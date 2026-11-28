using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using QuickLook.Common.Helpers;
using QuickLook.Common.Plugin;
using System;
using System.Collections.Generic;
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
internal sealed partial class TrailViewerPanel : UserControl, IDisposable
{
    private static readonly string ViewerFolder =
        Path.Combine(Path.GetDirectoryName(typeof(TrailViewerPanel).Assembly.Location), "viewer");

    // WebView2 caches by origin. Hash the files actually shipped under viewer/, plus the page protocol
    // version, so a content change invalidates the cache without inventing another product version.
    private static readonly string AppHost =
        $"app-{ViewerBuildId.Compute(ViewerFolder, BuildInfo.ViewerProtocolVersion)}.{PluginIdentity.VirtualHostSuffix}";

    private static readonly string FileHost = $"file.{PluginIdentity.VirtualHostSuffix}";
    private static readonly TimeSpan LoadTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan KeepAliveGrace = TimeSpan.FromSeconds(15);
    private static readonly object EnvironmentGate = new();
    private static System.Threading.Tasks.Task<CoreWebView2Environment>? _environmentTask;
    private static WebView2? _keepAliveWebView;
    private static DispatcherTimer? _keepAliveTimer;
    private static bool _shutdownHooked;
    internal const long MaxInputBytes = 64L * 1024 * 1024;
    internal const long MaxKmzInputBytes = 1088L * 1024 * 1024;

    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly DispatcherTimer _timeout;
    private readonly DispatcherTimer _focusRetryTimer = new();
    private readonly CancellationTokenSource _lifecycle = new();
    private string? _path;
    private string? _sourcePath;
    private string? _name;
    private string? _fileRoot;
    private string? _unpackedFolder;
    private readonly OverlayTransfer _overlay = new();
    private readonly TrackSaveService _trackSave = new();
    private readonly ViewerMessageRouter _messageRouter;
    private AttachmentExport? _attachments;
    private WebView2? _webView;
    private GlobalKeys? _keys;
    private volatile bool _onScreen;
    private volatile bool _textInput;
    private volatile bool _textComposing;
    private volatile bool _measureActive;
    private volatile bool _editorActive;
    private volatile bool _editorDirty;
    private volatile TileCacheOptions _tileCacheOptions = ViewerPreferences.ReadTileCacheOptions();
    private volatile IReadOnlyList<CustomHostMatcher> _customHostMatchers = Array.Empty<CustomHostMatcher>();
    private readonly HashSet<string> _registeredTileFilters = new(StringComparer.OrdinalIgnoreCase);
    private bool _finished;
    private bool _initializingWebView;
    private volatile bool _disposed;
    private DispatcherTimer? _revealTimer;
    private SizeChangedEventHandler? _revealSizeHandler;
    private WebView2? _revealWebView;
    private Themes _hostTheme = ViewerPreferences.ResolveHostTheme();
    private string _titleMeta = string.Empty;

    public event Action<Themes>? HostThemeChanged;
    public event Action<string>? HostTitleChanged;

    internal void InvokeHostAction(string action)
    {
        if (_disposed || string.IsNullOrWhiteSpace(action))
            return;
        _ = PostToViewerMessageAsync(ViewerMessages.HostAction(action));
    }

    private void UpdateHostTitle()
    {
        if (_disposed)
            return;
        var baseName = _name ?? Path.GetFileName(_path) ?? string.Empty;
        if (string.IsNullOrEmpty(baseName))
            return;
        var prefix = _editorDirty ? "* " : string.Empty;
        var suffix = string.IsNullOrEmpty(_titleMeta) ? string.Empty : " \u00b7 " + _titleMeta;
        var nextTitle = prefix + baseName + suffix;
        _ = Dispatcher.BeginInvoke(new Action(() =>
        {
            if (!_disposed)
                HostTitleChanged?.Invoke(nextTitle);
        }));
    }

