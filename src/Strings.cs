using System;
using System.Globalization;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// The few sentences the panel writes itself, in the language of the Windows UI. The viewer has its own
/// switch and remembers it, but these lines appear before the page is up - or instead of it - so the only
/// choice available here is the system language.
/// </summary>
internal static class Strings
{
    private static readonly bool Chinese =
        string.Equals(CultureInfo.CurrentUICulture.TwoLetterISOLanguageName, "zh", StringComparison.OrdinalIgnoreCase);

    internal static string TimedOut => Chinese
        ? "加载预览超时。"
        : "Timed out while loading the preview.";

    internal static string WebView2Missing => Chinese
        ? "显示轨迹预览需要 Microsoft Edge WebView2 运行时。"
        : "Microsoft Edge WebView2 Runtime is required to show track previews.";

    internal static string KmzUnreadable(string detail) => Chinese
        ? "无法读取该 KMZ 文件：" + detail
        : "Could not read this KMZ file: " + detail;

    internal static string PreviewFailed(string detail) => Chinese
        ? "无法打开预览：" + detail
        : "Could not open the preview: " + detail;

    internal static string ViewerFailed(string status) => Chinese
        ? "无法加载预览页面：" + status
        : "Could not load the viewer: " + status;
}
