using Microsoft.Web.WebView2.Core;
using QuickLook.Common.Helpers;
using System;
using System.IO;
using System.Runtime.InteropServices;
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

    /// <summary>
    /// Image loads do not expose an HTTP status to the page. Observe Tianditu responses out of band so only an
    /// explicit authentication failure can invalidate the in-page key; transient failures remain retryable.
    /// </summary>
    private void OnTiandituResponseReceived(
        object sender, CoreWebView2WebResourceResponseReceivedEventArgs args)
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
}
