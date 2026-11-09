using System;
using System.IO;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// State machine for the chunked PNG protocol sent by the page. It owns ordering, completeness, the expansion
/// bound and the file name, so the WebView host only has to decide where to persist a completed picture.
/// </summary>
internal sealed class OverlayTransfer : IDisposable
{
    private const int DefaultMaxBytes = 64 * 1024 * 1024;

    private readonly int _maxBytes;
    private MemoryStream _picture;
    private string _id;
    private string _name;
    private int _expectedChunks;
    private int _nextChunk;
    private int _bytes;

    internal OverlayTransfer(int maxBytes = DefaultMaxBytes)
    {
        if (maxBytes <= 0)
            throw new ArgumentOutOfRangeException(nameof(maxBytes));
        _maxBytes = maxBytes;
    }

    internal bool HasData => _picture != null && _picture.Length > 0;

    internal void Begin(string body)
    {
        Reset();
        var first = body.IndexOf('\t');
        var second = first < 0 ? -1 : body.IndexOf('\t', first + 1);
        if (first <= 0 || second <= first + 1
            || !int.TryParse(body.Substring(first + 1, second - first - 1), out var count)
            || count <= 0)
        {
            throw new InvalidDataException("the export header was invalid");
        }

        string name;
        try
        {
            name = SanitiseFileName(Uri.UnescapeDataString(body.Substring(second + 1)));
        }
        catch (UriFormatException)
        {
            throw new InvalidDataException("the export file name was invalid");
        }

        _id = body.Substring(0, first);
        _name = name;
        _expectedChunks = count;
        _nextChunk = 0;
        _bytes = 0;
        _picture = new MemoryStream();
    }

    internal void Append(string body)
    {
        if (_picture == null || string.IsNullOrEmpty(_id))
            return;

        try
        {
            var first = body.IndexOf('\t');
            var second = first < 0 ? -1 : body.IndexOf('\t', first + 1);
            var third = second < 0 ? -1 : body.IndexOf('\t', second + 1);
            if (first <= 0 || second <= first || third <= second
                || !int.TryParse(body.Substring(first + 1, second - first - 1), out var index)
                || !int.TryParse(body.Substring(second + 1, third - second - 1), out var count))
            {
                throw new InvalidDataException("an export chunk header was invalid");
            }

            var id = body.Substring(0, first);
            if (id != _id || count != _expectedChunks || index != _nextChunk)
                throw new InvalidDataException("the export pieces arrived out of order");

            var bytes = Convert.FromBase64String(body.Substring(third + 1));
            if (_bytes + bytes.Length > _maxBytes)
                throw new InvalidDataException($"the overlay is larger than {_maxBytes / (1024 * 1024)} MB");
            _picture.Write(bytes, 0, bytes.Length);
            _bytes += bytes.Length;
            _nextChunk++;
        }
        catch (FormatException ex)
        {
            Reset();
            throw new InvalidDataException("an export chunk was not valid base64", ex);
        }
        catch
        {
            Reset();
            throw;
        }
    }

    /// <summary>Returns null when no non-empty export is active; invalid completed transfers fail closed.</summary>
    internal OverlayTransferResult Complete(string body)
    {
        if (!HasData)
            return null;

        var split = body.IndexOf('\t');
        if (split <= 0 || !int.TryParse(body.Substring(split + 1), out var count)
            || body.Substring(0, split) != _id
            || count != _expectedChunks
            || _nextChunk != _expectedChunks)
        {
            Reset();
            throw new InvalidDataException("the export did not contain every piece");
        }

        var result = new OverlayTransferResult(_name, _picture);
        _picture = null;
        _id = null;
        _name = null;
        _expectedChunks = 0;
        _nextChunk = 0;
        _bytes = 0;
        return result;
    }

    internal void Reset()
    {
        _picture?.Dispose();
        _picture = null;
        _id = null;
        _name = null;
        _expectedChunks = 0;
        _nextChunk = 0;
        _bytes = 0;
    }

    internal static string SanitiseFileName(string name)
    {
        var leaf = Path.GetFileName(name ?? "");
        foreach (var bad in Path.GetInvalidFileNameChars())
            leaf = leaf.Replace(bad, '_');
        leaf = leaf.Trim().TrimEnd('.', ' ');
        return string.IsNullOrWhiteSpace(leaf) || leaf == "." || leaf == ".." ? "overlay.png" : leaf;
    }

    public void Dispose() => Reset();
}

internal sealed class OverlayTransferResult : IDisposable
{
    internal OverlayTransferResult(string name, MemoryStream picture)
    {
        Name = name;
        Picture = picture;
    }

    internal string Name { get; }

    internal MemoryStream Picture { get; }

    public void Dispose() => Picture.Dispose();
}

internal static class AtomicFile
{
    /// <summary>Writes beside the target first, then publishes with a move or replace, leaving no partial PNG.</summary>
    internal static void Write(string target, Stream source)
    {
        var folder = Path.GetDirectoryName(target);
        if (string.IsNullOrEmpty(folder))
            throw new IOException("the export folder is missing");

        var temporary = Path.Combine(folder,
            "." + Path.GetFileName(target) + "." + Guid.NewGuid().ToString("n") + ".tmp");
        try
        {
            source.Position = 0;
            using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                source.CopyTo(output);

            if (File.Exists(target))
                File.Replace(temporary, target, null);
            else
                File.Move(temporary, target);
            temporary = null;
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
