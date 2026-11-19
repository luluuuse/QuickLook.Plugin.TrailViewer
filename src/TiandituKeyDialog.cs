using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace QuickLook.Plugin.TrailViewer;

internal static class TiandituKeyDialog
{
    internal static bool Show(Window owner, bool english)
    {
        var dialog = new Window
        {
            Owner = owner,
            Title = english ? "TrailViewer · Tianditu key" : "TrailViewer · 天地图密钥",
            Width = 430,
            SizeToContent = SizeToContent.Height,
            ResizeMode = ResizeMode.NoResize,
            WindowStartupLocation = owner == null
                ? WindowStartupLocation.CenterScreen
                : WindowStartupLocation.CenterOwner,
            ShowInTaskbar = false,
        };

        var panel = new StackPanel { Margin = new Thickness(18) };
        panel.Children.Add(new TextBlock
        {
            Text = english
                ? "Enter your Tianditu developer key (32 hexadecimal characters)."
                : "输入天地图开发者密钥（32 位十六进制）。",
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 8),
        });
        panel.Children.Add(new TextBlock
        {
            Text = english
                ? "The key is encrypted for the current Windows user. TrailViewer decrypts it only for this "
                    + "preview and the WebView requests Tianditu directly. It is not written to page URLs, "
                    + "browser storage, logs or release packages."
                : "密钥会使用当前 Windows 用户凭据加密。TrailViewer 只在本次预览中解密，由 WebView 直接请求"
                    + "天地图；它不会写入页面地址、浏览器存储、日志或安装包。",
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });

        var status = new TextBlock
        {
            Text = TiandituKeyStore.HasKey()
                ? (english ? "A key is already configured. Enter a new value to replace it." : "当前已配置密钥。输入新值可替换。")
                : "",
            Foreground = Brushes.DimGray,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 8),
        };
        var input = new PasswordBox { MaxLength = 64, Padding = new Thickness(6) };
        input.PasswordChanged += (_, _) =>
        {
            status.Text = TiandituKeyStore.IsValid(input.Password)
                ? (english ? "The key format is valid." : "密钥格式有效，保存后即可使用天地图。")
                : (english
                    ? "Invalid key format: enter 32 hexadecimal characters."
                    : "密钥格式无效：需要 32 位十六进制字符。");
            status.Foreground = TiandituKeyStore.IsValid(input.Password) ? Brushes.DarkGreen : Brushes.DarkRed;
        };
        panel.Children.Add(input);
        panel.Children.Add(status);

        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 14, 0, 0),
        };
        var cancel = new Button { Content = english ? "Cancel" : "取消", Padding = new Thickness(14, 5, 14, 5) };
        cancel.Click += (_, _) => dialog.DialogResult = false;
        var save = new Button
        {
            Content = english ? "Save" : "保存",
            Padding = new Thickness(14, 5, 14, 5),
            Margin = new Thickness(8, 0, 0, 0),
            IsDefault = true,
        };
        save.Click += (_, _) =>
        {
            if (!TiandituKeyStore.IsValid(input.Password))
            {
                status.Text = english
                    ? "Enter a valid 32-character hexadecimal key."
                    : "请输入有效的 32 位十六进制密钥。";
                status.Foreground = Brushes.DarkRed;
                return;
            }
            if (!TiandituKeyStore.Save(input.Password))
            {
                status.Text = english
                    ? "Could not save the key. Check the current user's data-directory permissions."
                    : "无法保存密钥，请检查当前用户的数据目录权限。";
                status.Foreground = Brushes.DarkRed;
                return;
            }
            input.Clear();
            dialog.DialogResult = true;
        };
        buttons.Children.Add(cancel);
        buttons.Children.Add(save);
        panel.Children.Add(buttons);

        dialog.Content = panel;
        dialog.Loaded += (_, _) => input.Focus();
        return dialog.ShowDialog() == true;
    }

    internal static bool Remove(Window owner, bool english)
    {
        var answer = MessageBox.Show(owner,
            english
                ? "Remove the Tianditu key saved for the current Windows user?"
                : "移除当前 Windows 用户保存的天地图密钥？",
            "TrailViewer",
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);
        if (answer != MessageBoxResult.Yes) return false;
        return TiandituKeyStore.Delete();
    }
}
