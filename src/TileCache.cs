using QuickLook.Common.Helpers;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace QuickLook.Plugin.TrailViewer;

internal enum TileLookupKind
{
    Miss,
    Fresh,
    Expired,
}

internal sealed class TileCacheEntry
{
    internal byte[] Data { get; }
    internal string ContentType { get; }
    internal DateTime WrittenUtc { get; }

    internal TileCacheEntry(byte[] data, string contentType, DateTime writtenUtc)
    {
        Data = data;
        ContentType = contentType;
        WrittenUtc = writtenUtc;
    }
}

internal sealed class TileCacheStats
{
    internal long TotalBytes { get; }
    internal int TileCount { get; }

    internal TileCacheStats(long totalBytes, int tileCount)
    {
        TotalBytes = totalBytes;
        TileCount = tileCount;
    }
}

internal sealed class CustomHostMatcher
{
    private readonly string? _exactHost;
    private readonly string? _prefix;
    private readonly string? _suffix;
    private readonly HashSet<string>? _subdomains;

    internal string CanonicalHost { get; }

    internal CustomHostMatcher(string exactHost, string canonicalHost)
    {
        _exactHost = exactHost;
        CanonicalHost = canonicalHost;
    }

    internal CustomHostMatcher(string prefix, string suffix, string canonicalHost, string subdomains)
    {
        _prefix = prefix;
        _suffix = suffix;
        CanonicalHost = canonicalHost;
        if (!string.IsNullOrEmpty(subdomains))
        {
            _subdomains = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var ch in subdomains)
                _subdomains.Add(prefix + ch + suffix);
        }
    }

    internal bool Matches(string host)
    {
        if (_exactHost != null)
            return string.Equals(host, _exactHost, StringComparison.OrdinalIgnoreCase);

        if (_subdomains != null)
            return _subdomains.Contains(host);

        return _prefix != null
            && _suffix != null
            && host.Length > _prefix.Length + _suffix.Length
            && host.StartsWith(_prefix, StringComparison.OrdinalIgnoreCase)
            && host.EndsWith(_suffix, StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>
/// Persistent host-owned disk cache for map tiles, shared across versioned WebView2 origins.
/// Stores only verified image tiles keyed by normalized URL without personal API tokens.
/// </summary>
internal sealed class TileCache
{
    internal const int MaxTileBytes = 2 * 1024 * 1024;
    private const int HeaderLength = 5;
    private const int PruneWriteInterval = 40;
    private static readonly byte[] Magic = { 0x54, 0x56, 0x43, 0x31 }; // "TVC1"
    private static readonly TimeSpan TouchThreshold = TimeSpan.FromHours(1);

    private static readonly string DefaultDirectory = Path.Combine(
        SettingHelper.LocalDataPath, PluginIdentity.Name, "tile-cache");

    private static readonly JavaScriptSerializer Serializer = new()
    {
        MaxJsonLength = 128 * 1024,
        RecursionLimit = 100,
    };

    internal static readonly TileCache Shared = new(DefaultDirectory);

    internal static readonly HttpClient RefreshHttpClient = new(
        new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            UseProxy = true,
        })
    {
        Timeout = TimeSpan.FromSeconds(4),
    };

    private readonly string _rootDirectory;
    private int _writeCount;
    private int _pruning;

    internal TileCache(string rootDirectory)
    {
        _rootDirectory = rootDirectory;
    }

    internal static IReadOnlyList<CustomHostMatcher> BuildCustomHostMatchers(string? customSourcesJson)
    {
        var matchers = new List<CustomHostMatcher>();
        if (string.IsNullOrWhiteSpace(customSourcesJson))
            return matchers;

        try
        {
            if (!(Serializer.DeserializeObject(customSourcesJson) is object[] items))
                return matchers;

            foreach (var item in items)
            {
                if (!(item is IDictionary<string, object> source))
                    continue;
                if (!source.TryGetValue("url", out var urlValue) || urlValue == null)
                    continue;
                var rawUrl = Convert.ToString(urlValue) ?? string.Empty;
                if (!rawUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    continue;

                var subdomains = source.TryGetValue("subdomains", out var subValue) && subValue != null
                    ? Convert.ToString(subValue) ?? string.Empty
                    : string.Empty;

                var candidate = rawUrl
                    .Replace("{z}", "1")
                    .Replace("{x}", "1")
                    .Replace("{y}", "1");

                var hasSubToken = candidate.IndexOf("{s}", StringComparison.OrdinalIgnoreCase) >= 0;
                var normalizedUrl = hasSubToken
                    ? candidate.Replace("{s}", "0").Replace("{S}", "0")
                    : candidate.Replace("%7Bs%7D", "0").Replace("%7BS%7D", "0");

                if (!Uri.TryCreate(normalizedUrl, UriKind.Absolute, out var parsed)
                    || string.IsNullOrEmpty(parsed.Host))
                    continue;

                var rawAuthorityEnd = rawUrl.IndexOf('/', "https://".Length);
                var rawAuthority = (rawAuthorityEnd > 0
                    ? rawUrl.Substring("https://".Length, rawAuthorityEnd - "https://".Length)
                    : rawUrl.Substring("https://".Length)).ToLowerInvariant();

                var tokenIndex = rawAuthority.IndexOf("{s}", StringComparison.OrdinalIgnoreCase);
                if (tokenIndex >= 0)
                {
                    var prefix = rawAuthority.Substring(0, tokenIndex);
                    var suffix = rawAuthority.Substring(tokenIndex + 3);
                    var colon = suffix.IndexOf(':');
                    if (colon >= 0)
                        suffix = suffix.Substring(0, colon);
                    var canonical = NormalizeCustomHost(prefix + suffix);
                    matchers.Add(new CustomHostMatcher(prefix, suffix, canonical, subdomains));
                }
                else
                {
                    var host = parsed.Host.ToLowerInvariant();
                    matchers.Add(new CustomHostMatcher(host, NormalizeCustomHost(host)));
                }
            }
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            return Array.Empty<CustomHostMatcher>();
        }

        return matchers;
    }

    internal static bool TryBuildKey(
        Uri uri,
        IReadOnlyList<CustomHostMatcher>? customMatchers,
        out string normalizedKey)
    {
        normalizedKey = string.Empty;
        if (!uri.IsAbsoluteUri || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            return false;

        var host = uri.Host.ToLowerInvariant();
        if (string.IsNullOrEmpty(host)
            || host.EndsWith("." + PluginIdentity.VirtualHostSuffix, StringComparison.OrdinalIgnoreCase)
            || string.Equals(host, PluginIdentity.VirtualHostSuffix, StringComparison.OrdinalIgnoreCase))
            return false;

        var isTianditu = false;
        string? canonicalHost = null;

        if (MatchesSuffixHost(host, "tile.openstreetmap.fr"))
            canonicalHost = "tile.openstreetmap.fr";
        else if (MatchesSuffixHost(host, "tile-cyclosm.openstreetmap.fr"))
            canonicalHost = "tile-cyclosm.openstreetmap.fr";
        else if (string.Equals(host, "tile.openmaps.fr", StringComparison.OrdinalIgnoreCase))
            canonicalHost = "tile.openmaps.fr";
        else if (MatchesSuffixHost(host, "tile.opentopomap.org"))
            canonicalHost = "tile.opentopomap.org";
        else if (string.Equals(host, "server.arcgisonline.com", StringComparison.OrdinalIgnoreCase)
            && uri.AbsolutePath.StartsWith(
                "/ArcGIS/rest/services/World_Imagery/MapServer/tile/",
                StringComparison.OrdinalIgnoreCase))
            canonicalHost = "server.arcgisonline.com";
        else if (MatchesSuffixHost(host, "tianditu.gov.cn"))
        {
            canonicalHost = "t.tianditu.gov.cn";
            isTianditu = true;
        }
        else if (customMatchers != null)
        {
            foreach (var matcher in customMatchers)
            {
                if (matcher.Matches(host))
                {
                    canonicalHost = matcher.CanonicalHost;
                    break;
                }
            }
        }

        if (canonicalHost == null)
            return false;

        var canonicalQuery = NormalizeQuery(uri.Query, stripToken: isTianditu);
        normalizedKey = canonicalQuery.Length > 0
            ? canonicalHost + uri.AbsolutePath + "?" + canonicalQuery
            : canonicalHost + uri.AbsolutePath;
        return true;
    }

    internal static bool TryDetectImageContentType(
        byte[]? data,
        string? headerContentType,
        out byte code,
        out string contentType)
    {
        code = 0;
        contentType = string.Empty;
        if (data == null || data.Length == 0 || data.Length > MaxTileBytes)
            return false;

        if (data.Length >= 8
            && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47
            && data[4] == 0x0D && data[5] == 0x0A && data[6] == 0x1A && data[7] == 0x0A)
        {
            code = 1;
            contentType = "image/png";
            return true;
        }
        if (data.Length >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF)
        {
            code = 2;
            contentType = "image/jpeg";
            return true;
        }
        if (data.Length >= 12
            && data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46
            && data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50)
        {
            code = 3;
            contentType = "image/webp";
            return true;
        }
        if (data.Length >= 6
            && data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38
            && (data[4] == 0x37 || data[4] == 0x39) && data[5] == 0x61)
        {
            code = 4;
            contentType = "image/gif";
            return true;
        }
        if (data.Length >= 12
            && data[4] == 0x66 && data[5] == 0x74 && data[6] == 0x79 && data[7] == 0x70
            && data[8] == 0x61 && data[9] == 0x76 && data[10] == 0x69
            && (data[11] == 0x66 || data[11] == 0x73))
        {
            code = 5;
            contentType = "image/avif";
            return true;
        }
        return false;
    }

    internal TileLookupKind TryRead(
        string normalizedKey,
        TileCacheOptions options,
        DateTime utcNow,
        out TileCacheEntry? entry)
    {
        entry = null;
        if (!options.Enabled)
            return TileLookupKind.Miss;

        var path = PathForKey(normalizedKey);
        byte[] raw;
        DateTime writtenUtc;
        DateTime accessUtc;
        try
        {
            if (!File.Exists(path))
                return TileLookupKind.Miss;

            raw = File.ReadAllBytes(path);
            writtenUtc = File.GetLastWriteTimeUtc(path);
            accessUtc = File.GetLastAccessTimeUtc(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return TileLookupKind.Miss;
        }

        if (raw.Length <= HeaderLength
            || raw[0] != Magic[0] || raw[1] != Magic[1] || raw[2] != Magic[2] || raw[3] != Magic[3])
            return TileLookupKind.Miss;

        var contentType = ContentTypeForCode(raw[4]);
        if (contentType == null)
            return TileLookupKind.Miss;

        var payload = new byte[raw.Length - HeaderLength];
        Buffer.BlockCopy(raw, HeaderLength, payload, 0, payload.Length);
        entry = new TileCacheEntry(payload, contentType, writtenUtc);

        var expired = options.MaxAgeDays > 0
            && (utcNow - writtenUtc) > TimeSpan.FromDays(options.MaxAgeDays);
        if (expired)
            return TileLookupKind.Expired;

        if ((utcNow - accessUtc) > TouchThreshold)
        {
            try
            {
                File.SetLastAccessTimeUtc(path, utcNow);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Touching access time is best-effort LRU hygiene.
            }
        }
        return TileLookupKind.Fresh;
    }

    internal bool Store(
        string normalizedKey,
        byte[] imageBytes,
        string? headerContentType,
        TileCacheOptions options,
        DateTime utcNow)
    {
        if (!options.Enabled)
            return false;
        if (!TryDetectImageContentType(imageBytes, headerContentType, out var code, out _))
            return false;

        var path = PathForKey(normalizedKey);
        var envelope = new byte[HeaderLength + imageBytes.Length];
        Buffer.BlockCopy(Magic, 0, envelope, 0, Magic.Length);
        envelope[4] = code;
        Buffer.BlockCopy(imageBytes, 0, envelope, HeaderLength, imageBytes.Length);

        try
        {
            var folder = Path.GetDirectoryName(path);
            if (string.IsNullOrEmpty(folder))
                return false;
            Directory.CreateDirectory(folder);
            AtomicFile.WriteBytes(path, envelope);
            File.SetLastWriteTimeUtc(path, utcNow);
            File.SetLastAccessTimeUtc(path, utcNow);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }

        if ((!options.IsUnlimited || options.MaxAgeDays > 0)
            && Interlocked.Increment(ref _writeCount) % PruneWriteInterval == 0)
            SchedulePrune(options, removeExpired: IsNetworkAvailable());

        return true;
    }

    internal void SchedulePrune(
        TileCacheOptions options,
        bool removeExpired,
        Action<TileCacheStats>? onComplete = null)
    {
        if (Interlocked.CompareExchange(ref _pruning, 1, 0) != 0)
            return;

        _ = Task.Run(() =>
        {
            try
            {
                var stats = Prune(options, DateTime.UtcNow, removeExpired);
                onComplete?.Invoke(stats);
            }
            finally
            {
                Interlocked.Exchange(ref _pruning, 0);
            }
        });
    }

    internal TileCacheStats Prune(TileCacheOptions options, DateTime utcNow, bool removeExpired)
    {
        if (!Directory.Exists(_rootDirectory))
            return new TileCacheStats(0, 0);

        var files = new List<TileFileRecord>();
        try
        {
            foreach (var file in Directory.EnumerateFiles(_rootDirectory, "*.tile", SearchOption.AllDirectories))
            {
                try
                {
                    var info = new FileInfo(file);
                    if (!info.Exists)
                        continue;
                    files.Add(new TileFileRecord(
                        info.FullName, info.Length, info.LastWriteTimeUtc, info.LastAccessTimeUtc));
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // Skip files moving concurrently.
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new TileCacheStats(0, 0);
        }

        var remaining = new List<TileFileRecord>(files.Count);
        var maxAge = options.MaxAgeDays > 0 ? TimeSpan.FromDays(options.MaxAgeDays) : (TimeSpan?)null;
        long totalBytes = 0;

        foreach (var file in files)
        {
            if (removeExpired && maxAge.HasValue && (utcNow - file.WrittenUtc) > maxAge.Value)
            {
                TryDeleteFile(file.Path);
                continue;
            }
            remaining.Add(file);
            totalBytes += file.Length;
        }

        if (!options.IsUnlimited && totalBytes > options.MaxBytes && remaining.Count > 0)
        {
            remaining.Sort((a, b) =>
            {
                var access = a.AccessUtc.CompareTo(b.AccessUtc);
                return access != 0 ? access : a.WrittenUtc.CompareTo(b.WrittenUtc);
            });
            var targetBytes = options.MaxBytes > 0 ? (long)(options.MaxBytes * 0.90) : 0L;
            var kept = new List<TileFileRecord>(remaining.Count);
            foreach (var file in remaining)
            {
                if (totalBytes > targetBytes)
                {
                    if (TryDeleteFile(file.Path))
                        totalBytes -= file.Length;
                    else
                        kept.Add(file);
                }
                else
                {
                    kept.Add(file);
                }
            }
            remaining = kept;
        }

        RemoveEmptyShardDirectories();
        return new TileCacheStats(Math.Max(0, totalBytes), remaining.Count);
    }

    internal TileCacheStats GetStats()
    {
        if (!Directory.Exists(_rootDirectory))
            return new TileCacheStats(0, 0);

        long totalBytes = 0;
        var count = 0;
        try
        {
            foreach (var file in Directory.EnumerateFiles(_rootDirectory, "*.tile", SearchOption.AllDirectories))
            {
                try
                {
                    var info = new FileInfo(file);
                    if (!info.Exists)
                        continue;
                    totalBytes += info.Length;
                    count++;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // Skip files moving concurrently.
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new TileCacheStats(0, 0);
        }
        return new TileCacheStats(totalBytes, count);
    }

    internal TileCacheStats Clear()
    {
        if (!Directory.Exists(_rootDirectory))
            return new TileCacheStats(0, 0);

        try
        {
            foreach (var file in Directory.EnumerateFiles(_rootDirectory, "*.tile", SearchOption.AllDirectories))
                TryDeleteFile(file);
            RemoveEmptyShardDirectories();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Best-effort clear; return whatever remains.
        }
        return GetStats();
    }

    internal string PathForKey(string normalizedKey)
    {
        using var sha = SHA256.Create();
        var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(normalizedKey));
        var builder = new StringBuilder(hash.Length * 2);
        foreach (var b in hash)
            builder.Append(b.ToString("x2"));
        var hex = builder.ToString();
        return Path.Combine(_rootDirectory, hex.Substring(0, 2), hex + ".tile");
    }

    internal static bool IsNetworkAvailable()
    {
        try
        {
            return NetworkInterface.GetIsNetworkAvailable();
        }
        catch
        {
            return true;
        }
    }

    private static bool MatchesSuffixHost(string host, string suffix) =>
        string.Equals(host, suffix, StringComparison.OrdinalIgnoreCase)
        || host.EndsWith("." + suffix, StringComparison.OrdinalIgnoreCase);

    private static string NormalizeCustomHost(string host)
    {
        if (host.EndsWith(".google.com", StringComparison.OrdinalIgnoreCase))
        {
            var dot = host.IndexOf('.');
            var prefix = dot > 0 ? host.Substring(0, dot) : host;
            if (prefix.StartsWith("mts", StringComparison.OrdinalIgnoreCase)
                && prefix.Length == 4 && char.IsDigit(prefix[3]))
                return "mts" + host.Substring(dot);
            if (prefix.StartsWith("mt", StringComparison.OrdinalIgnoreCase)
                && prefix.Length == 3 && char.IsDigit(prefix[2]))
                return "mt" + host.Substring(dot);
        }
        return host;
    }

    private static string NormalizeQuery(string query, bool stripToken)
    {
        if (string.IsNullOrEmpty(query) || query == "?")
            return string.Empty;

        var trimmed = query[0] == '?' ? query.Substring(1) : query;
        if (trimmed.Length == 0)
            return string.Empty;

        var pairs = new List<string>();
        foreach (var part in trimmed.Split('&'))
        {
            if (part.Length == 0)
                continue;
            var equals = part.IndexOf('=');
            var key = equals >= 0 ? part.Substring(0, equals) : part;
            if (stripToken && string.Equals(key, "tk", StringComparison.OrdinalIgnoreCase))
                continue;
            pairs.Add(part);
        }
        if (pairs.Count == 0)
            return string.Empty;
        pairs.Sort(StringComparer.Ordinal);
        return string.Join("&", pairs);
    }

    private static string? ContentTypeForCode(byte code) => code switch
    {
        1 => "image/png",
        2 => "image/jpeg",
        3 => "image/webp",
        4 => "image/gif",
        5 => "image/avif",
        _ => null,
    };

    private static bool TryDeleteFile(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private void RemoveEmptyShardDirectories()
    {
        try
        {
            foreach (var dir in Directory.EnumerateDirectories(_rootDirectory))
            {
                try
                {
                    if (!Directory.EnumerateFileSystemEntries(dir).Any())
                        Directory.Delete(dir);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // Ignore busy shard directories.
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Ignore top-level enumeration errors.
        }
    }

    private sealed class TileFileRecord
    {
        internal string Path { get; }
        internal long Length { get; }
        internal DateTime WrittenUtc { get; }
        internal DateTime AccessUtc { get; }

        internal TileFileRecord(string path, long length, DateTime writtenUtc, DateTime accessUtc)
        {
            Path = path;
            Length = length;
            WrittenUtc = writtenUtc;
            AccessUtc = accessUtc;
        }
    }
}
