using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

namespace QuickLook.Plugin.TrailViewer;

internal sealed class NodeProbeResult
{
    internal bool Ok { get; }
    internal int ElapsedMs { get; }
    internal string Reason { get; }

    internal NodeProbeResult(bool ok, int elapsedMs, string reason)
    {
        Ok = ok;
        ElapsedMs = elapsedMs;
        Reason = reason;
    }
}

/// <summary>
/// Directly probes tile endpoints over the network, bypassing both WebView2 HTTP cache and the local disk tile cache.
/// </summary>
internal static class NodeProber
{
    internal const int DefaultTimeoutMs = 10000;
    internal const int MinTimeoutMs = 1000;
    internal const int MaxTimeoutMs = 30000;

    private static readonly string ProbeUserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TrailViewer/"
        + (typeof(NodeProber).Assembly.GetName().Version?.ToString(3) ?? "unknown");

    static NodeProber()
    {
        EnsureModernTls();
    }

    internal static void EnsureModernTls()
    {
        // QuickLook.exe targets .NET Framework 4.6.2, whose default SecurityProtocol omits TLS 1.2.
        const SecurityProtocolType tls13 = (SecurityProtocolType)12288;
        try
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12 | tls13;
        }
        catch (NotSupportedException)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        }
        if (ServicePointManager.DefaultConnectionLimit < 16)
            ServicePointManager.DefaultConnectionLimit = 16;
    }

    private static readonly HttpClient ProbeHttpClient = new(
        new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            UseProxy = true,
            AllowAutoRedirect = true,
        })
    {
        Timeout = Timeout.InfiniteTimeSpan,
    };

    internal static async Task<NodeProbeResult> ProbeAsync(
        string rawUrl,
        int timeoutMs,
        IReadOnlyList<CustomHostMatcher>? customMatchers,
        CancellationToken cancellationToken)
    {
        var boundedTimeout = Math.Max(MinTimeoutMs, Math.Min(MaxTimeoutMs, timeoutMs));
        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var uri)
            || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || uri.IsLoopback
            || !TileCache.TryBuildKey(uri, customMatchers, out _))
        {
            return new NodeProbeResult(false, 0, "invalid");
        }

        var watch = Stopwatch.StartNew();
        using var timeoutCts = new CancellationTokenSource(boundedTimeout);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.CacheControl = new CacheControlHeaderValue
            {
                NoCache = true,
                NoStore = true,
            };
            request.Headers.Pragma.Add(new NameValueHeaderValue("no-cache"));
            request.Headers.TryAddWithoutValidation("User-Agent", ProbeUserAgent);

            using var response = await ProbeHttpClient.SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, linkedCts.Token).ConfigureAwait(false);

            if (response.StatusCode != HttpStatusCode.OK)
            {
                var elapsed = Math.Max(1, (int)watch.ElapsedMilliseconds);
                return new NodeProbeResult(false, elapsed, "http-" + (int)response.StatusCode);
            }

            using var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
            var bytes = await ReadBoundedBytesAsync(stream, TileCache.MaxTileBytes, linkedCts.Token).ConfigureAwait(false);
            var headerContentType = response.Content.Headers.ContentType?.MediaType;
            var elapsedMs = Math.Max(1, (int)watch.ElapsedMilliseconds);

            if (bytes != null && TileCache.TryDetectImageContentType(bytes, headerContentType, out _, out _))
                return new NodeProbeResult(true, elapsedMs, "ok");

            return new NodeProbeResult(false, elapsedMs, "invalid");
        }
        catch (OperationCanceledException)
        {
            if (cancellationToken.IsCancellationRequested)
                throw;
            var elapsed = Math.Max(1, (int)watch.ElapsedMilliseconds);
            return new NodeProbeResult(false, elapsed, "timeout");
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException)
        {
            var elapsed = Math.Max(1, (int)watch.ElapsedMilliseconds);
            return new NodeProbeResult(false, elapsed, "error");
        }
    }

    private static async Task<byte[]?> ReadBoundedBytesAsync(
        Stream stream,
        int maxBytes,
        CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        var total = 0;
        int read;
        while ((read = await stream.ReadAsync(chunk, 0, chunk.Length, cancellationToken).ConfigureAwait(false)) > 0)
        {
            total += read;
            if (total > maxBytes)
                return null;
            buffer.Write(chunk, 0, read);
        }
        return total > 0 ? buffer.ToArray() : null;
    }
}
