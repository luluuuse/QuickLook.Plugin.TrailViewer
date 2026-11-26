using Microsoft.Web.WebView2.Core;
using QuickLook.Common.Helpers;
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Input;

namespace QuickLook.Plugin.TrailViewer;

internal sealed partial class TrailViewerPanel
{
    private async void OnInitialized(object sender, CoreWebView2InitializationCompletedEventArgs e)
    {
        Trace($"WebView2 initialized: success={e.IsSuccess} {e.InitializationException?.Message}");
        if (_webView == null)
            return; // preview already closed

        if (!e.IsSuccess)
        {
            Fail("Could not start WebView2: " + e.InitializationException?.Message);
            return;
        }

        try
        {
            var core = _webView.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            // Tile services such as OpenMaps require a user agent that identifies the application.
            core.Settings.UserAgent += " TrailViewer/"
                + (typeof(TrailViewerPanel).Assembly.GetName().Version?.ToString(3) ?? "unknown");
            core.NewWindowRequested += OnNewWindowRequested;
            core.NavigationStarting += (_, args) =>
            {
                // The page never navigates away: https links (map attribution) open in the default browser,
                // anything else (e.g. a file dropped on the view) is blocked.
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) && uri.Host == AppHost)
                    return;
                args.Cancel = true;
                OpenInBrowser(args.Uri);
            };
            core.WebMessageReceived += OnWebMessage;
            core.WebResourceRequested += OnWebResourceRequested;
            core.WebResourceResponseReceived += OnWebResourceResponseReceived;

            // Allow = served as if with "Access-Control-Allow-Origin: *", so the page (another origin) can fetch
            // the file. The page treats everything in the file as text and has a Content-Security-Policy.
            core.SetVirtualHostNameToFolderMapping(AppHost, ViewerFolder, CoreWebView2HostResourceAccessKind.Allow);
            core.SetVirtualHostNameToFolderMapping(FileHost, _fileRoot,
                CoreWebView2HostResourceAccessKind.Allow);

