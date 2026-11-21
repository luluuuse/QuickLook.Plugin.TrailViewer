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
        _customHostMatchers = TileCache.BuildCustomHostMatchers(CustomSourceStore.LoadJson());
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
                request, HttpCompletionOption.ResponseContentRead, _lifecycle.Token);
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
        if (TiandituKeyDialog.Show(Window.GetWindow(this), english))
            NotifyTiandituKeyState();
    }

    private void RemoveTiandituKey(bool english)
    {
        if (TiandituKeyDialog.Remove(Window.GetWindow(this), english))
            NotifyTiandituKeyState();
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
            : message.StartsWith("attachmentchunk\t", StringComparison.Ordinal)
                ? "attachmentchunk ..."
            : message.StartsWith("clipboard\t", StringComparison.Ordinal)
                ? "clipboard ..."
            : message.StartsWith("custom-sources\t", StringComparison.Ordinal)
                ? "custom-sources ..."
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
            var id = _trackSave.CurrentId;
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

        string? targetPath = null;
        var createBackup = false;
        var isGpxSource = !string.IsNullOrEmpty(_sourcePath)
            && string.Equals(Path.GetExtension(_sourcePath), ".gpx", StringComparison.OrdinalIgnoreCase);
        if (payload.Overwrite && isGpxSource)
        {
            targetPath = _sourcePath;
            createBackup = true;
        }
        else
        {
            var dialog = new Microsoft.Win32.SaveFileDialog
            {
                FileName = payload.FileName,
                DefaultExt = ".gpx",
                Filter = "GPX Track (*.gpx)|*.gpx|All Files (*.*)|*.*",
                InitialDirectory = !string.IsNullOrEmpty(_sourcePath)
                    ? (Path.GetDirectoryName(_sourcePath) ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments))
                    : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            };
            var owner = Window.GetWindow(this);
            var ok = owner != null ? dialog.ShowDialog(owner) : dialog.ShowDialog();
            if (ok != true || string.IsNullOrWhiteSpace(dialog.FileName))
            {
                _ = PostToViewerMessageAsync(ViewerMessages.TrackSaveResult(payload.Id, 2, "", "cancelled"));
                return;
            }
            targetPath = dialog.FileName;
            if (!isGpxSource && !string.IsNullOrEmpty(_sourcePath)
                && string.Equals(targetPath, _sourcePath, StringComparison.OrdinalIgnoreCase))
            {
                _ = PostToViewerMessageAsync(ViewerMessages.TrackSaveResult(
                    payload.Id, 1, "", "Cannot overwrite a non-GPX source file."));
                return;
            }
            createBackup = string.Equals(targetPath, _sourcePath, StringComparison.OrdinalIgnoreCase);
        }

        try
        {
            var resolvedPath = targetPath!;
            await System.Threading.Tasks.Task.Run(
                () => TrackSaveService.WriteWithBackup(resolvedPath, payload.Bytes, createBackup),
                _lifecycle.Token);
            _editorDirty = false;
            _ = PostToViewerMessageAsync(ViewerMessages.TrackSaveResult(payload.Id, 0, resolvedPath, ""));
        }
        catch (OperationCanceledException) when (_finished)
        {
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            _ = PostToViewerMessageAsync(ViewerMessages.TrackSaveResult(payload.Id, 1, "", ex.Message));
        }
    }
}
