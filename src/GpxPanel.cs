using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using QuickLook.Common.Helpers;
using System;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// Hosts the bundled web viewer (viewer/index.html) in WebView2. The viewer files and the folder of
/// the GPX/KML file - or of the .kml unpacked from a KMZ - are exposed on two virtual hosts;
/// the page reports back "ready\t&lt;summary&gt;" or "error:&lt;text&gt;".
/// </summary>
internal sealed class GpxPanel : UserControl, IDisposable
{
    private static readonly string ViewerFolder =
        Path.Combine(Path.GetDirectoryName(typeof(GpxPanel).Assembly.Location), "viewer");

    // WebView2 caches by origin. Hash the files actually shipped under viewer/, plus the page protocol
    // version, so a content change invalidates the cache without inventing another product version.
    private static readonly string AppHost =
        $"app-{ViewerBuildId.Compute(ViewerFolder, BuildInfo.ViewerProtocolVersion)}.gpxviewer.example";

    private const string FileHost = "file.gpxviewer.example";
    private static readonly TimeSpan LoadTimeout = TimeSpan.FromSeconds(20);

    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly DispatcherTimer _timeout;
    private string _path;
    private string _name;
    private string _unpackedFolder;
    private readonly OverlayTransfer _overlay = new();
    private WebView2 _webView;
    private GlobalKeys _keys;
    private volatile bool _onScreen;
    private bool _finished;

    public GpxPanel()
    {
        Background = new SolidColorBrush(Color.FromRgb(24, 24, 24));
        _timeout = new DispatcherTimer { Interval = LoadTimeout };
        _timeout.Tick += (_, _) => Fail(Strings.TimedOut);
    }

    /// <summary>Raised once: null when the track is shown, otherwise the error text.</summary>
    public event Action<string> Finished;

    /// <summary>Step-by-step trace for the test harness; silent inside QuickLook.</summary>
    internal static Action<string> Trace = _ => { };

