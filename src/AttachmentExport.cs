using QuickLook.Common.Helpers;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// Stores images sent by the page and downloads HTTPS image links. Files are published atomically beside the
/// opened track; an unwritable source folder falls back to the plugin's local exports directory.
/// </summary>
internal sealed class AttachmentExport : IDisposable
{
    private const long MaxImageBytes = 30L * 1024 * 1024;
    private const long MaxTotalBytes = 300L * 1024 * 1024;
    private const int MaxImageCount = 200;
    private const string ManifestName = ".trailviewer-photo-export.json";
    private static readonly Regex BatchPattern = new("^[a-z0-9-]+$", RegexOptions.CultureInvariant);

    private static readonly HttpClient Http = CreateHttpClient();

    private readonly string _sourcePath;
    private readonly string _fileRoot;
    private readonly CancellationTokenSource _cancel = new();
    private readonly OverlayTransfer _upload = new((int)MaxImageBytes);
    private readonly object _writeLock = new();
    private readonly SemaphoreSlim _downloadSlots = new(3);
    private readonly ConcurrentDictionary<string, Task<bool>> _hostChecks =
        new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, AttachmentManifest> _manifests =
        new(StringComparer.OrdinalIgnoreCase);
    private readonly string _sourceSignature;
    private long _savedBytes;
    private int _savedCount;
    private bool _disposed;

    internal AttachmentExport(string sourcePath, string fileRoot = null)
    {
        _sourcePath = Path.GetFullPath(sourcePath);
        _fileRoot = Path.GetFullPath(fileRoot ?? Path.GetDirectoryName(_sourcePath) ?? "");
        var source = new FileInfo(_sourcePath);
        _sourceSignature = $"{_sourcePath}|{source.Length}|{source.LastWriteTimeUtc.Ticks}";
    }

    internal string CurrentBatch { get; private set; }

    internal int CurrentIndex { get; private set; }

    internal void BeginUpload(string body)
    {
        var parts = body.Split(new[] { '\t' }, 3);
        if (parts.Length != 3 || !BatchPattern.IsMatch(parts[0])
            || !int.TryParse(parts[1], out var index) || index < 0)
        {
            throw new InvalidDataException("the attachment upload header was invalid");
        }
        CurrentBatch = parts[0];
        CurrentIndex = index;
        _upload.Begin(parts[2]);
    }

    internal void AppendUpload(string body) => _upload.Append(body);

    internal AttachmentResult CompleteUpload(string body)
    {
        var parts = body.Split(new[] { '\t' }, 4);
        if (parts.Length != 4 || parts[0] != CurrentBatch
            || !int.TryParse(parts[1], out var index) || index != CurrentIndex
            || !int.TryParse(parts[3], out var count))
        {
            throw new InvalidDataException("the attachment upload did not match its header");
        }
        using var image = _upload.Complete($"{parts[2]}\t{count}");
        if (image == null) throw new InvalidDataException("the attachment upload was empty");
        return Save(CurrentBatch, CurrentIndex, image.Name, image.Picture);
    }

    internal Task<AttachmentResult> CompleteUploadAsync(string body) =>
        Task.Run(() => CompleteUpload(body), _cancel.Token);

    internal AttachmentResult CopyLocal(string body)
    {
        var parts = body.Split(new[] { '\t' }, 4);
        if (parts.Length != 4 || !BatchPattern.IsMatch(parts[0])
            || !int.TryParse(parts[1], out var index) || index < 0)
        {
            throw new InvalidDataException("the local attachment header was invalid");
        }

        string name;
        string relativePath;
        try
        {
            name = Uri.UnescapeDataString(parts[2]);
            relativePath = Uri.UnescapeDataString(parts[3]);
        }
        catch (UriFormatException)
        {
            throw new InvalidDataException("the local attachment path was invalid");
        }

        try
        {
            var source = ResolveLocalPath(relativePath);
            using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            return Save(parts[0], index, name, input);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
            or NotSupportedException or InvalidDataException)
        {
            return new AttachmentResult(parts[0], index, false, "", ex.Message);
        }
    }

    internal Task<AttachmentResult> CopyLocalAsync(string body) =>
        Task.Run(() => CopyLocal(body), _cancel.Token);