            var tiandituKey = TiandituKeyStore.Load();
            _tileCacheOptions = ViewerPreferences.ReadTileCacheOptions();
            var runtimeConfig = new System.Collections.Generic.List<string>();
            if (!string.IsNullOrEmpty(tiandituKey))
            {
                runtimeConfig.Add($"tiandituKey: '{tiandituKey}', direct: true");
            }
            var customSources = CustomSourceStore.LoadJson();
            _customHostMatchers = TileCache.BuildCustomHostMatchers(customSources);
            RegisterTileCacheFilters(core, _customHostMatchers);
            if (customSources != null)
                runtimeConfig.Add("customSources: " + customSources);
            runtimeConfig.Add(string.Format(
                System.Globalization.CultureInfo.InvariantCulture,
                "tileCache: {{ enabled: {0}, maxMb: {1}, maxAgeDays: {2} }}",
                _tileCacheOptions.Enabled ? "true" : "false",
                _tileCacheOptions.MaxMegabytes,
                _tileCacheOptions.MaxAgeDays));
            if (runtimeConfig.Count > 0)
            {
                await core.AddScriptToExecuteOnDocumentCreatedAsync(
                    "window.__TRAILVIEWER_RUNTIME_CONFIG__ = Object.freeze({"
                    + string.Join(", ", runtimeConfig) + "});");
            }
            if (_webView == null || _finished)
                return;
            if (_path == null)
            {
                Fail(Strings.PreviewFailed("the preview path is unavailable"));
                return;
            }
            _webView.Source = new Uri(BuildViewerUrl(_path, _name, _fileRoot));
            Trace("navigating to " + _webView.Source);
        }
        catch (Exception ex)
        {
            Fail(Strings.PreviewFailed(ex.Message));
        }
    }

    /// <param name="path">The file to load; for a KMZ this is the .kml unpacked from it.</param>
    /// <param name="displayName">
    /// The name shown in the page. A KMZ is named after the archive the user opened, not after the
    /// document inside it, while the URL still points at the unpacked file.
    /// </param>
    internal static string BuildViewerUrl(
        string path, string? displayName = null, string? fileRoot = null)
    {
        var file = Path.GetFileName(path);
        var name = displayName ?? file;
        var root = Path.GetFullPath(fileRoot ?? Path.GetDirectoryName(path) ?? "");
        var fullPath = Path.GetFullPath(path);
        var prefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        var relative = fullPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            ? fullPath.Substring(prefix.Length)
            : file;
        var sourcePath = string.Join("/",
            relative.Replace('\\', '/').Split('/').Select(Uri.EscapeDataString));
        var source = $"https://{FileHost}/{sourcePath}{VersionStamp(path)}";
        var preferences = ViewerPreferences.Query();
        var suffix = string.IsNullOrEmpty(preferences) ? string.Empty : "&" + preferences;
        return $"https://{AppHost}/index.html?src={Uri.EscapeDataString(source)}"
            + $"&name={Uri.EscapeDataString(name)}&ver={Uri.EscapeDataString(BuildInfo.ProductVersion)}{suffix}";
    }

    /// <summary>
    /// A query that changes when the file does: the same URL would otherwise be answered from the cache
    /// after the user edits the track. Virtual host mappings ignore the query when they resolve the file.
    /// </summary>
    private static string VersionStamp(string path)
    {
        try
        {
            return "?v=" + File.GetLastWriteTimeUtc(path).Ticks.ToString();
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }

    private static void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs args)
    {
        args.Handled = true;
        OpenInBrowser(args.Uri);
    }

    /// <summary>Links in the map attribution open in the default browser, never inside the preview.</summary>
    private static void OpenInBrowser(string link)
    {
        if (Uri.TryCreate(link, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps)
        {
            try
            {
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                Trace("could not open link: " + ex.Message);
            }
        }
    }

    private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        _measureActive = false;
        Trace($"navigation completed: success={e.IsSuccess} status={e.WebErrorStatus}");
        if (!e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
        {
            Fail(Strings.ViewerFailed(e.WebErrorStatus.ToString()));
            return;
        }

        FocusViewer();
        // The window takes the keyboard back while it finishes laying itself out (measured: the page reports
        // focus again on its own only after a click), so the hand-over is repeated once, after that has passed.
        _focusRetryTimer.Stop();
        _focusRetryTimer.Start();
    }

    /// <summary>
    /// Hands the keyboard to the page. QuickLook focuses its own window when the preview opens, and the WebView2
    /// only starts receiving keys once something is clicked inside it: without this the shortcuts of a freshly
    /// opened file look dead until the map is dragged. Focus() on the control is not enough, WebView2 needs the
    /// focus moved into the browser itself.
    /// </summary>
    private void FocusViewer()
    {
        if (_webView == null || !_webView.IsLoaded)
            return;
        _webView.Focus();
        Keyboard.Focus(_webView);
    }

    private void UpdateOnScreen() => _onScreen = IsLoaded && IsVisible;

    /// <summary>Called on the hook thread; the message is marshalled to the UI thread and never awaited.</summary>
    private void OnGlobalKey(string name)
    {
        Dispatcher.BeginInvoke(() => SendKeyToViewer(name));
    }

    /// <summary>
    /// W, Q, E, S, M, T and measuring history, taken before WPF routes them. Measured: the hand-over above does not win against QuickLook's
    /// view window, so a fresh preview still sends keys to the window -- where W means "next file". Catching
    /// the key at pre-processing stops that, and the page is asked to do what it would have done anyway.
    /// When the page does hold the keyboard this handler never runs: the browser owns its own window, so the
    /// key goes straight in without passing through WPF at all.
    /// </summary>
    private void OnPreProcessInput(object sender, PreProcessInputEventArgs e)
    {
        if (_webView == null || e.StagingItem.Input is not KeyEventArgs key)
            return;
        if (key.RoutedEvent != Keyboard.PreviewKeyDownEvent || key.IsRepeat)
            return;
        // Z is ours only with Control, and only while measurement is active.
        var modifiers = key.KeyboardDevice.Modifiers;
        var measureHistory = key.Key == Key.Z
            && (modifiers == ModifierKeys.Control
                || modifiers == (ModifierKeys.Control | ModifierKeys.Shift));
        if (modifiers != ModifierKeys.None && !measureHistory)
            return;
        if (measureHistory && !_measureActive)
            return;

        var window = Window.GetWindow(this);
        if (window == null || !window.IsActive)
            return;

        string name;
        switch (key.Key)
        {
            case Key.W: name = "w"; break;
            case Key.Q: name = "q"; break;
            case Key.E: name = "e"; break;
            case Key.S: name = "s"; break;
            case Key.M: name = "m"; break;
            case Key.T: name = "t"; break;
            case Key.X: name = "x"; break;
            case Key.Z when measureHistory:
                name = (modifiers & ModifierKeys.Shift) != 0 ? "Z" : "z";
                break;
            default: return;
        }

        key.Handled = true; // nothing downstream sees it: no "next file", no other handler
        SendKeyToViewer(name);
    }

    private void SendKeyToViewer(string name)
    {
        ViewerBridge.PostMessage(_webView?.CoreWebView2, ViewerMessages.PressKey(name));
    }

}
