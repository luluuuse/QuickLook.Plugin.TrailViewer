using System;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>Host-to-page callbacks use the WebMessage transport so values never become script source.</summary>
internal static class ViewerMessages
{
    internal static string ClipboardResult(string id, bool ok, string detail) =>
        $"clipboardResult\t{id}\t{(ok ? 1 : 0)}\t{Encode(detail)}";

    internal static string AttachmentResume(AttachmentResumeResult result) =>
        $"attachmentResume\t{result.Batch}\t{string.Join(",", result.Completed)}\t{Encode(result.Folder)}";

    internal static string AttachmentResumeFailure(string batch) =>
        $"attachmentResume\t{batch}\t\t";

    internal static string AttachmentResult(AttachmentResult result) =>
        $"attachmentResult\t{result.Batch}\t{result.Index}\t{(result.Ok ? 1 : 0)}"
        + $"\t{Encode(result.Path)}\t{Encode(result.Detail)}";

    internal static string OverlayExported(string path) => $"overlayExported\t{Encode(path)}";

    internal static string OverlayFailed(string detail) => $"overlayFailed\t{Encode(detail)}";

    internal static string SetTiandituKey(string? key) => $"setTiandituKey\t{Encode(key ?? string.Empty)}";

    internal static string PressKey(string key) => $"pressKey\t{Encode(key)}";

    internal static string TileCacheStats(long totalBytes, int tileCount) =>
        $"tileCacheStats\t{totalBytes}\t{tileCount}";

    internal static string TileCacheCleared(long totalBytes, int tileCount) =>
        $"tileCacheCleared\t{totalBytes}\t{tileCount}";

    private static string Encode(string value) => Uri.EscapeDataString(value ?? "");
}
