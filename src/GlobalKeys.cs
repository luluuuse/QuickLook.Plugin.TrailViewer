using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Threading;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// W, Q, E, S, C, X, M and measuring undo/redo, caught below the application instead of inside it. Measured: QuickLook shows its preview
/// with ShowActivated="False" and reads its own keys (Space, Esc, arrows) through a global keyboard hook, so the
/// keyboard never enters this window -- a WPF handler only ever sees a key after someone clicks into the
/// preview. A raw low-level hook is the only place that always sees it first.
///
/// The hook exists only while this preview is on screen, and it only swallows a key when the foreground is
/// either this process or a file manager -- the windows a preview is opened from, and the ones whose selection
/// QuickLook follows. Everywhere else (a text editor, a browser) these keys pass straight through.
/// </summary>
internal sealed class GlobalKeys : IDisposable
{
    private const int WhKeyboardLl = 13;
    private const int WmKeyDown = 0x0100;
    private const int WmKeyUp = 0x0101;
    private const int WmSysKeyDown = 0x0104;
    private const int WmSysKeyUp = 0x0105;

    private const int VkShift = 0x10;
    private const int VkControl = 0x11;
    private const int VkMenu = 0x12;
    private const int VkLWin = 0x5B;
    private const int VkRWin = 0x5C;

