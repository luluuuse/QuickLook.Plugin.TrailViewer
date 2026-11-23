using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using QuickLook.Common.Helpers;
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
    private static readonly object EnvironmentGate = new();
    private static System.Threading.Tasks.Task<CoreWebView2Environment>? _environmentTask;
    internal const long MaxInputBytes = 64L * 1024 * 1024;

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
    private volatile bool _measureActive;
    private volatile bool _editorActive;
    private volatile bool _editorDirty;
    private volatile TileCacheOptions _tileCacheOptions = ViewerPreferences.ReadTileCacheOptions();
    private volatile IReadOnlyList<CustomHostMatcher> _customHostMatchers = Array.Empty<CustomHostMatcher>();
    private bool _finished;
    private volatile bool _disposed;

    public TrailViewerPanel()
    {
        Background = new SolidColorBrush(Color.FromRgb(24, 24, 24));
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
            EditorDirty = dirty => _editorDirty = dirty,
            BeginTrackSave = BeginTrackSave,
            AppendTrackSave = AppendTrackSave,
            FinishTrackSave = body => _ = FinishTrackSaveAsync(body),
            TextInput = active => _textInput = active,
            ConfigureTiandituKey = value => ConfigureTiandituKey(IsEnglishMessage(value)),
            RemoveTiandituKey = value => RemoveTiandituKey(IsEnglishMessage(value)),
            RequestTileCacheStats = RequestTileCacheStats,
            ClearTileCache = ClearTileCache,
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
            _keys = new GlobalKeys(
                () => _onScreen, () => _measureActive, () => _textInput, OnGlobalKey, () => _editorActive);
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
        _lifecycle.Cancel();
        _onScreen = false;
        _textInput = false;
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
            _webView.CoreWebView2InitializationCompleted -= OnInitialized;
            _webView.NavigationCompleted -= OnNavigationCompleted;
            _webView.Dispose();
            _webView = null;
        }

        DropUnpackedFolder();
    }

    private void DropUnpackedFolder()
    {
        KmzArchive.DeleteFolder(_unpackedFolder ?? string.Empty);
        _unpackedFolder = null;
    }
}
