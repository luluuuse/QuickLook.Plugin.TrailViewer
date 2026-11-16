using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text.RegularExpressions;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// A KMZ file is a zip holding one KML document - normally doc.kml - plus optional icons and photos.
/// The document and image resources it references are unpacked into a temporary folder that lives exactly
/// as long as the preview. Every entry name is normalised and checked against the extraction root before
/// it reaches the file system, which rules out path traversal from a crafted archive.
/// </summary>
internal static class KmzArchive
{
    private const string PreferredEntryName = "doc.kml";

    // The browser parses the whole KML into a DOM. Keep the document well below the point where that work
    // exhausts WebView2 or the 20-second preview budget.
    private const long MaxDocumentBytes = 64L * 1024 * 1024;
    private const long MaxCompressedDocumentBytes = 64L * 1024 * 1024;

    // A KMZ can legally carry a large photo album. Only images referenced by the KML are copied, and these
    // bounds stop a crafted archive from turning one preview into unbounded disk or decompression work.
    private const long MaxResourceBytes = 30L * 1024 * 1024;
    private const long MaxTotalResourceBytes = 300L * 1024 * 1024;
    private const int MaxResourceCount = 200;

    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif",
    };

    private static readonly Regex AttributeResourcePattern = new(
        @"(?:\bsrc|\bhref)\s*=\s*(?:""(?<url>[^""]*)""|'(?<url>[^']*)')",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex ElementResourcePattern = new(
        @"<href\b[^>]*>\s*(?<url>.*?)\s*</href\s*>",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Singleline);

    private static readonly string RootFolderName = PluginIdentity.Name;

    public static bool IsKmz(string path) =>
        path.EndsWith(".kmz", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Looks for the KML document inside the archive without unpacking it. Used to reject files that are
    /// named .kmz but hold no map, so QuickLook falls back to another viewer instead of showing an error.
    /// </summary>
    public static bool HasDocument(string path)
    {
        try
        {
            using var archive = ZipFile.OpenRead(path);
            return FindDocument(archive) != null;
        }
        catch (Exception ex) when (IsArchiveError(ex))
        {
            return false;
        }
    }

    /// <summary>
    /// Unpacks the KML document of <paramref name="kmzPath"/> into <paramref name="folder"/> and returns its
    /// path. The KML keeps its original parent directory and the name of the archive, so relative image URLs
    /// still resolve the same way they do inside the KMZ. Locally referenced images are copied beside it.
    /// </summary>
    /// <exception cref="InvalidDataException">The archive holds no readable KML document.</exception>
    public static string ExtractDocument(string kmzPath, string folder)
    {
        using var archive = ZipFile.OpenRead(kmzPath);
        var entry = FindDocument(archive)
            ?? throw new InvalidDataException("the archive holds no .kml file");

        if (entry.Length > MaxDocumentBytes || entry.CompressedLength > MaxCompressedDocumentBytes)
            throw new InvalidDataException($"the .kml inside is {entry.Length / (1024 * 1024)} MB, too large to draw");

        var documentDirectory = DocumentDirectory(entry.FullName);
        var targetRelative = string.IsNullOrEmpty(documentDirectory)
            ? DocumentFileName(kmzPath)
            : documentDirectory + "/" + DocumentFileName(kmzPath);
        var target = SafeTarget(folder, targetRelative);
        Directory.CreateDirectory(Path.GetDirectoryName(target));
        try
        {
            using (var source = entry.Open())
            using (var destination = File.Create(target))
                CopyBounded(source, destination, MaxDocumentBytes, "the .kml expands past the 64 MB preview limit");

            ExtractReferencedImages(archive, entry.FullName, target, folder);
        }
        catch
        {
            try { File.Delete(target); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            throw;
        }

        return target;
    }

    /// <summary>
    /// Zip metadata can lie. Count the bytes that actually leave the decompressor so a crafted archive cannot
    /// turn a small header into an unbounded temporary file before the browser ever sees it.
    /// </summary>
    private static long CopyBounded(Stream source, Stream destination, long limit, string tooLargeMessage)
    {
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
        {
            total += read;
            if (total > limit)
                throw new InvalidDataException(tooLargeMessage);
            destination.Write(buffer, 0, read);
        }
        return total;
    }

    private static void ExtractReferencedImages(
        ZipArchive archive,
        string documentEntryName,
        string extractedDocument,
        string folder)
    {
        var documentDirectory = DocumentDirectory(documentEntryName);
        var text = WebUtility.HtmlDecode(File.ReadAllText(extractedDocument));
        var references = new HashSet<string>(StringComparer.Ordinal);
        var extracted = new List<string>();

        foreach (Match match in AttributeResourcePattern.Matches(text))
            references.Add(match.Groups["url"].Value);
        foreach (Match match in ElementResourcePattern.Matches(text))
            references.Add(match.Groups["url"].Value);

        try
        {
            var count = 0;
            long totalBytes = 0;
            foreach (var reference in references)
            {
                if (!TryResolveArchivePath(reference, documentDirectory, out var resourcePath)
                    || !ImageExtensions.Contains(Path.GetExtension(resourcePath)))
                    continue;

                var entry = FindEntry(archive, resourcePath);
                if (entry == null || entry.FullName.EndsWith("/", StringComparison.Ordinal))
                    continue; // A broken image should not hide the route around it.

                if (++count > MaxResourceCount)
                    throw new InvalidDataException($"the .kmz references more than {MaxResourceCount} local images");
                if (entry.Length > MaxResourceBytes || entry.CompressedLength > MaxResourceBytes)
                    throw new InvalidDataException($"the image {resourcePath} is too large to preview");
                if (entry.Length > MaxTotalResourceBytes - totalBytes)
                    throw new InvalidDataException("the images in this .kmz exceed the 300 MB preview limit");

                var target = SafeTarget(folder, resourcePath);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                var remainingTotal = MaxTotalResourceBytes - totalBytes;
                long written;
                try
                {
                    using var source = entry.Open();
                    using var destination = File.Create(target);
                    written = CopyBounded(source, destination, Math.Min(MaxResourceBytes, remainingTotal),
                        $"the images in this .kmz exceed the {MaxTotalResourceBytes / (1024 * 1024)} MB limit");
                }
                catch
                {
                    TryDelete(target);
                    throw;
                }

                totalBytes += written;
                extracted.Add(target);
            }
        }
        catch
        {
            for (var i = extracted.Count - 1; i >= 0; i--)
                TryDelete(extracted[i]);
            throw;
        }
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    private static ZipArchiveEntry FindEntry(ZipArchive archive, string path)
    {
        var exact = archive.GetEntry(path);
        if (exact != null) return exact;

        ZipArchiveEntry match = null;
        foreach (var entry in archive.Entries)
        {
            if (!string.Equals(entry.FullName, path, StringComparison.OrdinalIgnoreCase))
                continue;
            if (match != null)
                return null; // Ambiguous case-only duplicates are safer to leave unresolved.
            match = entry;
        }
        return match;
    }

    private static string DocumentDirectory(string entryName)
    {
        if (!TryNormaliseArchivePath(entryName, "", out var safeEntry))
            return string.Empty;
        var slash = safeEntry.LastIndexOf('/');
        return slash <= 0 ? string.Empty : safeEntry.Substring(0, slash);
    }

    private static bool TryResolveArchivePath(string reference, string documentDirectory, out string path)
    {
        reference = WebUtility.HtmlDecode(reference ?? string.Empty).Trim();
        var query = reference.IndexOfAny(new[] { '?', '#' });
        if (query >= 0) reference = reference.Substring(0, query);
        if (reference.Length == 0) { path = null; return false; }
        if (reference.StartsWith("//", StringComparison.Ordinal)) { path = null; return false; }

        var rooted = reference[0] == '/' || reference[0] == '\\';
        var baseDirectory = rooted ? string.Empty : documentDirectory;
        return TryNormaliseArchivePath(reference.TrimStart('/', '\\'), baseDirectory, out path);
    }

    private static bool TryNormaliseArchivePath(string entryName, string baseDirectory, out string path)
    {
        path = null;
        if (string.IsNullOrWhiteSpace(entryName) || entryName.IndexOf('\0') >= 0)
            return false;

        try
        {
            entryName = Uri.UnescapeDataString(entryName).Replace('\\', '/');
        }
        catch (UriFormatException)
        {
            return false;
        }

        if (entryName.IndexOf(':') >= 0
            || entryName.IndexOfAny(new[] { '"', '<', '>', '|', '*', '?' }) >= 0)
            return false;

        var parts = new List<string>();
        if (!string.IsNullOrEmpty(baseDirectory))
            parts.AddRange(baseDirectory.Replace('\\', '/').Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries));

        foreach (var part in entryName.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries))
        {
            if (part == ".") continue;
            if (part == "..")
            {
                if (parts.Count == 0) return false;
                parts.RemoveAt(parts.Count - 1);
                continue;
            }
            if (part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                return false;
            parts.Add(part);
        }

        if (parts.Count == 0) return false;
        path = string.Join("/", parts);
        return true;
    }

    private static string SafeTarget(string folder, string relativePath)
    {
        var root = Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        var target = Path.GetFullPath(Path.Combine(folder, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("the archive contains an unsafe resource path");
        return target;
    }

    /// <summary>Creates a fresh folder to unpack into, cleaning up folders left behind by earlier runs.</summary>
    public static string CreateFolder()
    {
        RemoveLegacyRoot();
        var root = Path.Combine(Path.GetTempPath(), RootFolderName);
        Directory.CreateDirectory(root);
        RemoveStaleFolders(root);

        var folder = Path.Combine(root, Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(folder);
        return folder;
    }

    private static void RemoveLegacyRoot()
    {
        try
        {
            var legacy = Path.Combine(Path.GetTempPath(), PluginIdentity.LegacyName);
            if (Directory.Exists(legacy)) Directory.Delete(legacy, true);
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
        {
            // A previous process may still hold a temporary extraction; it is harmless.
        }
    }

    /// <summary>Deletes an unpacked folder; a file still held open by the browser is left for the next run.</summary>
    public static void DeleteFolder(string folder)
    {
        if (string.IsNullOrEmpty(folder))
            return;

        try
        {
            Directory.Delete(folder, true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            TrailViewerPanel.Trace("could not remove the unpacked folder yet: " + ex.Message);
        }
    }

    /// <summary>doc.kml first wherever it sits, otherwise the first .kml entry in the archive.</summary>
    private static ZipArchiveEntry FindDocument(ZipArchive archive)
    {
        ZipArchiveEntry first = null;
        foreach (var entry in archive.Entries)
        {
            // Folders end with a slash and carry no content.
            if (entry.FullName.EndsWith("/", StringComparison.Ordinal)
                || !entry.FullName.EndsWith(".kml", StringComparison.OrdinalIgnoreCase))
                continue;

            if (string.Equals(Path.GetFileName(entry.FullName), PreferredEntryName, StringComparison.OrdinalIgnoreCase))
                return entry;

            first ??= entry;
        }

        return first;
    }

    private static string DocumentFileName(string kmzPath)
    {
        var name = Path.GetFileNameWithoutExtension(kmzPath);
        // A file called just ".kmz" would otherwise unpack to ".kml" - a hidden file with no name.
        return string.IsNullOrEmpty(name) ? PreferredEntryName : name + ".kml";
    }

    private static void RemoveStaleFolders(string root)
    {
        try
        {
            var cutoff = DateTime.UtcNow.AddDays(-1);
            foreach (var folder in Directory.GetDirectories(root))
            {
                if (Directory.GetCreationTimeUtc(folder) > cutoff)
                    continue;

                try
                {
                    Directory.Delete(folder, true);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // Still in use by a preview that is open right now; it gets another chance next run.
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
        }
    }

    private static bool IsArchiveError(Exception ex) =>
        ex is InvalidDataException or IOException or UnauthorizedAccessException or NotSupportedException;
}
