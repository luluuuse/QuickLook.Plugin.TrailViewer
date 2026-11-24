using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Xml;

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
    private const long MaxTotalResourceBytes = 1024L * 1024 * 1024;
    private const int MaxResourceCount = 1000;

    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif",
    };

    private static readonly Regex AttributeResourcePattern = new(
        @"(?:\bsrc|\bhref)\s*=\s*(?:""(?<url>[^""]*)""|'(?<url>[^']*)')",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex DataImagePattern = new(
        @"^data:image/[a-z0-9.+-]+;base64,(?<b64>[a-z0-9+/=\s]+)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly XmlReaderSettings ResourceReaderSettings = new()
    {
        DtdProcessing = DtdProcessing.Prohibit,
        XmlResolver = null,
        IgnoreComments = true,
        IgnoreProcessingInstructions = true,
        CloseInput = true,
    };

    private static readonly XmlReaderSettings ResourceStreamReaderSettings = new()
    {
        DtdProcessing = DtdProcessing.Prohibit,
        XmlResolver = null,
        IgnoreComments = true,
        IgnoreProcessingInstructions = true,
        CloseInput = false,
    };

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
    public static string ExtractDocument(
        string kmzPath, string folder, CancellationToken cancel = default)
    {
        cancel.ThrowIfCancellationRequested();
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
                CopyBounded(source, destination, MaxDocumentBytes,
                    "the .kml expands past the 64 MB preview limit", cancel);

            ExtractReferencedImages(archive, entry.FullName, target, folder, cancel);
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
    private static long CopyBounded(
        Stream source, Stream destination, long limit, string tooLargeMessage, CancellationToken cancel)
    {
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
        {
            cancel.ThrowIfCancellationRequested();
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
        string folder,
        CancellationToken cancel)
    {
        var documentDirectory = DocumentDirectory(documentEntryName);
        var references = ReadResourceReferences(extractedDocument, cancel);
        var extracted = new List<string>();

        try
        {
            var count = 0;
            long totalBytes = 0;
            var seenResources = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var reference in references)
            {
                cancel.ThrowIfCancellationRequested();
                if (!TryResolveArchivePath(reference, documentDirectory, out var resourcePath)
                    || !ImageExtensions.Contains(Path.GetExtension(resourcePath))
                    || !seenResources.Add(resourcePath!))
                    continue;

                var entry = FindEntry(archive, resourcePath!);
                if (entry == null || entry.FullName.EndsWith("/", StringComparison.Ordinal))
                    continue; // A broken image should not hide the route around it.

                if (++count > MaxResourceCount)
                    throw new InvalidDataException($"the .kmz references more than {MaxResourceCount} local images");
                if (entry.Length > MaxResourceBytes || entry.CompressedLength > MaxResourceBytes)
                    throw new InvalidDataException($"the image {resourcePath} is too large to preview");
                if (entry.Length > MaxTotalResourceBytes - totalBytes)
                    throw new InvalidDataException("the images in this .kmz exceed the 300 MB preview limit");

                var target = SafeTarget(folder, resourcePath!);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                var remainingTotal = MaxTotalResourceBytes - totalBytes;
                long written;
                try
                {
                    using var source = entry.Open();
                    using var destination = File.Create(target);
                    written = CopyBounded(source, destination, Math.Min(MaxResourceBytes, remainingTotal),
                        $"the images in this .kmz exceed the {MaxTotalResourceBytes / (1024 * 1024)} MB limit",
                        cancel);
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

    /// <summary>Scan only the XML events needed for image references; never materialise the whole document.</summary>
    private static HashSet<string> ReadResourceReferences(string path, CancellationToken cancel)
    {
        using var stream = File.OpenRead(path);
        return ReadResourceReferences(stream, ResourceReaderSettings, cancel);
    }

    private static HashSet<string> ReadResourceReferences(
        Stream stream, XmlReaderSettings settings, CancellationToken cancel)
    {
        var references = new HashSet<string>(StringComparer.Ordinal);
        try
        {
            using var reader = XmlReader.Create(stream, settings);
            var advance = true;
            while (!advance || reader.Read())
            {
                advance = true;
                cancel.ThrowIfCancellationRequested();
                if (reader.NodeType == XmlNodeType.Element)
                {
                    if (reader.MoveToFirstAttribute())
                    {
                        do
                        {
                            if (reader.LocalName.Equals("src", StringComparison.OrdinalIgnoreCase)
                                || reader.LocalName.Equals("href", StringComparison.OrdinalIgnoreCase))
                            {
                                references.Add(WebUtility.HtmlDecode(reader.Value));
                            }
                        }
                        while (reader.MoveToNextAttribute());
                        reader.MoveToElement();
                    }

                    if (reader.LocalName.Equals("href", StringComparison.OrdinalIgnoreCase)
                        && !reader.IsEmptyElement)
                    {
                        var value = reader.ReadElementContentAsString();
                        if (!string.IsNullOrWhiteSpace(value))
                            references.Add(WebUtility.HtmlDecode(value));
                        AddAttributeReferences(references, value);
                        advance = false;
                    }
                }
                else if (reader.NodeType == XmlNodeType.Text || reader.NodeType == XmlNodeType.CDATA)
                {
                    AddAttributeReferences(references, WebUtility.HtmlDecode(reader.Value));
                }
            }
        }
        catch (XmlException ex)
        {
            throw new InvalidDataException("the .kml inside is not valid XML", ex);
        }
        return references;
    }

    internal sealed class KmzRemoteImage
    {
        internal KmzRemoteImage(byte[] bytes, string extension)
        {
            Bytes = bytes;
            Extension = extension;
        }

        internal byte[] Bytes { get; }
        internal string Extension { get; }
    }

    private sealed class KmzRemoteDownloadResult
    {
        internal KmzRemoteDownloadResult(string rawRef, KmzRemoteImage? image)
        {
            RawRef = rawRef;
            Image = image;
        }

        internal string RawRef { get; }
        internal KmzRemoteImage? Image { get; }
    }

    /// <summary>
    /// Packages KML bytes and any referenced local or embedded data-URI images into a .kmz archive.
    /// External HTTPS links are preserved untouched unless <paramref name="packRemoteImages"/> is enabled.
    /// </summary>
    internal static byte[] BuildKmzBytes(byte[] kmlBytes, string? documentDirectory, string? fileRoot) =>
        BuildKmzBytesAsync(kmlBytes, documentDirectory, fileRoot, packRemoteImages: false)
            .GetAwaiter()
            .GetResult();

    internal static async Task<byte[]> BuildKmzBytesAsync(
        byte[] kmlBytes,
        string? documentDirectory,
        string? fileRoot,
        bool packRemoteImages = false,
        Func<string, CancellationToken, Task<KmzRemoteImage?>>? remoteFetcher = null,
        Action<int, int, int>? onProgress = null,
        CancellationToken cancel = default)
    {
        if (kmlBytes == null || kmlBytes.Length == 0)
            throw new InvalidDataException("the KML payload was empty");
        if (kmlBytes.Length > MaxDocumentBytes)
            throw new InvalidDataException($"the .kml exceeds the {MaxDocumentBytes / (1024 * 1024)} MB limit");

        HashSet<string> references;
        using (var kmlStream = new MemoryStream(kmlBytes, writable: false))
        {
            references = ReadResourceReferences(kmlStream, ResourceStreamReaderSettings, cancel);
        }

        var kmlText = Encoding.UTF8.GetString(kmlBytes);
        var resources = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        var remoteCandidates = new List<string>();
        var seenRemote = new HashSet<string>(StringComparer.Ordinal);
        long totalBytes = 0;
        var count = 0;
        var embeddedIndex = 0;

        string? fullRoot = null;
        string? docBaseDir = null;
        if (!string.IsNullOrWhiteSpace(fileRoot))
        {
            fullRoot = Path.GetFullPath(fileRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            var trimmedRoot = fullRoot.TrimEnd(Path.DirectorySeparatorChar);
            docBaseDir = trimmedRoot;
            if (!string.IsNullOrWhiteSpace(documentDirectory))
            {
                var candidateDocDir = Path.GetFullPath(documentDirectory).TrimEnd(
                    Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                if (string.Equals(candidateDocDir, trimmedRoot, StringComparison.OrdinalIgnoreCase)
                    || (candidateDocDir + Path.DirectorySeparatorChar).StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
                {
                    docBaseDir = candidateDocDir;
                }
            }
        }

        foreach (var reference in references)
        {
            cancel.ThrowIfCancellationRequested();
            var rawRef = (reference ?? string.Empty).Trim();
            if (rawRef.Length == 0)
                continue;

            var dataMatch = DataImagePattern.Match(rawRef);
            if (dataMatch.Success)
            {
                byte[] imgBytes;
                try
                {
                    imgBytes = Convert.FromBase64String(dataMatch.Groups["b64"].Value);
                }
                catch (FormatException)
                {
                    continue;
                }

                if (imgBytes.Length == 0
                    || imgBytes.Length > MaxResourceBytes
                    || totalBytes + imgBytes.Length > MaxTotalResourceBytes
                    || count >= MaxResourceCount)
                    continue;

                var ext = AttachmentExport.ImageExtensionFor(imgBytes);
                if (ext == null)
                    continue;

                string entryName;
                do
                {
                    embeddedIndex++;
                    entryName = $"files/embedded-{embeddedIndex}{ext}";
                }
                while (resources.ContainsKey(entryName));

                resources[entryName] = imgBytes;
                count++;
                totalBytes += imgBytes.Length;
                kmlText = ReplaceKmlReference(kmlText, rawRef, entryName);
                continue;
            }

            if (rawRef.StartsWith("//", StringComparison.Ordinal) || HasSchemePrefix(rawRef))
            {
                if (packRemoteImages && AttachmentExport.IsAllowedUri(rawRef) && seenRemote.Add(rawRef))
                    remoteCandidates.Add(rawRef);
                continue;
            }

            if (fullRoot == null || docBaseDir == null)
                continue;

            if (!TryResolveLocalDiskImage(rawRef, fullRoot, docBaseDir, out var cleanPath, out var diskPath))
                continue;

            FileInfo info;
            try
            {
                info = new FileInfo(diskPath!);
                if (!info.Exists
                    || info.Length <= 0
                    || info.Length > MaxResourceBytes
                    || totalBytes + info.Length > MaxTotalResourceBytes
                    || count >= MaxResourceCount)
                    continue;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                continue;
            }

            string archiveEntry;
            var remapped = false;
            if (!cleanPath!.StartsWith("/", StringComparison.Ordinal)
                && !cleanPath.StartsWith("\\", StringComparison.Ordinal)
                && TryResolveArchivePath(cleanPath, string.Empty, out var directEntry)
                && !string.Equals(directEntry, PreferredEntryName, StringComparison.OrdinalIgnoreCase))
            {
                archiveEntry = directEntry!;
            }
            else
            {
                var safeName = OverlayTransfer.SanitiseFileName(Path.GetFileName(diskPath!));
                var stem = Path.GetFileNameWithoutExtension(safeName);
                var ext = Path.GetExtension(safeName);
                archiveEntry = $"files/{safeName}";
                for (var suffix = 2; resources.ContainsKey(archiveEntry); suffix++)
                    archiveEntry = $"files/{stem}-{suffix}{ext}";
                remapped = true;
            }

            if (!resources.ContainsKey(archiveEntry))
            {
                byte[] imgBytes;
                try
                {
                    imgBytes = File.ReadAllBytes(diskPath!);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    continue;
                }

                if (imgBytes.Length == 0
                    || imgBytes.Length > MaxResourceBytes
                    || totalBytes + imgBytes.Length > MaxTotalResourceBytes
                    || count >= MaxResourceCount)
                    continue;

                resources[archiveEntry] = imgBytes;
                count++;
                totalBytes += imgBytes.Length;
            }

            if (remapped)
                kmlText = ReplaceKmlReference(kmlText, rawRef, archiveEntry);
        }

        if (packRemoteImages && remoteCandidates.Count > 0 && count < MaxResourceCount)
        {
            var hostChecks = new ConcurrentDictionary<string, Task<bool>>(StringComparer.OrdinalIgnoreCase);
            var fetcher = remoteFetcher ?? (async (url, token) =>
            {
                using var downloaded = await AttachmentExport
                    .DownloadImageWithHostCacheAsync(url, hostChecks, token)
                    .ConfigureAwait(false);
                return new KmzRemoteImage(downloaded.Bytes.ToArray(), downloaded.Extension);
            });

            var remainingSlots = MaxResourceCount - count;
            var targets = remoteCandidates.Count > remainingSlots
                ? remoteCandidates.GetRange(0, remainingSlots)
                : remoteCandidates;

            onProgress?.Invoke(0, targets.Count, 0);
            var completedCount = 0;
            var failedCount = 0;

            using var slots = new SemaphoreSlim(6);
            var tasks = new List<Task<KmzRemoteDownloadResult>>(targets.Count);
            foreach (var rawRef in targets)
            {
                tasks.Add(DownloadRemoteForKmzAsync(rawRef, slots, fetcher, ok =>
                {
                    var failNow = ok ? Volatile.Read(ref failedCount) : Interlocked.Increment(ref failedCount);
                    var doneNow = Interlocked.Increment(ref completedCount);
                    onProgress?.Invoke(doneNow, targets.Count, failNow);
                }, cancel));
            }
            var downloadedResults = await Task.WhenAll(tasks).ConfigureAwait(false);

            var remoteIndex = 0;
            foreach (var result in downloadedResults)
            {
                var image = result.Image;
                if (image == null
                    || image.Bytes == null
                    || image.Bytes.Length == 0
                    || image.Bytes.Length > MaxResourceBytes
                    || totalBytes + image.Bytes.Length > MaxTotalResourceBytes
                    || count >= MaxResourceCount)
                    continue;

                var ext = !string.IsNullOrWhiteSpace(image.Extension) && ImageExtensions.Contains(image.Extension)
                    ? image.Extension
                    : AttachmentExport.ImageExtensionFor(image.Bytes);
                if (ext == null)
                    continue;

                string entryName;
                do
                {
                    remoteIndex++;
                    entryName = $"files/remote-{remoteIndex}{ext}";
                }
                while (resources.ContainsKey(entryName));

                resources[entryName] = image.Bytes;
                count++;
                totalBytes += image.Bytes.Length;
                kmlText = ReplaceKmlReference(kmlText, result.RawRef, entryName);
            }
        }

        var finalKmlBytes = new UTF8Encoding(false).GetBytes(kmlText);
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            var docEntry = archive.CreateEntry(PreferredEntryName, CompressionLevel.Optimal);
            using (var docStream = docEntry.Open())
                docStream.Write(finalKmlBytes, 0, finalKmlBytes.Length);

            foreach (var item in resources)
            {
                var resEntry = archive.CreateEntry(item.Key, CompressionLevel.NoCompression);
                using var resStream = resEntry.Open();
                resStream.Write(item.Value, 0, item.Value.Length);
            }
        }
        return output.ToArray();
    }

    private static async Task<KmzRemoteDownloadResult> DownloadRemoteForKmzAsync(
        string rawRef,
        SemaphoreSlim slots,
        Func<string, CancellationToken, Task<KmzRemoteImage?>> fetcher,
        Action<bool>? onItemDone,
        CancellationToken cancel)
    {
        await slots.WaitAsync(cancel).ConfigureAwait(false);
        var ok = false;
        try
        {
            var image = await fetcher(rawRef, cancel).ConfigureAwait(false);
            ok = image != null && image.Bytes != null && image.Bytes.Length > 0;
            return new KmzRemoteDownloadResult(rawRef, image);
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidDataException
            or IOException or UriFormatException or NotSupportedException)
        {
            // Keep the original HTTPS link in doc.kml if a single remote image fails or times out.
            return new KmzRemoteDownloadResult(rawRef, null);
        }
        finally
        {
            slots.Release();
            if (!cancel.IsCancellationRequested)
                onItemDone?.Invoke(ok);
        }
    }

    private static bool HasSchemePrefix(string reference)
    {
        var firstDelim = reference.IndexOfAny(new[] { '/', '?', '#' });
        var colon = reference.IndexOf(':');
        return colon >= 0 && (firstDelim < 0 || colon < firstDelim);
    }

    private static string ReplaceKmlReference(string kmlText, string rawRef, string replacement)
    {
        var updated = kmlText.Replace(rawRef, replacement);
        var ampEncoded = rawRef.Replace("&", "&amp;");
        if (!string.Equals(ampEncoded, rawRef, StringComparison.Ordinal))
            updated = updated.Replace(ampEncoded, replacement);
        var htmlEncoded = WebUtility.HtmlEncode(rawRef);
        if (!string.IsNullOrEmpty(htmlEncoded) && !string.Equals(htmlEncoded, rawRef, StringComparison.Ordinal))
            updated = updated.Replace(htmlEncoded, replacement);
        return updated;
    }

    private static bool TryResolveLocalDiskImage(
        string rawRef,
        string fullRoot,
        string docBaseDir,
        out string? cleanPath,
        out string? diskPath)
    {
        cleanPath = null;
        diskPath = null;

        var decoded = WebUtility.HtmlDecode(rawRef).Trim();
        var query = decoded.IndexOfAny(new[] { '?', '#' });
        if (query >= 0) decoded = decoded.Substring(0, query);
        if (decoded.Length == 0 || decoded.IndexOf('\0') >= 0)
            return false;

        string unescaped;
        try
        {
            unescaped = Uri.UnescapeDataString(decoded).Replace('\\', '/');
        }
        catch (UriFormatException)
        {
            return false;
        }

        if (unescaped.IndexOf(':') >= 0
            || unescaped.IndexOfAny(new[] { '"', '<', '>', '|', '*', '?' }) >= 0)
            return false;

        if (!ImageExtensions.Contains(Path.GetExtension(unescaped)))
            return false;

        var rooted = unescaped.StartsWith("/", StringComparison.Ordinal);
        var baseDir = rooted ? fullRoot.TrimEnd(Path.DirectorySeparatorChar) : docBaseDir;
        var relative = unescaped.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        if (string.IsNullOrEmpty(relative))
            return false;

        string candidate;
        try
        {
            candidate = Path.GetFullPath(Path.Combine(baseDir, relative));
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return false;
        }

        if (!candidate.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
            return false;

        cleanPath = decoded;
        diskPath = candidate;
        return true;
    }

    private static void AddAttributeReferences(HashSet<string> references, string text)
    {
        foreach (Match match in AttributeResourcePattern.Matches(text ?? string.Empty))
            references.Add(match.Groups["url"].Value);
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    private static ZipArchiveEntry? FindEntry(ZipArchive archive, string path)
    {
        var exact = archive.GetEntry(path);
        if (exact != null) return exact;

        ZipArchiveEntry? match = null;
        foreach (var entry in archive.Entries)
        {
            var normalised = entry.FullName.Replace('\\', '/');
            if (!string.Equals(normalised, path, StringComparison.OrdinalIgnoreCase))
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
        var slash = safeEntry!.LastIndexOf('/');
        return slash <= 0 ? string.Empty : safeEntry.Substring(0, slash);
    }

    private static bool TryResolveArchivePath(
        string reference, string documentDirectory, out string? path)
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

    private static bool TryNormaliseArchivePath(
        string entryName, string baseDirectory, out string? path)
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
    private static ZipArchiveEntry? FindDocument(ZipArchive archive)
    {
        ZipArchiveEntry? first = null;
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
