using QuickLook.Plugin.TrailViewer;
using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "detect")
            return Detect(args);
        if (args.Length >= 3 && args[0] == "render")
            return Render(args[1], args[2], args.Length > 3 ? int.Parse(args[3]) : 30, args.Length > 4 ? args[4] : null);
        if (args.Length >= 2 && args[0] == "keys")
            return Keys(args[1], args.Length > 2 ? args[2] : "w,q,e");
        if (args.Length >= 2 && args[0] == "wpfkey")
            return WpfKey(args[1], args.Length > 2 ? args[2] : "w");
        if (args.Length >= 2 && args[0] == "hookkey")
            return HookKey(args[1], args.Length > 2 ? args[2] : "w");
        if (args.Length >= 2 && args[0] == "hookprobe")
            return HookProbe(args[1]);

        Console.WriteLine("Usage: TrailViewer.Harness detect <file>...");
        Console.WriteLine("       TrailViewer.Harness render <file> <out.png> [timeoutSeconds] [layer]");
        Console.WriteLine("       TrailViewer.Harness keys <file> [w,q,e]");
        Console.WriteLine("       TrailViewer.Harness wpfkey <file> [w|q|e|z]");
        Console.WriteLine("       TrailViewer.Harness hookkey <file> [w|q|e|z]");
        Console.WriteLine("       TrailViewer.Harness hookprobe <file>");
        return 2;
    }

    /// <summary>
    /// Proves the low-level hook does the job when the page has no keyboard at all. The filter is called with
    /// the same KBDLLHOOKSTRUCT the OS would hand it, so what is measured is the real decision: was the key
    /// swallowed, and did the page act on it. Z is the control: it must never be swallowed.
    /// </summary>
    private static int HookKey(string file, string name)
    {
        if (!DocumentDetector.CanPreview(file))
        {
            Console.WriteLine("NOT HANDLED " + file);
            return 3;
        }

        var clock = System.Diagnostics.Stopwatch.StartNew();
        GpxPanel.Trace = line => Console.WriteLine($"[{clock.ElapsedMilliseconds,6} ms] {line}");
        var exitCode = 1;
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var panel = new GpxPanel();
        var window = new Window { Width = 1200, Height = 800, Title = "TrailViewer harness", Content = panel };
        var timeout = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
        timeout.Tick += (_, _) =>
        {
            Console.WriteLine("TIMEOUT");
            app.Shutdown();
        };

        panel.Finished += async error =>
        {
            timeout.Stop();
            if (error != null)
            {
                Console.WriteLine("ERROR " + error);
                app.Shutdown();
                return;
            }

            window.Activate();
            panel.MarkOnScreen(true);
            await Task.Delay(300); // let the window actually become the foreground one
            var before = await panel.RunScriptAsync(
                "JSON.stringify({pins: window.gpxViewer.pins.visible(), layer: window.gpxViewer.layer(),"
                + " chrome: document.body.classList.contains('chrome-hidden')})");

            var swallowed = panel.HandleGlobalKeyForTest(name[0]);
            var reason = panel.HookReason;
            panel.HandleGlobalKeyForTest(name[0], keyUp: true); // release, so the next run is a fresh press
            await Task.Delay(400);

            var after = await panel.RunScriptAsync(
                "JSON.stringify({pins: window.gpxViewer.pins.visible(), layer: window.gpxViewer.layer(),"
                + " chrome: document.body.classList.contains('chrome-hidden')})");

            // The guard in the other direction: with no preview on screen the same key must be let through.
            panel.MarkOnScreen(false);
            var offScreen = panel.HandleGlobalKeyForTest('w');
            panel.MarkOnScreen(true);

            Console.WriteLine($"HOOKKEY {name} installed={panel.HookInstalled} swallowed={swallowed}"
                + $" reason={reason} offscreenSwallowed={offScreen} before={before} after={after}");
            exitCode = 0;
            app.Shutdown();
        };

        window.Loaded += (_, _) =>
        {
            timeout.Start();
            panel.Load(Path.GetFullPath(file));
        };
        app.Run(window);
        panel.Dispose();
        return exitCode;
    }

    /// <summary>
    /// Proves the host-level capture of W/Q/E. WPF focus is parked on a sibling control, which is the state a
    /// freshly opened preview is in (the page has no keyboard), then one key is pushed through the real input
    /// pipeline. Handled=true is the point: it means QuickLook's window never sees the key and cannot read W
    /// as "show the next file". The page is asked before and after, so the key also has to have done its job.
    /// </summary>
    private static int WpfKey(string file, string name)
    {
        if (!DocumentDetector.CanPreview(file))
        {
            Console.WriteLine("NOT HANDLED " + file);
            return 3;
        }

        var clock = System.Diagnostics.Stopwatch.StartNew();
        GpxPanel.Trace = line => Console.WriteLine($"[{clock.ElapsedMilliseconds,6} ms] {line}");
        var exitCode = 1;
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var panel = new GpxPanel();
        var rival = new System.Windows.Controls.Button { Width = 12, Height = 12, Opacity = 0.01 };
        var host = new System.Windows.Controls.Grid();
        host.Children.Add(panel);
        host.Children.Add(rival);
        var window = new Window { Width = 1200, Height = 800, Title = "TrailViewer harness", Content = host };
        var timeout = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
        timeout.Tick += (_, _) =>
        {
            Console.WriteLine("TIMEOUT");
            app.Shutdown();
        };

        panel.Finished += async error =>
        {
            timeout.Stop();
            if (error != null)
            {
                Console.WriteLine("ERROR " + error);
                app.Shutdown();
                return;
            }

            var before = await panel.RunScriptAsync(
                "JSON.stringify({pins: window.gpxViewer.pins.visible(), layer: window.gpxViewer.layer(),"
                + " focus: document.hasFocus()})");
            Console.WriteLine("FOCUS before " + panel.FocusReport);

            // The keyboard sits anywhere but the page, exactly as in a preview nobody has clicked yet.
            window.Activate();
            rival.Focus();
            await Task.Delay(200);
            Console.WriteLine("FOCUS parked " + panel.FocusReport);

            var key = name.ToLowerInvariant() switch
            {
                "q" => Key.Q,
                "e" => Key.E,
                "z" => Key.Z, // a key the viewer does not bind: it must pass through untouched
                _ => Key.W,
            };
            var args = new KeyEventArgs(Keyboard.PrimaryDevice, PresentationSource.FromVisual(window), 0, key)
            {
                RoutedEvent = Keyboard.PreviewKeyDownEvent,
            };
            InputManager.Current.ProcessInput(args);
            await Task.Delay(400);

            var after = await panel.RunScriptAsync(
                "JSON.stringify({pins: window.gpxViewer.pins.visible(), layer: window.gpxViewer.layer(),"
                + " chrome: document.body.classList.contains('chrome-hidden')})");
            Console.WriteLine($"WPFKEY {key} handled={args.Handled} rival={rival.IsKeyboardFocused}"
                + $" before={before} after={after}");
            exitCode = 0;
            app.Shutdown();
        };

        window.Loaded += (_, _) =>
        {
            timeout.Start();
            panel.Load(Path.GetFullPath(file));
        };
        app.Run(window);
        panel.Dispose();
        return exitCode;
    }


    /// <summary>
    /// Proves the hook thread is really wired to the operating system, not just callable in-process: one F13
    /// is typed into the input queue (a key nothing binds, so a leak would be harmless) and the counter of keys
    /// the OS routed through the hook has to move. Without this, a hook that was never delivered would look
    /// exactly like a working one.
    /// </summary>
    private static int HookProbe(string file)
    {
        if (!DocumentDetector.CanPreview(file))
        {
            Console.WriteLine("NOT HANDLED " + file);
            return 3;
        }

        var clock = System.Diagnostics.Stopwatch.StartNew();
        GpxPanel.Trace = line => Console.WriteLine($"[{clock.ElapsedMilliseconds,6} ms] {line}");
        var exitCode = 1;
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var panel = new GpxPanel();
        var window = new Window { Width = 1200, Height = 800, Title = "TrailViewer harness", Content = panel };
        var timeout = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
        timeout.Tick += (_, _) =>
        {
            Console.WriteLine("TIMEOUT");
            app.Shutdown();
        };

        panel.Finished += async error =>
        {
            timeout.Stop();
            if (error != null)
            {
                Console.WriteLine("ERROR " + error);
                app.Shutdown();
                return;
            }

            window.Activate();
            await Task.Delay(300);
            var before = panel.HookCalls;
            keybd_event(0x7C, 0, 0, UIntPtr.Zero);      // F13 down
            keybd_event(0x7C, 0, 2, UIntPtr.Zero);      // F13 up
            await Task.Delay(500);
            var after = panel.HookCalls;
            Console.WriteLine($"HOOKPROBE installed={panel.HookInstalled} calls {before}->{after}"
                + $" delivered={after > before}");
            exitCode = after > before ? 0 : 1;
            app.Shutdown();
        };

        window.Loaded += (_, _) =>
        {
            timeout.Start();
            panel.Load(Path.GetFullPath(file));
        };
        app.Run(window);
        panel.Dispose();
        return exitCode;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    /// <summary>
    /// Proves a key can reach the page inside WebView2 at all: a listener collects what the document saw,
    /// then the keys are dispatched through CDP as real input events rather than synthetic DOM events.
    /// This is the check for "does typing into the preview arrive", before any handler is written.
    /// </summary>
    private static int Keys(string file, string list)
    {
        if (!DocumentDetector.CanPreview(file))
        {
            Console.WriteLine("NOT HANDLED " + file);
            return 3;
        }

        var clock = System.Diagnostics.Stopwatch.StartNew();
        GpxPanel.Trace = line => Console.WriteLine($"[{clock.ElapsedMilliseconds,6} ms] {line}");
        var exitCode = 1;
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var panel = new GpxPanel();
        var window = new Window { Width = 1200, Height = 800, Title = "TrailViewer harness", Content = panel };
        var timeout = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
        timeout.Tick += (_, _) =>
        {
            Console.WriteLine("TIMEOUT");
            app.Shutdown();
        };

        panel.Finished += async error =>
        {
            timeout.Stop();
            if (error != null)
            {
                Console.WriteLine("ERROR " + error);
                app.Shutdown();
                return;
            }

            await panel.RunScriptAsync(
                "window.__seen=[]; document.addEventListener('keydown', e => window.__seen.push(e.key + ':' + e.code));");

            foreach (var raw in list.Split(','))
            {
                var key = raw.Trim();
                if (key.Length == 0) continue;
                var vk = char.ToUpperInvariant(key[0]);
                var code = "Key" + vk;
                var payload = "{\"type\":\"keyDown\",\"modifiers\":0,\"windowsVirtualKeyCode\":" + (int)vk
                    + ",\"nativeVirtualKeyCode\":" + (int)vk + ",\"code\":\"" + code + "\",\"key\":\"" + key
                    + "\",\"text\":\"" + key + "\",\"unmodifiedText\":\"" + key + "\"}";
                await panel.Core.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", payload);
                await panel.Core.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent",
                    payload.Replace("\"keyDown\"", "\"keyUp\""));
                await Task.Delay(250);
            }

            // hasFocus is the whole point of the keys check: a page that never got the keyboard still passes a
            // CDP-dispatched key, so the handler can look fine while a real user presses keys into nothing.
            Console.WriteLine("KEYS " + await panel.RunScriptAsync(
                "JSON.stringify({seen: window.__seen, pins: window.gpxViewer.pins.visible(),"
                + " layer: window.gpxViewer.layer(), focus: document.hasFocus(),"
                + " active: document.activeElement && document.activeElement.tagName})"));
            exitCode = 0;
            app.Shutdown();
        };

        window.Loaded += (_, _) =>
        {
            timeout.Start();
            panel.Load(Path.GetFullPath(file));
        };
        app.Run(window);
        panel.Dispose();
        return exitCode;
    }

    private static int Detect(string[] args)
    {
        for (var i = 1; i < args.Length; i++)
            Console.WriteLine($"{(DocumentDetector.CanPreview(args[i]) ? "TRACK" : "-")}\t{Path.GetFileName(args[i])}");
        return 0;
    }

    private static int Render(string file, string png, int timeoutSeconds, string layer)
    {
        if (!DocumentDetector.CanPreview(file))
        {
            Console.WriteLine("NOT HANDLED " + file);
            return 3;
        }

        // The narrow window is where the layout has to fold, so the size is a parameter: GPXVIEWER_SIZE=1600x900.
        var size = (Environment.GetEnvironmentVariable("GPXVIEWER_SIZE") ?? "1200x800").Split('x');
        var width = int.Parse(size[0]);
        var height = size.Length > 1 ? int.Parse(size[1]) : 800;

        var clock = System.Diagnostics.Stopwatch.StartNew();
        GpxPanel.Trace = line => Console.WriteLine($"[{clock.ElapsedMilliseconds,6} ms] {line}");
        var exitCode = 1;
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var panel = new GpxPanel();
        var window = new Window { Width = width, Height = height, Title = "TrailViewer harness", Content = panel };
        var timeout = new DispatcherTimer { Interval = TimeSpan.FromSeconds(timeoutSeconds) };
        timeout.Tick += (_, _) =>
        {
            Console.WriteLine("TIMEOUT");
            app.Shutdown();
        };

        panel.Finished += async error =>
        {
            timeout.Stop();
            if (error != null)
            {
                Console.WriteLine("ERROR " + error);
                app.Shutdown();
                return;
            }

            if (layer != null)
            {
                // Same path a click takes, so the capture shows what the button would have produced.
                var result = await panel.RunScriptAsync($"window.gpxViewer.selectLayer('{layer}')");
                GpxPanel.Trace($"layer {layer} -> {result}");
            }

            if (Environment.GetEnvironmentVariable("GPXVIEWER_CDP") == "1")
            {
                // Every failed request with its Chromium error code, then the layer is re-selected so the
                // listener sees a fresh round. "The map is black" has several causes and this is the only
                // place that tells them apart: ERR_BLOCKED_BY_ORB, for one, means a 403 dressed as an image.
                var failed = panel.Core.GetDevToolsProtocolEventReceiver("Network.loadingFailed");
                failed.DevToolsProtocolEventReceived += (_, e) =>
                {
                    if (!e.ParameterObjectAsJson.Contains("\"canceled\":true"))
                        Console.WriteLine("CDP " + e.ParameterObjectAsJson);
                };
                await panel.Core.CallDevToolsProtocolMethodAsync("Network.enable", "{}");
                await panel.RunScriptAsync("window.gpxViewer.selectLayer('none')");
                await Task.Delay(800);
                await panel.RunScriptAsync($"window.gpxViewer.selectLayer('{layer ?? "map"}')");
                await Task.Delay(8000);
            }

            // Tiles arrive over a second or three, and a shot taken on a fixed delay catches the black
            // squares of the ones still in flight. Wait until every tile image in the pane has settled,
            // with a cap so a slow network cannot hang the capture. GPXVIEWER_WAIT overrides the cap.
            var wait = int.TryParse(Environment.GetEnvironmentVariable("GPXVIEWER_WAIT"), out var w) ? w : 0;
            await SettleTiles(panel, wait > 0 ? wait : (layer == null ? 20000 : 30000));

            // How many tiles actually arrived: a black map and a slow map look the same in a screenshot.
            var stats = await panel.RunScriptAsync(
                "JSON.stringify({total: document.querySelectorAll('.leaflet-tile-pane img').length,"
                + " ok: [...document.querySelectorAll('.leaflet-tile-pane img')].filter(i => i.complete && i.naturalWidth > 0).length})");
            GpxPanel.Trace($"tiles {stats}");

            // A key pressed before the shot, through the same entry point the hook calls: GPXVIEWER_KEY=s
            // photographs the cleared screen. The wait outlasts the tip, so the picture shows the end state.
            var key = Environment.GetEnvironmentVariable("GPXVIEWER_KEY");
            if (!string.IsNullOrEmpty(key))
            {
                await panel.RunScriptAsync($"window.gpxViewer && window.gpxViewer.pressKey('{key}')");
                await Task.Delay(2400);
            }

            // GPXVIEWER_SCRIPT runs one expression in the page before the shutter -- opening a pin's photo
            // card, hovering the profile, switching the language. The map is settled again afterwards,
            // because whatever it did may have panned or changed the layer.
            var script = Environment.GetEnvironmentVariable("GPXVIEWER_SCRIPT");
            if (!string.IsNullOrEmpty(script))
            {
                var result = await panel.RunScriptAsync(script);
                GpxPanel.Trace($"script -> {result}");
                await Task.Delay(600);
                await SettleTiles(panel, 8000);
            }

            // CapturePreviewAsync asks the compositor for what is on screen, and right after the last tile
            // arrives some layers have not been painted into the frame yet: the shot comes back with black
            // rectangles where the map should be. A quiet second lets the compositor finish.
            await Task.Delay(1800);

            using (var output = File.Create(png))
                await panel.CapturePngAsync(output);
            Console.WriteLine("OK " + png);
            exitCode = 0;
            app.Shutdown();
        };

        window.Loaded += (_, _) =>
        {
            GpxPanel.Trace("window loaded");
            timeout.Start();
            panel.Load(Path.GetFullPath(file));
        };
        app.Run(window);
        // QuickLook calls Cleanup() when the preview closes; doing the same here covers the KMZ temp folder.
        panel.Dispose();
        return exitCode;
    }

    /// <summary>
    /// Waits until no tile in the pane is still loading. The pane holds exactly the tiles the current view
    /// asked for, so "none pending" is the moment the map is as complete as it is going to get -- the fixed
    /// delay this replaces used to photograph the black squares of tiles still in flight.
    /// </summary>
    private static async Task SettleTiles(GpxPanel panel, int capMilliseconds)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(capMilliseconds);
        while (DateTime.UtcNow < deadline)
        {
            var pending = await panel.RunScriptAsync(
                "[...document.querySelectorAll('.leaflet-tile-pane img')].filter(i => !i.complete).length");
            if ((pending ?? string.Empty).Trim().Trim('"') == "0") return;
            await Task.Delay(300);
        }
    }
}
