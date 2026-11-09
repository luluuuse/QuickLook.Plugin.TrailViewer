using QuickLook.Common.Helpers;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// Preferences that must outlive the versioned WebView2 origin. localStorage is partitioned by origin, so an
/// upgrade changed the origin and silently reset "No map" to the online Map layer. This small file is owned by
/// the host plugin instead, and the viewer receives the values in its URL.
/// </summary>
internal static class ViewerPreferences
{
    private const int MaxQueryLength = 4096;
    private static readonly object Gate = new();

    private static readonly Dictionary<string, string[]> Allowed = new(StringComparer.Ordinal)
    {
        ["lang"] = new[] { "en", "zh" },
        ["layer"] = new[] { "map", "terrain", "satellite", "none" },
        ["pins"] = new[] { "0", "1" },
        ["exportSize"] = new[] { "1:1", "9:16", "4:3" },
        ["exportInk"] = new[] { "black", "white" },
        ["exportScrim"] = new[] { "none", "soft" },
    };

    private static readonly string FilePath = Path.Combine(
        SettingHelper.LocalDataPath, "GpxViewer", "viewer-settings.txt");

    /// <summary>A stable query string for BuildViewerUrl; empty on first use or when the file is unreadable.</summary>
    public static string Query()
        => QueryFromFile(FilePath);

    /// <summary>Test seam: the same reader and ordering against a caller-owned settings file.</summary>
    internal static string QueryFromFile(string path)
    {
        lock (Gate)
        {
            var values = Load(path);
            var keys = new List<string>(values.Keys);
            keys.Sort(StringComparer.Ordinal);
            var parts = new List<string>();
            foreach (var key in keys)
                parts.Add(Uri.EscapeDataString(key) + "=" + Uri.EscapeDataString(values[key]));
            return string.Join("&", parts);
        }
    }

    /// <summary>Merges one settings message. Invalid keys and values are ignored rather than trusted.</summary>
    public static void SaveFromQuery(string query)
        => SaveFromQueryToFile(query, FilePath);

    /// <summary>Test seam: exercises the production parser and atomic writer without touching user settings.</summary>
    internal static void SaveFromQueryToFile(string query, string path)
    {
        if (string.IsNullOrWhiteSpace(query) || query.Length > MaxQueryLength)
            return;

        lock (Gate)
        {
            var values = Load(path);
            foreach (var part in query.Split('&'))
            {
                var split = part.IndexOf('=');
                if (split <= 0)
                    continue;

                try
                {
                    var key = Uri.UnescapeDataString(part.Substring(0, split));
                    var value = Uri.UnescapeDataString(part.Substring(split + 1).Replace("+", " "));
                    if (Allowed.TryGetValue(key, out var allowed)
                        && Array.IndexOf(allowed, value) >= 0)
                    {
                        values[key] = value;
                    }
                }
                catch (UriFormatException)
                {
                    // A malformed setting is not worth failing a preview over.
                }
            }
            Save(path, values);
        }
    }

    private static Dictionary<string, string> Load(string path)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        try
        {
            if (!File.Exists(path))
                return values;

            foreach (var line in File.ReadAllLines(path, Encoding.UTF8))
            {
                var split = line.IndexOf('=');
                if (split <= 0)
                    continue;

                var key = line.Substring(0, split);
                var value = line.Substring(split + 1);
                if (Allowed.TryGetValue(key, out var allowed)
                    && Array.IndexOf(allowed, value) >= 0)
                {
                    values[key] = value;
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Defaults are safe: the page starts in Map and still works.
        }
        return values;
    }

    private static void Save(string path, Dictionary<string, string> values)
    {
        string temporary = null;
        try
        {
            var directory = Path.GetDirectoryName(path);
            if (string.IsNullOrEmpty(directory))
                return;
            Directory.CreateDirectory(directory);
            var keys = new List<string>(values.Keys);
            keys.Sort(StringComparer.Ordinal);
            var lines = new string[keys.Count];
            for (var i = 0; i < keys.Count; i++)
                lines[i] = keys[i] + "=" + values[keys[i]];

            temporary = path + "." + Guid.NewGuid().ToString("n") + ".tmp";
            File.WriteAllLines(temporary, lines, new UTF8Encoding(false));
            if (File.Exists(path))
            {
                var backup = path + ".old";
                File.Replace(temporary, path, backup, true);
                File.Delete(backup);
            }
            else
            {
                File.Move(temporary, path);
            }
            temporary = null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Preference persistence must never break the preview.
        }
        finally
        {
            if (temporary != null)
            {
                try { File.Delete(temporary); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
        }
    }
}
