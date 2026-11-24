using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// Pure WPF dark-themed GPX/KML picker that avoids Windows Shell/ExplorerBrowser controls
/// so browsing folders and selecting files never triggers QuickLook's background preview switching.
/// </summary>
internal static class TrackPickerDialog
{
    private static readonly SolidColorBrush BgBrush = Freeze(Color.FromRgb(0x1C, 0x20, 0x26));
    private static readonly SolidColorBrush SurfaceBrush = Freeze(Color.FromRgb(0x23, 0x28, 0x30));
    private static readonly SolidColorBrush ControlBgBrush = Freeze(Color.FromRgb(0x2A, 0x30, 0x3A));
    private static readonly SolidColorBrush BorderBrush = Freeze(Color.FromRgb(0x36, 0x40, 0x4E));
    private static readonly SolidColorBrush TextBrush = Freeze(Color.FromRgb(0xEE, 0xF2, 0xF7));
    private static readonly SolidColorBrush MutedBrush = Freeze(Color.FromRgb(0x8F, 0x9B, 0xB0));
    private static readonly SolidColorBrush AccentBrush = Freeze(Color.FromRgb(0x38, 0xBD, 0xF8));
    private static readonly SolidColorBrush PrimaryBgBrush = Freeze(Color.FromRgb(0x1D, 0x6F, 0xB8));
    private static readonly SolidColorBrush FolderTintBrush = Freeze(Color.FromRgb(0xF5, 0xB8, 0x41));
    private static readonly SolidColorBrush SelectedRowBrush = Freeze(Color.FromRgb(0x1E, 0x3A, 0x5F));

    private sealed class QuickLocation
    {
        internal string Label { get; }
        internal string Path { get; }

        internal QuickLocation(string label, string path)
        {
            Label = label;
            Path = path;
        }

        public override string ToString() => Label;
    }

    private sealed class PickerEntry
    {
        internal bool IsDirectory { get; }
        internal string Name { get; }
        internal string FullPath { get; }
        internal string Meta { get; }

        internal PickerEntry(bool isDirectory, string name, string fullPath, string meta)
        {
            IsDirectory = isDirectory;
            Name = name;
            FullPath = fullPath;
            Meta = meta;
        }
    }