    public void Load(string path)
    {
        _path = path;
        _name = Path.GetFileName(path);

        if (!IsWebView2Available())
        {
            Fail(Strings.WebView2Missing);
            return;
        }

        // A KMZ is unpacked first; from here on everything - the virtual host, the URL - works on the .kml inside.
        if (KmzArchive.IsKmz(path))
        {
            try
            {
                _unpackedFolder = KmzArchive.CreateFolder();
                _path = KmzArchive.ExtractDocument(path, _unpackedFolder);
                Trace($"unpacked {_name} to {_path}");
            }
            catch (Exception ex) when (ex is InvalidDataException or IOException
                or UnauthorizedAccessException or NotSupportedException)
            {
                DropUnpackedFolder();
                Fail(Strings.KmzUnreadable(ex.Message));
                return;
            }
        }

        _webView = new WebView2
        {
            CreationProperties = new CoreWebView2CreationProperties
            {
                // Also keeps the chosen map layer (localStorage) between previews.
                UserDataFolder = UserDataFolder,
            },
            DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 24),
        };
        _webView.CoreWebView2InitializationCompleted += OnInitialized;
        _webView.NavigationCompleted += OnNavigationCompleted;
        // The window is already up and holding the keyboard by the time the control is in the tree.
        _webView.Loaded += (_, _) => { _onScreen = IsVisible; FocusViewer(); };
        // QuickLook shows its preview without activating it (ShowActivated="False") and reads Space, Esc and
        // the arrows through a global keyboard hook of its own, so a WPF handler only ever sees a key after
        // someone clicks into the preview. These three keys are caught below the application instead.
        var hookClock = Stopwatch.StartNew();
        _keys = new GlobalKeys(() => _onScreen, OnGlobalKey);
        _keys.Start();
        Trace($"keyboard hook ready in {hookClock.ElapsedMilliseconds} ms (installed={_keys.Installed})");
        // Kept as a fallback: when the hook is unavailable, a preview that did get the keyboard still works.
        InputManager.Current.PreProcessInput += OnPreProcessInput;
        IsVisibleChanged += (_, _) => UpdateOnScreen();
        Loaded += (_, _) => UpdateOnScreen();
        Unloaded += (_, _) => _onScreen = false;
        Content = _webView;
        _timeout.Start();
        Trace("WebView2 runtime " + CoreWebView2Environment.GetAvailableBrowserVersionString());
        _ = _webView.EnsureCoreWebView2Async();
    }

    /// <summary>
    /// A harness can point WebView2 at its own profile, rather than contending with a running QuickLook instance
    /// for the normal browser cache and lock files.
    /// </summary>
    private static string UserDataFolder
    {
        get
        {
            var overridden = Environment.GetEnvironmentVariable("GPXVIEWER_USER_DATA");
            return string.IsNullOrWhiteSpace(overridden)
                ? Path.Combine(SettingHelper.LocalDataPath, "GpxViewer_WebView2")
                : Path.GetFullPath(overridden);
        }
    }

    private void OnInitialized(object sender, CoreWebView2InitializationCompletedEventArgs e)
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

            // Allow = served as if with "Access-Control-Allow-Origin: *", so the page (another origin) can fetch
            // the file. The page treats everything in the file as text and has a Content-Security-Policy.
            core.SetVirtualHostNameToFolderMapping(AppHost, ViewerFolder, CoreWebView2HostResourceAccessKind.Allow);
            core.SetVirtualHostNameToFolderMapping(FileHost, Path.GetDirectoryName(_path),
                CoreWebView2HostResourceAccessKind.Allow);

            // Every remote response, for the harness: the terrain tiles fail silently in the page, so a hint
            // about which status came back is the only way to tell a slow map from a refused one.
            core.WebResourceResponseReceived += (_, args) =>
            {
                if (args.Request.Uri.Contains("tiles.windy.com"))
                    Trace($"tile response {args.Response.StatusCode}");
            };

            _webView.Source = new Uri(BuildViewerUrl(_path, _name));
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
    internal static string BuildViewerUrl(string path, string displayName = null)
    {
        var file = Path.GetFileName(path);
        var name = displayName ?? file;
        var source = $"https://{FileHost}/{Uri.EscapeDataString(file)}{VersionStamp(path)}";
        var preferences = ViewerPreferences.Query();
        var suffix = string.IsNullOrEmpty(preferences) ? string.Empty : "&" + preferences;
        return $"https://{AppHost}/index.html?src={Uri.EscapeDataString(source)}"
            + $"&name={Uri.EscapeDataString(name)}{suffix}";
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
        Trace($"navigation completed: success={e.IsSuccess} status={e.WebErrorStatus}");
        if (!e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
        {
            Fail(Strings.ViewerFailed(e.WebErrorStatus.ToString()));
            return;
        }

        FocusViewer();
        // The window takes the keyboard back while it finishes laying itself out (measured: the page reports
        // focus again on its own only after a click), so the hand-over is repeated once, after that has passed.
        var retry = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
        retry.Tick += (_, _) =>
        {
            retry.Stop();
            FocusViewer();
        };
        retry.Start();
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

    /// <summary>Called on the hook thread; the script call is marshalled to the UI thread and never awaited.</summary>
    private void OnGlobalKey(string name)
    {
        Dispatcher.BeginInvoke(() => _ = SendKeyToViewer(name));
    }

    /// <summary>
    /// W, Q, E and S, taken before WPF routes them. Measured: the hand-over above does not win against QuickLook's
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
        // Shift is spoken for by one key only: Shift+X opens the export panel while X on its own exports with
        // the settings already chosen. The page learns the difference from the case of the letter.
        var shifted = key.KeyboardDevice.Modifiers == ModifierKeys.Shift && key.Key == Key.X;
        if (key.KeyboardDevice.Modifiers != ModifierKeys.None && !shifted)
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
            case Key.X: name = shifted ? "X" : "x"; break;
            default: return;
        }

        key.Handled = true; // nothing downstream sees it: no "next file", no other handler
        _ = SendKeyToViewer(name);
    }

    private async System.Threading.Tasks.Task SendKeyToViewer(string name)
    {
        try
        {
            var core = _webView?.CoreWebView2;
            if (core != null)
                await core.ExecuteScriptAsync($"window.gpxViewer && window.gpxViewer.pressKey('{name}')");
        }
        catch (Exception ex) when (ex is InvalidOperationException or ObjectDisposedException)
        {
            // The preview closed between the key and the call; nothing left to press.
        }
    }

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
        if (message.StartsWith("export\t", StringComparison.Ordinal))
            BeginExport(message.Substring("export\t".Length));
        else if (message.StartsWith("exportchunk\t", StringComparison.Ordinal))
            AppendExport(message.Substring("exportchunk\t".Length));
        else if (message.StartsWith("exportdone\t", StringComparison.Ordinal))
            FinishExport(message.Substring("exportdone\t".Length));
        else if (message == "ready" || message.StartsWith("ready\t", StringComparison.Ordinal))
            Finish(null, message.Length > 6 ? message.Substring(6) : "");
        else if (message.StartsWith("error:", StringComparison.Ordinal))
            Finish(message.Substring("error:".Length), "");
        else if (message.StartsWith("settings\t", StringComparison.Ordinal))
            ViewerPreferences.SaveFromQuery(message.Substring("settings\t".Length));
    }

    /// <summary>The trace is read by a person watching the harness: a chunk of base64 is not worth a line.</summary>
    private static string Summarise(string message) =>
        message.StartsWith("exportchunk\t", StringComparison.Ordinal) ? "exportchunk ..." : message;

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
    private void FinishExport(string body)
    {
        OverlayTransferResult picture;
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
            target = Path.Combine(Path.GetDirectoryName(_path) ?? "", picture.Name);
            AtomicFile.Write(target, picture.Picture);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            // A network share, a locked folder, a read-only stick: the picture is kept rather than dropped.
            try
            {
                var fallback = Path.Combine(SettingHelper.LocalDataPath, "exports");
                Directory.CreateDirectory(fallback);
                target = Path.Combine(fallback, picture.Name);
                AtomicFile.Write(target, picture.Picture);
            }
            catch (Exception inner)
            {
                Trace($"export failed: {ex.Message} / {inner.Message}");
                _ = SendToViewer($"exportFailed('{Escape(inner.Message)}')");
                return;
            }
        }
        finally
        {
            picture.Dispose();
        }

        Trace($"exported overlay to {target}");
        _ = SendToViewer($"exported('{Escape(target)}')");
    }

    private void FailExport(string detail)
    {
        _overlay.Reset();
        Trace("export failed: " + detail);
        _ = SendToViewer($"exportFailed('{Escape(detail)}')");
    }

    private static string Escape(string text) =>
        (text ?? "").Replace("\\", "\\\\").Replace("'", "\\'")
            .Replace("\r", "\\r").Replace("\n", "\\n")
            .Replace("\u2028", "\\u2028").Replace("\u2029", "\\u2029");

    private async System.Threading.Tasks.Task SendToViewer(string call)
    {
        try
        {
            var core = _webView?.CoreWebView2;
            if (core != null)
                await core.ExecuteScriptAsync($"window.gpxViewer && window.gpxViewer.{call}");
        }
        catch (Exception ex) when (ex is InvalidOperationException or ObjectDisposedException)
        {
            // The preview closed between the write and the toast; nothing left to tell.
        }
    }

    /// <summary>Shows the error in place of the viewer and ends loading.</summary>
    private void Fail(string error)
    {
        if (_finished)
            return;
        ShowMessage(error);
        Finish(error, "");
    }

    private void Finish(string error, string summary)
    {
        if (_finished)
            return;
        _finished = true;
        _timeout.Stop();

        var name = _name ?? Path.GetFileName(_path);
        Log.Write(error == null
            ? $"OK    {name} {summary} {_clock.ElapsedMilliseconds} ms"
            : $"ERROR {name} {_clock.ElapsedMilliseconds} ms: {error}");

        Finished?.Invoke(error);
    }

    private void ShowMessage(string text)
    {
        // The WebView2 (if any) is disposed in Dispose(); it may still be raising the current event.
        Content = new TextBlock
        {
            Text = text,
            Foreground = Brushes.Gainsboro,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(24),
        };
    }

    private static bool IsWebView2Available()
    {
        try
        {
            return !string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString());
        }
        catch (WebView2RuntimeNotFoundException)
        {
            return false;
        }
    }

    internal System.Threading.Tasks.Task CapturePngAsync(Stream output) =>
        _webView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, output);

    /// <summary>Test harness only: drives the page (a layer switch, say) before a capture. Unused by the plugin.</summary>
    internal System.Threading.Tasks.Task<string> RunScriptAsync(string script) =>
        _webView.CoreWebView2.ExecuteScriptAsync(script);

    /// <summary>Test harness only: the live WebView, for DevTools-protocol diagnostics.</summary>
    internal CoreWebView2 Core => _webView.CoreWebView2;

    /// <summary>Test harness only: where WPF believes the keyboard is.</summary>
    internal string FocusReport =>
        $"inWebView={_webView?.IsKeyboardFocusWithin} element={Keyboard.FocusedElement?.GetType().Name}"
        + $" active={Window.GetWindow(this)?.IsActive}";

    /// <summary>Test harness only: why the hook let the last key through.</summary>
    internal string HookReason => _keys?.Reason ?? "no hook";

    /// <summary>Test harness only: how many keys the operating system routed through the hook.</summary>
    internal int HookCalls => _keys?.Calls ?? 0;

    /// <summary>Test harness only: did Windows give us the keyboard hook?</summary>
    internal bool HookInstalled => _keys?.Installed == true;

    /// <summary>Test harness only: pretend the preview is on screen, whatever the visual tree says.</summary>
    internal void MarkOnScreen(bool onScreen) => _onScreen = onScreen;

    /// <summary>Test harness only: push a key through the hook filter without touching the input queue.</summary>
    internal bool HandleGlobalKeyForTest(char key, bool keyUp = false) =>
        _keys?.HandleForTest(char.ToUpperInvariant(key), keyUp) ?? false;

    public void Dispose()
    {
        _finished = true; // no callbacks after the preview is closed
        _onScreen = false;
        _timeout.Stop();
        InputManager.Current.PreProcessInput -= OnPreProcessInput;
        _keys?.Dispose();
        _keys = null;
        _overlay.Dispose();
        if (_webView != null)
        {
            _webView.CoreWebView2InitializationCompleted -= OnInitialized;
            _webView.NavigationCompleted -= OnNavigationCompleted;
            _webView.Dispose();
            _webView = null;
        }

        DropUnpackedFolder();
    }

    private void DropUnpackedFolder()
    {
        KmzArchive.DeleteFolder(_unpackedFolder);
        _unpackedFolder = null;
    }
}
