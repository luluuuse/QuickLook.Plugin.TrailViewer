using QuickLook.Common.Helpers;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// Durable custom tile sources. WebView localStorage belongs to a content-hashed origin and therefore changes
/// between plugin builds; this file stays beside the other user preferences and survives a normal overwrite update.
/// </summary>
internal static class CustomSourceStore
{
    private const int MaxEntries = 20;
    private const int MaxJsonLength = 128 * 1024;
    private const int MaxUrlLength = 2048;
    private const int MaxNameLength = 60;
    private const int MaxAttributionLength = 200;
    private static readonly object Gate = new();
    private static readonly JavaScriptSerializer Serializer = new()
    {
        MaxJsonLength = MaxJsonLength,
        RecursionLimit = 100,
    };

    private static readonly string FilePath = Path.Combine(
        SettingHelper.LocalDataPath, PluginIdentity.Name, "custom-sources.json");

    public static string LoadJson()
    {
        return LoadJsonFromFile(FilePath);
    }

    public static bool SaveJson(string json)
    {
        return SaveJsonToFile(json, FilePath);
    }

    internal static string LoadJsonFromFile(string path)
    {
        lock (Gate)
        {
            try
            {
                if (!File.Exists(path) || new FileInfo(path).Length > MaxJsonLength)
                    return null;
                var json = File.ReadAllText(path, Encoding.UTF8);
                return json.Length <= MaxJsonLength ? Normalize(json) : null;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException
                or ArgumentException or InvalidOperationException)
            {
                return null;
            }
        }
    }

    internal static bool SaveJsonToFile(string json, string path)
    {
        if (string.IsNullOrWhiteSpace(json) || json.Length > MaxJsonLength)
            return false;

        string normalized;
        try
        {
            normalized = Normalize(json);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            return false;
        }
        if (normalized == null)
            return false;

        lock (Gate)
        {
            try
            {
                var directory = Path.GetDirectoryName(path);
                if (string.IsNullOrEmpty(directory))
                    return false;
                Directory.CreateDirectory(directory);
                AtomicFile.WriteText(path, normalized);
                return true;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return false;
            }
        }
    }

    private static string Normalize(string json)
    {
        if (!(Serializer.DeserializeObject(json) is object[] raw))
            return null;

        var entries = new List<Dictionary<string, object>>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in raw.Take(MaxEntries))
        {
            if (!(item is IDictionary<string, object> source))
                continue;

            var url = Text(source, "url", MaxUrlLength);
            if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
                || !url.Contains("{x}") || !url.Contains("{y}") || !url.Contains("{z}")
                || url.Any(char.IsWhiteSpace))
                continue;

            var id = Text(source, "id", 40);
            if (string.IsNullOrEmpty(id) || !ids.Add(id))
                continue;

            var name = Text(source, "name", MaxNameLength);
            if (string.IsNullOrEmpty(name))
                name = "Source " + (entries.Count + 1).ToString(CultureInfo.InvariantCulture);
            var minZoom = Number(source, "minZoom", 1, 0, 22);
            var maxZoom = Number(source, "maxZoom", 19, 0, 22);
            var tileSize = Number(source, "tileSize", 256, 256, 512);
            if (tileSize != 256 && tileSize != 512)
                tileSize = 256;
            var subdomains = new string(Text(source, "subdomains", 16)
                .Where(char.IsLetterOrDigit).ToArray());

            entries.Add(new Dictionary<string, object>(StringComparer.Ordinal)
            {
                ["id"] = id,
                ["name"] = name,
                ["url"] = url,
                ["tileSize"] = tileSize,
                ["minZoom"] = Math.Min(minZoom, maxZoom),
                ["maxZoom"] = Math.Max(minZoom, maxZoom),
                ["subdomains"] = subdomains,
                ["attribution"] = Text(source, "attribution", MaxAttributionLength),
                ["tms"] = source.TryGetValue("tms", out var tms) && tms is bool enabled && enabled,
            });
        }
        return Serializer.Serialize(entries);
    }

    private static string Text(IDictionary<string, object> source, string key, int maximum)
    {
        if (!source.TryGetValue(key, out var value) || value == null)
            return string.Empty;
        var text = Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        text = new string(text.Where(character => !char.IsControl(character)).ToArray()).Trim();
        return text.Length <= maximum ? text : text.Substring(0, maximum);
    }

    private static int Number(
        IDictionary<string, object> source, string key, int fallback, int minimum, int maximum)
    {
        if (!source.TryGetValue(key, out var value) || value == null)
            return fallback;
        try
        {
            return Math.Max(minimum, Math.Min(maximum, Convert.ToInt32(value, CultureInfo.InvariantCulture)));
        }
        catch (Exception ex) when (ex is FormatException or InvalidCastException or OverflowException)
        {
            return fallback;
        }
    }
}
