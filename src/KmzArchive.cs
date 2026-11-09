using System;
using System.IO;
using System.IO.Compression;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// A KMZ file is a zip holding one KML document - normally doc.kml - plus optional icons and photos.
/// The viewer draws only the document, so only that single entry is unpacked, into a temporary folder
/// that lives exactly as long as the preview. Reading one entry by stream also means no entry name ever
/// reaches the file system, which rules out path traversal from a crafted archive.
/// </summary>
internal static class KmzArchive
{
    private const string PreferredEntryName = "doc.kml";

    // The browser parses the whole KML into a DOM. Keep the document well below the point where that work
    // exhausts WebView2 or the 20-second preview budget.
    private const long MaxDocumentBytes = 64L * 1024 * 1024;
    private const long MaxCompressedDocumentBytes = 64L * 1024 * 1024;

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
    /// Unpacks the KML document of <paramref name="kmzPath"/> into <paramref name="folder"/> and returns its path.
    /// The unpacked file keeps the name of the archive, so the preview names it the way Explorer does.
    /// </summary>
    /// <exception cref="InvalidDataException">The archive holds no readable KML document.</exception>
    public static string ExtractDocument(string kmzPath, string folder)
    {
        using var archive = ZipFile.OpenRead(kmzPath);
        var entry = FindDocument(archive)
            ?? throw new InvalidDataException("the archive holds no .kml file");

        if (entry.Length > MaxDocumentBytes || entry.CompressedLength > MaxCompressedDocumentBytes)
            throw new InvalidDataException($"the .kml inside is {entry.Length / (1024 * 1024)} MB, too large to draw");

        var target = Path.Combine(folder, DocumentFileName(kmzPath));
        try
        {
            using (var source = entry.Open())
            using (var destination = File.Create(target))
                CopyBounded(source, destination);
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
    private static void CopyBounded(Stream source, Stream destination)
    {
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
        {
            total += read;
            if (total > MaxDocumentBytes)
                throw new InvalidDataException("the .kml expands past the 64 MB preview limit");
            destination.Write(buffer, 0, read);
        }
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
