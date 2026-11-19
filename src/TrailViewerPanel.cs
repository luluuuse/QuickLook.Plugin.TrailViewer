using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using QuickLook.Common.Helpers;
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// Hosts the bundled web viewer (viewer/index.html) in WebView2. The viewer files and the folder of
/// the GPX/KML/FIT file - or of the .kml unpacked from a KMZ - are exposed on two virtual hosts;
/// the page reports back "ready\t&lt;summary&gt;" or "error:&lt;text&gt;".
/// </summary>
internal sealed class TrailViewerPanel : UserControl, IDisposable
{
    private static readonly string ViewerFolder =
        Path.Combine(Path.GetDirectoryName(typeof(TrailViewerPanel).Assembly.Location), "viewer");

    // WebView2 caches by origin. Hash the files actually shipped under viewer/, plus the page protocol
    // version, so a content change invalidates the cache without inventing another product version.
    private static readonly string AppHost =
        $"app-{ViewerBuildId.Compute(ViewerFolder, BuildInfo.ViewerProtocolVersion)}.{PluginIdentity.VirtualHostSuffix}";

    private static readonly string FileHost = $"file.{PluginIdentity.VirtualHostSuffix}";
    private static readonly TimeSpan LoadTimeout = TimeSpan.FromSeconds(20);
    private static readonly object EnvironmentGate = new();
    private static System.Threading.Tasks.Task<CoreWebView2Environment> _environmentTask;
    internal const long MaxInputBytes = 64L * 1024 * 1024;

    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly DispatcherTimer _timeout;
    private readonly CancellationTokenSource _lifecycle = new();
    private string _path;
    private string _sourcePath;
    private string _name;
    private string _fileRoot;
    private string _unpackedFolder;
    private readonly OverlayTransfer _overlay = new();
    private AttachmentExport _attachments;
    private WebView2 _webView;
    private GlobalKeys _keys;
    private volatile bool _onScreen;
    private volatile bool _textInput;
    private volatile bool _measureActive;
    private bool _finished;

