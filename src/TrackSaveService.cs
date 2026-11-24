using System;
using System.Collections.Generic;
using System.IO;

namespace QuickLook.Plugin.TrailViewer;

internal sealed class TrackSavePayload
{
    internal TrackSavePayload(
        string id,
        string fileName,
        bool overwrite,
        byte[] bytes,
        string format = "gpx",
        bool packRemoteImages = false)
    {
        Id = id;
        FileName = fileName;
        Overwrite = overwrite;
        Bytes = bytes;
        Format = format;
        PackRemoteImages = packRemoteImages;
    }

    internal string Id { get; }
    internal string FileName { get; }
    internal bool Overwrite { get; }
    internal byte[] Bytes { get; }
    internal string Format { get; }
    internal bool PackRemoteImages { get; }
}

/// <summary>
/// Chunked receiver and atomic file writer (with optional .bak backup) for edited tracks.
/// </summary>
internal sealed class TrackSaveService : IDisposable
{
    private const int DefaultMaxBytes = 64 * 1024 * 1024;
    private static readonly HashSet<string> SupportedFormats = new(StringComparer.OrdinalIgnoreCase)
    {
        "gpx", "kml", "kmz", "geojson", "tcx", "csv",
    };

    private readonly int _maxBytes;
    private MemoryStream? _buffer;
    private string? _id;
    private string? _fileName;
    private bool _overwrite;
    private string _format = "gpx";
    private bool _packRemoteImages;
    private int _expectedChunks;
    private int _nextChunk;
    private int _bytes;

    internal TrackSaveService(int maxBytes = DefaultMaxBytes)
    {
        _maxBytes = maxBytes > 0 ? maxBytes : DefaultMaxBytes;
    }

    internal string CurrentId => _id ?? string.Empty;

    internal static bool IsSupportedFormat(string? format) =>
        !string.IsNullOrWhiteSpace(format) && SupportedFormats.Contains(format!.Trim());

    internal static string GetDefaultExtension(string? format)
    {
        switch ((format ?? "gpx").Trim().ToLowerInvariant())
        {
            case "kml":
                return ".kml";
            case "kmz":
                return ".kmz";
            case "geojson":
                return ".geojson";
            case "tcx":
                return ".tcx";
            case "csv":
                return ".csv";
            default:
                return ".gpx";
        }
    }

    internal static string GetFileDialogFilter(string? format)
    {
        switch ((format ?? "gpx").Trim().ToLowerInvariant())
        {
            case "kml":
                return "KML Track (*.kml)|*.kml|All Files (*.*)|*.*";
            case "kmz":
                return "KMZ Archive (*.kmz)|*.kmz|All Files (*.*)|*.*";
            case "geojson":
                return "GeoJSON (*.geojson)|*.geojson|JSON (*.json)|*.json|All Files (*.*)|*.*";
            case "tcx":
                return "Garmin TCX (*.tcx)|*.tcx|All Files (*.*)|*.*";
            case "csv":
                return "CSV Table (*.csv)|*.csv|All Files (*.*)|*.*";
            default:
                return "GPX Track (*.gpx)|*.gpx|All Files (*.*)|*.*";
        }
    }

    internal void Begin(string body)
    {
        Reset();
        var parts = body.Split(new[] { '\t' }, 6);
        if (parts.Length < 4
            || string.IsNullOrEmpty(parts[0])
            || !int.TryParse(parts[1], out var count)
            || count <= 0)
        {
            throw new InvalidDataException("the track save header was invalid");
        }

        var format = "gpx";
        if (parts.Length >= 5 && !string.IsNullOrWhiteSpace(parts[4]))
        {
            if (!IsSupportedFormat(parts[4]))
                throw new InvalidDataException("the track save format was invalid");
            format = parts[4].Trim().ToLowerInvariant();
        }

        string name;
        try
        {
            var rawName = Uri.UnescapeDataString(parts[3]);
            var sanitised = OverlayTransfer.SanitiseFileName(rawName);
            name = string.IsNullOrWhiteSpace(rawName) || string.IsNullOrWhiteSpace(rawName.Trim('.'))
                ? "track" + GetDefaultExtension(format)
                : sanitised;
        }
        catch (UriFormatException)
        {
            throw new InvalidDataException("the track save file name was invalid");
        }

        _id = parts[0];
        _expectedChunks = count;
        _format = format;
        _overwrite = parts[2] == "1" && string.Equals(format, "gpx", StringComparison.OrdinalIgnoreCase);
        _packRemoteImages = parts.Length >= 6
            && parts[5] == "1"
            && string.Equals(format, "kmz", StringComparison.OrdinalIgnoreCase);
        _fileName = name;
        _nextChunk = 0;
        _bytes = 0;
        _buffer = new MemoryStream();
    }

    internal void Append(string body)
    {
        if (_buffer == null || string.IsNullOrEmpty(_id))
            return;

        var first = body.IndexOf('\t');
        var second = first < 0 ? -1 : body.IndexOf('\t', first + 1);
        if (first <= 0 || second <= first
            || !int.TryParse(body.Substring(first + 1, second - first - 1), out var index))
        {
            throw new InvalidDataException("a track chunk header was invalid");
        }

        var id = body.Substring(0, first);
        if (id != _id || index != _nextChunk)
            throw new InvalidDataException("the track chunks arrived out of order");

        var bytes = Convert.FromBase64String(body.Substring(second + 1));
        if (_bytes + bytes.Length > _maxBytes)
            throw new InvalidDataException($"the track is larger than {_maxBytes / (1024 * 1024)} MB");

        _buffer.Write(bytes, 0, bytes.Length);
        _bytes += bytes.Length;
        _nextChunk++;
    }

    internal TrackSavePayload? Complete(string id)
    {
        if (_buffer == null || string.IsNullOrEmpty(_id))
            return null;

        try
        {
            if (id != _id || _nextChunk != _expectedChunks || _buffer.Length == 0)
                throw new InvalidDataException("the track payload was incomplete");

            return new TrackSavePayload(
                _id,
                _fileName ?? ("track-edited" + GetDefaultExtension(_format)),
                _overwrite,
                _buffer.ToArray(),
                _format,
                _packRemoteImages);
        }
        finally
        {
            Reset();
        }
    }

    internal static void WriteWithBackup(string targetPath, byte[] bytes, bool createBackup)
    {
        if (createBackup && File.Exists(targetPath))
        {
            var backupPath = targetPath + ".bak";
            if (!File.Exists(backupPath))
                File.Copy(targetPath, backupPath, overwrite: false);
        }
        AtomicFile.WriteBytes(targetPath, bytes);
    }

    internal void Reset()
    {
        _buffer?.Dispose();
        _buffer = null;
        _id = null;
        _fileName = null;
        _overwrite = false;
        _format = "gpx";
        _packRemoteImages = false;
        _expectedChunks = 0;
        _nextChunk = 0;
        _bytes = 0;
    }

    public void Dispose() => Reset();
}
