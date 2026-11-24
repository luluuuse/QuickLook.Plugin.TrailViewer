using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace QuickLook.Plugin.TrailViewer;

internal sealed class UpdateStatusInfo
{
    public string Status { get; set; } = "idle"; // "available" | "up-to-date" | "ignored" | "error" | "silent-error"
    public string CurrentVersion { get; set; } = string.Empty;
    public string LatestVersion { get; set; } = string.Empty;
    public string PublishedAt { get; set; } = string.Empty;
    public string ReleaseUrl { get; set; } = string.Empty;
    public string AssetName { get; set; } = string.Empty;
    public string AssetUrl { get; set; } = string.Empty;
    public string FallbackAssetUrl { get; set; } = string.Empty;
    public long AssetSize { get; set; }
    public string ExpectedSha256 { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty; // "github" | "gitcode"
    public string NotesZh { get; set; } = string.Empty;
    public string NotesEn { get; set; } = string.Empty;
    public string IgnoredVersion { get; set; } = string.Empty;
    public string Detail { get; set; } = string.Empty;
    public bool FromCache { get; set; }
    public bool HasUpdate { get; set; }
}

internal sealed class UpdateStateRecord
{
    public string LastCheckedUtc { get; set; } = string.Empty;
    public string IgnoredVersion { get; set; } = string.Empty;
    public string LatestVersion { get; set; } = string.Empty;
    public string PublishedAt { get; set; } = string.Empty;
    public string ReleaseUrl { get; set; } = string.Empty;
    public string AssetName { get; set; } = string.Empty;
    public string AssetUrl { get; set; } = string.Empty;
    public string FallbackAssetUrl { get; set; } = string.Empty;
    public long AssetSize { get; set; }
    public string ExpectedSha256 { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public string NotesZh { get; set; } = string.Empty;
    public string NotesEn { get; set; } = string.Empty;
}

/// <summary>
/// Checks GitHub Releases and the GitCode mirror for newer TrailViewer versions, caches results for 24 h,
/// verifies SHA256 and package manifest integrity, and hands verified .qlplugin packages to QuickLook.
/// </summary>
internal static class UpdateChecker
{
    internal const string RepoOwner = "luluuuse";
    internal const string RepoName = "QuickLook.Plugin.TrailViewer";
    internal const string LatestReleaseApiUrl =
        "https://api.github.com/repos/" + RepoOwner + "/" + RepoName + "/releases/latest";
    internal const string ReleasesPageUrl =
        "https://github.com/" + RepoOwner + "/" + RepoName + "/releases";

    internal const string MirrorOwner = "luluse";
    internal const string MirrorRepoName = "QuickLook.Plugin.TrailViewer";
    internal const string MirrorReleasesApiUrl =
        "https://api.gitcode.com/api/v5/repos/" + MirrorOwner + "/" + MirrorRepoName + "/releases";
    internal const string MirrorReleasesPageUrl =
        "https://gitcode.com/" + MirrorOwner + "/" + MirrorRepoName + "/releases";

    private const long MaxPackageBytes = 32L * 1024 * 1024;
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(24);
    private static readonly Regex SemverPattern = new(
        @"^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?<pre>-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$",
        RegexOptions.CultureInvariant);
    private static readonly Regex Sha256Pattern = new(
        @"\b(?<hex>[0-9a-fA-F]{64})\b",
        RegexOptions.CultureInvariant);

    private static readonly object StateLock = new();
    private static readonly HttpClient ApiClient = CreateHttpClient(TimeSpan.FromSeconds(8));
    private static readonly HttpClient DownloadClient = CreateHttpClient(TimeSpan.FromSeconds(120));

    private static HttpClient CreateHttpClient(TimeSpan timeout)
    {
        EnsureModernTls();
        var handler = new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            AllowAutoRedirect = true,
            MaxAutomaticRedirections = 5,
            UseProxy = true,
        };
        var client = new HttpClient(handler) { Timeout = timeout };
        client.DefaultRequestHeaders.UserAgent.ParseAdd(
            $"QuickLook.Plugin.TrailViewer/{BuildInfo.ProductVersion}");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        return client;
    }

