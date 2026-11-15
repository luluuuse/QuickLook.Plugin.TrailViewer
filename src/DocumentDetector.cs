using System;
using System.IO;
using System.Xml;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// Decides whether a file is a track document this plugin can draw: a .gpx or .kml file whose root element
/// is &lt;gpx&gt; or &lt;kml&gt;, a structurally complete .fit activity/course, or a .kmz archive that holds a
/// KML document.
/// Only the start of the file is read, so huge tracks are accepted without parsing them here;
/// the web viewer parses the whole file and reports errors further in.
/// </summary>
internal static class DocumentDetector
{
    private const int HeadBytes = 64 * 1024;

    private static readonly string[] Extensions = { ".gpx", ".kml", ".fit" };

    // Matched against the local name, so the kml: prefix and the missing namespace of older files both work.
    private static readonly string[] Roots = { "gpx", "kml" };

    public static bool CanPreview(string path)
    {
        // A zip has no XML head, so it is opened instead of sniffed; no map inside means another viewer gets it.
        if (KmzArchive.IsKmz(path))
            return KmzArchive.HasDocument(path);

        if (!HasTrackExtension(path))
            return false;

        try
        {
            var head = ReadHead(path);
            if (head.Length == 0)
                return false;
            if (path.EndsWith(".fit", StringComparison.OrdinalIgnoreCase))
                return IsFit(head, new FileInfo(path).Length);

            var settings = new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Ignore,
                XmlResolver = null,
                IgnoreComments = true,
                IgnoreProcessingInstructions = true,
                IgnoreWhitespace = true,
            };
            using var reader = XmlReader.Create(new MemoryStream(head), settings);
            return reader.MoveToContent() == XmlNodeType.Element
                && Array.IndexOf(Roots, reader.LocalName) >= 0;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or XmlException)
        {
            return false;
        }
    }

    /// <summary>
    /// Checks only the FIT framing. The viewer validates both CRCs and whether the data contains GPS records;
    /// accepting a structurally complete but damaged file here lets it show a useful, localised error page.
    /// </summary>
    private static bool IsFit(byte[] head, long fileLength)
    {
        if (head.Length < 14 || fileLength < 14)
            return false;

        var headerSize = head[0];
        if (headerSize != 12 && headerSize != 14)
            return false;
        if (head[8] != (byte)'.' || head[9] != (byte)'F'
            || head[10] != (byte)'I' || head[11] != (byte)'T')
            return false;

        var dataSize = (long)(head[4] | (head[5] << 8) | (head[6] << 16) | (head[7] << 24));
        // The uint32 data size is read as a positive long even when bit 31 is set.
        if (dataSize < 0)
            dataSize += 1L << 32;
        return headerSize + dataSize + 2 == fileLength;
    }

    private static bool HasTrackExtension(string path)
    {
        foreach (var extension in Extensions)
        {
            if (path.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private static byte[] ReadHead(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var buffer = new byte[(int)Math.Min(HeadBytes, stream.Length)];
        var read = 0;
        while (read < buffer.Length)
        {
            var n = stream.Read(buffer, read, buffer.Length - read);
            if (n == 0)
                break;
            read += n;
        }
        if (read < buffer.Length)
            Array.Resize(ref buffer, read);
        return buffer;
    }
}
