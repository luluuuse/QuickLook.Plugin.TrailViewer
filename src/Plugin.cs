using QuickLook.Common.Commands;
using QuickLook.Common.Controls;
using QuickLook.Common.Plugin;
using QuickLook.Common.Plugin.MoreMenu;
using System.Collections.Generic;
using System.IO;
using System.Windows;

namespace QuickLook.Plugin.TrailViewer;

public class Plugin : IViewer, IMoreMenu
{
    private TrailViewerPanel? _panel;

    // Above the text viewer and generic binary viewers.
    public int Priority => 10;

    public IEnumerable<IMenuItem> MenuItems
    {
        get
        {
            var zh = ViewerPreferences.IsChinese();
            return new IMenuItem[]
            {
                new MoreMenuItem
                {
                    Icon = FontSymbols.Copy,
                    Header = zh ? "复制轨迹摘要" : "Copy track summary",
                    Command = new RelayCommand(() => _panel?.InvokeHostAction("copySummary")),
                },
                new MoreMenuItem
                {
                    Icon = FontSymbols.Picture,
                    Header = zh ? "导出透明叠加图" : "Export overlay PNG",
                    Command = new RelayCommand(() => _panel?.InvokeHostAction("openExport")),
                },
                new MoreMenuItem
                {
                    Icon = FontSymbols.Save,
                    Header = zh ? "导出轨迹附件" : "Export attachments",
                    Command = new RelayCommand(() => _panel?.InvokeHostAction("openAttachments")),
                },
            };
        }
    }

    public void Init()
    {
        TrailViewerPanel.PrepareEnvironment();
    }

    public bool CanHandle(string path) => !Directory.Exists(path) && DocumentDetector.CanPreview(path);

    public void Prepare(string path, ContextObject context)
    {
        context.Title = Path.GetFileName(path);
        context.Theme = ViewerPreferences.ResolveHostTheme();
        context.SetPreferredSizeFit(new Size(1280, 820), 0.85);
    }

    public void View(string path, ContextObject context)
    {
        // QuickLook calls Cleanup() before the next View() in practice; disposing first keeps a stray
        // WebView2 - and the folder a KMZ was unpacked into - from outliving the preview it belonged to.
        _panel?.Dispose();
        _panel = new TrailViewerPanel();
        _panel.Finished += _ => context.IsBusy = false;
        _panel.HostThemeChanged += theme => context.Theme = theme;
        _panel.HostTitleChanged += title => context.Title = title;
        context.ViewerContent = _panel;
        _panel.Load(path);
    }

    public void Cleanup()
    {
        _panel?.Dispose();
        _panel = null;
    }
}
