using Microsoft.Web.WebView2.Core;
using QuickLook.Common.Helpers;
using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;

namespace QuickLook.Plugin.TrailViewer;

internal sealed partial class TrailViewerPanel
{
    private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var origin) || origin.Host != AppHost)
            return;

        string message;
        try
        {
            message = e.TryGetWebMessageAsString();
        }
        catch (ArgumentException)
        {
            return;
        }

        Trace("message from viewer: " + Summarise(message));
        _messageRouter.Route(message);
    }

    private async System.Threading.Tasks.Task CopyToClipboardAsync(string body)
    {
        var split = body.IndexOf('\t');
        var id = split > 0 ? body.Substring(0, split) : "";
        if (split <= 0 || id.Length > 80)
            return;

        string text;
        try
        {
            text = Uri.UnescapeDataString(body.Substring(split + 1));
        }
        catch (UriFormatException)
        {
            SendClipboardResult(id, false, "clipboard text was invalid");
            return;
        }
        if (text.Length > 32000)
        {
            SendClipboardResult(id, false, "clipboard text is too large");
            return;
        }

        try
        {
            await SetClipboardTextAsync(text);
            SendClipboardResult(id, true, "");
        }
        catch (Exception ex) when (ex is InvalidOperationException or ExternalException)
        {
            SendClipboardResult(id, false, ex.Message);
        }
    }

    internal static async System.Threading.Tasks.Task SetClipboardTextAsync(
        string text, Action<string>? writer = null, int attempts = 20, int delayMilliseconds = 50)
    {
        writer = writer ?? Clipboard.SetText;
        attempts = Math.Max(1, attempts);
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                writer(text);
                return;
            }
            catch (ExternalException) when (attempt + 1 < attempts)
            {
                // Another process can briefly own the Windows clipboard (CLIPBRD_E_CANT_OPEN).
                await System.Threading.Tasks.Task.Delay(delayMilliseconds);
            }
        }
    }

    private void SendClipboardResult(string id, bool ok, string detail)
    {
        _ = PostToViewerMessageAsync(ViewerMessages.ClipboardResult(id, ok, detail));
    }

    private void BeginAttachment(string body)
    {
        var attachments = _attachments;
        if (attachments == null) return;
        try
        {
            attachments.BeginUpload(body);
        }
        catch (Exception ex) when (ex is InvalidDataException or FormatException)
        {
            SendAttachmentFailure(attachments.CurrentBatch, attachments.CurrentIndex, ex.Message);
        }
    }

    private void AppendAttachment(string body)
    {
        var attachments = _attachments;
        if (attachments == null) return;
        try
        {
            attachments.AppendUpload(body);
        }
        catch (Exception ex) when (ex is InvalidDataException or FormatException or IOException)
        {
            SendAttachmentFailure(attachments.CurrentBatch, attachments.CurrentIndex, ex.Message);
        }
    }

    private async System.Threading.Tasks.Task CopyLocalAttachmentAsync(string body)
    {
        var attachments = _attachments;
        if (attachments == null) return;
        AttachmentResult result;
        try
        {
            result = await attachments.CopyLocalAsync(body);
        }
        catch (OperationCanceledException) when (_finished)
        {
            return;
        }
        catch (Exception ex) when (ex is InvalidDataException or FormatException)
        {
            var parts = body.Split(new[] { '\t' }, 3);
            var index = parts.Length > 1 && int.TryParse(parts[1], out var parsed) ? parsed : -1;
            SendAttachmentFailure(parts.Length > 0 ? parts[0] : "", index, ex.Message);
            return;
        }
        _ = SendAttachmentResultAsync(result);
    }

    private async System.Threading.Tasks.Task ResumeAttachmentsAsync(string body)
    {
        var attachments = _attachments;
        if (attachments == null) return;
        try
        {
            var result = await attachments.ResumeAsync(body);
            _ = PostToViewerMessageAsync(ViewerMessages.AttachmentResume(result));
        }
        catch (OperationCanceledException) when (_finished)
        {
            return;
        }
        catch (Exception ex) when (ex is InvalidDataException or FormatException)
        {
            var batch = body.Split('\t')[0];
            _ = PostToViewerMessageAsync(ViewerMessages.AttachmentResumeFailure(batch));
            Trace("attachment resume failed: " + ex.Message);
        }
    }

    private async System.Threading.Tasks.Task FinishAttachmentAsync(string body)
    {
        var attachments = _attachments;
        if (attachments == null) return;
        AttachmentResult result;
        try
        {
            result = await attachments.CompleteUploadAsync(body);
        }
        catch (OperationCanceledException) when (_finished)
        {
            return;
        }
        catch (Exception ex) when (ex is InvalidDataException or FormatException or IOException
            or UnauthorizedAccessException or NotSupportedException)
        {
            SendAttachmentFailure(attachments.CurrentBatch, attachments.CurrentIndex, ex.Message);
            return;
        }
        _ = SendAttachmentResultAsync(result);
    }

    private async System.Threading.Tasks.Task DownloadAttachmentAsync(string body)
    {
        var attachments = _attachments;
        if (attachments == null) return;
        AttachmentResult result;
        try
        {
            result = await attachments.DownloadAsync(body);
        }
        catch (Exception ex) when (ex is InvalidDataException or FormatException or UriFormatException)
        {
            var parts = body.Split(new[] { '\t' }, 3);
            var index = parts.Length > 1 && int.TryParse(parts[1], out var parsed) ? parsed : -1;
            SendAttachmentFailure(parts.Length > 0 ? parts[0] : "", index, ex.Message);
            return;
        }
        await SendAttachmentResultAsync(result);
    }

    private void SendAttachmentFailure(string batch, int index, string detail)
    {
        _ = SendAttachmentResultAsync(new AttachmentResult(batch, index, false, "", detail));
    }

    private async System.Threading.Tasks.Task SendAttachmentResultAsync(AttachmentResult result)
    {
        await PostToViewerMessageAsync(ViewerMessages.AttachmentResult(result)).ConfigureAwait(false);
    }

    private static bool IsEnglishMessage(string message) =>
        message.EndsWith("\ten", StringComparison.Ordinal);

    private void SaveViewerSettings(string query)
    {
        var previous = _tileCacheOptions;
        ViewerPreferences.SaveFromQuery(query);
        var nextHostTheme = ViewerPreferences.ResolveHostTheme();
        if (nextHostTheme != _hostTheme)
        {
            _hostTheme = nextHostTheme;
            if (!_disposed)
            {
                _ = Dispatcher.BeginInvoke(new Action(() =>
                {
                    if (!_disposed)
                    {
                        Background = nextHostTheme == QuickLook.Common.Plugin.Themes.Light
                            ? new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(238, 242, 246))
                            : new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(24, 24, 24));
                        HostThemeChanged?.Invoke(nextHostTheme);
                    }
                }));
            }
        }
        var updated = ViewerPreferences.ReadTileCacheOptions();
        _tileCacheOptions = updated;
        var limitTightened = updated.MaxMegabytes > 0
            && (previous.MaxMegabytes <= 0 || updated.MaxMegabytes < previous.MaxMegabytes);
        var ageTightened = updated.MaxAgeDays > 0
            && (previous.MaxAgeDays <= 0 || updated.MaxAgeDays < previous.MaxAgeDays);
        if (updated.Enabled && (limitTightened || ageTightened))
        {
            TileCache.Shared.SchedulePrune(
                updated,
                removeExpired: TileCache.IsNetworkAvailable(),
                stats =>
                {
                    if (!_disposed)
                        _ = PostToViewerMessageAsync(ViewerMessages.TileCacheStats(stats.TotalBytes, stats.TileCount));
                });
        }
    }

    private void SaveCustomSources(string json)
    {
        _ = CustomSourceStore.SaveJson(json);
        var matchers = TileCache.BuildCustomHostMatchers(CustomSourceStore.LoadJson());
        _customHostMatchers = matchers;
        var core = _webView?.CoreWebView2;
        if (core != null && !_disposed)
            RegisterTileCacheFilters(core, matchers);
    }

    private void RegisterTileCacheFilters(
        CoreWebView2 core,
        System.Collections.Generic.IReadOnlyList<CustomHostMatcher>? customMatchers)
    {
        foreach (var pattern in TileCache.GetWebResourceFilterPatterns(customMatchers))
        {
            if (_registeredTileFilters.Add(pattern))
                core.AddWebResourceRequestedFilter(pattern, CoreWebView2WebResourceContext.Image);
        }
    }

    private void RequestTileCacheStats()
    {
        _ = Task.Run(() => TileCache.Shared.GetStats()).ContinueWith(
            task =>
            {
                if (task.IsCompleted && !task.IsFaulted && !task.IsCanceled && !_disposed)
                {
                    var stats = task.Result;
                    _ = PostToViewerMessageAsync(ViewerMessages.TileCacheStats(stats.TotalBytes, stats.TileCount));
                }
            },
            TaskScheduler.Default);
    }

    private void ClearTileCache()
    {
        _ = Task.Run(() => TileCache.Shared.Clear()).ContinueWith(
            task =>
            {
                if (task.IsCompleted && !task.IsFaulted && !task.IsCanceled && !_disposed)
                {
                    var stats = task.Result;
                    _ = PostToViewerMessageAsync(ViewerMessages.TileCacheCleared(stats.TotalBytes, stats.TileCount));
                }
            },
            TaskScheduler.Default);
    }

    private async Task ProbeNodeAsync(string body)
    {
        var parts = body.Split(new[] { '\t' }, 3);
        if (parts.Length < 3)
            return;

        var id = parts[0];
        if (string.IsNullOrEmpty(id) || id.Length > 80)
            return;

        var timeoutMs = int.TryParse(parts[1], out var parsedTimeout)
            ? parsedTimeout
            : NodeProber.DefaultTimeoutMs;

        string url;
        try
        {
            url = Uri.UnescapeDataString(parts[2]);
        }
        catch (UriFormatException)
        {
            if (!_disposed)
                _ = PostToViewerMessageAsync(ViewerMessages.NodeProbeResult(id, false, 0, "invalid"));
            return;
        }

        try
        {
            var result = await NodeProber.ProbeAsync(
                url, timeoutMs, _customHostMatchers, _lifecycle.Token).ConfigureAwait(false);
            if (!_disposed)
            {
                _ = PostToViewerMessageAsync(ViewerMessages.NodeProbeResult(
                    id, result.Ok, result.ElapsedMs, result.Reason));
            }
        }
        catch (OperationCanceledException) when (_disposed || _lifecycle.IsCancellationRequested)
        {
            // Preview closed while probe was in flight.
        }
    }

    private void OnWebResourceRequested(
        object? sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
        var options = _tileCacheOptions;
        var core = _webView?.CoreWebView2;
        if (!options.Enabled || _disposed || core == null) return;
        if (!string.Equals(args.Request.Method, "GET", StringComparison.OrdinalIgnoreCase)) return;
        if (!Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var uri)) return;
        if (!TileCache.TryBuildKey(uri, _customHostMatchers, out var key)) return;

        var kind = TileCache.Shared.TryRead(key, options, DateTime.UtcNow, out var cached);
        if (kind == TileLookupKind.Fresh && cached != null)
        {
            args.Response = CreateCachedTileResponse(core.Environment, cached, "hit");
            return;
        }
        if (kind == TileLookupKind.Expired && cached != null)
        {
            if (!TileCache.IsNetworkAvailable())
            {
                args.Response = CreateCachedTileResponse(core.Environment, cached, "stale");
                return;
            }
            var deferral = args.GetDeferral();
            _ = RefreshExpiredTileAsync(core, args, deferral, uri, key, cached, options);
        }
    }

    private async Task RefreshExpiredTileAsync(
        CoreWebView2 core,
        CoreWebView2WebResourceRequestedEventArgs args,
        CoreWebView2Deferral deferral,
        Uri uri,
        string key,
        TileCacheEntry stale,
        TileCacheOptions options)
    {
        var responseSet = false;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            try
            {
                foreach (var header in args.Request.Headers)
                {
                    if (string.Equals(header.Key, "User-Agent", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(header.Key, "Referer", StringComparison.OrdinalIgnoreCase))
                    {
                        request.Headers.TryAddWithoutValidation(header.Key, header.Value);
                    }
                }
            }
            catch (Exception ex) when (IsViewerShutdown(ex))
            {
                return;
            }

            using var response = await TileCache.RefreshHttpClient.SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, _lifecycle.Token);
            if (_disposed) return;

            if (response.StatusCode == HttpStatusCode.OK)
            {
                using var stream = await response.Content.ReadAsStreamAsync();
                var bytes = ReadBoundedBytes(stream, TileCache.MaxTileBytes);
                var headerContentType = response.Content.Headers.ContentType?.MediaType;
                if (bytes != null && TileCache.TryDetectImageContentType(
                    bytes, headerContentType, out _, out var detectedType))
                {
                    _ = Task.Run(() => TileCache.Shared.Store(
                        key, bytes, detectedType, options, DateTime.UtcNow));
                    if (!_disposed)
                    {
                        args.Response = core.Environment.CreateWebResourceResponse(
                            new MemoryStream(bytes, writable: false),
                            200,
                            "OK",
                            $"Content-Type: {detectedType}\r\nCache-Control: no-store\r\nX-TrailViewer-Cache: refreshed");
                        responseSet = true;
                    }
                    return;
                }
            }
            else if (IsTiandituTileUri(uri.AbsoluteUri)
                && (response.StatusCode == HttpStatusCode.Unauthorized
                    || response.StatusCode == HttpStatusCode.Forbidden))
            {
                _ = PostTiandituResponseAsync(core, (int)response.StatusCode);
                if (!_disposed)
                {
                    args.Response = core.Environment.CreateWebResourceResponse(
                        Stream.Null,
                        (int)response.StatusCode,
                        response.ReasonPhrase ?? "Forbidden",
                        "Cache-Control: no-store\r\nX-TrailViewer-Cache: error");
                    responseSet = true;
                }
                return;
            }
        }
        catch (OperationCanceledException) when (_disposed)
        {
            return;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException || IsViewerShutdown(ex))
        {
            // Fall back to the stale cached tile when refreshing fails or times out.
        }
        finally
        {
            if (!_disposed && !responseSet)
            {
                try
                {
                    args.Response = CreateCachedTileResponse(core.Environment, stale, "stale");
                }
                catch (Exception ex) when (IsViewerShutdown(ex))
                {
                    // Preview already closed while refresh was finishing.
                }
            }
            try
            {
                deferral.Complete();
            }
            catch (Exception ex) when (IsViewerShutdown(ex))
            {
                // Preview already closed.
            }
        }
    }

    private static CoreWebView2WebResourceResponse CreateCachedTileResponse(
        CoreWebView2Environment environment, TileCacheEntry entry, string cacheHeader) =>
        environment.CreateWebResourceResponse(
            new MemoryStream(entry.Data, writable: false),
            200,
            "OK",
            $"Content-Type: {entry.ContentType}\r\nCache-Control: no-store\r\nX-TrailViewer-Cache: {cacheHeader}");

    /// <summary>
    /// Image loads do not expose an HTTP status to the page. Observe Tianditu responses out of band so only an
    /// explicit authentication failure can invalidate the in-page key; transient failures remain retryable.
    /// Also persists newly fetched valid map tiles into the host disk cache.
    /// </summary>
    private void OnWebResourceResponseReceived(
        object? sender, CoreWebView2WebResourceResponseReceivedEventArgs args)
    {
        ObserveTiandituResponse(args);

        var options = _tileCacheOptions;
        if (!options.Enabled || _disposed) return;
        if ((int)args.Response.StatusCode != 200) return;

        try
        {
            if (args.Response.Headers.Contains("X-TrailViewer-Cache")) return;
        }
        catch (Exception ex) when (IsViewerShutdown(ex))
        {
            return;
        }

        if (!Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var uri)) return;
        if (!TileCache.TryBuildKey(uri, _customHostMatchers, out var key)) return;

        string? contentType = null;
        try
        {
            if (args.Response.Headers.Contains("Content-Type"))
                contentType = args.Response.Headers.GetHeader("Content-Type");
        }
        catch (Exception ex) when (IsViewerShutdown(ex))
        {
            return;
        }

        if (!string.IsNullOrEmpty(contentType))
        {
            var trimmed = contentType!.TrimStart();
            if (trimmed.StartsWith("text/", StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("application/json", StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("application/xml", StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("application/javascript", StringComparison.OrdinalIgnoreCase))
                return;
        }

        _ = CacheResponseBodyAsync(args.Response, key, contentType, options);
    }

    private async Task CacheResponseBodyAsync(
        CoreWebView2WebResourceResponseView response,
        string key,
        string? contentType,
        TileCacheOptions options)
    {
        try
        {
            using var stream = await response.GetContentAsync();
            if (stream == null || _disposed) return;
            var bytes = ReadBoundedBytes(stream, TileCache.MaxTileBytes);
            if (bytes == null || _disposed) return;
            await Task.Run(() => TileCache.Shared.Store(key, bytes, contentType, options, DateTime.UtcNow));
        }
        catch (Exception ex) when (IsViewerShutdown(ex) || ex is IOException or ArgumentException)
        {
            // Cache misses or shutdown races never fail tile rendering.
        }
    }

    private static byte[]? ReadBoundedBytes(Stream stream, int maxBytes)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        var total = 0;
        int read;
        while ((read = stream.Read(chunk, 0, chunk.Length)) > 0)
        {
            total += read;
            if (total > maxBytes)
                return null;
            buffer.Write(chunk, 0, read);
        }
        return total > 0 ? buffer.ToArray() : null;
    }

    private void ObserveTiandituResponse(CoreWebView2WebResourceResponseReceivedEventArgs args)
    {
        if (!IsTiandituTileUri(args.Request.Uri)) return;
        var status = (int)args.Response.StatusCode;
        if (status < 400) return;
        var core = _webView?.CoreWebView2;
        if (core != null) _ = PostTiandituResponseAsync(core, status);
    }

    internal static bool IsTiandituTileUri(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && (uri.Host.Equals("tianditu.gov.cn", StringComparison.OrdinalIgnoreCase)
            || uri.Host.EndsWith(".tianditu.gov.cn", StringComparison.OrdinalIgnoreCase));

    private async System.Threading.Tasks.Task PostTiandituResponseAsync(CoreWebView2 core, int status)
    {
        try
        {
            await Dispatcher.InvokeAsync(() =>
                core.PostWebMessageAsString($"tianditu-response\t{status}"));
        }
        catch (Exception ex) when (IsViewerShutdown(ex))
        {
            // The preview closed while the response was in flight.
        }
    }

    private void ConfigureTiandituKey(bool english)
    {
        _ = Dispatcher.BeginInvoke(new Action(() =>
        {
            if (_disposed) return;
            if (TiandituKeyDialog.Show(Window.GetWindow(this), english))
                NotifyTiandituKeyState();
        }));
    }

    private void RemoveTiandituKey(bool english)
    {
        _ = Dispatcher.BeginInvoke(new Action(() =>
        {
            if (_disposed) return;
            if (TiandituKeyDialog.Remove(Window.GetWindow(this), english))
                NotifyTiandituKeyState();
        }));
    }

    private void NotifyTiandituKeyState()
    {
        var key = TiandituKeyStore.Load() ?? string.Empty;
        ViewerBridge.PostMessage(_webView?.CoreWebView2, ViewerMessages.SetTiandituKey(key));
    }

    /// <summary>The trace is read by a person watching the harness: a chunk of base64 is not worth a line.</summary>
    private static string Summarise(string message) =>
        message.StartsWith("exportchunk\t", StringComparison.Ordinal)
            ? "exportchunk ..."
            : message.StartsWith("trackchunk\t", StringComparison.Ordinal)
                ? "trackchunk ..."
            : message.StartsWith("attachmentchunk\t", StringComparison.Ordinal)
                ? "attachmentchunk ..."
            : message.StartsWith("clipboard\t", StringComparison.Ordinal)
                ? "clipboard ..."
            : message.StartsWith("custom-sources\t", StringComparison.Ordinal)
                ? "custom-sources ..."
            : message.StartsWith("probe-node\t", StringComparison.Ordinal)
                ? "probe-node ..."
            : message.StartsWith("track-import-", StringComparison.Ordinal)
                ? "track-import ..."
                : message;

    // The overlay arrives as base64 in pieces, because a large PNG is close to the size where one
    // postMessage starts to be unreliable. The id, sequence and count make a lost or duplicated piece visible
    // instead of publishing a plausible-looking but corrupt PNG.
    private void BeginExport(string body)
    {
        try
        {
            _overlay.Begin(body);
        }
        catch (InvalidDataException ex)
        {
            FailExport(ex.Message);
        }
    }

    private void AppendExport(string body)
    {
        try
        {
            _overlay.Append(body);
        }
        catch (Exception ex) when (ex is FormatException or InvalidDataException or IOException)
        {
            FailExport(ex.Message);
        }
    }

    /// <summary>Writes the picture beside the track, or into the plugin's own folder when that one is read-only.</summary>
    private async System.Threading.Tasks.Task FinishExportAsync(string body)
    {
        OverlayTransferResult? picture;
        try
        {
            picture = _overlay.Complete(body);
        }
        catch (InvalidDataException ex)
        {
            FailExport(ex.Message);
            return;
        }
        if (picture == null)
            return;

        string target;
        try
        {
            target = OverlayTarget(_sourcePath ?? string.Empty, picture.Name);
            await System.Threading.Tasks.Task.Run(
                () => AtomicFile.Write(target, picture.Picture), _lifecycle.Token);
        }
        catch (OperationCanceledException) when (_finished)
        {
            return;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            // A network share, a locked folder, a read-only stick: the picture is kept rather than dropped.
            try
            {
                var fallback = Path.Combine(SettingHelper.LocalDataPath, "exports");
                Directory.CreateDirectory(fallback);
                target = Path.Combine(fallback, picture.Name);
                await System.Threading.Tasks.Task.Run(
                    () => AtomicFile.Write(target, picture.Picture), _lifecycle.Token);
            }
            catch (OperationCanceledException) when (_finished)
            {
                return;
            }
            catch (Exception inner)
            {
                Trace($"export failed: {ex.Message} / {inner.Message}");
                _ = PostToViewerMessageAsync(ViewerMessages.OverlayFailed(inner.Message));
                return;
            }
        }
        finally
        {
            picture.Dispose();
        }

        Trace($"exported overlay to {target}");
        _ = PostToViewerMessageAsync(ViewerMessages.OverlayExported(target));
    }

    private void FailExport(string detail)
    {
        _overlay.Reset();
        Trace("export failed: " + detail);
        _ = PostToViewerMessageAsync(ViewerMessages.OverlayFailed(detail));
    }

    private void BeginTrackSave(string body)
    {
        try
        {
            _trackSave.Begin(body);
        }
        catch (InvalidDataException ex)
        {
            var tab = body.IndexOf('\t');
            var id = !string.IsNullOrEmpty(_trackSave.CurrentId)
                ? _trackSave.CurrentId
                : (tab > 0 ? body.Substring(0, tab) : string.Empty);
            _trackSave.Reset();
            _ = PostToViewerMessageAsync(ViewerMessages.TrackSaveResult(id, 1, "", ex.Message));
        }
    }

    private void AppendTrackSave(string body)
    {
        try
        {
            _trackSave.Append(body);
        }
        catch (Exception ex) when (ex is FormatException or InvalidDataException or IOException)
        {
            var id = _trackSave.CurrentId;
            _trackSave.Reset();
            _ = PostToViewerMessageAsync(ViewerMessages.TrackSaveResult(id, 1, "", ex.Message));
        }
    }

    private async System.Threading.Tasks.Task FinishTrackSaveAsync(string id)
    {
        TrackSavePayload? payload;
        try
        {
            payload = _trackSave.Complete(id);
        }
        catch (InvalidDataException ex)
        {
            _ = PostToViewerMessageAsync(ViewerMessages.TrackSaveResult(id, 1, "", ex.Message));
            return;
        }
        if (payload == null)
            return;

        // Yield off CoreWebView2.WebMessageReceived before pumping a modal SaveFileDialog.
        await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Normal);
        if (_disposed)
            return;

        string? targetPath = null;
        var createBackup = false;
        var format = payload.Format;
        var sourceExt = !string.IsNullOrEmpty(_sourcePath) ? Path.GetExtension(_sourcePath) : string.Empty;
        var expectedExt = TrackSaveService.GetDefaultExtension(format);
        var isSameOverwritableFormat = TrackSaveService.IsOverwritableFormat(format)
            && !string.IsNullOrEmpty(_sourcePath)
            && string.Equals(sourceExt, expectedExt, StringComparison.OrdinalIgnoreCase);
        if (payload.Overwrite && isSameOverwritableFormat)
        {
            targetPath = _sourcePath;
            createBackup = true;
        }
        else
        {
            var dialog = new Microsoft.Win32.SaveFileDialog
            {
                FileName = payload.FileName,
                DefaultExt = expectedExt,
                Filter = TrackSaveService.GetFileDialogFilter(format),
                InitialDirectory = !string.IsNullOrEmpty(_sourcePath)
                    ? (Path.GetDirectoryName(_sourcePath) ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments))
                    : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            };
            var owner = Window.GetWindow(this);
            var prevTextInput = _textInput;
            _textInput = true;
            bool? ok;
            try
            {
                ok = owner != null ? dialog.ShowDialog(owner) : dialog.ShowDialog();
            }
            finally
            {
                _textInput = prevTextInput;
            }
            if (ok != true || string.IsNullOrWhiteSpace(dialog.FileName))
            {
                _ = PostToViewerMessageAsync(ViewerMessages.TrackSaveResult(payload.Id, 2, "", "cancelled"));
                return;
            }
            targetPath = dialog.FileName;
            if (!isSameOverwritableFormat && !string.IsNullOrEmpty(_sourcePath)
                && string.Equals(targetPath, _sourcePath, StringComparison.OrdinalIgnoreCase))
            {
                _ = PostToViewerMessageAsync(ViewerMessages.TrackSaveResult(
                    payload.Id, 1, "", "Cannot overwrite the original file with a different format."));
                return;
            }
            createBackup = isSameOverwritableFormat && string.Equals(targetPath, _sourcePath, StringComparison.OrdinalIgnoreCase);
        }

        try
        {
            var resolvedPath = targetPath!;
            var docDir = !string.IsNullOrEmpty(_path) ? Path.GetDirectoryName(_path) : null;
            var fileRoot = _fileRoot;
            var bytesToWrite = string.Equals(format, "kmz", StringComparison.OrdinalIgnoreCase)
                ? await System.Threading.Tasks.Task.Run(
                    () => KmzArchive.BuildKmzBytesAsync(
                        payload.Bytes,
                        docDir,
                        fileRoot,
                        payload.PackRemoteImages,
                        onProgress: (completed, total, failed) =>
                        {
                            if (!_disposed)
                            {
                                _ = PostToViewerMessageAsync(
                                    ViewerMessages.TrackSaveProgress(payload.Id, completed, total, failed));
                            }
                        },
                        cancel: _lifecycle.Token),
                    _lifecycle.Token)
                : payload.Bytes;
            await System.Threading.Tasks.Task.Run(
                () => TrackSaveService.WriteWithBackup(resolvedPath, bytesToWrite, createBackup),
                System.Threading.CancellationToken.None);
            _editorDirty = false;
            var didOverwrite = isSameOverwritableFormat && (payload.Overwrite || createBackup);
            _ = PostToViewerMessageAsync(ViewerMessages.TrackSaveResult(
                payload.Id, 0, resolvedPath, didOverwrite ? "overwrote" : ""));
        }
        catch (OperationCanceledException) when (_finished)
        {
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException or InvalidDataException)
        {
            _ = PostToViewerMessageAsync(ViewerMessages.TrackSaveResult(payload.Id, 1, "", ex.Message));
        }
    }

    private const long MaxImportTrackBytes = 16L * 1024 * 1024;

    private async Task ListSiblingTracksAsync(string id)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 80)
            return;

        var sourcePath = _sourcePath;
        var json = await Task.Run(() =>
        {
            if (string.IsNullOrEmpty(sourcePath))
                return "[]";
            var folder = Path.GetDirectoryName(sourcePath);
            if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder))
                return "[]";

            var items = new System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, object>>();
            try
            {
                var currentFull = Path.GetFullPath(sourcePath);
                foreach (var file in Directory.EnumerateFiles(folder))
                {
                    var ext = Path.GetExtension(file);
                    if (!string.Equals(ext, ".gpx", StringComparison.OrdinalIgnoreCase)
                        && !string.Equals(ext, ".kml", StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (string.Equals(Path.GetFullPath(file), currentFull, StringComparison.OrdinalIgnoreCase))
                        continue;
                    try
                    {
                        var info = new FileInfo(file);
                        if (!info.Exists || (info.Attributes & FileAttributes.Hidden) != 0)
                            continue;
                        if (info.Length <= 0 || info.Length > MaxImportTrackBytes)
                            continue;
                        items.Add(new System.Collections.Generic.Dictionary<string, object>
                        {
                            ["name"] = info.Name,
                            ["size"] = info.Length,
                        });
                    }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                    {
                        // Skip unreadable entries.
                    }
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return "[]";
            }

            items.Sort((a, b) => string.Compare(
                (string)a["name"], (string)b["name"], StringComparison.OrdinalIgnoreCase));
            if (items.Count > 30)
                items.RemoveRange(30, items.Count - 30);

            var serializer = new System.Web.Script.Serialization.JavaScriptSerializer();
            return serializer.Serialize(items);
        }).ConfigureAwait(false);

        if (!_disposed)
            _ = PostToViewerMessageAsync(ViewerMessages.TrackImportList(id, json));
    }

    private async Task ImportExternalTrackAsync(string body)
    {
        var parts = body.Split(new[] { '\t' }, 3);
        if (parts.Length < 2)
            return;

        var id = parts[0];
        var mode = parts[1];
        if (string.IsNullOrWhiteSpace(id) || id.Length > 80)
            return;

        string? targetPath = null;
        if (string.Equals(mode, "dialog", StringComparison.Ordinal))
        {
            await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Normal);
            if (_disposed)
                return;

            var initialDir = !string.IsNullOrEmpty(_sourcePath)
                ? Path.GetDirectoryName(_sourcePath)
                : null;
            var owner = Window.GetWindow(this);
            var english = !string.Equals(
                System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName,
                "zh",
                StringComparison.OrdinalIgnoreCase);
            var prevTextInput = _textInput;
            _textInput = true;
            string? picked;
            try
            {
                picked = TrackPickerDialog.Show(owner, initialDir, _sourcePath, english);
            }
            finally
            {
                _textInput = prevTextInput;
            }
            if (string.IsNullOrWhiteSpace(picked))
            {
                if (!_disposed)
                    _ = PostToViewerMessageAsync(ViewerMessages.TrackImportResult(id, 2, "", "cancelled"));
                return;
            }
            targetPath = picked;
        }
        else if (string.Equals(mode, "sibling", StringComparison.Ordinal) && parts.Length >= 3)
        {
            string fileName;
            try
            {
                fileName = Uri.UnescapeDataString(parts[2]);
            }
            catch (UriFormatException)
            {
                if (!_disposed)
                    _ = PostToViewerMessageAsync(ViewerMessages.TrackImportResult(id, 1, "", "invalid file name"));
                return;
            }
            if (string.IsNullOrWhiteSpace(fileName)
                || fileName.IndexOfAny(new[] { '\\', '/', ':' }) >= 0
                || fileName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
                || string.IsNullOrEmpty(_sourcePath))
            {
                if (!_disposed)
                    _ = PostToViewerMessageAsync(ViewerMessages.TrackImportResult(id, 1, "", "invalid file name"));
                return;
            }
            var folder = Path.GetDirectoryName(Path.GetFullPath(_sourcePath));
            if (string.IsNullOrEmpty(folder))
                return;
            string candidate;
            try
            {
                candidate = Path.GetFullPath(Path.Combine(folder, fileName));
            }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
            {
                if (!_disposed)
                    _ = PostToViewerMessageAsync(ViewerMessages.TrackImportResult(id, 1, "", "invalid file name"));
                return;
            }
            var prefix = folder.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
                ? folder
                : folder.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                    + Path.DirectorySeparatorChar;
            if (!candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(candidate))
            {
                if (!_disposed)
                    _ = PostToViewerMessageAsync(ViewerMessages.TrackImportResult(id, 1, "", "file not found"));
                return;
            }
            targetPath = candidate;
        }
        else
        {
            return;
        }

        var ext = Path.GetExtension(targetPath);
        if (!string.Equals(ext, ".gpx", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(ext, ".kml", StringComparison.OrdinalIgnoreCase))
        {
            if (!_disposed)
                _ = PostToViewerMessageAsync(ViewerMessages.TrackImportResult(id, 1, "", "unsupported format"));
            return;
        }

        try
        {
            var resolved = targetPath;
            var name = Path.GetFileName(resolved);
            var bytes = await Task.Run(() =>
            {
                var info = new FileInfo(resolved);
                if (!info.Exists)
                    throw new FileNotFoundException("file not found");
                if (info.Length > MaxImportTrackBytes)
                    throw new InvalidDataException("file exceeds 16 MB limit");
                return File.ReadAllBytes(resolved);
            }, _lifecycle.Token).ConfigureAwait(false);

            if (_disposed)
                return;

            // Stream base64 in 512 KB chunks to avoid .NET 4.6.2 Uri.EscapeDataString 65 KB limit.
            var base64 = Convert.ToBase64String(bytes);
            const int chunkSize = 512 * 1024;
            var totalChunks = Math.Max(1, (base64.Length + chunkSize - 1) / chunkSize);
            for (var i = 0; i < totalChunks; i++)
            {
                if (_disposed)
                    return;
                var start = i * chunkSize;
                var len = Math.Min(chunkSize, base64.Length - start);
                var slice = len > 0 ? base64.Substring(start, len) : string.Empty;
                await PostToViewerMessageAsync(ViewerMessages.TrackImportChunk(id, i, totalChunks, slice))
                    .ConfigureAwait(false);
            }
            if (!_disposed)
                _ = PostToViewerMessageAsync(ViewerMessages.TrackImportResult(id, 0, name, ""));
        }
        catch (OperationCanceledException) when (_disposed || _lifecycle.IsCancellationRequested)
        {
            // Preview closed while reading.
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidDataException or NotSupportedException)
        {
            if (!_disposed)
                _ = PostToViewerMessageAsync(ViewerMessages.TrackImportResult(id, 1, "", ex.Message));
        }
    }

    private int _updateDownloading;

    private async Task CheckUpdateAsync(bool force)
    {
        if (_disposed)
            return;
        try
        {
            var info = await UpdateChecker.CheckLatestAsync(force, _lifecycle.Token).ConfigureAwait(false);
            if (!_disposed)
                _ = PostToViewerMessageAsync(ViewerMessages.UpdateStatus(UpdateChecker.SerializeStatus(info)));
        }
        catch (OperationCanceledException) when (_disposed || _lifecycle.IsCancellationRequested)
        {
            // Preview closed while checking.
        }
    }

    private async Task DownloadUpdateAsync(string body)
    {
        if (_disposed)
            return;
        if (System.Threading.Interlocked.CompareExchange(ref _updateDownloading, 1, 0) != 0)
            return;

        try
        {
            var parts = body.Split(new[] { '\t' }, 2);
            if (parts.Length < 2)
                throw new InvalidDataException("update download parameters were invalid");

            var assetUrl = Uri.UnescapeDataString(parts[0]);
            var assetName = Uri.UnescapeDataString(parts[1]);
            var cachedState = UpdateChecker.LoadState();
            var fallbackUrl = string.Equals(cachedState.AssetUrl, assetUrl, StringComparison.OrdinalIgnoreCase)
                ? cachedState.FallbackAssetUrl
                : string.Empty;
            var expectedSha = string.Equals(cachedState.AssetName, assetName, StringComparison.OrdinalIgnoreCase)
                ? cachedState.ExpectedSha256
                : string.Empty;
            var downloadedPath = await UpdateChecker.DownloadPackageAsync(
                assetUrl,
                assetName,
                onProgress: (downloaded, total) =>
                {
                    if (!_disposed)
                        _ = PostToViewerMessageAsync(ViewerMessages.UpdateDownloadProgress(downloaded, total));
                },
                cancel: _lifecycle.Token,
                fallbackAssetUrl: fallbackUrl,
                expectedSha256: expectedSha).ConfigureAwait(false);

            if (_disposed)
                return;

            UpdateChecker.LaunchPackageInstaller(downloadedPath);
            _ = PostToViewerMessageAsync(ViewerMessages.UpdateDownloadResult(true, downloadedPath));
        }
        catch (OperationCanceledException) when (_disposed || _lifecycle.IsCancellationRequested)
        {
            // Preview closed while downloading.
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidDataException
            or IOException or UnauthorizedAccessException or UriFormatException or System.ComponentModel.Win32Exception)
        {
            if (!_disposed)
                _ = PostToViewerMessageAsync(ViewerMessages.UpdateDownloadResult(false, ex.Message));
        }
        finally
        {
            System.Threading.Interlocked.Exchange(ref _updateDownloading, 0);
        }
    }

    private void IgnoreUpdateVersion(string rawVersion)
    {
        if (_disposed)
            return;
        string version;
        try
        {
            version = Uri.UnescapeDataString(rawVersion);
        }
        catch (UriFormatException)
        {
            return;
        }
        var info = UpdateChecker.IgnoreVersion(version);
        _ = PostToViewerMessageAsync(ViewerMessages.UpdateStatus(UpdateChecker.SerializeStatus(info)));
    }

    private void OpenUpdateReleaseUrl(string rawUrl)
    {
        if (_disposed)
            return;
        string url;
        try
        {
            url = Uri.UnescapeDataString(rawUrl);
        }
        catch (UriFormatException)
        {
            url = UpdateChecker.ReleasesPageUrl;
        }
        var safeUrl = UpdateChecker.IsAllowedReleasePageUrl(url) ? url : UpdateChecker.ReleasesPageUrl;
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = safeUrl,
                UseShellExecute = true,
            });
        }
        catch
        {
            // Ignore shell launch failures.
        }
    }
}
