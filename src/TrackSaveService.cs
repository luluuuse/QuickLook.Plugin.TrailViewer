using System;
using System.IO;

namespace QuickLook.Plugin.TrailViewer;

internal sealed class TrackSavePayload
{
    internal TrackSavePayload(string id, string fileName, bool overwrite, byte[] bytes)
    {
        Id = id;
        FileName = fileName;
        Overwrite = overwrite;
        Bytes = bytes;
    }

    internal string Id { get; }
    internal string FileName { get; }
    internal bool Overwrite { get; }
    internal byte[] Bytes { get; }
}

/// <summary>
/// Chunked receiver and atomic file writer (with optional .bak backup) for edited GPX tracks.
/// </summary>
internal sealed class TrackSaveService : IDisposable
{
    private const int DefaultMaxBytes = 64 * 1024 * 1024;
    private readonly int _maxBytes;
    private MemoryStream? _buffer;
    private string? _id;
    private string? _fileName;
    private bool _overwrite;
    private int _expectedChunks;
    private int _nextChunk;
    private int _bytes;

    internal TrackSaveService(int maxBytes = DefaultMaxBytes)
    {
        _maxBytes = maxBytes > 0 ? maxBytes : DefaultMaxBytes;
    }

    internal string CurrentId => _id ?? string.Empty;

    internal void Begin(string body)
    {
        Reset();
        var parts = body.Split(new[] { '\t' }, 4);
        if (parts.Length < 4
            || string.IsNullOrEmpty(parts[0])
            || !int.TryParse(parts[1], out var count)
            || count <= 0)
        {
            throw new InvalidDataException("the track save header was invalid");
        }

        string name;
        try
        {
            name = OverlayTransfer.SanitiseFileName(Uri.UnescapeDataString(parts[3]));
        }
        catch (UriFormatException)
        {
            throw new InvalidDataException("the track save file name was invalid");
        }

        _id = parts[0];
        _expectedChunks = count;
        _overwrite = parts[2] == "1";
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

            return new TrackSavePayload(_id, _fileName ?? "track-edited.gpx", _overwrite, _buffer.ToArray());
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
        _expectedChunks = 0;
        _nextChunk = 0;
        _bytes = 0;
    }

    public void Dispose() => Reset();
}
