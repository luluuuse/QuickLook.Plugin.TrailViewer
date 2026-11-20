using QuickLook.Common.Helpers;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace QuickLook.Plugin.TrailViewer;

internal sealed class TileCacheOptions
{
    private readonly long? _maxBytesOverride;

    internal bool Enabled { get; }
    internal int MaxMegabytes { get; }
    internal int MaxAgeDays { get; }
    internal bool IsUnlimited => !_maxBytesOverride.HasValue && MaxMegabytes <= 0;
    internal long MaxBytes => _maxBytesOverride ?? (MaxMegabytes > 0 ? MaxMegabytes * 1024L * 1024L : 0L);

    internal TileCacheOptions(bool enabled, int maxMegabytes, int maxAgeDays, long? maxBytesOverride = null)
    {
        Enabled = enabled;
        MaxMegabytes = maxMegabytes;
        MaxAgeDays = maxAgeDays;
        _maxBytesOverride = maxBytesOverride;
    }
}

/// <summary>
/// Preferences that must outlive the versioned WebView2 origin. localStorage is partitioned by origin, so an
/// upgrade changed the origin and silently reset "No map" to the online Map layer. This small file is owned by
/// the host plugin instead, and the viewer receives the values in its URL.
/// </summary>
internal static class ViewerPreferences
{
    private const int MaxQueryLength = 4096;
    private const int MaxCustomLayerIdLength = 40;
    private const string CustomLayerPrefix = "custom.";
    private static readonly object Gate = new();

    private static bool IsCustomLayerId(string value)
    {
        if (!value.StartsWith(CustomLayerPrefix, StringComparison.Ordinal)
            || value.Length <= CustomLayerPrefix.Length
            || value.Length > MaxCustomLayerIdLength)
            return false;

        for (var i = CustomLayerPrefix.Length; i < value.Length; i++)
        {
            var ch = value[i];
            var valid = (ch >= 'a' && ch <= 'z')
                || (ch >= 'A' && ch <= 'Z')
                || (ch >= '0' && ch <= '9')
                || ch == '.'
                || ch == '_'
                || ch == '-';
            if (!valid)
                return false;
        }
        return true;
    }

    private static bool IsAllowed(string key, string value)
    {
        if (Allowed.TryGetValue(key, out var allowed) && Array.IndexOf(allowed, value) >= 0)
            return true;
        return string.Equals(key, "layer", StringComparison.Ordinal) && IsCustomLayerId(value);
    }

    private static readonly Dictionary<string, string[]> Allowed = new(StringComparer.Ordinal)
    {
        ["lang"] = new[] { "en", "zh" },
        ["layer"] = new[]
        {
            // Legacy category values remain readable so an upgrade keeps the user's selected background.
            "map", "terrain", "satellite", "none",
            "road.osm", "road.tianditu",
            "terrain.cyclosm", "terrain.openHiking", "terrain.openTopo",
            "satellite.esri", "satellite.tianditu",
        },
        ["pins"] = new[] { "0", "1" },
        ["exportSize"] = new[] { "1:1", "9:16", "4:3" },
        ["exportInk"] = new[] { "black", "white" },
        ["exportScrim"] = new[] { "none", "soft" },
        ["tileCache"] = new[] { "0", "1" },
        ["tileCacheMaxMb"] = new[] { "0", "256", "512", "2048" },
        ["tileCacheDays"] = new[] { "0", "7", "30", "90" },
    };

    private static readonly string FilePath = Path.Combine(
        SettingHelper.LocalDataPath, PluginIdentity.Name, "viewer-settings.txt");
    private static readonly string LegacyFilePath = Path.Combine(
        SettingHelper.LocalDataPath, PluginIdentity.LegacyName, "viewer-settings.txt");

    /// <summary>A stable query string for BuildViewerUrl; empty on first use or when the file is unreadable.</summary>
    public static string Query()
    {
        MigrateLegacyFile(LegacyFilePath, FilePath);
        return QueryFromFile(FilePath);
    }

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
    {
        MigrateLegacyFile(LegacyFilePath, FilePath);
        SaveFromQueryToFile(query, FilePath);
    }

    internal static TileCacheOptions ReadTileCacheOptions(string? path = null)
    {
        if (path == null)
            MigrateLegacyFile(LegacyFilePath, FilePath);

        lock (Gate)
        {
            var values = Load(path ?? FilePath);
            var enabled = !values.TryGetValue("tileCache", out var en) || en != "0";
            var maxMb = values.TryGetValue("tileCacheMaxMb", out var mb)
                && int.TryParse(mb, out var parsedMb) ? parsedMb : 512;
            var days = values.TryGetValue("tileCacheDays", out var d)
                && int.TryParse(d, out var parsedDays) ? parsedDays : 30;
            return new TileCacheOptions(enabled, maxMb, days);
        }
    }

    internal static bool MigrateLegacyFile(string legacy, string current)
    {
        lock (Gate)
        {
            if (!File.Exists(legacy) || File.Exists(current)) return false;
            string? temporary = null;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(current) ?? string.Empty);
                temporary = current + "." + Guid.NewGuid().ToString("n") + ".tmp";
                File.Copy(legacy, temporary);
                File.Move(temporary, current);
                temporary = null;
                File.Delete(legacy);
                var legacyDirectory = Path.GetDirectoryName(legacy);
                if (legacyDirectory is { Length: > 0 } && Directory.Exists(legacyDirectory)
                    && !Directory.EnumerateFileSystemEntries(legacyDirectory).Any())
                    Directory.Delete(legacyDirectory);
                return true;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                return false;
            }
            finally
            {
                if (temporary != null)
                {
                    try { File.Delete(temporary); }
                    catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { }
                }
            }
        }
    }

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
                    if (IsAllowed(key, value))
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
                if (IsAllowed(key, value))
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

            AtomicFile.WriteText(path, string.Join(Environment.NewLine, lines) + Environment.NewLine);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Preference persistence must never break the preview.
        }
    }
}