    internal async Task<AttachmentResult> DownloadAsync(string body)
    {
        var parts = body.Split(new[] { '\t' }, 4);
        if (parts.Length != 4 || !BatchPattern.IsMatch(parts[0])
            || !int.TryParse(parts[1], out var index) || index < 0)
        {
            throw new InvalidDataException("the attachment link header was invalid");
        }

        string name;
        string url;
        try
        {
            name = Uri.UnescapeDataString(parts[2]);
            url = Uri.UnescapeDataString(parts[3]);
        }
        catch (UriFormatException)
        {
            throw new InvalidDataException("the attachment link was invalid");
        }

        try
        {
            await _downloadSlots.WaitAsync(_cancel.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return new AttachmentResult(parts[0], index, false, "", "download canceled");
        }
        try
        {
            using var image = await DownloadImageAsync(url, _cancel.Token).ConfigureAwait(false);
            return Save(parts[0], index, ExtendName(name, image.Extension), image.Bytes);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
            or HttpRequestException or TaskCanceledException or InvalidDataException)
        {
            return new AttachmentResult(parts[0], index, false, "", ex.Message);
        }
        finally
        {
            _downloadSlots.Release();
        }
    }

    internal static string FolderTarget(string sourcePath)
    {
        var full = Path.GetFullPath(sourcePath);
        var parent = Path.GetDirectoryName(full) ?? "";
        var name = Path.GetFileNameWithoutExtension(full);
        if (string.IsNullOrWhiteSpace(name)) name = "track";
        return Path.Combine(parent, name + "-photos");
    }

    internal AttachmentResumeResult Resume(string body)
    {
        var parts = body.Split(new[] { '\t' }, 2);
        if (parts.Length != 2 || !BatchPattern.IsMatch(parts[0]))
            throw new InvalidDataException("the attachment resume header was invalid");

        var requested = new List<int>();
        foreach (var raw in parts[1].Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
        {
            if (!int.TryParse(raw, out var index) || index < 0)
                throw new InvalidDataException("the attachment resume index was invalid");
            requested.Add(index);
        }

        lock (_writeLock)
        {
            var completed = new List<int>();
            var folders = CandidateFolders();
            string folder = folders.FirstOrDefault() ?? FolderTarget(_sourcePath);
            var most = -1;
            foreach (var candidate in folders)
            {
                var manifest = LoadManifest(candidate);
                if (manifest == null) continue;
                var count = 0;
                foreach (var index in requested)
                {
                    if (!manifest.Completed.TryGetValue(index.ToString(), out var entry)) continue;
                    var target = Path.Combine(candidate, SanitiseFileName(entry.Name));
                    if (!File.Exists(target) || new FileInfo(target).Length != entry.Size) continue;
                    count += 1;
                }
                if (count > most)
                {
                    most = count;
                    folder = candidate;
                }
            }

            foreach (var index in requested)
            {
                foreach (var candidate in folders)
                {
                    var manifest = LoadManifest(candidate);
                    if (manifest == null
                        || !manifest.Completed.TryGetValue(index.ToString(), out var entry)) continue;
                    var target = Path.Combine(candidate, SanitiseFileName(entry.Name));
                    if (!File.Exists(target) || new FileInfo(target).Length != entry.Size) continue;
                    completed.Add(index);
                    break;
                }
            }
            return new AttachmentResumeResult(parts[0], completed, folder);
        }
    }

    internal Task<AttachmentResumeResult> ResumeAsync(string body) =>
        Task.Run(() => Resume(body), _cancel.Token);

    internal static bool IsAllowedUri(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !string.IsNullOrEmpty(uri.UserInfo)
            || string.IsNullOrWhiteSpace(uri.Host))
        {
            return false;
        }
        if (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || uri.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        return !IPAddress.TryParse(uri.DnsSafeHost, out var address) || !IsBlocked(address);
    }

    private AttachmentResult Save(string batch, int index, string name, Stream source)
    {
        try
        {
            var target = WriteUnique(index, name, source, FolderTarget(_sourcePath));
            return new AttachmentResult(batch, index, true, target, "");
        }
        catch (Exception first) when (first is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            try
            {
                var fallback = Path.Combine(SettingHelper.LocalDataPath, "exports", "photos");
                var target = WriteUnique(index, name, source, fallback);
                return new AttachmentResult(batch, index, true, target, "");
            }
            catch (Exception second) when (second is IOException or UnauthorizedAccessException or NotSupportedException)
            {
                return new AttachmentResult(batch, index, false, "", second.Message);
            }
        }
    }

    private string ResolveLocalPath(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath) || relativePath.IndexOf('\0') >= 0)
            throw new InvalidDataException("the local attachment path was empty");

        var root = _fileRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        var target = Path.GetFullPath(Path.Combine(_fileRoot,
            relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("the local attachment escaped the track folder");
        if (!File.Exists(target))
            throw new InvalidDataException("the local attachment no longer exists");
        return target;
    }

    private string WriteUnique(int index, string name, Stream source, string folder)
    {
        lock (_writeLock)
        {
            if (_savedCount >= MaxImageCount)
                throw new InvalidDataException($"the attachment export exceeds {MaxImageCount} images");
            if (source.Length > MaxImageBytes)
                throw new InvalidDataException($"the image is larger than {MaxImageBytes / (1024 * 1024)} MB");
            if (_savedBytes + source.Length > MaxTotalBytes)
                throw new InvalidDataException("the attachment images exceed the 300 MB export limit");

            Directory.CreateDirectory(folder);
            var safe = SanitiseFileName(name);
            var stem = Path.GetFileNameWithoutExtension(safe);
            var extension = Path.GetExtension(safe);
            var target = Path.Combine(folder, safe);
            for (var suffix = 2; File.Exists(target); suffix++)
                target = Path.Combine(folder, $"{stem}-{suffix}{extension}");

            AtomicFile.Write(target, source);
            _savedBytes += source.Length;
            _savedCount += 1;
            MarkCompleted(folder, index, target, source.Length);
            return target;
        }
    }

    private IEnumerable<string> CandidateFolders()
    {
        var primary = FolderTarget(_sourcePath);
        if (Directory.Exists(primary)) yield return primary;
        var fallback = Path.Combine(SettingHelper.LocalDataPath, "exports", "photos");
        if (Directory.Exists(fallback)) yield return fallback;
    }

    private AttachmentManifest LoadManifest(string folder)
    {
        if (_manifests.TryGetValue(folder, out var cached)) return cached;
        var path = Path.Combine(folder, ManifestName);
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            var serializer = new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024 };
            var root = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(path, Encoding.UTF8));
            if (root == null || Convert.ToInt32(root["version"]) != 1
                || !string.Equals(root["source"] as string, _sourceSignature, StringComparison.Ordinal))
                return null;
            var manifest = new AttachmentManifest
            {
                Version = 1,
                Source = _sourceSignature,
                Completed = new Dictionary<string, AttachmentManifestEntry>(),
            };
            if (root["completed"] is IDictionary<string, object> completed)
            {
                foreach (var pair in completed)
                {
                    if (!(pair.Value is IDictionary<string, object> entry)
                        || !(entry["name"] is string name)
                        || entry["size"] == null)
                    {
                        continue;
                    }
                    manifest.Completed[pair.Key] = new AttachmentManifestEntry
                    {
                        Name = name,
                        Size = Convert.ToInt64(entry["size"]),
                    };
                }
            }
            _manifests[folder] = manifest;
            return manifest;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
            or InvalidOperationException or ArgumentException or KeyNotFoundException or FormatException)
        {
            return null;
        }
    }

    private void MarkCompleted(string folder, int index, string target, long size)
    {
        var manifest = LoadManifest(folder);
        if (manifest == null)
        {
            manifest = new AttachmentManifest
            {
                Version = 1,
                Source = _sourceSignature,
                Completed = new Dictionary<string, AttachmentManifestEntry>(),
            };
        }
        _manifests[folder] = manifest;
        try
        {
            WriteManifest(folder, manifest, index, target, size);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException
            or InvalidOperationException or ArgumentException)
        {
            // A read-only export folder can still deliver the image even when resume state cannot be stored.
        }
    }

    private void WriteManifest(string folder, AttachmentManifest manifest, int index, string target, long size)
    {
        var key = index.ToString();
        manifest.Completed[key] = new AttachmentManifestEntry
        {
            Name = Path.GetFileName(target),
            Size = size,
        };
        var serializer = new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024 };
        var root = new Dictionary<string, object>
        {
            ["version"] = 1,
            ["source"] = _sourceSignature,
            ["completed"] = manifest.Completed.ToDictionary(
                pair => pair.Key,
                pair => (object)new Dictionary<string, object>
                {
                    ["name"] = pair.Value.Name,
                    ["size"] = pair.Value.Size,
                }),
        };
        var bytes = Encoding.UTF8.GetBytes(serializer.Serialize(root));
        using var stream = new MemoryStream(bytes);
        var path = Path.Combine(folder, ManifestName);
        AtomicFile.Write(path, stream);
        try { File.SetAttributes(path, File.GetAttributes(path) | FileAttributes.Hidden); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { }
    }

    private async Task<DownloadedImage> DownloadImageAsync(string value, CancellationToken cancel)
    {
        var uri = new Uri(value, UriKind.Absolute);
        for (var redirect = 0; redirect <= 4; redirect++)
        {
            if (!IsAllowedUri(uri.AbsoluteUri))
                throw new InvalidDataException("only public HTTPS image links can be downloaded");
            await EnsurePublicHostAsync(uri, cancel).ConfigureAwait(false);

            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.Accept.ParseAdd("image/*");
            using var response = await Http.SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, cancel).ConfigureAwait(false);

            if ((int)response.StatusCode >= 300 && (int)response.StatusCode < 400)
            {
                var location = response.Headers.Location;
                if (location == null)
                    throw new InvalidDataException("the image redirect had no destination");
                uri = location.IsAbsoluteUri ? location : new Uri(uri, location);
                continue;
            }
            if (!response.IsSuccessStatusCode)
                throw new InvalidDataException($"the image server returned HTTP {(int)response.StatusCode}");

            var mediaType = response.Content.Headers.ContentType?.MediaType?.ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(mediaType) || !mediaType.StartsWith("image/", StringComparison.Ordinal))
                throw new InvalidDataException("the external link did not return an image");
            if (response.Content.Headers.ContentLength > MaxImageBytes)
                throw new InvalidDataException("the image is larger than 30 MB");

            using var input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
            var output = new MemoryStream();
            try
            {
                var buffer = new byte[81920];
                long total = 0;
                int read;
                while ((read = await input.ReadAsync(buffer, 0, buffer.Length, cancel).ConfigureAwait(false)) > 0)
                {
                    total += read;
                    if (total > MaxImageBytes)
                        throw new InvalidDataException("the image is larger than 30 MB");
                    output.Write(buffer, 0, read);
                }
                output.Position = 0;
                var header = new byte[32];
                var headerLength = output.Read(header, 0, header.Length);
                output.Position = 0;
                var extension = ImageExtensionFor(header, headerLength);
                if (extension == null)
                    throw new InvalidDataException("the external image content was not recognised");
                return new DownloadedImage(output, extension);
            }
            catch
            {
                output.Dispose();
                throw;
            }
        }
        throw new InvalidDataException("the image used too many redirects");
    }

    /// <summary>
    /// shortcut: DNS is checked before HttpClient resolves it again. Upgrade to a pinned-IP connector if hostile
    /// DNS rebinding becomes part of the threat model.
    /// </summary>
    private async Task EnsurePublicHostAsync(Uri uri, CancellationToken cancel)
    {
        string host = uri.DnsSafeHost;
        var check = _hostChecks.GetOrAdd(host, _ => ValidatePublicHostAsync(host, cancel));
        if (!await check.ConfigureAwait(false))
        {
            // A DNS timeout is transient. Do not poison every later image from this host in the batch.
            _hostChecks.TryRemove(host, out _);
            throw new InvalidDataException("the image host did not resolve to a public address");
        }
    }

    private static async Task<bool> ValidatePublicHostAsync(string host, CancellationToken cancel)
    {
        if (IPAddress.TryParse(host, out var literal))
        {
            return !IsBlocked(literal);
        }

        try
        {
            var addresses = await Task.Run(() => Dns.GetHostAddresses(host), cancel)
                .ConfigureAwait(false);
            return addresses.Length > 0 && !addresses.Any(IsBlockedResolved);
        }
        catch (Exception ex) when (ex is System.Net.Sockets.SocketException or OperationCanceledException)
        {
            return false;
        }
    }

    private static bool IsBlocked(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (IPAddress.IsLoopback(address)) return true;
        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        {
            return bytes[0] == 0 || bytes[0] == 10 || bytes[0] == 127
                || (bytes[0] == 169 && bytes[1] == 254)
                || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
                || (bytes[0] == 192 && bytes[1] == 0 && (bytes[2] == 0 || bytes[2] == 2))
                || (bytes[0] == 192 && bytes[1] == 168)
                || (bytes[0] == 100 && bytes[1] >= 64 && bytes[1] <= 127)
                || (bytes[0] == 198 && (bytes[1] == 18 || bytes[1] == 19))
                || (bytes[0] == 198 && bytes[1] == 51 && bytes[2] == 100)
                || (bytes[0] == 203 && bytes[1] == 0 && bytes[2] == 113)
                || bytes[0] >= 224;
        }
        return bytes.All(value => value == 0)
            || (bytes[0] & 0xfe) == 0xfc
            || (bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80)
            || (bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0xc0)
            || (bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0x0d && bytes[3] == 0xb8)
            || bytes[0] == 0xff;
    }

    /// <summary>
    /// Clash/Mihomo TUN commonly maps public hostnames into the 198.18.0.0/15 benchmark range. Literal addresses
    /// remain blocked; only a hostname resolved through the local network stack may use this proxy range.
    /// </summary>
    internal static bool IsBlockedResolved(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork
            && bytes[0] == 198 && (bytes[1] == 18 || bytes[1] == 19))
            return false;
        return IsBlocked(address);
    }

    internal static string ImageExtensionFor(byte[] bytes, int length = -1)
    {
        var available = Math.Min(bytes?.Length ?? 0, length < 0 ? bytes?.Length ?? 0 : length);
        bool Starts(params byte[] prefix) =>
            available >= prefix.Length
            && prefix.Select((value, index) => bytes[index] == value).All(match => match);

        if (Starts(0xff, 0xd8, 0xff)) return ".jpg";
        if (Starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return ".png";
        if (Starts(0x47, 0x49, 0x46, 0x38) && available >= 6
            && (bytes[4] == 0x37 || bytes[4] == 0x39) && bytes[5] == 0x61) return ".gif";
        if (Starts(0x42, 0x4d)) return ".bmp";
        if (Starts(0x52, 0x49, 0x46, 0x46) && available >= 12
            && bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50)
            return ".webp";
        if (available >= 12
            && bytes[4] == 0x66 && bytes[5] == 0x74 && bytes[6] == 0x79 && bytes[7] == 0x70
            && bytes[8] == 0x61 && bytes[9] == 0x76 && bytes[10] == 0x69
            && (bytes[11] == 0x66 || bytes[11] == 0x73))
            return ".avif";
        return null;
    }

    private static string ExtendName(string name, string extension)
    {
        var safe = SanitiseFileName(name);
        var stem = Path.GetFileNameWithoutExtension(safe);
        return (string.IsNullOrWhiteSpace(stem) ? "photo" : stem) + extension;
    }

    private static string SanitiseFileName(string name)
    {
        var leaf = Path.GetFileName(name ?? "");
        foreach (var bad in Path.GetInvalidFileNameChars())
            leaf = leaf.Replace(bad, '_');
        leaf = leaf.Trim().TrimEnd('.', ' ');
        return string.IsNullOrWhiteSpace(leaf) || leaf == "." || leaf == ".." ? "photo.jpg" : leaf;
    }

    private static HttpClient CreateHttpClient()
    {
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
        };
        var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(10) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("TrailViewer/1.0");
        return client;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cancel.Cancel();
        _upload.Dispose();
        // In-flight downloads still release _downloadSlots in their finally blocks. Keep the semaphore and
        // cancellation source alive until those tasks finish; both are managed objects and will be collected.
    }

    private sealed class DownloadedImage : IDisposable
    {
        internal DownloadedImage(MemoryStream bytes, string extension)
        {
            Bytes = bytes;
            Extension = extension;
        }

        internal MemoryStream Bytes { get; }

        internal string Extension { get; }

        public void Dispose() => Bytes.Dispose();
    }
}

internal sealed class AttachmentResult
{
    internal AttachmentResult(string batch, int index, bool ok, string path, string detail)
    {
        Batch = batch;
        Index = index;
        Ok = ok;
        Path = path;
        Detail = detail;
    }

    internal string Batch { get; }

    internal int Index { get; }

    internal bool Ok { get; }

    internal string Path { get; }

    internal string Detail { get; }
}

internal sealed class AttachmentResumeResult
{
    internal AttachmentResumeResult(string batch, IEnumerable<int> completed, string folder)
    {
        Batch = batch;
        Completed = completed.ToArray();
        Folder = folder;
    }

    internal string Batch { get; }

    internal int[] Completed { get; }

    internal string Folder { get; }
}

internal sealed class AttachmentManifest
{
    public int Version { get; set; }

    public string Source { get; set; }

    public Dictionary<string, AttachmentManifestEntry> Completed { get; set; }
        = new Dictionary<string, AttachmentManifestEntry>();
}

internal sealed class AttachmentManifestEntry
{
    public string Name { get; set; }

    public long Size { get; set; }
}