    internal static string? Show(
        Window? owner,
        string? initialDirectory,
        string? excludeFilePath,
        bool english)
    {
        var startDir = ResolveInitialDirectory(initialDirectory);
        var excludeFull = !string.IsNullOrEmpty(excludeFilePath)
            ? SafeFullPath(excludeFilePath!)
            : string.Empty;

        string? selectedFilePath = null;
        var currentDir = startDir;
        var allEntries = new List<PickerEntry>();
        var syncingRoots = false;

        var dialog = new Window
        {
            Owner = owner,
            Title = english ? "TrailViewer · Select track to append" : "选择要拼接的轨迹文件",
            Width = 640,
            Height = 440,
            MinWidth = 520,
            MinHeight = 340,
            Background = BgBrush,
            Foreground = TextBrush,
            WindowStartupLocation = owner == null
                ? WindowStartupLocation.CenterScreen
                : WindowStartupLocation.CenterOwner,
            ShowInTaskbar = false,
            ResizeMode = ResizeMode.CanResize,
        };

        var rootGrid = new Grid { Margin = new Thickness(14) };
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        // Row 0: Navigation bar (Up button + Quick location picker + Path display + Filter input)
        var navGrid = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        navGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        navGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(116) });
        navGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        navGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(148) });

        var upBtn = CreateButton(english ? "↑ Up" : "↑ 上级", primary: false);
        upBtn.Margin = new Thickness(0, 0, 8, 0);
        Grid.SetColumn(upBtn, 0);

        var rootCombo = new ComboBox
        {
            MinHeight = 30,
            Padding = new Thickness(8, 4, 8, 4),
            Margin = new Thickness(0, 0, 8, 0),
            VerticalAlignment = VerticalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
            Background = ControlBgBrush,
            Foreground = TextBrush,
            BorderBrush = BorderBrush,
        };
        foreach (var loc in BuildQuickLocations(startDir, english))
            rootCombo.Items.Add(loc);
        Grid.SetColumn(rootCombo, 1);

        var pathBox = new TextBox
        {
            MinHeight = 30,
            IsReadOnly = true,
            VerticalAlignment = VerticalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
            Padding = new Thickness(8, 4, 8, 4),
            Margin = new Thickness(0, 0, 8, 0),
            Background = SurfaceBrush,
            Foreground = MutedBrush,
            BorderBrush = BorderBrush,
            BorderThickness = new Thickness(1),
        };
        Grid.SetColumn(pathBox, 2);

        var filterGrid = new Grid { VerticalAlignment = VerticalAlignment.Center };
        var filterBox = new TextBox
        {
            MinHeight = 30,
            VerticalContentAlignment = VerticalAlignment.Center,
            Padding = new Thickness(8, 4, 8, 4),
            Background = ControlBgBrush,
            Foreground = TextBrush,
            CaretBrush = AccentBrush,
            BorderBrush = BorderBrush,
            BorderThickness = new Thickness(1),
        };
        var filterPlaceholder = new TextBlock
        {
            Text = english ? "Filter name…" : "筛选文件名…",
            Foreground = MutedBrush,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(10, 0, 8, 0),
            IsHitTestVisible = false,
        };
        filterGrid.Children.Add(filterBox);
        filterGrid.Children.Add(filterPlaceholder);
        Grid.SetColumn(filterGrid, 3);

        navGrid.Children.Add(upBtn);
        navGrid.Children.Add(rootCombo);
        navGrid.Children.Add(pathBox);
        navGrid.Children.Add(filterGrid);
        Grid.SetRow(navGrid, 0);
        rootGrid.Children.Add(navGrid);

        // Row 1: File & folder list
        var listBorder = new Border
        {
            Background = SurfaceBrush,
            BorderBrush = BorderBrush,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(4),
        };
        var listBox = new ListBox
        {
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Foreground = TextBrush,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            SelectionMode = SelectionMode.Single,
        };
        ScrollViewer.SetHorizontalScrollBarVisibility(listBox, ScrollBarVisibility.Disabled);

        var emptyLabel = new TextBlock
        {
            Text = english ? "No GPX or KML files in this folder" : "当前目录无 GPX / KML 文件",
            Foreground = MutedBrush,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };
        var listHost = new Grid();
        listHost.Children.Add(listBox);
        listHost.Children.Add(emptyLabel);
        listBorder.Child = listHost;
        Grid.SetRow(listBorder, 1);
        rootGrid.Children.Add(listBorder);

        // Row 2: Footer (Status + Cancel + Confirm)
        var footerGrid = new Grid { Margin = new Thickness(0, 10, 0, 0) };
        footerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var statusLabel = new TextBlock
        {
            Foreground = MutedBrush,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Margin = new Thickness(0, 0, 12, 0),
        };
        Grid.SetColumn(statusLabel, 0);

        var buttonPanel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        var cancelBtn = CreateButton(english ? "Cancel" : "取消", primary: false);
        var confirmBtn = CreateButton(english ? "Append selected" : "选择拼接", primary: true);
        confirmBtn.Margin = new Thickness(8, 0, 0, 0);
        confirmBtn.IsEnabled = false;
        buttonPanel.Children.Add(cancelBtn);
        buttonPanel.Children.Add(confirmBtn);
        Grid.SetColumn(buttonPanel, 1);

        footerGrid.Children.Add(statusLabel);
        footerGrid.Children.Add(buttonPanel);
        Grid.SetRow(footerGrid, 2);
        rootGrid.Children.Add(footerGrid);

        dialog.Content = rootGrid;
        rootGrid.Opacity = 0;
        dialog.Loaded += (_, _) =>
        {
            var fade = new DoubleAnimation(0, 1, new Duration(TimeSpan.FromMilliseconds(150)))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
            };
            rootGrid.BeginAnimation(UIElement.OpacityProperty, fade);
        };

        void UpdateSelectionState()
        {
            var entry = (listBox.SelectedItem as ListBoxItem)?.Tag as PickerEntry;
            if (entry != null && !entry.IsDirectory)
            {
                confirmBtn.IsEnabled = true;
                statusLabel.Text = (english ? "Selected: " : "已选：") + entry.Name;
                statusLabel.Foreground = TextBrush;
            }
            else
            {
                confirmBtn.IsEnabled = false;
                var fileCount = allEntries.Count(e => !e.IsDirectory);
                statusLabel.Text = english
                    ? $"{fileCount} track file(s) in folder"
                    : $"当前目录共 {fileCount} 个可拼接轨迹文件";
                statusLabel.Foreground = MutedBrush;
            }
        }

        void RenderFilteredList()
        {
            var query = (filterBox.Text ?? string.Empty).Trim();
            filterPlaceholder.Visibility = query.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
            listBox.Items.Clear();

            var filtered = string.IsNullOrEmpty(query)
                ? allEntries
                : allEntries.Where(e => e.Name.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0).ToList();

            foreach (var entry in filtered)
            {
                listBox.Items.Add(BuildListItem(entry));
            }
            emptyLabel.Visibility = filtered.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            UpdateSelectionState();
        }

        void LoadDirectory(string dir)
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir))
                return;

            currentDir = dir;
            pathBox.Text = currentDir;
            pathBox.ToolTip = currentDir;
            upBtn.IsEnabled = Directory.GetParent(currentDir) != null;

            syncingRoots = true;
            try
            {
                var matched = false;
                for (var i = 0; i < rootCombo.Items.Count; i++)
                {
                    if (rootCombo.Items[i] is QuickLocation loc
                        && string.Equals(
                            loc.Path.TrimEnd('\\'),
                            currentDir.TrimEnd('\\'),
                            StringComparison.OrdinalIgnoreCase))
                    {
                        rootCombo.SelectedIndex = i;
                        matched = true;
                        break;
                    }
                }
                if (!matched)
                {
                    var driveRoot = Path.GetPathRoot(currentDir) ?? string.Empty;
                    for (var i = 0; i < rootCombo.Items.Count; i++)
                    {
                        if (rootCombo.Items[i] is QuickLocation loc
                            && string.Equals(loc.Path, driveRoot, StringComparison.OrdinalIgnoreCase))
                        {
                            rootCombo.SelectedIndex = i;
                            break;
                        }
                    }
                }
            }
            finally
            {
                syncingRoots = false;
            }

            allEntries = ReadDirectoryEntries(currentDir, excludeFull, english);
            RenderFilteredList();
        }

        void CommitSelection()
        {
            var entry = (listBox.SelectedItem as ListBoxItem)?.Tag as PickerEntry;
            if (entry == null)
                return;
            if (entry.IsDirectory)
            {
                filterBox.Text = string.Empty;
                LoadDirectory(entry.FullPath);
                return;
            }
            selectedFilePath = entry.FullPath;
            dialog.DialogResult = true;
        }

        upBtn.Click += (_, _) =>
        {
            var parent = Directory.GetParent(currentDir);
            if (parent != null)
            {
                filterBox.Text = string.Empty;
                LoadDirectory(parent.FullName);
            }
        };

        rootCombo.SelectionChanged += (_, _) =>
        {
            if (syncingRoots) return;
            if (rootCombo.SelectedItem is QuickLocation loc && Directory.Exists(loc.Path))
            {
                filterBox.Text = string.Empty;
                LoadDirectory(loc.Path);
            }
        };

        filterBox.TextChanged += (_, _) => RenderFilteredList();
        listBox.SelectionChanged += (_, _) =>
        {
            foreach (ListBoxItem item in listBox.Items)
            {
                item.Background = item.IsSelected ? SelectedRowBrush : Brushes.Transparent;
            }
            UpdateSelectionState();
        };
        listBox.MouseDoubleClick += (_, e) =>
        {
            if (e.ChangedButton == MouseButton.Left)
                CommitSelection();
        };

        cancelBtn.Click += (_, _) => dialog.DialogResult = false;
        confirmBtn.Click += (_, _) => CommitSelection();

        LoadDirectory(startDir);
        return dialog.ShowDialog() == true ? selectedFilePath : null;
    }

    private static ListBoxItem BuildListItem(PickerEntry entry)
    {
        var row = new Grid { Margin = new Thickness(6, 5, 6, 5) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(22) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var glyph = new TextBlock
        {
            Text = entry.IsDirectory ? "📁" : "▸",
            Foreground = entry.IsDirectory ? FolderTintBrush : AccentBrush,
            VerticalAlignment = VerticalAlignment.Center,
            FontSize = 12,
        };
        Grid.SetColumn(glyph, 0);

        var nameText = new TextBlock
        {
            Text = entry.Name,
            Foreground = TextBrush,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            FontSize = 13,
        };
        Grid.SetColumn(nameText, 1);

        var metaText = new TextBlock
        {
            Text = entry.Meta,
            Foreground = MutedBrush,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(12, 0, 0, 0),
            FontSize = 11.5,
        };
        Grid.SetColumn(metaText, 2);

        row.Children.Add(glyph);
        row.Children.Add(nameText);
        row.Children.Add(metaText);

        return new ListBoxItem
        {
            Tag = entry,
            Content = row,
            Padding = new Thickness(0),
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            ToolTip = entry.Name,
        };
    }

    private static List<PickerEntry> ReadDirectoryEntries(
        string directory,
        string excludeFullPath,
        bool english)
    {
        var folders = new List<PickerEntry>();
        var files = new List<PickerEntry>();
        try
        {
            foreach (var dir in Directory.EnumerateDirectories(directory))
            {
                try
                {
                    var info = new DirectoryInfo(dir);
                    if ((info.Attributes & (FileAttributes.Hidden | FileAttributes.System)) != 0)
                        continue;
                    folders.Add(new PickerEntry(
                        true,
                        info.Name,
                        info.FullName,
                        english ? "Folder" : "文件夹"));
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // Skip inaccessible folders.
                }
            }

            foreach (var file in Directory.EnumerateFiles(directory))
            {
                var ext = Path.GetExtension(file);
                if (!string.Equals(ext, ".gpx", StringComparison.OrdinalIgnoreCase)
                    && !string.Equals(ext, ".kml", StringComparison.OrdinalIgnoreCase))
                    continue;
                var full = SafeFullPath(file);
                if (!string.IsNullOrEmpty(excludeFullPath)
                    && string.Equals(full, excludeFullPath, StringComparison.OrdinalIgnoreCase))
                    continue;
                try
                {
                    var info = new FileInfo(file);
                    if (!info.Exists || (info.Attributes & FileAttributes.Hidden) != 0)
                        continue;
                    var tag = ext.TrimStart('.').ToUpperInvariant();
                    files.Add(new PickerEntry(
                        false,
                        info.Name,
                        info.FullName,
                        $"{tag} · {FormatBytes(info.Length)}"));
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // Skip unreadable files.
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Return whatever was readable.
        }

        folders.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));
        files.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));
        folders.AddRange(files);
        return folders;
    }

    private static List<QuickLocation> BuildQuickLocations(string currentDir, bool english)
    {
        var list = new List<QuickLocation>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void TryAdd(string label, string? path)
        {
            if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
                return;
            var normalized = path!.TrimEnd('\\');
            if (normalized.Length == 2 && normalized[1] == ':')
                normalized += "\\";
            if (seen.Add(normalized))
                list.Add(new QuickLocation(label, normalized));
        }

        TryAdd(english ? "Current folder" : "当前目录", currentDir);
        TryAdd(english ? "Desktop" : "桌面", Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
        TryAdd(
            english ? "Downloads" : "下载",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"));
        TryAdd(english ? "Documents" : "文档", Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));

        try
        {
            foreach (var drive in DriveInfo.GetDrives())
            {
                if (!drive.IsReady) continue;
                TryAdd(drive.Name, drive.RootDirectory.FullName);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Ignore drive enumeration failures.
        }

        return list;
    }

    private static string ResolveInitialDirectory(string? candidate)
    {
        if (!string.IsNullOrWhiteSpace(candidate) && Directory.Exists(candidate))
            return Path.GetFullPath(candidate!);
        var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        return Directory.Exists(docs) ? docs : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    }

    private static string SafeFullPath(string path)
    {
        try
        {
            return Path.GetFullPath(path);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return path;
        }
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes >= 1024L * 1024L)
            return (bytes / (1024.0 * 1024.0)).ToString("0.00", CultureInfo.InvariantCulture) + " MB";
        if (bytes >= 1024L)
            return Math.Max(1, (int)Math.Round(bytes / 1024.0)).ToString(CultureInfo.InvariantCulture) + " KB";
        return bytes.ToString(CultureInfo.InvariantCulture) + " B";
    }

    private static Button CreateButton(string text, bool primary) => new()
    {
        Content = text,
        MinHeight = 30,
        Padding = new Thickness(12, 4, 12, 4),
        VerticalAlignment = VerticalAlignment.Center,
        Background = primary ? PrimaryBgBrush : ControlBgBrush,
        Foreground = TextBrush,
        BorderBrush = primary ? AccentBrush : BorderBrush,
        BorderThickness = new Thickness(1),
        Cursor = Cursors.Hand,
    };

    private static SolidColorBrush Freeze(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }
}
