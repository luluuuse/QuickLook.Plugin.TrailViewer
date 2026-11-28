using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Threading;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// W, Q, E, S, C, M, T and measuring undo/redo, caught below the application instead of inside it. Measured:
/// QuickLook shows its preview with ShowActivated="False" and reads its own keys (Space, Esc, arrows) through a
/// global keyboard hook, so the keyboard never enters this window -- a WPF handler only ever sees a key after
/// someone clicks into the preview. A raw low-level hook is the only place that always sees it first.
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
    private const int VkSpace = 0x20;
    private const int VkLWin = 0x5B;
    private const int VkRWin = 0x5C;
    private const uint InputKeyboard = 1;
    private const uint KeyEventFKeyUp = 0x0002;
    private const ushort VkDigitOne = 0x31;
    private const ushort ScanDigitOne = 0x02;

    // The windows a QuickLook preview is normally driven from. QuickLook itself polls the selection of these
    // windows and follows it, which is why a swallowed key must not reach them.
    private static readonly HashSet<string> HostProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "explorer", "Everything", "dopus", "MultiCommander", "Directory", "FreeCommander", "XYplorer", "TotalCMD",
    };

    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    private readonly Func<bool> _onScreen;
    private readonly Func<bool> _measureActive;
    private readonly Func<bool> _editorActive;
    private readonly Func<bool> _textInputActive;
    private readonly Func<bool> _textComposing;
    private readonly Action<string> _onKey;
    private readonly HookProc _callback; // held in a field: the GC must not collect the thunk the OS calls
    private readonly ManualResetEventSlim _ready = new(false);
    private readonly Dictionary<uint, bool> _hostPids = new();
    private readonly Dictionary<uint, string> _foregroundNames = new();
    private readonly HashSet<int> _held = new();
    private readonly uint _ownPid = (uint)Process.GetCurrentProcess().Id;

    private int _calls; // test harness only: how many keys the OS actually routed through the hook

    private Thread? _thread;
    private Dispatcher? _dispatcher;
    private IntPtr _hook;
    private bool _swallowedSpace;
    private bool _swallowedSpaceAsImeCommit;
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
        Action<string> onKey,
        Func<bool>? editorActive = null,
        Func<bool>? textComposing = null)
    {
        _onScreen = onScreen;
        _measureActive = measureActive;
        _editorActive = editorActive ?? (() => false);
        _textInputActive = textInputActive;
        _textComposing = textComposing ?? (() => false);
        _onKey = onKey;
        _callback = Filter;
    }

    /// <summary>False when Windows refused the hook; the preview still works, the keys just stay with the host.</summary>
    public bool Installed { get; private set; }

    /// <summary>Test harness only: why the last candidate key was let through.</summary>
    internal string Reason { get; private set; } = "none";

    /// <summary>Test harness only: keys seen by the hook, whoever they were for.</summary>
    internal int Calls => _calls;

    private readonly object _stateGate = new();

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
        lock (_stateGate)
        {
            if (_disposed)
            {
                _ready.Set();
                return;
            }
            _dispatcher = Dispatcher.CurrentDispatcher;
            _hook = SetWindowsHookEx(WhKeyboardLl, _callback, GetModuleHandle(null), 0);
            Installed = _hook != IntPtr.Zero;
        }
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

        try
        {
            _calls++;
            var info = Marshal.PtrToStructure<KbdHook>(lParam);
            if ((int)info.vkCode == VkSpace)
                return HandleSpace(code, wParam, lParam, info);

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
            var measureHistory = control && !alt && !win && name == "z";
            var editorSave = control && !shift && !alt && !win && name == "s";

            if ((!plainAction && !measureHistory && !editorSave) || !SafeOnScreen() || !HostIsForeground())
            {
                Reason = !plainAction && !measureHistory && !editorSave ? "modifier"
                    : TextInputActive() ? "text-input"
                    : !SafeOnScreen() ? "off-screen" : "foreground=" + ForegroundName();
                return Next(code, wParam, lParam);
            }
            if (measureHistory && !_measureActive() && !_editorActive())
            {
                Reason = "measure-inactive";
                return Next(code, wParam, lParam);
            }
            if (editorSave && !_editorActive())
            {
                Reason = "editor-inactive";
                return Next(code, wParam, lParam);
            }

            // A held key repeats ~30 times a second; the page should see one press, not a flicker.
            if (!_held.Add((int)info.vkCode))
                return (IntPtr)1; // a held key: swallowed, but it already did its job

            var payload = editorSave ? "ctrl+s" : (measureHistory && shift ? "Z" : name);
            _onKey(payload);

            Reason = "swallowed";
            return (IntPtr)1; // no file switch, no typing into the file manager's list
        }
        catch (Exception ex)
        {
            Trace("key filter failed: " + ex.Message);
            return Next(code, wParam, lParam);
        }
    }

    private IntPtr HandleSpace(int code, IntPtr wParam, IntPtr lParam, KbdHook info)
    {
        var message = (int)wParam;
        if (message == WmKeyUp || message == WmSysKeyUp)
        {
            if (!_swallowedSpace)
                return Next(code, wParam, lParam);
            var wasImeCommit = _swallowedSpaceAsImeCommit;
            _swallowedSpace = false;
            _swallowedSpaceAsImeCommit = false;
            if (!wasImeCommit)
                PostSpaceKey((uint)WmKeyUp, info.scanCode, isKeyUp: true, isRepeat: false);
            Reason = wasImeCommit ? "space-ime-commit-up" : "space-text-input-up";
            return (IntPtr)1;
        }

        if (message != WmKeyDown && message != WmSysKeyDown)
            return Next(code, wParam, lParam);

        var control = Down(VkControl);
        var shift = Down(VkShift);
        var alt = Down(VkMenu);
        var win = Down(VkLWin) || Down(VkRWin);
        if (alt || win || !TextInputActive() || !IsOnScreen() || !OwnWindowIsForeground())
            return Next(code, wParam, lParam);

        var isRepeat = _swallowedSpace;
        if (!control && !shift && TextComposing())
        {
            _swallowedSpace = true;
            _swallowedSpaceAsImeCommit = true;
            if (!isRepeat)
                ThreadPool.QueueUserWorkItem(_ => SendDigitOne());
            Reason = "space-ime-commit";
            return (IntPtr)1;
        }

        _swallowedSpace = true;
        _swallowedSpaceAsImeCommit = false;
        PostSpaceKey((uint)WmKeyDown, info.scanCode, isKeyUp: false, isRepeat: isRepeat);
        Reason = "space-text-input";
        return (IntPtr)1;
    }

    private bool TextComposing()
    {
        try
        {
            return _textComposing != null && _textComposing();
        }
        catch
        {
            return false;
        }
    }

    private static void SendDigitOne()
    {
        var inputs = new[]
        {
            new Input
            {
                type = InputKeyboard,
                u = new InputUnion
                {
                    ki = new KeybdInput { wVk = VkDigitOne, wScan = ScanDigitOne },
                },
            },
            new Input
            {
                type = InputKeyboard,
                u = new InputUnion
                {
                    ki = new KeybdInput { wVk = VkDigitOne, wScan = ScanDigitOne, dwFlags = KeyEventFKeyUp },
                },
            },
        };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>());
    }

    private void PostSpaceKey(uint message, uint scanCode, bool isKeyUp, bool isRepeat)
    {
        var target = FocusedForegroundWindow();
        if (target == IntPtr.Zero)
            return;
        PostMessage(target, message, (IntPtr)VkSpace, MakeKeyLParam(scanCode, isKeyUp, isRepeat));
    }

    private static IntPtr FocusedForegroundWindow()
    {
        var fg = GetForegroundWindow();
        if (fg == IntPtr.Zero)
            return IntPtr.Zero;
        var threadId = GetWindowThreadProcessId(fg, out _);
        if (threadId != 0)
        {
            var gui = new GuiThreadInfo { cbSize = Marshal.SizeOf<GuiThreadInfo>() };
            if (GetGUIThreadInfo(threadId, ref gui) && gui.hwndFocus != IntPtr.Zero)
                return gui.hwndFocus;
        }
        return fg;
    }

    private static IntPtr MakeKeyLParam(uint scanCode, bool isKeyUp, bool isRepeat)
    {
        var sc = scanCode != 0 ? (scanCode & 0xFFu) : 0x39u;
        uint value = 1u | (sc << 16);
        if (isRepeat || isKeyUp)
            value |= 1u << 30;
        if (isKeyUp)
            value |= 1u << 31;
        return IntPtr.Size == 8 ? new IntPtr((long)value) : new IntPtr(unchecked((int)value));
    }

    private bool IsOnScreen()
    {
        try
        {
            return _onScreen();
        }
        catch
        {
            return false;
        }
    }

    private bool SafeOnScreen()
    {
        // A focused text field owns every letter: let the key through so the page can type it.
        if (TextInputActive())
            return false;
        return IsOnScreen();
    }

    private bool OwnWindowIsForeground()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero)
            return false;
        GetWindowThreadProcessId(hwnd, out var pid);
        return pid == _ownPid;
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

    private string ForegroundName()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero)
            return "none";
        GetWindowThreadProcessId(hwnd, out var pid);
        if (_foregroundNames.TryGetValue(pid, out var cached))
            return cached;
        try
        {
            using var process = Process.GetProcessById((int)pid);
            if (_foregroundNames.Count > 32)
                _foregroundNames.Clear();
            _foregroundNames[pid] = process.ProcessName;
            return process.ProcessName;
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or Win32Exception)
        {
            var fallback = "pid" + pid;
            _foregroundNames[pid] = fallback;
            return fallback;
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
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or Win32Exception)
        {
            // The window outlived its process for a moment; treat it as a stranger.
        }

        if (_hostPids.Count > 32) // a long session should not grow a map forever
            _hostPids.Clear();
        _hostPids[pid] = host;
        return host;
    }

    private static bool Down(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;

    private static string? NameOf(int vk) => vk switch
    {
        0x57 => "w",
        0x51 => "q",
        0x45 => "e",
        0x53 => "s",
        0x43 => "c",
        0x4D => "m",
        0x54 => "t",
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
        Dispatcher? dispatcher;
        lock (_stateGate)
        {
            if (_disposed)
                return;
            _disposed = true;
            dispatcher = _dispatcher;
        }
        try
        {
            // Unhook on the thread that installed the hook, before its dispatcher stops. Clearing the handle
            // from the UI thread after a short timeout could otherwise lose the only reference to a live global
            // hook while the callback thread was still winding down.
            dispatcher?.BeginInvoke(new Action(() =>
            {
                ReleaseHook();
                dispatcher.InvokeShutdown();
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

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct GuiThreadInfo
    {
        public int cbSize;
        public int flags;
        public IntPtr hwndActive;
        public IntPtr hwndFocus;
        public IntPtr hwndCapture;
        public IntPtr hwndMenuOwner;
        public IntPtr hwndMoveSize;
        public IntPtr hwndCaret;
        public Rect rcCaret;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? moduleName);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    [DllImport("user32.dll")]
    private static extern bool GetGUIThreadInfo(uint idThread, ref GuiThreadInfo lpgui);

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint type;
        public InputUnion u;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MouseInput mi;
        [FieldOffset(0)] public KeybdInput ki;
        [FieldOffset(0)] public HardwareInput hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeybdInput
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HardwareInput
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, Input[] pInputs, int cbSize);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vk);
}
