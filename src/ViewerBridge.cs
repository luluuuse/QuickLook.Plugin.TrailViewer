#nullable enable

using Microsoft.Web.WebView2.Wpf;
using System;
using System.Windows.Threading;

namespace QuickLook.Plugin.TrailViewer;

internal static class ViewerBridge
{
    internal static async System.Threading.Tasks.Task PostAsync(
        Dispatcher dispatcher, Func<WebView2?> view, string message)
    {
        try
        {
            await dispatcher.InvokeAsync(() =>
            {
                var core = view()?.CoreWebView2;
                if (core != null) core.PostWebMessageAsString(message);
            });
        }
        catch (Exception ex) when (TrailViewerPanel.IsViewerShutdown(ex))
        {
            // The preview closed between the host result and the page callback.
        }
    }
}