    public TrailViewerPanel()
    {
        Background = _hostTheme == Themes.Light
            ? new SolidColorBrush(Color.FromRgb(238, 242, 246))
            : new SolidColorBrush(Color.FromRgb(24, 24, 24));
        _timeout = new DispatcherTimer { Interval = LoadTimeout };
        _timeout.Tick += (_, _) => Fail(Strings.TimedOut);
        _focusRetryTimer.Interval = TimeSpan.FromMilliseconds(250);
        _focusRetryTimer.Tick += (_, _) =>
        {
            _focusRetryTimer.Stop();
            FocusViewer();
        };
        _messageRouter = new ViewerMessageRouter(new ViewerMessageActions
        {
            BeginExport = BeginExport,
            AppendExport = AppendExport,
            FinishExport = body => _ = FinishExportAsync(body),
            CopyToClipboard = CopyToClipboardAsync,
            BeginAttachment = BeginAttachment,
            CopyLocalAttachment = CopyLocalAttachmentAsync,
            ResumeAttachments = ResumeAttachmentsAsync,
            AppendAttachment = AppendAttachment,
            FinishAttachment = FinishAttachmentAsync,
            DownloadAttachment = DownloadAttachmentAsync,
            Ready = summary => Finish(null, summary),
            Error = detail => Finish(detail, ""),
            SaveSettings = SaveViewerSettings,
            SaveCustomSources = SaveCustomSources,
            MeasureState = active => _measureActive = active,
            EditorState = active => _editorActive = active,
            EditorDirty = dirty =>
            {
                _editorDirty = dirty;
                UpdateHostTitle();
            },
            TitleMeta = encoded =>
            {
                try { _titleMeta = Uri.UnescapeDataString(encoded ?? string.Empty).Trim(); }
                catch (UriFormatException) { _titleMeta = string.Empty; }
                UpdateHostTitle();
            },
            BeginTrackSave = BeginTrackSave,
            AppendTrackSave = AppendTrackSave,
            FinishTrackSave = body => _ = FinishTrackSaveAsync(body),
            TextInput = active =>
            {
                _textInput = active;
                if (!active)
                    _textComposing = false;
            },
            TextComposing = active => _textComposing = active,
            ConfigureTiandituKey = value => ConfigureTiandituKey(IsEnglishMessage(value)),
            RemoveTiandituKey = value => RemoveTiandituKey(IsEnglishMessage(value)),
            RequestTileCacheStats = RequestTileCacheStats,
            ClearTileCache = ClearTileCache,
            ProbeNode = ProbeNodeAsync,
            ListSiblingTracks = ListSiblingTracksAsync,
            ImportExternalTrack = ImportExternalTrackAsync,
            CheckUpdate = CheckUpdateAsync,
            DownloadUpdate = DownloadUpdateAsync,
            IgnoreUpdate = IgnoreUpdateVersion,
            OpenUpdateRelease = OpenUpdateReleaseUrl,
        });
    }

    /// <summary>Raised once: null when the track is shown, otherwise the error text.</summary>
    public event Action<string?>? Finished;

    /// <summary>Step-by-step trace for the test harness; silent inside QuickLook.</summary>
    internal static Action<string> Trace = _ => { };

    public void Load(string path)
    {
        _ = LoadAsync(path);
    }