    public TrailViewerPanel()
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
        _ = LoadAsync(path);
    }

    private async System.Threading.Tasks.Task LoadAsync(string path)
    {
        _measureActive = false;
        _sourcePath = Path.GetFullPath(path);
        _attachments?.Dispose();
        _path = _sourcePath;
        _name = Path.GetFileName(_sourcePath);
        _fileRoot = Path.GetDirectoryName(_sourcePath);

        long sourceBytes;
        try
        {
            sourceBytes = new FileInfo(_sourcePath).Length;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Fail(Strings.PreviewFailed(ex.Message));
            return;
        }
        if (IsOversized(sourceBytes))
        {
            Fail(Strings.FileTooLarge(MaxInputBytes));
            return;
        }

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
                _unpackedFolder = await System.Threading.Tasks.Task.Run(
                    KmzArchive.CreateFolder, _lifecycle.Token);
                var unpacked = _unpackedFolder;
                _path = await System.Threading.Tasks.Task.Run(
                    () => KmzArchive.ExtractDocument(_sourcePath, unpacked, _lifecycle.Token),
                    _lifecycle.Token);
                _fileRoot = _unpackedFolder;
                Trace($"unpacked {_name} to {_path}");
            }
            catch (OperationCanceledException) when (_finished)
            {
                return;
            }
            catch (Exception ex) when (ex is InvalidDataException or IOException
                or UnauthorizedAccessException or NotSupportedException)
            {
                DropUnpackedFolder();
                Fail(Strings.KmzUnreadable(ex.Message));
                return;
            }
        }
        if (_finished) return;
        _attachments = new AttachmentExport(_sourcePath, _fileRoot);

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
        // someone clicks into the preview. The viewer keys are caught below the application instead.
        var hookClock = Stopwatch.StartNew();
        _keys = new GlobalKeys(() => _onScreen, () => _measureActive, () => _textInput, OnGlobalKey);
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
        _ = EnsureWebViewAsync();
    }

    internal static void PrepareEnvironment()
    {
        var task = SharedEnvironmentAsync();
        _ = task.ContinueWith(
            completed => Trace("WebView2 environment prewarm failed: "
                + completed.Exception?.GetBaseException().Message),
            CancellationToken.None,
            System.Threading.Tasks.TaskContinuationOptions.OnlyOnFaulted,
            System.Threading.Tasks.TaskScheduler.Default);
    }

    private static System.Threading.Tasks.Task<CoreWebView2Environment> SharedEnvironmentAsync()
    {
        lock (EnvironmentGate)
        {
            return _environmentTask ??= CoreWebView2Environment.CreateAsync(null, UserDataFolder);
        }
    }

    private async System.Threading.Tasks.Task EnsureWebViewAsync()
    {
        try
        {
            var environment = await SharedEnvironmentAsync();
            if (_webView == null || _finished) return;
            await _webView.EnsureCoreWebView2Async(environment);
        }
        catch (Exception ex) when (!_finished)
        {
            Trace("prewarmed WebView2 environment failed; using the default profile: " + ex.Message);
            try
            {
                if (_webView != null && !_finished)
                    await _webView.EnsureCoreWebView2Async();
            }
            catch (Exception fallback) when (!_finished)
            {
                Fail("Could not start WebView2: " + fallback.Message);
            }
        }
    }

    /// <summary>
    /// A harness can point WebView2 at its own profile, rather than contending with a running QuickLook instance
    /// for the normal browser cache and lock files.
    /// </summary>
    private static string UserDataFolder
    {
        get
        {
            var overridden = Environment.GetEnvironmentVariable(PluginIdentity.UserDataEnvironment)
                ?? Environment.GetEnvironmentVariable(PluginIdentity.LegacyUserDataEnvironment);
            if (!string.IsNullOrWhiteSpace(overridden)) return Path.GetFullPath(overridden);

            var current = Path.Combine(SettingHelper.LocalDataPath, PluginIdentity.WebViewProfile);
            var legacy = Path.Combine(SettingHelper.LocalDataPath, PluginIdentity.LegacyWebViewProfile);
            MigrateLegacyProfile(legacy, current);
            return current;
        }
    }

    internal static bool MigrateLegacyProfile(string legacy, string current)
    {
        try
        {
            if (!Directory.Exists(legacy) || Directory.Exists(current)) return false;
            Directory.Move(legacy, current);
            return true;
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
        {
            // A locked legacy profile is disposable; WebView2 will create the new profile.
            return false;
        }
    }

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
            core.WebResourceResponseReceived += OnTiandituResponseReceived;

            // Allow = served as if with "Access-Control-Allow-Origin: *", so the page (another origin) can fetch
            // the file. The page treats everything in the file as text and has a Content-Security-Policy.
            core.SetVirtualHostNameToFolderMapping(AppHost, ViewerFolder, CoreWebView2HostResourceAccessKind.Allow);
            core.SetVirtualHostNameToFolderMapping(FileHost, _fileRoot,
                CoreWebView2HostResourceAccessKind.Allow);

            var tiandituKey = TiandituKeyStore.Load();
            var runtimeConfig = new System.Collections.Generic.List<string>();
            if (!string.IsNullOrEmpty(tiandituKey))
            {
                runtimeConfig.Add($"tiandituKey: '{tiandituKey}', direct: true");
            }
            var customSources = CustomSourceStore.LoadJson();
            if (customSources != null)
                runtimeConfig.Add("customSources: " + customSources);
            if (runtimeConfig.Count > 0)
            {
                await core.AddScriptToExecuteOnDocumentCreatedAsync(
                    "window.__TRAILVIEWER_RUNTIME_CONFIG__ = Object.freeze({"
                    + string.Join(", ", runtimeConfig) + "});");
            }
            if (_webView == null || _finished)
                return;
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
    internal static string BuildViewerUrl(string path, string displayName = null, string fileRoot = null)
    {
        var file = Path.GetFileName(path);
        var name = displayName ?? file;
        var root = Path.GetFullPath(fileRoot ?? Path.GetDirectoryName(path));
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
    /// W, Q, E, S, M and measuring history, taken before WPF routes them. Measured: the hand-over above does not win against QuickLook's
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
            && (modifiers == ModifierKeys.Control || modifiers == (ModifierKeys.Control | ModifierKeys.Shift));
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
            case Key.Z when measureHistory:
                name = (modifiers & ModifierKeys.Shift) != 0 ? "Z" : "z";
                break;
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
                await core.ExecuteScriptAsync($"window.trailViewer && window.trailViewer.pressKey('{name}')");
        }
        catch (Exception ex) when (IsViewerShutdown(ex))
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
            _ = FinishExportAsync(message.Substring("exportdone\t".Length));
        else if (message.StartsWith("clipboard\t", StringComparison.Ordinal))
            _ = CopyToClipboardAsync(message.Substring("clipboard\t".Length));
        else if (message.StartsWith("attachmentbegin\t", StringComparison.Ordinal))
            BeginAttachment(message.Substring("attachmentbegin\t".Length));
        else if (message.StartsWith("attachmentlocal\t", StringComparison.Ordinal))
            _ = CopyLocalAttachmentAsync(message.Substring("attachmentlocal\t".Length));
        else if (message.StartsWith("attachmentresume\t", StringComparison.Ordinal))
            _ = ResumeAttachmentsAsync(message.Substring("attachmentresume\t".Length));
        else if (message.StartsWith("attachmentchunk\t", StringComparison.Ordinal))
            AppendAttachment(message.Substring("attachmentchunk\t".Length));
        else if (message.StartsWith("attachmentdone\t", StringComparison.Ordinal))
            _ = FinishAttachmentAsync(message.Substring("attachmentdone\t".Length));
        else if (message.StartsWith("attachmentlink\t", StringComparison.Ordinal))
            _ = DownloadAttachmentAsync(message.Substring("attachmentlink\t".Length));
        else if (message == "ready" || message.StartsWith("ready\t", StringComparison.Ordinal))
            Finish(null, message.Length > 6 ? message.Substring(6) : "");
        else if (message.StartsWith("error:", StringComparison.Ordinal))
            Finish(message.Substring("error:".Length), "");
        else if (message.StartsWith("settings\t", StringComparison.Ordinal))
        {
            var query = message.Substring("settings\t".Length);
            _ = System.Threading.Tasks.Task.Run(() => ViewerPreferences.SaveFromQuery(query));
        }
        else if (message.StartsWith("custom-sources\t", StringComparison.Ordinal))
        {
            var json = message.Substring("custom-sources\t".Length);
            _ = System.Threading.Tasks.Task.Run(() => CustomSourceStore.SaveJson(json));
        }
        else if (message == "measure-state\t1" || message == "measure-state\t0")
            _measureActive = message.EndsWith("\t1", StringComparison.Ordinal);
        else if (message == "text-input\t1" || message == "text-input\t0")
            // A focused page field must receive its letters: the global hook sees them before the WebView does.
            _textInput = message.EndsWith("\t1", StringComparison.Ordinal);
        else if (message.StartsWith("tianditu-key\tconfigure", StringComparison.Ordinal))
        {
            ConfigureTiandituKey(IsEnglishMessage(message));
        }
        else if (message.StartsWith("tianditu-key\tremove", StringComparison.Ordinal))
        {
            RemoveTiandituKey(IsEnglishMessage(message));
        }
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
        string text, Action<string> writer = null, int attempts = 20, int delayMilliseconds = 50)
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
        try
        {
            _attachments.BeginUpload(body);
        }
        catch (Exception ex) when (ex is InvalidDataException or FormatException)
        {
            SendAttachmentFailure(_attachments.CurrentBatch, _attachments.CurrentIndex, ex.Message);
        }
    }

    private void AppendAttachment(string body)
    {
        try
        {
            _attachments.AppendUpload(body);
        }
        catch (Exception ex) when (ex is InvalidDataException or FormatException or IOException)
        {
            SendAttachmentFailure(_attachments.CurrentBatch, _attachments.CurrentIndex, ex.Message);
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
            _ = NotifyTiandituKeyStateAsync();
    }

    private void RemoveTiandituKey(bool english)
    {
        if (TiandituKeyDialog.Remove(Window.GetWindow(this), english))
            _ = NotifyTiandituKeyStateAsync();
    }

    private async System.Threading.Tasks.Task NotifyTiandituKeyStateAsync()
    {
        try
        {
            var core = _webView?.CoreWebView2;
            if (core == null) return;
            var key = TiandituKeyStore.Load() ?? string.Empty;
            await core.ExecuteScriptAsync(
                "window.trailViewer && window.trailViewer.setTiandituKey("
                + $"'{key}')");
        }
        catch (Exception ex) when (IsViewerShutdown(ex))
        {
            // The preview closed while the user was editing the key.
        }
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
            target = OverlayTarget(_sourcePath, picture.Name);
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

    internal static bool IsOversized(long bytes) => bytes > MaxInputBytes;

    internal static bool IsViewerShutdown(Exception exception) =>
        exception is InvalidOperationException or ObjectDisposedException
            or System.Runtime.InteropServices.COMException
            or System.Threading.Tasks.TaskCanceledException;

    internal static string OverlayTarget(string sourcePath, string name) =>
        Path.Combine(Path.GetDirectoryName(Path.GetFullPath(sourcePath)) ?? "", name);

    private System.Threading.Tasks.Task PostToViewerMessageAsync(string message) =>
        ViewerBridge.PostAsync(Dispatcher, () => _webView, message);

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

    /// <summary>Test harness only: pretend a page text field holds the keyboard.</summary>
    internal void MarkTextInput(bool active) => _textInput = active;

    /// <summary>Test harness only: does the panel believe a page text field is focused?</summary>
    internal bool TextInputActive => _textInput;

    /// <summary>Test harness only: push a key through the hook filter without touching the input queue.</summary>
    internal bool HandleGlobalKeyForTest(char key, bool keyUp = false) =>
        _keys?.HandleForTest(char.ToUpperInvariant(key), keyUp) ?? false;

    public void Dispose()
    {
        _finished = true; // no callbacks after the preview is closed
        _lifecycle.Cancel();
        _onScreen = false;
        _textInput = false;
        _timeout.Stop();
        InputManager.Current.PreProcessInput -= OnPreProcessInput;
        _keys?.Dispose();
        _keys = null;
        _overlay.Dispose();
        _attachments?.Dispose();
        _attachments = null;
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