    // The windows a QuickLook preview is normally driven from. QuickLook itself polls the selection of these
    // windows and follows it, which is why a swallowed key must not reach them.
    private static readonly HashSet<string> HostProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "explorer", "Everything", "dopus", "MultiCommander", "Directory", "FreeCommander", "XYplorer", "TotalCMD",
    };

    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    private readonly Func<bool> _onScreen;
    private readonly Func<bool> _measureActive;
    private readonly Func<bool> _textInputActive;
    private readonly Action<string> _onKey;
    private readonly HookProc _callback; // held in a field: the GC must not collect the thunk the OS calls
    private readonly ManualResetEventSlim _ready = new(false);
    private readonly Dictionary<uint, bool> _hostPids = new();
    private readonly HashSet<int> _held = new();
    private readonly uint _ownPid = (uint)Process.GetCurrentProcess().Id;

    private int _calls; // test harness only: how many keys the OS actually routed through the hook

    private Thread _thread;
    private Dispatcher _dispatcher;
    private IntPtr _hook;
    private bool _disposed;

    /// <param name="onScreen">Asked on the hook thread: is there a preview to act on right now?</param>
    /// <param name="onKey">Called on the hook thread with a viewer key name. Must not block.</param>
    /// <param name="textInputActive">
    /// Asked on the hook thread: is a text field inside the page focused? A global hook sees the key before the
    /// WebView does, so without this a letter typed into the map-settings form would be swallowed as a shortcut.
    /// </param>
    public GlobalKeys(
        Func<bool> onScreen,
        Func<bool> measureActive,
        Func<bool> textInputActive,
        Action<string> onKey)
    {
        _onScreen = onScreen;
        _measureActive = measureActive;
        _textInputActive = textInputActive;
        _onKey = onKey;
        _callback = Filter;
    }

    /// <summary>False when Windows refused the hook; the preview still works, the keys just stay with the host.</summary>
    public bool Installed { get; private set; }

    /// <summary>Test harness only: why the last candidate key was let through.</summary>
    internal string Reason { get; private set; } = "none";

    /// <summary>Test harness only: keys seen by the hook, whoever they were for.</summary>
    internal int Calls => _calls;

    public void Start()
    {
        // Its own thread on purpose: the hook callback runs wherever the hook was installed, and the UI thread
        // is busy laying out four thousand track points exactly when a key arrives.
        _thread = new Thread(Pump) { IsBackground = true, Name = "TrailViewer keys" };
        _thread.Start();
        _ready.Wait(2000);
    }

    private void Pump()
    {
        _dispatcher = Dispatcher.CurrentDispatcher;
        _hook = SetWindowsHookEx(WhKeyboardLl, _callback, GetModuleHandle(null), 0);
        Installed = _hook != IntPtr.Zero;
        _ready.Set();
        if (!Installed)
        {
            Trace("keyboard hook refused by Windows");
            return;
        }

        Dispatcher.Run(); // pumps the messages the hook is delivered through; ends on Dispose
        ReleaseHook();
    }

    private IntPtr Filter(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code < 0)
            return Next(code, wParam, lParam);

        _calls++;
        var info = Marshal.PtrToStructure<KbdHook>(lParam);
        var name = NameOf((int)info.vkCode);
        if (name == null) // the common case: one comparison and back out
            return Next(code, wParam, lParam);

        var message = (int)wParam;
        if (message == WmKeyUp || message == WmSysKeyUp)
        {
            _held.Remove((int)info.vkCode);
            return Next(code, wParam, lParam);
        }
        if (message != WmKeyDown && message != WmSysKeyDown)
            return Next(code, wParam, lParam);

        var control = Down(VkControl);
        var shift = Down(VkShift);
        var alt = Down(VkMenu);
        var win = Down(VkLWin) || Down(VkRWin);
        var plain = !control && !shift && !alt && !win;
        var plainAction = plain && name != "z";
        // Shift+X opens the export panel. Ctrl+Z and Ctrl+Shift+Z belong to measurement only while its mode is
        // active, so an inactive preview leaves Explorer's own undo shortcut untouched.
        var shiftedExport = name == "x" && shift && !control && !alt && !win;
        var measureHistory = name == "z" && control && !alt && !win;

        if ((!plainAction && !shiftedExport && !measureHistory) || !SafeOnScreen() || !HostIsForeground())
        {
            Reason = !plainAction && !shiftedExport && !measureHistory ? "modifier"
                : TextInputActive() ? "text-input"
                : !SafeOnScreen() ? "off-screen" : "foreground=" + ForegroundName();
            return Next(code, wParam, lParam);
        }
        if (measureHistory && !_measureActive())
        {
            Reason = "measure-inactive";
            return Next(code, wParam, lParam);
        }

        // A held key repeats ~30 times a second; the page should see one press, not a flicker.
        if (!_held.Add((int)info.vkCode))
            return (IntPtr)1; // a held key: swallowed, but it already did its job

        try
        {
            _onKey(shiftedExport ? "X" : measureHistory && shift ? "Z" : name);
        }
        catch (Exception ex)
        {
            Trace("key handler failed: " + ex.Message);
        }

        Reason = "swallowed";
        return (IntPtr)1; // no file switch, no typing into the file manager's list
    }

    private bool SafeOnScreen()
    {
        try
        {
            // A focused text field owns every letter: let the key through so the page can type it.
            if (TextInputActive())
                return false;
            return _onScreen();
        }
        catch
        {
            return false;
        }
    }

    private bool TextInputActive()
    {
        try
        {
            return _textInputActive != null && _textInputActive();
        }
        catch
        {
            return false;
        }
    }

    private bool HostIsForeground()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero)
            return false;
        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == _ownPid)
            return true; // this preview has the keyboard itself
        return IsHostProcess(pid);
    }

    private static string ForegroundName()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero)
            return "none";
        GetWindowThreadProcessId(hwnd, out var pid);
        try
        {
            using var process = Process.GetProcessById((int)pid);
            return process.ProcessName;
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            return "pid" + pid;
        }
    }

    private bool IsHostProcess(uint pid)
    {
        if (_hostPids.TryGetValue(pid, out var known))
            return known;

        var host = false;
        try
        {
            using var process = Process.GetProcessById((int)pid);
            host = HostProcesses.Contains(process.ProcessName);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            // The window outlived its process for a moment; treat it as a stranger.
        }

        if (_hostPids.Count > 32) // a long session should not grow a map forever
            _hostPids.Clear();
        _hostPids[pid] = host;
        return host;
    }

    private static bool Down(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;

    private static string NameOf(int vk) => vk switch
    {
        0x57 => "w",
        0x51 => "q",
        0x45 => "e",
        0x53 => "s",
        0x43 => "c",
        0x58 => "x",
        0x4D => "m",
        0x5A => "z",
        _ => null,
    };

    private static IntPtr Next(int code, IntPtr wParam, IntPtr lParam) =>
        CallNextHookEx(IntPtr.Zero, code, wParam, lParam);

    /// <summary>Test harness only: push a key through the same filter the OS uses, without touching the input queue.</summary>
    internal bool HandleForTest(int vk, bool keyUp)
    {
        var size = Marshal.SizeOf<KbdHook>();
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(new KbdHook { vkCode = (uint)vk }, buffer, false);
            var message = (IntPtr)(keyUp ? WmKeyUp : WmKeyDown);
            return Filter(0, message, buffer) != IntPtr.Zero;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static void Trace(string message) => TrailViewerPanel.Trace("[keys] " + message);

    private void ReleaseHook()
    {
        var hook = Interlocked.Exchange(ref _hook, IntPtr.Zero);
        if (hook != IntPtr.Zero)
            UnhookWindowsHookEx(hook);
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        try
        {
            // Unhook on the thread that installed the hook, before its dispatcher stops. Clearing the handle
            // from the UI thread after a short timeout could otherwise lose the only reference to a live global
            // hook while the callback thread was still winding down.
            _dispatcher?.BeginInvoke(new Action(() =>
            {
                ReleaseHook();
                _dispatcher.InvokeShutdown();
            }));
        }
        catch (Exception ex) when (ex is InvalidOperationException or ObjectDisposedException
            or System.Threading.Tasks.TaskCanceledException)
        {
            // Already shut down.
        }

        var stopped = _thread == null || _thread.Join(2000);
        if (stopped)
            _ready.Dispose();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KbdHook
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string moduleName);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vk);
}