    private async System.Threading.Tasks.Task LoadAsync(string path)
    {
        try
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
            var isKmz = KmzArchive.IsKmz(path);
            var limitBytes = isKmz ? MaxKmzInputBytes : MaxInputBytes;
            if (IsOversized(sourceBytes, isKmz))
            {
                Fail(Strings.FileTooLarge(limitBytes));
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
                string? unpacked = null;
                try
                {
                    unpacked = await System.Threading.Tasks.Task.Run(
                        KmzArchive.CreateFolder, _lifecycle.Token);
                    _unpackedFolder = unpacked;
                    _path = await System.Threading.Tasks.Task.Run(
                        () => KmzArchive.ExtractDocument(_sourcePath, unpacked, _lifecycle.Token),
                        _lifecycle.Token);
                    _fileRoot = _unpackedFolder;
                    Trace($"unpacked {_name} to {_path}");
                }
                catch (OperationCanceledException) when (_finished)
                {
                    if (unpacked is { Length: > 0 })
                        KmzArchive.DeleteFolder(unpacked);
                    DropUnpackedFolder();
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
            if (_finished)
            {
                DropUnpackedFolder();
                return;
            }
            _attachments = new AttachmentExport(_sourcePath, _fileRoot);

            AttachWebView();
            // QuickLook shows its preview without activating it (ShowActivated="False") and reads Space, Esc and
            // the arrows through a global keyboard hook of its own, so a WPF handler only ever sees a key after
            // someone clicks into the preview. The viewer keys are caught below the application instead.
            var hookClock = Stopwatch.StartNew();
            _keys = new GlobalKeys(
                () => _onScreen, () => _measureActive, () => _textInput, OnGlobalKey,
                () => _editorActive, () => _textComposing);
            _keys.Start();
            Trace($"keyboard hook ready in {hookClock.ElapsedMilliseconds} ms (installed={_keys.Installed})");
            // Kept as a fallback: when the hook is unavailable, a preview that did get the keyboard still works.
            InputManager.Current.PreProcessInput += OnPreProcessInput;
            IsVisibleChanged += (_, _) => UpdateOnScreen();
            Loaded += (_, _) => UpdateOnScreen();
            Unloaded += (_, _) => _onScreen = false;
            _timeout.Start();
            Trace("WebView2 runtime " + CoreWebView2Environment.GetAvailableBrowserVersionString());
            _ = EnsureWebViewAsync();
        }
        catch (OperationCanceledException) when (_finished)
        {
            DropUnpackedFolder();
        }
        catch (Exception ex)
        {
            DropUnpackedFolder();
            Fail(Strings.PreviewFailed(ex.Message));
        }
    }

    private void AttachWebView()
    {
        if (_webView != null)
        {
            _webView.CoreWebView2InitializationCompleted -= OnInitialized;
            _webView.NavigationCompleted -= OnNavigationCompleted;
            _webView.Dispose();
            _webView = null;
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
        Content = _webView;
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
            if (_environmentTask != null && (_environmentTask.IsFaulted || _environmentTask.IsCanceled))
                _environmentTask = null;
            if (_environmentTask == null)
            {
                System.Threading.Tasks.Task<CoreWebView2Environment>? created = null;
                created = CreateTrackedEnvironmentAsync(() => ResetSharedEnvironment(created));
                _environmentTask = created;
            }
            return _environmentTask;
        }
    }

    private static async System.Threading.Tasks.Task<CoreWebView2Environment> CreateTrackedEnvironmentAsync(
        Action onBrowserProcessExited)
    {
        var env = await CoreWebView2Environment.CreateAsync(null, UserDataFolder);
        env.BrowserProcessExited += (_, _) => onBrowserProcessExited();
        return env;
    }

    private static void ResetSharedEnvironment(System.Threading.Tasks.Task<CoreWebView2Environment>? expected = null)
    {
        lock (EnvironmentGate)
        {
            if (expected == null || ReferenceEquals(_environmentTask, expected))
                _environmentTask = null;
        }
    }

    private async System.Threading.Tasks.Task EnsureWebViewAsync()
    {
        // When a user closes and quickly reopens a preview while the previous msedgewebview2.exe is still
        // tearing down its UserDataFolder lock, EnsureCoreWebView2Async can fail with CO_E_SERVER_EXEC_FAILURE
        // (0x80080005). Resetting the stale environment, waiting briefly for the exiting process to release the
        // profile lock, and retrying on a fresh WebView2 control recovers cleanly.
        int[] retryDelaysMs = { 350, 700 };
        _initializingWebView = true;
        try
        {
            for (var attempt = 0; attempt <= retryDelaysMs.Length; attempt++)
            {
                if (_webView == null || _finished || _disposed) return;
                System.Threading.Tasks.Task<CoreWebView2Environment>? envTask = null;
                try
                {
                    envTask = SharedEnvironmentAsync();
                    var environment = await envTask;
                    if (_webView == null || _finished || _disposed) return;
                    await _webView.EnsureCoreWebView2Async(environment);
                    return;
                }
                catch (OperationCanceledException) when (_finished || _disposed)
                {
                    return;
                }
                catch (Exception ex) when (!_finished && !_disposed)
                {
                    ResetSharedEnvironment(envTask);
                    if (attempt >= retryDelaysMs.Length)
                    {
                        Fail("Could not start WebView2: " + ex.Message);
                        return;
                    }
                    Trace($"WebView2 startup attempt {attempt + 1} failed ({ex.Message}); retrying in {retryDelaysMs[attempt]} ms");
                    try
                    {
                        await System.Threading.Tasks.Task.Delay(retryDelaysMs[attempt], _lifecycle.Token);
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }
                    if (_finished || _disposed) return;
                    AttachWebView();
                }
            }
        }
        finally
        {
            _initializingWebView = false;
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

    internal static bool IsOversized(long bytes, bool isKmz = false) =>
        bytes > (isKmz ? MaxKmzInputBytes : MaxInputBytes);

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
        _keys?.Dispose();
        _keys = null;
        ShowMessage(error);
        Finish(error, "");
    }

    private void Finish(string? error, string summary)
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

        if (error == null && _webView != null)
        {
            ScheduleHostReveal();
        }
    }

    private void CancelHostReveal()
    {
        _revealTimer?.Stop();
        _revealTimer = null;
        if (_revealWebView != null && _revealSizeHandler != null)
            _revealWebView.SizeChanged -= _revealSizeHandler;
        _revealSizeHandler = null;
        _revealWebView = null;
    }

    private void ScheduleHostReveal()
    {
        CancelHostReveal();
        if (_disposed || _webView == null)
            return;
        var webView = _webView;
        var timer = new DispatcherTimer(DispatcherPriority.Loaded, Dispatcher)
        {
            Interval = TimeSpan.FromMilliseconds(50),
        };
        SizeChangedEventHandler onSizeChanged = (_, _) =>
        {
            if (_disposed || !ReferenceEquals(_revealTimer, timer))
                return;
            timer.Stop();
            timer.Interval = TimeSpan.FromMilliseconds(35);
            timer.Start();
        };
        _revealTimer = timer;
        _revealSizeHandler = onSizeChanged;
        _revealWebView = webView;
        webView.SizeChanged += onSizeChanged;
        timer.Tick += (_, _) =>
        {
            CancelHostReveal();
            if (!_disposed && ReferenceEquals(_webView, webView))
                _ = PostToViewerMessageAsync("hostReveal");
        };
        timer.Start();
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
        _webView!.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, output);

    /// <summary>Test harness only: drives the page (a layer switch, say) before a capture. Unused by the plugin.</summary>
    internal System.Threading.Tasks.Task<string> RunScriptAsync(string script) =>
        _webView!.CoreWebView2.ExecuteScriptAsync(script);

    /// <summary>Test harness only: the live WebView, for DevTools-protocol diagnostics.</summary>
    internal CoreWebView2 Core => _webView!.CoreWebView2;

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
        _disposed = true;
        _finished = true; // no callbacks after the preview is closed
        CancelHostReveal();
        _lifecycle.Cancel();
        _onScreen = false;
        _textInput = false;
        _textComposing = false;
        _timeout.Stop();
        _focusRetryTimer.Stop();
        InputManager.Current.PreProcessInput -= OnPreProcessInput;
        _keys?.Dispose();
        _keys = null;
        _overlay.Dispose();
        _trackSave.Dispose();
        _attachments?.Dispose();
        _attachments = null;
        if (_webView != null)
        {
            var webView = _webView;
            _webView = null;
            Content = null;
            webView.CoreWebView2InitializationCompleted -= OnInitialized;
            webView.NavigationCompleted -= OnNavigationCompleted;
            DetachCoreEvents(webView);
            DeferDisposeWebView(webView);
        }

        DropUnpackedFolder();
    }

