using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System;
using System.Windows.Threading;

namespace QuickLook.Plugin.TrailViewer;

internal static class ViewerBridge
{
    internal static void PostMessage(CoreWebView2? core, string message)
    {
        if (core == null) return;
        try
        {
            core.PostWebMessageAsString(message);
        }
        catch (Exception ex) when (TrailViewerPanel.IsViewerShutdown(ex))
        {
            // The preview closed between the host action and posting the WebMessage.
        }
    }

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