    private static void EnsureModernTls()
    {
        try
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12 | (SecurityProtocolType)12288;
        }
        catch (NotSupportedException)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        }
    }

    internal static string DefaultStatePath()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(local, PluginIdentity.Name, "update-state.json");
    }

    /// <summary>
    /// Compares two semantic version strings (ignoring leading 'v'). Returns &gt;0 if left is newer,
    /// &lt;0 if right is newer, 0 if equal. Stable versions always sort newer than prereleases of the same triple.
    /// </summary>
    internal static int CompareVersions(string? left, string? right)
    {
        var lOk = TryParseVersion(left, out var lMaj, out var lMin, out var lPat, out var lPre);
        var rOk = TryParseVersion(right, out var rMaj, out var rMin, out var rPat, out var rPre);
        if (!lOk && !rOk) return 0;
        if (!lOk) return -1;
        if (!rOk) return 1;

        var cmp = lMaj.CompareTo(rMaj);
        if (cmp != 0) return cmp;
        cmp = lMin.CompareTo(rMin);
        if (cmp != 0) return cmp;
        cmp = lPat.CompareTo(rPat);
        if (cmp != 0) return cmp;

        if (string.IsNullOrEmpty(lPre) && string.IsNullOrEmpty(rPre)) return 0;
        if (string.IsNullOrEmpty(lPre)) return 1;
        if (string.IsNullOrEmpty(rPre)) return -1;
        return string.Compare(lPre, rPre, StringComparison.OrdinalIgnoreCase);
    }

    internal static bool IsPrerelease(string? version) =>
        TryParseVersion(version, out _, out _, out _, out var pre) && !string.IsNullOrEmpty(pre);

    internal static string NormalizeVersion(string? raw)
    {
        if (!TryParseVersion(raw, out var maj, out var min, out var pat, out var pre))
            return string.Empty;
        return string.IsNullOrEmpty(pre) ? $"{maj}.{min}.{pat}" : $"{maj}.{min}.{pat}{pre}";
    }

    private static bool TryParseVersion(string? raw, out int major, out int minor, out int patch, out string pre)
    {
        major = 0;
        minor = 0;
        patch = 0;
        pre = string.Empty;
        if (string.IsNullOrWhiteSpace(raw))
            return false;
        var match = SemverPattern.Match(raw!.Trim());
        if (!match.Success)
            return false;
        if (!int.TryParse(match.Groups["major"].Value, out major)
            || !int.TryParse(match.Groups["minor"].Value, out minor)
            || !int.TryParse(match.Groups["patch"].Value, out patch))
            return false;
        pre = match.Groups["pre"].Value ?? string.Empty;
        return true;
    }

    internal static bool IsAllowedReleaseAssetUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)
            || !Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            return false;
        }
        var host = uri.Host;
        return string.Equals(host, "github.com", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".githubusercontent.com", StringComparison.OrdinalIgnoreCase)
            || string.Equals(host, "gitcode.com", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".gitcode.com", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".gitcode.net", StringComparison.OrdinalIgnoreCase);
    }

    internal static bool IsAllowedReleasePageUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)
            || !Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        if (string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase)
            && uri.AbsolutePath.StartsWith($"/{RepoOwner}/{RepoName}/releases", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        return string.Equals(uri.Host, "gitcode.com", StringComparison.OrdinalIgnoreCase)
            && uri.AbsolutePath.StartsWith($"/{MirrorOwner}/{MirrorRepoName}/releases", StringComparison.OrdinalIgnoreCase);
    }

    internal static UpdateStatusInfo ParseReleaseJson(
        string json, string currentVersion, string ignoredVersion, string source = "github")
    {
        var serializer = new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024 };
        var parsed = serializer.DeserializeObject(json);
        Dictionary<string, object>? root = null;
        if (parsed is Dictionary<string, object> dict)
        {
            root = dict;
        }
        else if (parsed is object[] list)
        {
            root = SelectLatestStableRelease(list);
        }
        if (root == null)
            throw new InvalidDataException("release response contained no valid release object");

        var isDraft = root.TryGetValue("draft", out var draftObj) && draftObj is bool d && d;
        var isPre = root.TryGetValue("prerelease", out var preObj) && preObj is bool p && p;
        var tag = ReadString(root, "tag_name");
        var latestVersion = NormalizeVersion(tag);
        if (string.IsNullOrEmpty(latestVersion))
            throw new InvalidDataException("release tag was not a valid version");

        var publishedAt = ReadString(root, "published_at");
        if (string.IsNullOrEmpty(publishedAt))
            publishedAt = ReadString(root, "created_at");

        var defaultPage = string.Equals(source, "gitcode", StringComparison.OrdinalIgnoreCase)
            ? $"{MirrorReleasesPageUrl}/tag/{Uri.EscapeDataString(tag)}"
            : ReleasesPageUrl;
        var releaseUrl = ReadString(root, "html_url");
        if (!IsAllowedReleasePageUrl(releaseUrl))
            releaseUrl = defaultPage;

        var body = ReadString(root, "body");
        ExtractBilingualNotes(body, out var notesZh, out var notesEn);
        var expectedSha256 = ExtractSha256(body);

        var assetName = string.Empty;
        var assetUrl = string.Empty;
        long assetSize = 0;
        if (root.TryGetValue("assets", out var assetsObj) && assetsObj is object[] assets)
        {
            foreach (var item in assets)
            {
                if (item is not Dictionary<string, object> asset) continue;
                var name = ReadString(asset, "name");
                var dl = ReadString(asset, "browser_download_url");
                if (string.IsNullOrEmpty(dl))
                    dl = ReadString(asset, "url");
                if (!name.EndsWith(".qlplugin", StringComparison.OrdinalIgnoreCase))
                    continue;
                if (string.IsNullOrEmpty(dl) && string.Equals(source, "gitcode", StringComparison.OrdinalIgnoreCase))
                {
                    dl = $"https://gitcode.com/{MirrorOwner}/{MirrorRepoName}/releases/download/"
                        + $"{Uri.EscapeDataString(tag)}/{Uri.EscapeDataString(name)}";
                }
                if (!IsAllowedReleaseAssetUrl(dl))
                    continue;
                assetName = name;
                assetUrl = dl;
                if (asset.TryGetValue("size", out var sizeObj))
                {
                    if (sizeObj is int si) assetSize = si;
                    else if (sizeObj is long sl) assetSize = sl;
                }
                break;
            }
        }

        var isNewer = !isDraft && !isPre && !IsPrerelease(latestVersion)
            && CompareVersions(latestVersion, currentVersion) > 0;
        var isIgnored = isNewer && !string.IsNullOrEmpty(ignoredVersion)
            && CompareVersions(latestVersion, ignoredVersion) == 0;

        return new UpdateStatusInfo
        {
            Status = isNewer ? (isIgnored ? "ignored" : "available") : "up-to-date",
            CurrentVersion = NormalizeVersion(currentVersion),
            LatestVersion = latestVersion,
            PublishedAt = publishedAt,
            ReleaseUrl = releaseUrl,
            AssetName = assetName,
            AssetUrl = assetUrl,
            AssetSize = assetSize,
            ExpectedSha256 = expectedSha256,
            Source = source,
            NotesZh = notesZh,
            NotesEn = notesEn,
            IgnoredVersion = ignoredVersion ?? string.Empty,
            HasUpdate = isNewer && !isIgnored,
        };
    }

    private static Dictionary<string, object>? SelectLatestStableRelease(object[] list)
    {
        Dictionary<string, object>? best = null;
        string? bestVersion = null;
        foreach (var item in list)
        {
            if (item is not Dictionary<string, object> entry) continue;
            var isDraft = entry.TryGetValue("draft", out var dObj) && dObj is bool d && d;
            var isPre = entry.TryGetValue("prerelease", out var pObj) && pObj is bool p && p;
            if (isDraft || isPre) continue;
            var ver = NormalizeVersion(ReadString(entry, "tag_name"));
            if (string.IsNullOrEmpty(ver) || IsPrerelease(ver)) continue;
            if (best == null || CompareVersions(ver, bestVersion) > 0)
            {
                best = entry;
                bestVersion = ver;
            }
        }
        return best;
    }

    internal static string ExtractSha256(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return string.Empty;
        var match = Sha256Pattern.Match(body);
        return match.Success ? match.Groups["hex"].Value.ToUpperInvariant() : string.Empty;
    }

    internal static void ExtractBilingualNotes(string body, out string zh, out string en)
    {
        zh = string.Empty;
        en = string.Empty;
        if (string.IsNullOrWhiteSpace(body))
            return;

        var normalized = body.Replace("\r\n", "\n").Replace('\r', '\n');
        var zhMatch = Regex.Match(normalized, @"(?m)^#{2,3}\s*中文\s*$");
        var enMatch = Regex.Match(normalized, @"(?m)^#{2,3}\s*English\s*$");

        if (zhMatch.Success && enMatch.Success)
        {
            if (zhMatch.Index < enMatch.Index)
            {
                zh = TrimNotes(normalized.Substring(zhMatch.Index + zhMatch.Length, enMatch.Index - (zhMatch.Index + zhMatch.Length)));
                en = TrimNotes(normalized.Substring(enMatch.Index + enMatch.Length));
            }
            else
            {
                en = TrimNotes(normalized.Substring(enMatch.Index + enMatch.Length, zhMatch.Index - (enMatch.Index + enMatch.Length)));
                zh = TrimNotes(normalized.Substring(zhMatch.Index + zhMatch.Length));
            }
        }
        else if (zhMatch.Success)
        {
            zh = TrimNotes(normalized.Substring(zhMatch.Index + zhMatch.Length));
            en = zh;
        }
        else if (enMatch.Success)
        {
            en = TrimNotes(normalized.Substring(enMatch.Index + enMatch.Length));
            zh = en;
        }
        else
        {
            var plain = TrimNotes(normalized);
            zh = plain;
            en = plain;
        }
    }

    private static string TrimNotes(string raw)
    {
        var text = raw.Trim();
        var pkgHeading = Regex.Match(text, @"(?m)^##\s+安装包\s*/\s*Package\b");
        if (pkgHeading.Success && pkgHeading.Index > 0)
            text = text.Substring(0, pkgHeading.Index).Trim();
        var sep = text.IndexOf("\n---", StringComparison.Ordinal);
        if (sep > 0) text = text.Substring(0, sep).Trim();
        return text.Length > 2400 ? text.Substring(0, 2400).TrimEnd() + "…" : text;
    }

    internal static UpdateStateRecord LoadState(string? statePath = null)
    {
        var path = statePath ?? DefaultStatePath();
        lock (StateLock)
        {
            try
            {
                if (!File.Exists(path))
                    return new UpdateStateRecord();
                var text = File.ReadAllText(path, Encoding.UTF8);
                var serializer = new JavaScriptSerializer();
                return serializer.Deserialize<UpdateStateRecord>(text) ?? new UpdateStateRecord();
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException)
            {
                return new UpdateStateRecord();
            }
        }
    }

    internal static void SaveState(UpdateStateRecord record, string? statePath = null)
    {
        var path = statePath ?? DefaultStatePath();
        lock (StateLock)
        {
            try
            {
                var dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir))
                    Directory.CreateDirectory(dir);
                var serializer = new JavaScriptSerializer();
                AtomicFile.WriteText(path, serializer.Serialize(record));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Non-fatal: cache write failure never breaks preview.
            }
        }
    }

    internal static UpdateStatusInfo IgnoreVersion(string version, string? statePath = null, string? currentVersion = null)
    {
        var current = currentVersion ?? BuildInfo.ProductVersion;
        var norm = NormalizeVersion(version);
        var state = LoadState(statePath);
        state.IgnoredVersion = norm;
        SaveState(state, statePath);
        return BuildStatusFromState(state, current, fromCache: true);
    }

    internal static async Task<UpdateStatusInfo> CheckLatestAsync(
        bool force,
        CancellationToken cancel,
        string? statePath = null,
        string? currentVersion = null,
        Func<CancellationToken, Task<string>>? fetcher = null,
        Func<CancellationToken, Task<string>>? mirrorFetcher = null)
    {
        var current = currentVersion ?? BuildInfo.ProductVersion;
        var state = LoadState(statePath);

        if (!force
            && DateTimeOffset.TryParse(state.LastCheckedUtc, out var lastChecked)
            && DateTimeOffset.UtcNow - lastChecked < CheckInterval
            && !string.IsNullOrEmpty(state.LatestVersion))
        {
            return BuildStatusFromState(state, current, fromCache: true);
        }

        try
        {
            UpdateStatusInfo info;
            if (fetcher != null && mirrorFetcher == null)
            {
                // Single injected fetcher (unit test compatibility path)
                var json = await fetcher(cancel).ConfigureAwait(false);
                info = ParseReleaseJson(json, current, state.IgnoredVersion, "github");
            }
            else
            {
                var ghFetch = fetcher ?? (token => FetchJsonAsync(LatestReleaseApiUrl, token));
                var gcFetch = mirrorFetcher ?? (token => FetchJsonAsync(MirrorReleasesApiUrl, token));
                info = await CheckDualSourceAsync(ghFetch, gcFetch, current, state.IgnoredVersion, cancel)
                    .ConfigureAwait(false);
            }

            state.LastCheckedUtc = DateTimeOffset.UtcNow.ToString("o");
            state.LatestVersion = info.LatestVersion;
            state.PublishedAt = info.PublishedAt;
            state.ReleaseUrl = info.ReleaseUrl;
            state.AssetName = info.AssetName;
            state.AssetUrl = info.AssetUrl;
            state.FallbackAssetUrl = info.FallbackAssetUrl;
            state.AssetSize = info.AssetSize;
            state.ExpectedSha256 = info.ExpectedSha256;
            state.Source = info.Source;
            state.NotesZh = info.NotesZh;
            state.NotesEn = info.NotesEn;
            SaveState(state, statePath);
            return info;
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidDataException or IOException)
        {
            return new UpdateStatusInfo
            {
                Status = force ? "error" : "silent-error",
                CurrentVersion = NormalizeVersion(current),
                ReleaseUrl = MirrorReleasesPageUrl,
                IgnoredVersion = state.IgnoredVersion ?? string.Empty,
                Detail = ex is TaskCanceledException ? "timeout" : ex.Message,
                HasUpdate = false,
            };
        }
    }

    private static async Task<UpdateStatusInfo> CheckDualSourceAsync(
        Func<CancellationToken, Task<string>> githubFetcher,
        Func<CancellationToken, Task<string>> gitcodeFetcher,
        string currentVersion,
        string ignoredVersion,
        CancellationToken cancel)
    {
        var ghTask = TryFetchParsedAsync(githubFetcher, currentVersion, ignoredVersion, "github", cancel);
        var gcTask = TryFetchParsedAsync(gitcodeFetcher, currentVersion, ignoredVersion, "gitcode", cancel);

        var firstDone = await Task.WhenAny(ghTask, gcTask).ConfigureAwait(false);
        var first = await firstDone.ConfigureAwait(false);
        var otherTask = firstDone == ghTask ? gcTask : ghTask;

        // If the fastest source already found a newer release, give the second source a short grace window
        // so we can attach a fallback download URL if both are reachable, without delaying slow networks.
        UpdateStatusInfo? second = null;
        if (first != null)
        {
            var graceMs = first.HasUpdate ? 600 : 2500;
            var completed = await Task.WhenAny(otherTask, Task.Delay(graceMs, cancel)).ConfigureAwait(false);
            if (completed == otherTask)
                second = await otherTask.ConfigureAwait(false);
        }
        else
        {
            second = await otherTask.ConfigureAwait(false);
        }

        if (first == null && second == null)
            throw new HttpRequestException("both GitHub and GitCode update sources failed");

        if (first == null) return second!;
        if (second == null) return first;

        var cmp = CompareVersions(second.LatestVersion, first.LatestVersion);
        var winner = cmp > 0 ? second : first;
        var runnerUp = winner == first ? second : first;
        if (CompareVersions(winner.LatestVersion, runnerUp.LatestVersion) == 0
            && !string.IsNullOrEmpty(runnerUp.AssetUrl)
            && !string.Equals(winner.AssetUrl, runnerUp.AssetUrl, StringComparison.OrdinalIgnoreCase))
        {
            winner.FallbackAssetUrl = runnerUp.AssetUrl;
            if (string.IsNullOrEmpty(winner.ExpectedSha256) && !string.IsNullOrEmpty(runnerUp.ExpectedSha256))
                winner.ExpectedSha256 = runnerUp.ExpectedSha256;
        }
        return winner;
    }

    private static async Task<UpdateStatusInfo?> TryFetchParsedAsync(
        Func<CancellationToken, Task<string>> fetcher,
        string currentVersion,
        string ignoredVersion,
        string source,
        CancellationToken cancel)
    {
        try
        {
            var json = await fetcher(cancel).ConfigureAwait(false);
            return ParseReleaseJson(json, currentVersion, ignoredVersion, source);
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidDataException or IOException)
        {
            return null;
        }
    }

    private static UpdateStatusInfo BuildStatusFromState(UpdateStateRecord state, string currentVersion, bool fromCache)
    {
        var isNewer = !string.IsNullOrEmpty(state.LatestVersion)
            && !IsPrerelease(state.LatestVersion)
            && CompareVersions(state.LatestVersion, currentVersion) > 0;
        var isIgnored = isNewer && !string.IsNullOrEmpty(state.IgnoredVersion)
            && CompareVersions(state.LatestVersion, state.IgnoredVersion) == 0;

        return new UpdateStatusInfo
        {
            Status = isNewer ? (isIgnored ? "ignored" : "available") : "up-to-date",
            CurrentVersion = NormalizeVersion(currentVersion),
            LatestVersion = state.LatestVersion ?? string.Empty,
            PublishedAt = state.PublishedAt ?? string.Empty,
            ReleaseUrl = IsAllowedReleasePageUrl(state.ReleaseUrl) ? state.ReleaseUrl : ReleasesPageUrl,
            AssetName = state.AssetName ?? string.Empty,
            AssetUrl = IsAllowedReleaseAssetUrl(state.AssetUrl) ? state.AssetUrl : string.Empty,
            FallbackAssetUrl = IsAllowedReleaseAssetUrl(state.FallbackAssetUrl) ? state.FallbackAssetUrl : string.Empty,
            AssetSize = state.AssetSize,
            ExpectedSha256 = state.ExpectedSha256 ?? string.Empty,
            Source = state.Source ?? string.Empty,
            NotesZh = state.NotesZh ?? string.Empty,
            NotesEn = state.NotesEn ?? string.Empty,
            IgnoredVersion = state.IgnoredVersion ?? string.Empty,
            FromCache = fromCache,
            HasUpdate = isNewer && !isIgnored,
        };
    }

    private static async Task<string> FetchJsonAsync(string url, CancellationToken cancel)
    {
        using var response = await ApiClient.GetAsync(url, cancel).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"HTTP {(int)response.StatusCode}");
        return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
    }

    internal static async Task<string> DownloadPackageAsync(
        string assetUrl,
        string assetName,
        Action<long, long>? onProgress,
        CancellationToken cancel,
        string? downloadDir = null,
        string? fallbackAssetUrl = null,
        string? expectedSha256 = null)
    {
        try
        {
            return await DownloadSinglePackageAsync(
                assetUrl, assetName, expectedSha256, onProgress, cancel, downloadDir).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception) when (!string.IsNullOrEmpty(fallbackAssetUrl)
            && !string.Equals(fallbackAssetUrl, assetUrl, StringComparison.OrdinalIgnoreCase)
            && IsAllowedReleaseAssetUrl(fallbackAssetUrl))
        {
            return await DownloadSinglePackageAsync(
                fallbackAssetUrl!, assetName, expectedSha256, onProgress, cancel, downloadDir).ConfigureAwait(false);
        }
    }

    private static async Task<string> DownloadSinglePackageAsync(
        string assetUrl,
        string assetName,
        string? expectedSha256,
        Action<long, long>? onProgress,
        CancellationToken cancel,
        string? downloadDir)
    {
        if (!IsAllowedReleaseAssetUrl(assetUrl))
            throw new InvalidDataException("release asset URL is not allowed");

        var safeName = OverlayTransfer.SanitiseFileName(assetName);
        if (!safeName.EndsWith(".qlplugin", StringComparison.OrdinalIgnoreCase))
            safeName = "QuickLook.Plugin.TrailViewer-update.qlplugin";

        var folder = downloadDir ?? Path.Combine(Path.GetTempPath(), "TrailViewer-Updates");
        Directory.CreateDirectory(folder);
        var finalPath = Path.Combine(folder, safeName);
        var tempPath = finalPath + ".downloading";

        try
        {
            using var response = await DownloadClient
                .GetAsync(assetUrl, HttpCompletionOption.ResponseHeadersRead, cancel)
                .ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"HTTP {(int)response.StatusCode}");

            var totalBytes = response.Content.Headers.ContentLength ?? -1L;
            if (totalBytes > MaxPackageBytes)
                throw new InvalidDataException("update package exceeds size limit");

            onProgress?.Invoke(0, Math.Max(0, totalBytes));
            long downloaded = 0;
            var lastReported = 0L;

            using (var source = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
            using (var target = File.Create(tempPath))
            {
                var buffer = new byte[32768];
                int read;
                while ((read = await source.ReadAsync(buffer, 0, buffer.Length, cancel).ConfigureAwait(false)) > 0)
                {
                    downloaded += read;
                    if (downloaded > MaxPackageBytes)
                        throw new InvalidDataException("update package exceeds size limit");
                    target.Write(buffer, 0, read);
                    if (downloaded - lastReported >= 32768 || (totalBytes > 0 && downloaded >= totalBytes))
                    {
                        lastReported = downloaded;
                        onProgress?.Invoke(downloaded, Math.Max(downloaded, totalBytes));
                    }
                }
            }

            VerifyPluginPackage(tempPath, expectedSha256);
            if (File.Exists(finalPath))
                File.Delete(finalPath);
            File.Move(tempPath, finalPath);
            onProgress?.Invoke(downloaded, downloaded);
            return finalPath;
        }
        catch
        {
            try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { }
            throw;
        }
    }

    internal static void VerifyPluginPackage(string packagePath, string? expectedSha256 = null)
    {
        if (!string.IsNullOrWhiteSpace(expectedSha256))
        {
            var actual = ComputeFileSha256(packagePath);
            if (!string.Equals(actual, expectedSha256!.Trim(), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("downloaded package SHA256 verification failed");
        }

        using var archive = ZipFile.OpenRead(packagePath);
        var hasMetadata = false;
        foreach (var entry in archive.Entries)
        {
            if (string.Equals(entry.Name, "QuickLook.Plugin.Metadata.config", StringComparison.OrdinalIgnoreCase))
            {
                hasMetadata = true;
                break;
            }
        }
        if (!hasMetadata)
            throw new InvalidDataException("downloaded file is not a valid QuickLook plugin package");
    }

    internal static string ComputeFileSha256(string path)
    {
        using var sha = SHA256.Create();
        using var stream = File.OpenRead(path);
        var hash = sha.ComputeHash(stream);
        var sb = new StringBuilder(hash.Length * 2);
        foreach (var b in hash)
            sb.Append(b.ToString("X2"));
        return sb.ToString();
    }

    internal static void LaunchPackageInstaller(string packagePath)
    {
        var quickLookExe = FindRunningQuickLookExe();
        if (!string.IsNullOrEmpty(quickLookExe) && File.Exists(quickLookExe))
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = quickLookExe,
                Arguments = $"\"{packagePath}\"",
                UseShellExecute = false,
            });
            return;
        }

        // Fallback: reveal the downloaded .qlplugin in File Explorer so the user can press Space to install.
        Process.Start(new ProcessStartInfo
        {
            FileName = "explorer.exe",
            Arguments = $"/select,\"{packagePath}\"",
            UseShellExecute = true,
        });
    }

    private static string? FindRunningQuickLookExe()
    {
        try
        {
            var currentPath = Process.GetCurrentProcess().MainModule?.FileName;
            if (!string.IsNullOrEmpty(currentPath)
                && string.Equals(Path.GetFileName(currentPath), "QuickLook.exe", StringComparison.OrdinalIgnoreCase))
            {
                return currentPath;
            }
        }
        catch
        {
            // Ignore module access restrictions and fall back to standard install locations.
        }

        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var candidates = new[]
        {
            Path.Combine(local, "Programs", "QuickLook", "QuickLook.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "QuickLook", "QuickLook.exe"),
        };
        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
                return candidate;
        }
        return null;
    }

    internal static string SerializeStatus(UpdateStatusInfo info) =>
        new JavaScriptSerializer().Serialize(info);

    private static string ReadString(Dictionary<string, object> map, string key) =>
        map.TryGetValue(key, out var val) && val != null ? Convert.ToString(val) ?? string.Empty : string.Empty;
}