    private void DetachCoreEvents(WebView2 webView)
    {
        try
        {
            var core = webView.CoreWebView2;
            if (core == null) return;
            core.NewWindowRequested -= OnNewWindowRequested;
            core.NavigationStarting -= OnNavigationStarting;
            core.WebMessageReceived -= OnWebMessage;
            core.WebResourceRequested -= OnWebResourceRequested;
            core.WebResourceResponseReceived -= OnWebResourceResponseReceived;
        }
        catch (Exception)
        {
            // Ignore errors if WebView2 is already tearing down.
        }
    }

    /// <summary>
    /// Closing the last WebView2 triggers a ~5 s msedgewebview2.exe shutdown during which reopening a preview
    /// stalls for 4-6 s or fails with CO_E_SERVER_EXEC_FAILURE. Holding a blank shell for 15 s keeps the
    /// browser process warm across rapid close/reopen cycles, then releases all memory once idle.
    /// </summary>
    private static void DeferDisposeWebView(WebView2 webView)
    {
        try
        {
            var core = webView.CoreWebView2;
            if (core == null)
            {
                webView.Dispose();
                return;
            }
            core.Navigate("about:blank");
            var previous = _keepAliveWebView;
            _keepAliveWebView = webView;
            previous?.Dispose();

            if (!_shutdownHooked && Application.Current != null)
            {
                _shutdownHooked = true;
                Application.Current.Exit += (_, _) => ReleaseKeepAliveWebView();
            }
            if (_keepAliveTimer == null)
            {
                _keepAliveTimer = new DispatcherTimer { Interval = KeepAliveGrace };
                _keepAliveTimer.Tick += (_, _) => ReleaseKeepAliveWebView();
            }
            _keepAliveTimer.Stop();
            _keepAliveTimer.Start();
        }
        catch (Exception)
        {
            try { webView.Dispose(); } catch (Exception) { }
        }
    }

    private static void ReleaseKeepAliveWebView()
    {
        _keepAliveTimer?.Stop();
        var webView = _keepAliveWebView;
        _keepAliveWebView = null;
        if (webView == null) return;
        try
        {
            webView.Dispose();
        }
        catch (Exception)
        {
            // Best-effort cleanup.
        }
    }

    private void DropUnpackedFolder()
    {
        KmzArchive.DeleteFolder(_unpackedFolder ?? string.Empty);
        _unpackedFolder = null;
    }
}
