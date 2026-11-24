using QuickLook.Plugin.TrailViewer;
using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal static class SelfTests
{
    private static int _failures;

    public static int Run()
    {
        _failures = 0;
        var root = FindRepositoryRoot();
        var temporary = Path.Combine(Path.GetTempPath(), "TrailViewer-host-tests-" + Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(temporary);
        try
        {
            TestKmzDetection(root);
            TestKmzExtraction(root, temporary);
            TestKmzResources(root, temporary);
            TestKmzResourceLimits(temporary);
            TestKmzTraversal(temporary);
            TestKmzLimit(root, temporary);
            TestSourceSafety(temporary);
            TestViewerShutdownFilter();
            TestClipboardRetry();
            TestPreferences(temporary);
            TestCustomSources(temporary);
            TestTileCache(temporary);
            TestProductIdentity(temporary);
            TestTianditu(temporary);
            TestViewerBuildId(temporary);
            TestOverlayTransfer();
            TestTrackSaveService(temporary);
            TestKmzBuild(root, temporary);
            TestAtomicFile(temporary);
            TestViewerMessages();
            TestAttachmentExport(temporary);
            TestUpdateChecker(temporary);
        }
        finally
        {
            try { Directory.Delete(temporary, true); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }

        Console.WriteLine(_failures == 0 ? "\nhost checks OK" : $"\n{_failures} host checks failed");
        return _failures == 0 ? 0 : 1;
    }

    private static void TestKmzDetection(string root)
    {
        var fixtures = Path.Combine(root, "tests", "fixtures");
        var names = new[]
        {
            "kmz-doc.kmz",
            "kmz-named.kmz",
            "kmz-nested.kmz",
            "kmz-empty.kmz",
            "kmz-no-kml.kmz",
            "kmz-corrupt.kmz",
        };
        var expected = new[] { true, true, true, false, false, false };
        for (var i = 0; i < names.Length; i++)
        {
            var file = Path.Combine(fixtures, names[i]);
            Check($"KMZ document detection: {names[i]}", KmzArchive.HasDocument(file) == expected[i]);
        }
    }

    private static void TestKmzExtraction(string root, string temporary)
    {
        var fixtures = Path.Combine(root, "tests", "fixtures");
        foreach (var name in new[] { "kmz-doc.kmz", "kmz-named.kmz", "kmz-nested.kmz" })
        {
            var folder = Path.Combine(temporary, "extract-" + Guid.NewGuid().ToString("n"));
            Directory.CreateDirectory(folder);
            var extracted = KmzArchive.ExtractDocument(Path.Combine(fixtures, name), folder);
            var parent = name == "kmz-nested.kmz" ? "files" : "";
            var wanted = Path.Combine(folder, parent, Path.GetFileNameWithoutExtension(name) + ".kml");
            Check($"{name} keeps its archive name", extracted == wanted, extracted);
            Check($"{name} contains a KML root", File.ReadAllText(extracted).Contains("<kml"), extracted);
            Check($"{name} leaves no partial file",
                Directory.GetFiles(folder, "*", SearchOption.AllDirectories).Length == 1);
        }

        ExpectInvalidData("an archive without KML is rejected", () =>
            KmzArchive.ExtractDocument(Path.Combine(fixtures, "kmz-no-kml.kmz"), temporary));
    }

    private static void TestKmzResources(string root, string temporary)
    {
        var photo = File.ReadAllBytes(Path.Combine(root, "tests", "fixtures", "photo.png"));

        var flatArchive = Path.Combine(temporary, "photo-resources.kmz");
        using (var archive = ZipFile.Open(flatArchive, ZipArchiveMode.Create))
        {
            WriteEntry(archive, "doc.kml",
                "<kml xmlns=\"http://www.opengis.net/kml/2.2\"><Document><Placemark><description><![CDATA["
                + "<img src=\"files/photo%20one.png?cache=1&amp;size=large\" />"
                + "<a href=\"icons/icon.png\">icon</a>]]></description><Point><coordinates>0,0</coordinates>"
                + "</Point></Placemark></Document></kml>");
            WriteEntry(archive, "files/photo one.png", photo);
            WriteEntry(archive, "icons/icon.png", photo);
            WriteEntry(archive, "not-referenced.png", photo);
        }

        var flatFolder = Path.Combine(temporary, "photo-resources");
        Directory.CreateDirectory(flatFolder);
        var flatDocument = KmzArchive.ExtractDocument(flatArchive, flatFolder);
        Check("KMZ keeps the document at its original relative directory",
            flatDocument == Path.Combine(flatFolder, "photo-resources.kml"), flatDocument);
        Check("KMZ extracts an encoded image path beside the document",
            File.Exists(Path.Combine(flatFolder, "files", "photo one.png")));
        Check("KMZ extracts references from href attributes",
            File.Exists(Path.Combine(flatFolder, "icons", "icon.png")));
        Check("KMZ leaves unreferenced resources out of the preview folder",
            !File.Exists(Path.Combine(flatFolder, "not-referenced.png")));
        Check("KMZ copies image bytes without changing them",
            File.ReadAllBytes(Path.Combine(flatFolder, "files", "photo one.png")).SequenceEqual(photo));

        var nestedArchive = Path.Combine(temporary, "nested-resources.kmz");
        using (var archive = ZipFile.Open(nestedArchive, ZipArchiveMode.Create))
        {
            WriteEntry(archive, "album/doc.kml",
                "<kml xmlns=\"http://www.opengis.net/kml/2.2\"><Document><Placemark><description><![CDATA["
                + "<img src=\"media/local.png\" />"
                + "<img src=\"../shared/photo.png\" />"
                + "<img src=\"../../escape.png\" />"
                + "]]></description><Point><coordinates>0,0</coordinates></Point></Placemark></Document></kml>");
            WriteEntry(archive, "album/media/local.png", photo);
            WriteEntry(archive, "shared/photo.png", photo);
            WriteEntry(archive, "escape.png", photo);
        }

        var nestedFolder = Path.Combine(temporary, "nested-resources");
        Directory.CreateDirectory(nestedFolder);
        var nestedDocument = KmzArchive.ExtractDocument(nestedArchive, nestedFolder);
        Check("nested KMZ document keeps its parent directory",
            nestedDocument == Path.Combine(nestedFolder, "album", "nested-resources.kml"), nestedDocument);
        Check("nested KMZ extracts an image beside the document",
            File.Exists(Path.Combine(nestedFolder, "album", "media", "local.png")));
        Check("nested KMZ resolves a parent-relative image inside the archive root",
            File.Exists(Path.Combine(nestedFolder, "shared", "photo.png")));
        Check("nested KMZ rejects a reference above the archive root",
            !File.Exists(Path.Combine(nestedFolder, "escape.png")));

        var viewerUrl = new Uri(TrailViewerPanel.BuildViewerUrl(nestedDocument, "nested-resources.kmz", nestedFolder));
        var source = viewerUrl.Query.TrimStart('?').Split('&')
            .First((part) => part.StartsWith("src=", StringComparison.Ordinal))
            .Substring(4);
        var sourceUrl = Uri.UnescapeDataString(source);
        Check("KMZ viewer URL includes the preserved document directory",
            sourceUrl.IndexOf("/album/nested-resources.kml?", StringComparison.OrdinalIgnoreCase) >= 0, sourceUrl);
    }

    private static void TestKmzResourceLimits(string temporary)
    {
        var oversized = Path.Combine(temporary, "oversized-resource.kmz");
        using (var archive = ZipFile.Open(oversized, ZipArchiveMode.Create))
        {
            WriteEntry(archive, "doc.kml",
                "<kml><Document><Placemark><description><![CDATA[<img src=\"files/large.jpg\" />"
                + "]]></description></Placemark></Document></kml>");
            var entry = archive.CreateEntry("files/large.jpg", CompressionLevel.Optimal);
            using var stream = entry.Open();
            var buffer = new byte[81920];
            long remaining = 30L * 1024 * 1024 + 1;
            while (remaining > 0)
            {
                var count = (int)Math.Min(buffer.Length, remaining);
                stream.Write(buffer, 0, count);
                remaining -= count;
            }
        }

        var oversizedFolder = Path.Combine(temporary, "oversized-resource");
        Directory.CreateDirectory(oversizedFolder);
        ExpectInvalidData("a KMZ image over 30 MB is rejected", () =>
            KmzArchive.ExtractDocument(oversized, oversizedFolder));
        Check("an oversized KMZ image leaves no partial files",
            Directory.GetFiles(oversizedFolder, "*", SearchOption.AllDirectories).Length == 0);

        var tooMany = Path.Combine(temporary, "too-many-resources.kmz");
        var description = new StringBuilder();
        using (var archive = ZipFile.Open(tooMany, ZipArchiveMode.Create))
        {
            for (var i = 0; i < 1001; i++)
            {
                var name = $"files/image-{i}.png";
                description.Append($"<img src=\"{name}\" />");
                WriteEntry(archive, name, new byte[] { 0 });
            }
            WriteEntry(archive, "doc.kml",
                "<kml><Document><Placemark><description><![CDATA["
                + description
                + "]]></description></Placemark></Document></kml>");
        }

        var tooManyFolder = Path.Combine(temporary, "too-many-resources");
        Directory.CreateDirectory(tooManyFolder);
        ExpectInvalidData("a KMZ over the 1000-image limit is rejected", () =>
            KmzArchive.ExtractDocument(tooMany, tooManyFolder));
        Check("a resource-limit failure removes the KML and copied images",
            Directory.GetFiles(tooManyFolder, "*", SearchOption.AllDirectories).Length == 0);
    }

    private static void TestKmzTraversal(string temporary)
    {
        var archivePath = Path.Combine(temporary, "safe.kmz");
        using (var archive = ZipFile.Open(archivePath, ZipArchiveMode.Create))
        {
            var entry = archive.CreateEntry("../escape.kml");
            using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
            writer.Write("<kml xmlns=\"http://www.opengis.net/kml/2.2\"/>");
        }

        var folder = Path.Combine(temporary, "traversal");
        Directory.CreateDirectory(folder);
        var extracted = KmzArchive.ExtractDocument(archivePath, folder);
        Check("entry names never escape the extraction folder",
            Path.GetFullPath(extracted).StartsWith(Path.GetFullPath(folder) + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase), extracted);
        Check("a traversal entry is written as the archive filename",
            Path.GetFileName(extracted) == "safe.kml", extracted);
        Check("no file is written one level above", !File.Exists(Path.Combine(temporary, "escape.kml")));
    }

    private static void TestKmzLimit(string root, string temporary)
    {
        var large = Path.Combine(temporary, "too-large.kmz");
        const long limit = 64L * 1024 * 1024;
        using (var archive = ZipFile.Open(large, ZipArchiveMode.Create))
        {
            var entry = archive.CreateEntry("doc.kml", CompressionLevel.Optimal);
            using var stream = entry.Open();
            var buffer = new byte[81920];
            long remaining = limit + 1;
            while (remaining > 0)
            {
                var count = (int)Math.Min(buffer.Length, remaining);
                stream.Write(buffer, 0, count);
                remaining -= count;
            }
        }

        var folder = Path.Combine(temporary, "too-large");
        Directory.CreateDirectory(folder);
        ExpectInvalidData("a KML over the 64 MB limit is rejected", () =>
            KmzArchive.ExtractDocument(large, folder));
        Check("the oversized KML leaves no partial file", Directory.GetFiles(folder).Length == 0);

        var noDocument = Path.Combine(root, "tests", "fixtures", "kmz-empty.kmz");
        ExpectInvalidData("an empty KMZ is rejected during extraction", () =>
            KmzArchive.ExtractDocument(noDocument, folder));
    }

    private static void TestSourceSafety(string temporary)
    {
        Check("a 64 MB direct track remains accepted",
            !TrailViewerPanel.IsOversized(TrailViewerPanel.MaxInputBytes));
        Check("a direct track over 64 MB is rejected",
            TrailViewerPanel.IsOversized(TrailViewerPanel.MaxInputBytes + 1));
        Check("a photo-heavy KMZ archive up to 1088 MB is accepted",
            !TrailViewerPanel.IsOversized(120L * 1024 * 1024, isKmz: true)
            && !TrailViewerPanel.IsOversized(TrailViewerPanel.MaxKmzInputBytes, isKmz: true));
        Check("a KMZ archive over 1088 MB is rejected",
            TrailViewerPanel.IsOversized(TrailViewerPanel.MaxKmzInputBytes + 1, isKmz: true));

        var source = Path.Combine(temporary, "source", "route.kmz");
        var target = TrailViewerPanel.OverlayTarget(source, "overlay.png");
        Check("an overlay is written beside the original archive",
            target == Path.Combine(temporary, "source", "overlay.png"), target);
    }

    private static void TestViewerShutdownFilter()
    {
        Check("viewer COM shutdown is handled",
            TrailViewerPanel.IsViewerShutdown(
                new System.Runtime.InteropServices.COMException("closed")));
        Check("a dispatcher shutdown cancellation is handled",
            TrailViewerPanel.IsViewerShutdown(new System.Threading.Tasks.TaskCanceledException()));
        Check("unrelated viewer errors are not swallowed",
            !TrailViewerPanel.IsViewerShutdown(new ArgumentException("bad input")));
    }

    private static void TestClipboardRetry()
    {
        var attempts = 0;
        TrailViewerPanel.SetClipboardTextAsync("point", _ =>
        {
            attempts++;
            if (attempts < 3)
                throw new System.Runtime.InteropServices.ExternalException("clipboard busy");
        }, 3, 0).GetAwaiter().GetResult();
        Check("a briefly locked clipboard is retried", attempts == 3, attempts.ToString());

        var finalFailure = false;
        try
        {
            TrailViewerPanel.SetClipboardTextAsync("point", _ =>
                throw new System.Runtime.InteropServices.ExternalException("clipboard busy"), 2, 0)
                .GetAwaiter().GetResult();
        }
        catch (System.Runtime.InteropServices.ExternalException)
        {
            finalFailure = true;
        }
        Check("a permanently unavailable clipboard still reports failure", finalFailure);
    }

    private static void TestPreferences(string temporary)
    {
        var path = Path.Combine(temporary, "settings", "viewer-settings.txt");
        Check("preferences start empty", ViewerPreferences.QueryFromFile(path) == "");

        ViewerPreferences.SaveFromQueryToFile(
            "layer=terrain&pins=0&lang=EN&evil=value&exportSize=1%3A1&exportSize=bad"
            + "&layer=terrain.openTopo&exportInk=white&pins=1&exportScrim=soft&broken&%ZZ=bad",
            path);
        Check("preferences accept only the final valid values",
            ViewerPreferences.QueryFromFile(path)
                == "exportInk=white&exportScrim=soft&exportSize=1%3A1&layer=terrain.openTopo&pins=1",
            ViewerPreferences.QueryFromFile(path));

        ViewerPreferences.SaveFromQueryToFile("pins=0&lang=zh&unknown=terrain", path);
        Check("a later message merges with the existing values",
            ViewerPreferences.QueryFromFile(path)
                == "exportInk=white&exportScrim=soft&exportSize=1%3A1&lang=zh&layer=terrain.openTopo&pins=0",
            ViewerPreferences.QueryFromFile(path));

        var before = ViewerPreferences.QueryFromFile(path);
        ViewerPreferences.SaveFromQueryToFile("layer=" + new string('x', 4096), path);
        Check("an oversized settings message is ignored", ViewerPreferences.QueryFromFile(path) == before);

        File.WriteAllLines(path, new[]
        {
            "junk",
            "layer=terrain",
            "layer=invalid",
            "pins=1",
            "exportSize=4:3",
            "lang=zh",
        }, new UTF8Encoding(false));
        Check("invalid lines on disk are ignored",
            ViewerPreferences.QueryFromFile(path) == "exportSize=4%3A3&lang=zh&layer=terrain&pins=1",
            ViewerPreferences.QueryFromFile(path));
        ViewerPreferences.SaveFromQueryToFile("layer=satellite.tianditu", path);
        ViewerPreferences.SaveFromQueryToFile("exportContent=track&exportProfile=ele", path);
        Check("export content and profile preferences persist valid values",
            ViewerPreferences.QueryFromFile(path).Contains("exportContent=track")
            && ViewerPreferences.QueryFromFile(path).Contains("exportProfile=ele"),
            ViewerPreferences.QueryFromFile(path));
        ViewerPreferences.SaveFromQueryToFile("exportContent=bad&exportProfile=bad", path);
        Check("invalid export content/profile values are ignored",
            ViewerPreferences.QueryFromFile(path).Contains("exportContent=track")
            && ViewerPreferences.QueryFromFile(path).Contains("exportProfile=ele"));
        Check("Tianditu provider IDs are valid map preferences",
            ViewerPreferences.QueryFromFile(path).Contains("layer=satellite.tianditu"),
            ViewerPreferences.QueryFromFile(path));
        ViewerPreferences.SaveFromQueryToFile("layer=custom.mwkubd7l0", path);
        Check("custom source IDs are persisted across previews",
            ViewerPreferences.QueryFromFile(path).Contains("layer=custom.mwkubd7l0"),
            ViewerPreferences.QueryFromFile(path));
        ViewerPreferences.SaveFromQueryToFile("layer=custom.", path);
        ViewerPreferences.SaveFromQueryToFile("layer=custom.bad%20id", path);
        Check("malformed custom source IDs do not overwrite saved layer",
            ViewerPreferences.QueryFromFile(path).Contains("layer=custom.mwkubd7l0"),
            ViewerPreferences.QueryFromFile(path));
        Check("no temporary preference files are left",
            !Directory.GetFiles(Path.GetDirectoryName(path), "*.tmp").Any()
            && !Directory.GetFiles(Path.GetDirectoryName(path), "*.old").Any());

        var cachePrefsPath = Path.Combine(temporary, "settings", "tile-cache-settings.txt");
        var defaultCacheOpts = ViewerPreferences.ReadTileCacheOptions(cachePrefsPath);
        Check("tile cache options default to enabled, 512 MB and 30 days",
            defaultCacheOpts.Enabled && defaultCacheOpts.MaxMegabytes == 512 && defaultCacheOpts.MaxAgeDays == 30
            && !defaultCacheOpts.IsUnlimited);
        ViewerPreferences.SaveFromQueryToFile("tileCache=0&tileCacheMaxMb=2048&tileCacheDays=0", cachePrefsPath);
        var updatedCacheOpts = ViewerPreferences.ReadTileCacheOptions(cachePrefsPath);
        Check("tile cache options persist valid finite limit values",
            !updatedCacheOpts.Enabled && updatedCacheOpts.MaxMegabytes == 2048 && updatedCacheOpts.MaxAgeDays == 0
            && !updatedCacheOpts.IsUnlimited);
        ViewerPreferences.SaveFromQueryToFile("tileCache=1&tileCacheMaxMb=0&tileCacheDays=7", cachePrefsPath);
        var unlimitedCacheOpts = ViewerPreferences.ReadTileCacheOptions(cachePrefsPath);
        Check("tile cache options persist unlimited capacity mode",
            unlimitedCacheOpts.Enabled && unlimitedCacheOpts.MaxMegabytes == 0 && unlimitedCacheOpts.MaxAgeDays == 7
            && unlimitedCacheOpts.IsUnlimited);
        ViewerPreferences.SaveFromQueryToFile("tileCache=bad&tileCacheMaxMb=1024&tileCacheDays=12", cachePrefsPath);
        ViewerPreferences.SaveFromQueryToFile("tileCache=bad&tileCacheMaxMb=9999&tileCacheDays=12", cachePrefsPath);
        var preservedCacheOpts = ViewerPreferences.ReadTileCacheOptions(cachePrefsPath);
        Check("invalid or removed tile cache option values do not overwrite saved settings",
            preservedCacheOpts.Enabled && preservedCacheOpts.MaxMegabytes == 0 && preservedCacheOpts.MaxAgeDays == 7
            && preservedCacheOpts.IsUnlimited);
    }

    private static void TestTileCache(string temporary)
    {
        var cacheDir = Path.Combine(temporary, "tile-cache");
        var cache = new TileCache(cacheDir);
        var customJson = "["
            + "{\"id\":\"custom.g\",\"name\":\"G\",\"url\":\"https://mts1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}\"},"
            + "{\"id\":\"custom.sub\",\"name\":\"Sub\",\"url\":\"https://{s}.tiles.example.org/{z}/{x}/{y}.png\",\"subdomains\":\"ab\"}"
            + "]";
        var matchers = TileCache.BuildCustomHostMatchers(customJson);

        Check("built-in tile subdomains normalize to one cache key",
            TileCache.TryBuildKey(new Uri("https://a.tile.openstreetmap.fr/hot/13/100/200.png"), matchers, out var osmA)
            && TileCache.TryBuildKey(new Uri("https://c.tile.openstreetmap.fr/hot/13/100/200.png"), matchers, out var osmC)
            && osmA == osmC && osmA == "tile.openstreetmap.fr/hot/13/100/200.png",
            osmA);

        Check("Tianditu keys strip personal tokens and normalize subdomains",
            TileCache.TryBuildKey(new Uri("https://t2.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&tk=secret123&TILEMATRIX=10"), matchers, out var tdtA)
            && TileCache.TryBuildKey(new Uri("https://t6.tianditu.gov.cn/img_w/wmts?TILEMATRIX=10&SERVICE=WMTS&tk=other456"), matchers, out var tdtB)
            && tdtA == tdtB && !tdtA.Contains("secret123") && !tdtA.Contains("tk="),
            tdtA);

        var hasGoogleKey = TileCache.TryBuildKey(
            new Uri("https://mts1.google.com/vt/lyrs=y&x=1&y=2&z=3"), matchers, out var googleKey);
        var hasSubKey = TileCache.TryBuildKey(
            new Uri("https://b.tiles.example.org/10/1/2.png"), matchers, out var subKey);
        Check("custom tile sources including wildcard subdomains and Google satellites are cached",
            hasGoogleKey
            && googleKey.StartsWith("mts.google.com/vt", StringComparison.Ordinal)
            && hasSubKey
            && subKey == ".tiles.example.org/10/1/2.png",
            googleKey + " | " + subKey);

        Check("non-tile images, Esri non-tile paths and virtual hosts are never cached",
            !TileCache.TryBuildKey(new Uri("https://example.com/photos/trail.jpg"), matchers, out _)
            && !TileCache.TryBuildKey(new Uri("https://server.arcgisonline.com/other/asset.png"), matchers, out _)
            && !TileCache.TryBuildKey(new Uri("https://app-1234.trailviewer.example/tile.png"), matchers, out _)
            && !TileCache.TryBuildKey(new Uri("https://file.trailviewer.example/photo.png"), matchers, out _));

        var pngBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4 };
        var jpegBytes = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 5, 6, 7 };
        var htmlBytes = Encoding.UTF8.GetBytes("<html>error</html>");
        Check("valid image signatures pass and HTML/empty payloads are rejected",
            TileCache.TryDetectImageContentType(pngBytes, "text/plain", out _, out var pngType) && pngType == "image/png"
            && TileCache.TryDetectImageContentType(jpegBytes, null, out _, out var jpgType) && jpgType == "image/jpeg"
            && !TileCache.TryDetectImageContentType(htmlBytes, "image/png", out _, out _)
            && !TileCache.TryDetectImageContentType(Array.Empty<byte>(), "image/png", out _, out _)
            && !cache.Store(osmA, htmlBytes, "text/html", new TileCacheOptions(true, 512, 30), DateTime.UtcNow));

        var now = new DateTime(2026, 11, 20, 12, 0, 0, DateTimeKind.Utc);
        var opts30 = new TileCacheOptions(true, 512, 30);
        Check("stored fresh tile reads back with exact payload and content type",
            cache.Store(osmA, pngBytes, "image/png", opts30, now)
            && cache.TryRead(osmA, opts30, now.AddDays(5), out var freshEntry) == TileLookupKind.Fresh
            && freshEntry != null && freshEntry.ContentType == "image/png" && freshEntry.Data.SequenceEqual(pngBytes));

        Check("disabled cache returns Miss without breaking stored entries",
            cache.TryRead(osmA, new TileCacheOptions(false, 512, 30), now, out _) == TileLookupKind.Miss);

        Check("expired tile returns Expired with stale bytes, while maxAgeDays=0 stays Fresh",
            cache.TryRead(osmA, opts30, now.AddDays(31), out var staleEntry) == TileLookupKind.Expired
            && staleEntry != null && staleEntry.Data.SequenceEqual(pngBytes)
            && cache.TryRead(osmA, new TileCacheOptions(true, 512, 0), now.AddDays(365), out _) == TileLookupKind.Fresh);

        var offlinePruned = cache.Prune(opts30, now.AddDays(31), removeExpired: false);
        Check("offline prune preserves expired tiles for fallback",
            offlinePruned.TileCount == 1
            && cache.TryRead(osmA, opts30, now.AddDays(31), out _) == TileLookupKind.Expired);

        var onlinePruned = cache.Prune(opts30, now.AddDays(31), removeExpired: true);
        Check("online prune removes expired tiles",
            onlinePruned.TileCount == 0 && cache.GetStats().TileCount == 0);

        var tinyPayload = new byte[1024];
        Buffer.BlockCopy(pngBytes, 0, tinyPayload, 0, pngBytes.Length);
        var optsForever = new TileCacheOptions(true, 512, 0);
        cache.Store("tile.openstreetmap.fr/hot/1/1/1.png", tinyPayload, "image/png", optsForever, now.AddMinutes(-30));
        cache.Store("tile.openstreetmap.fr/hot/1/1/2.png", tinyPayload, "image/png", optsForever, now.AddMinutes(-20));
        cache.Store("tile.openstreetmap.fr/hot/1/1/3.png", tinyPayload, "image/png", optsForever, now.AddMinutes(-10));
        var stats3 = cache.GetStats();
        Check("stats report accurate file count and byte total",
            stats3.TileCount == 3 && stats3.TotalBytes == 3 * (5 + tinyPayload.Length));

        var unlimitedStats = cache.Prune(new TileCacheOptions(true, 0, 0), now, removeExpired: false);
        Check("unlimited storage limit (0) preserves all cached tiles during Prune",
            unlimitedStats.TileCount == 3 && unlimitedStats.TotalBytes == stats3.TotalBytes);

        // Two tiles weigh 2058 bytes; a 2500-byte override (90% target = 2250 bytes) evicts only the oldest tile.
        var lruStats = cache.Prune(new TileCacheOptions(true, 512, 0, maxBytesOverride: 2500), now, removeExpired: false);
        Check("LRU eviction removes oldest-accessed tile while keeping newer entries",
            lruStats.TileCount == 2
            && cache.TryRead("tile.openstreetmap.fr/hot/1/1/1.png", optsForever, now, out _) == TileLookupKind.Miss
            && cache.TryRead("tile.openstreetmap.fr/hot/1/1/2.png", optsForever, now, out _) == TileLookupKind.Fresh
            && cache.TryRead("tile.openstreetmap.fr/hot/1/1/3.png", optsForever, now, out _) == TileLookupKind.Fresh,
            $"count={lruStats.TileCount}");

        cache.Store("tile.openstreetmap.fr/hot/1/1/1.png", pngBytes, "image/png", optsForever, now);
        var cleared = cache.Clear();
        Check("Clear removes all cached tiles", cleared.TileCount == 0 && cleared.TotalBytes == 0);
    }

    private static void TestCustomSources(string temporary)
    {
        var path = Path.Combine(temporary, "custom-sources", "custom-sources.json");
        var valid = "[{\"id\":\"custom.windy\",\"name\":\"Windy\",\"url\":"
            + "\"https://tiles.example/{z}/{x}/{y}.png\",\"tileSize\":512,\"minZoom\":1,"
            + "\"maxZoom\":20,\"subdomains\":\"a1-\",\"attribution\":\"Example\",\"tms\":true}]";
        Check("custom sources start absent", CustomSourceStore.LoadJsonFromFile(path) == null);
        Check("a valid custom source list is saved", CustomSourceStore.SaveJsonToFile(valid, path));
        var loaded = CustomSourceStore.LoadJsonFromFile(path);
        Check("custom sources survive a fresh host read",
            loaded != null && loaded.Contains("\"custom.windy\"") && loaded.Contains("\"tileSize\":512")
            && loaded.Contains("\"subdomains\":\"a1\"") && loaded.Contains("\"tms\":true"),
            loaded);

        File.WriteAllText(path, valid, new UTF8Encoding(false));
        var before = File.ReadAllText(path);
        Check("invalid custom source JSON is rejected without replacing the file",
            !CustomSourceStore.SaveJsonToFile("not json", path)
            && File.ReadAllText(path) == before);
        Check("oversized custom source data is rejected",
            !CustomSourceStore.SaveJsonToFile("[" + new string('x', 128 * 1024) + "]", path));

        var duplicates = "["
            + "{\"id\":\"custom.same\",\"name\":\"One\",\"url\":\"https://a/{z}/{x}/{y}\"},"
            + "{\"id\":\"custom.same\",\"name\":\"Two\",\"url\":\"https://b/{z}/{x}/{y}\"}]";
        Check("host persistence validates and de-duplicates custom sources",
            CustomSourceStore.SaveJsonToFile(duplicates, path)
            && Regex.Matches(CustomSourceStore.LoadJsonFromFile(path), "\"id\":").Count == 1);
        Check("custom source writes leave no temporary files",
            !Directory.GetFiles(Path.GetDirectoryName(path), "*.tmp").Any()
            && !Directory.GetFiles(Path.GetDirectoryName(path), "*.old").Any());
    }

    private static void TestViewerBuildId(string temporary)
    {
        var folder = Path.Combine(temporary, "viewer-build-id");
        Directory.CreateDirectory(Path.Combine(folder, "nested"));
        File.WriteAllText(Path.Combine(folder, "app.js"), "alpha");
        File.WriteAllText(Path.Combine(folder, "nested", "style.css"), "beta");
        var first = ViewerBuildId.Compute(folder, 1);
        var again = ViewerBuildId.Compute(folder, 1);
        Check("viewer build id is stable", first == again, first);
        Check("viewer build id is a short lowercase hash",
            first.Length == 12 && first.All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')), first);
        File.WriteAllText(Path.Combine(folder, "app.js"), "changed");
        Check("viewer content invalidates its cache id", ViewerBuildId.Compute(folder, 1) != first);
        Check("viewer protocol participates in the cache id",
            ViewerBuildId.Compute(folder, 2) != ViewerBuildId.Compute(folder, 1));
        var host = (string)typeof(TrailViewerPanel)
            .GetField("AppHost", BindingFlags.NonPublic | BindingFlags.Static)
            .GetValue(null);
        Check("the live WebView host is a content hash",
            Regex.IsMatch(host, "^app-[0-9a-f]{12}\\.trailviewer\\.example$"), host);
        Check("the live WebView host does not contain the release version", !host.Contains("1-17-0"), host);
        Check("protocol and preference schema versions stay independent",
            BuildInfo.ViewerProtocolVersion > 0 && BuildInfo.PreferencesSchemaVersion > 0,
            $"{BuildInfo.ViewerProtocolVersion}/{BuildInfo.PreferencesSchemaVersion}");
    }

    private static void TestProductIdentity(string temporary)
    {
        Check("current identity is TrailViewer", PluginIdentity.Name == "TrailViewer");
        Check("legacy identity is isolated for migration", PluginIdentity.LegacyName == "GpxViewer");

        var legacyPreferences = Path.Combine(temporary, "legacy-preferences", "viewer-settings.txt");
        var currentPreferences = Path.Combine(temporary, "current-preferences", "viewer-settings.txt");
        Directory.CreateDirectory(Path.GetDirectoryName(legacyPreferences));
        File.WriteAllLines(legacyPreferences, new[] { "layer=terrain", "pins=0" });
        Check("legacy preferences migrate to the current product directory",
            ViewerPreferences.MigrateLegacyFile(legacyPreferences, currentPreferences)
            && File.Exists(currentPreferences) && !File.Exists(legacyPreferences),
            currentPreferences);
        Check("migrated preference values remain valid",
            ViewerPreferences.QueryFromFile(currentPreferences) == "layer=terrain&pins=0");

        var legacyProfile = Path.Combine(temporary, "legacy-profile");
        var currentProfile = Path.Combine(temporary, "current-profile");
        Directory.CreateDirectory(legacyProfile);
        File.WriteAllText(Path.Combine(legacyProfile, "marker"), "kept");
        Check("legacy WebView profile moves to the current name",
            TrailViewerPanel.MigrateLegacyProfile(legacyProfile, currentProfile)
            && Directory.Exists(currentProfile) && !Directory.Exists(legacyProfile));

        var legacyLog = Path.Combine(temporary, "legacy-log", "log.txt");
        var currentLog = Path.Combine(temporary, "current-log", "log.txt");
        Directory.CreateDirectory(Path.GetDirectoryName(legacyLog));
        File.WriteAllText(legacyLog, "old log");
        Check("legacy log moves to the current product directory",
            Log.MigrateLegacyFile(legacyLog, currentLog)
            && File.Exists(currentLog) && !File.Exists(legacyLog));
    }

    private static void TestTianditu(string temporary)
    {
        const string fakeKey = "0123456789abcdef0123456789abcdef";
        var keyFile = Path.Combine(temporary, "tianditu", "key.bin");
        Check("Tianditu accepts a 32-character hexadecimal key", TiandituKeyStore.IsValid(fakeKey));
        Check("Tianditu rejects a malformed key", !TiandituKeyStore.IsValid("not-a-key"));
        Check("Tianditu encrypts the saved key", TiandituKeyStore.Save(fakeKey, keyFile) && File.Exists(keyFile));
        var storedText = Convert.ToBase64String(File.ReadAllBytes(keyFile));
        Check("the encrypted key file does not contain the plaintext key", !storedText.Contains(fakeKey));
        Check("the encrypted key round-trips for the current Windows user",
            TiandituKeyStore.LoadFromFile(keyFile) == fakeKey);
        Check("Tianditu deletes a saved key", TiandituKeyStore.Delete(keyFile) && !File.Exists(keyFile));
        Check("TrailViewer recognizes Tianditu tile response URLs",
            TrailViewerPanel.IsTiandituTileUri("https://t3.tianditu.gov.cn/vec_w/wmts?tk=irrelevant"));
        Check("TrailViewer ignores lookalike Tianditu response hosts",
            !TrailViewerPanel.IsTiandituTileUri("https://tianditu.gov.cn.example.test/vec_w/wmts"));
    }

    private static void TestOverlayTransfer()
    {
        using (var transfer = new OverlayTransfer())
        {
            transfer.Begin("export-1\t2\t..%2F..%2Ftrack.png");
            transfer.Append("export-1\t0\t2\t" + Base64("abc"));
            transfer.Append("export-1\t1\t2\t" + Base64("def"));
            using var result = transfer.Complete("export-1\t2");
            Check("a complete transfer keeps its bytes", ReadText(result.Picture) == "abcdef");
            Check("a complete transfer strips path traversal", result.Name == "track.png", result.Name);
            Check("the completed transfer releases its state", transfer.Complete("export-1\t2") == null);
        }

        using (var transfer = new OverlayTransfer())
        {
            transfer.Begin("order\t2\torder.png");
            transfer.Append("order\t0\t2\t" + Base64("a"));
            ExpectInvalidData("an out-of-order chunk is rejected", () =>
                transfer.Append("order\t0\t2\t" + Base64("b")));
            Check("a rejected chunk clears the transfer", !transfer.HasData);
        }

        using (var transfer = new OverlayTransfer(4))
        {
            transfer.Begin("limit\t1\tlimit.png");
            ExpectInvalidData("the decoded overlay byte limit is enforced", () =>
                transfer.Append("limit\t0\t1\t" + Base64("12345")));
        }

        using (var transfer = new OverlayTransfer())
        {
            transfer.Begin("bad64\t1\tbad.png");
            ExpectInvalidData("invalid base64 is rejected", () =>
                transfer.Append("bad64\t0\t1\tnot-base64!"));
        }

        using (var transfer = new OverlayTransfer())
        {
            transfer.Begin("short\t2\tshort.png");
            transfer.Append("short\t0\t2\t" + Base64("one"));
            ExpectInvalidData("an incomplete transfer is rejected", () => transfer.Complete("short\t2"));
        }

        using (var transfer = new OverlayTransfer())
        {
            ExpectInvalidData("a transfer header with zero chunks is rejected", () =>
                transfer.Begin("zero\t0\tzero.png"));
        }

        Check("empty file names fall back to overlay.png", OverlayTransfer.SanitiseFileName("") == "overlay.png");
        Check("dot-only file names fall back to overlay.png", OverlayTransfer.SanitiseFileName("..") == "overlay.png");
        Check("Unicode file names are preserved", OverlayTransfer.SanitiseFileName("轨迹.png") == "轨迹.png");
    }

    private static void TestTrackSaveService(string temporary)
    {
        using (var svc = new TrackSaveService())
        {
            var gpx = "<gpx version=\"1.1\"/>";
            var b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(gpx));
            svc.Begin("s1\t1\t0\tdemo-edited.gpx");
            svc.Append($"s1\t0\t{b64}");
            var payload = svc.Complete("s1");
            Check("track save reassembles UTF-8 GPX payload",
                payload != null && Encoding.UTF8.GetString(payload.Bytes) == gpx
                && !payload.Overwrite && payload.Format == "gpx");

            foreach (var fmt in new[] { "kml", "kmz", "geojson", "tcx", "csv" })
            {
                svc.Begin($"fmt-{fmt}\t1\t1\tdemo-edited.{fmt}\t{fmt}\t1");
                svc.Append($"fmt-{fmt}\t0\t{b64}");
                var fmtPayload = svc.Complete($"fmt-{fmt}");
                var expectOverwrite = fmt == "kml" || fmt == "kmz";
                Check($"track save records {fmt} format and expected overwrite policy",
                    fmtPayload != null && fmtPayload.Format == fmt && fmtPayload.Overwrite == expectOverwrite
                    && fmtPayload.PackRemoteImages == (fmt == "kmz"));
            }

            ExpectInvalidData("track save rejects unsupported export format", () =>
                svc.Begin("bad-fmt\t1\t0\tdemo.fit\tfit"));
        }

        Check("track save maps extensions and dialog filters for all formats",
            TrackSaveService.GetDefaultExtension("geojson") == ".geojson"
            && TrackSaveService.GetDefaultExtension("kmz") == ".kmz"
            && TrackSaveService.GetFileDialogFilter("tcx").Contains("*.tcx")
            && TrackSaveService.GetFileDialogFilter("csv").Contains("*.csv"));

        var folder = Path.Combine(temporary, "tracksave");
        Directory.CreateDirectory(folder);
        var target = Path.Combine(folder, "route.gpx");
        File.WriteAllText(target, "old-gpx");
        TrackSaveService.WriteWithBackup(target, Encoding.UTF8.GetBytes("new-gpx"), createBackup: true);
        Check("track save writes .bak backup before overwriting",
            File.ReadAllText(target + ".bak") == "old-gpx" && File.ReadAllText(target) == "new-gpx");
        TrackSaveService.WriteWithBackup(target, Encoding.UTF8.GetBytes("newer-gpx"), createBackup: true);
        Check("track save preserves original .bak on subsequent overwrites",
            File.ReadAllText(target + ".bak") == "old-gpx" && File.ReadAllText(target) == "newer-gpx");
    }

    private static void TestKmzBuild(string root, string temporary)
    {
        var photo = File.ReadAllBytes(Path.Combine(root, "tests", "fixtures", "photo.png"));
        var photo2 = File.ReadAllBytes(Path.Combine(root, "tests", "fixtures", "photo2.png"));
        var fileRoot = Path.Combine(temporary, "kmz-build-root");
        var albumDir = Path.Combine(fileRoot, "album");
        var mediaDir = Path.Combine(albumDir, "media");
        var sharedDir = Path.Combine(fileRoot, "shared");
        Directory.CreateDirectory(mediaDir);
        Directory.CreateDirectory(sharedDir);

        File.WriteAllBytes(Path.Combine(mediaDir, "local.png"), photo);
        File.WriteAllBytes(Path.Combine(sharedDir, "photo.png"), photo2);
        var outsideSecret = Path.Combine(temporary, "secret.png");
        File.WriteAllBytes(outsideSecret, photo);

        var dataUri = "data:image/png;base64," + Convert.ToBase64String(photo2);
        var kmlText =
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
            + "<kml xmlns=\"http://www.opengis.net/kml/2.2\">\n"
            + "  <Document>\n"
            + "    <Placemark>\n"
            + "      <name>Album Stop</name>\n"
            + "      <description><![CDATA["
            + "<img src=\"media/local.png\" />"
            + "<img src=\"../shared/photo.png\" />"
            + "<img src=\"../../secret.png\" />"
            + $"<img src=\"{dataUri}\" />"
            + "<img src=\"https://example.com/remote.jpg\" />"
            + "]]></description>\n"
            + "      <Point><coordinates>114.3,30.5,100</coordinates></Point>\n"
            + "    </Placemark>\n"
            + "  </Document>\n"
            + "</kml>\n";

        var kmzBytes = KmzArchive.BuildKmzBytes(Encoding.UTF8.GetBytes(kmlText), albumDir, fileRoot);
        var outKmz = Path.Combine(temporary, "built-output.kmz");
        File.WriteAllBytes(outKmz, kmzBytes);

        Check("built KMZ archive is recognized as valid KMZ", KmzArchive.HasDocument(outKmz));
        var extractDir = Path.Combine(temporary, "kmz-build-extract");
        Directory.CreateDirectory(extractDir);
        var extractedKml = KmzArchive.ExtractDocument(outKmz, extractDir);
        var extractedText = File.ReadAllText(extractedKml);
        Check("built KMZ round-trips local image inside archive",
            File.Exists(Path.Combine(extractDir, "media", "local.png"))
            && File.ReadAllBytes(Path.Combine(extractDir, "media", "local.png")).SequenceEqual(photo));
        Check("built KMZ remaps parent-relative image safely inside archive",
            File.Exists(Path.Combine(extractDir, "files", "photo.png"))
            && File.ReadAllBytes(Path.Combine(extractDir, "files", "photo.png")).SequenceEqual(photo2));
        Check("built KMZ extracts embedded data-URI image into files/",
            File.Exists(Path.Combine(extractDir, "files", "embedded-1.png"))
            && File.ReadAllBytes(Path.Combine(extractDir, "files", "embedded-1.png")).SequenceEqual(photo2));
        Check("built KMZ excludes files outside fileRoot and preserves HTTPS URLs",
            !File.Exists(Path.Combine(extractDir, "secret.png"))
            && !File.Exists(Path.Combine(extractDir, "files", "secret.png"))
            && extractedText.Contains("https://example.com/remote.jpg")
            && !extractedText.Contains("data:image/png;base64,"));

        var remoteKml =
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
            + "<kml xmlns=\"http://www.opengis.net/kml/2.2\">\n"
            + "  <Document>\n"
            + "    <Placemark>\n"
            + "      <name>Remote Album</name>\n"
            + "      <description><![CDATA["
            + "<img src=\"https://images.example/ok.png\" />"
            + "<img src=\"https://images.example/dead.png\" />"
            + "]]></description>\n"
            + "      <Point><coordinates>114.3,30.5,100</coordinates></Point>\n"
            + "    </Placemark>\n"
            + "  </Document>\n"
            + "</kml>\n";
        var progressLog = new System.Collections.Generic.List<string>();
        var remoteKmzBytes = KmzArchive.BuildKmzBytesAsync(
            Encoding.UTF8.GetBytes(remoteKml),
            albumDir,
            fileRoot,
            packRemoteImages: true,
            remoteFetcher: (url, _) =>
            {
                if (url == "https://images.example/ok.png")
                    return System.Threading.Tasks.Task.FromResult(
                        new KmzArchive.KmzRemoteImage(photo, ".png"));
                throw new InvalidDataException("simulated 404");
            },
            onProgress: (done, total, fail) =>
            {
                lock (progressLog) progressLog.Add($"{done}/{total}:{fail}");
            }).GetAwaiter().GetResult();
        var remoteKmz = Path.Combine(temporary, "built-remote.kmz");
        File.WriteAllBytes(remoteKmz, remoteKmzBytes);
        var remoteExtractDir = Path.Combine(temporary, "kmz-remote-extract");
        Directory.CreateDirectory(remoteExtractDir);
        var remoteExtractedKml = KmzArchive.ExtractDocument(remoteKmz, remoteExtractDir);
        var remoteExtractedText = File.ReadAllText(remoteExtractedKml);
        Check("KMZ remote packing downloads valid HTTPS image into files/ and keeps failed links untouched",
            File.Exists(Path.Combine(remoteExtractDir, "files", "remote-1.png"))
            && File.ReadAllBytes(Path.Combine(remoteExtractDir, "files", "remote-1.png")).SequenceEqual(photo)
            && remoteExtractedText.Contains("files/remote-1.png")
            && !remoteExtractedText.Contains("https://images.example/ok.png")
            && remoteExtractedText.Contains("https://images.example/dead.png"));
        Check("KMZ remote packing reports initial and final download progress counts",
            progressLog.Count == 3
            && progressLog[0] == "0/2:0"
            && progressLog[progressLog.Count - 1] == "2/2:1"
            && ViewerMessages.TrackSaveProgress("s1", 2, 5, 1) == "trackSaveProgress\ts1\t2\t5\t1",
            string.Join(", ", progressLog));

        var prefixKml =
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
            + "<kml xmlns=\"http://www.opengis.net/kml/2.2\">\n"
            + "  <Document>\n"
            + "    <Placemark>\n"
            + "      <name>Prefix Collision</name>\n"
            + "      <description><![CDATA["
            + "<img src=\"https://images.example/a.png\" />"
            + "<img src=\"https://images.example/a.png?w=800\" />"
            + "]]></description>\n"
            + "      <Point><coordinates>114.3,30.5,100</coordinates></Point>\n"
            + "    </Placemark>\n"
            + "  </Document>\n"
            + "</kml>\n";
        var prefixKmzBytes = KmzArchive.BuildKmzBytesAsync(
            Encoding.UTF8.GetBytes(prefixKml),
            albumDir,
            fileRoot,
            packRemoteImages: true,
            remoteFetcher: (url, _) =>
            {
                if (url == "https://images.example/a.png")
                    return System.Threading.Tasks.Task.FromResult(
                        new KmzArchive.KmzRemoteImage(photo, ".png"));
                throw new InvalidDataException("simulated 404");
            }).GetAwaiter().GetResult();
        var prefixKmz = Path.Combine(temporary, "built-prefix.kmz");
        File.WriteAllBytes(prefixKmz, prefixKmzBytes);
        var prefixExtractDir = Path.Combine(temporary, "kmz-prefix-extract");
        Directory.CreateDirectory(prefixExtractDir);
        var prefixExtractedKml = KmzArchive.ExtractDocument(prefixKmz, prefixExtractDir);
        var prefixExtractedText = File.ReadAllText(prefixExtractedKml);
        Check("KMZ reference replacement does not corrupt longer URL sharing a prefix",
            prefixExtractedText.Contains("\"files/remote-1.png\"")
            && prefixExtractedText.Contains("\"https://images.example/a.png?w=800\"")
            && !prefixExtractedText.Contains("files/remote-1.png?w=800"));

        var directFilesDir = Path.Combine(albumDir, "files");
        Directory.CreateDirectory(directFilesDir);
        var directPhoto = new byte[] { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x77, 0x88 };
        File.WriteAllBytes(Path.Combine(directFilesDir, "photo.png"), directPhoto);
        var collisionKml =
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
            + "<kml xmlns=\"http://www.opengis.net/kml/2.2\">\n"
            + "  <Document>\n"
            + "    <Placemark>\n"
            + "      <name>Collision</name>\n"
            + "      <description><![CDATA["
            + "<img src=\"../shared/photo.png\" />"
            + "<img src=\"files/photo.png\" />"
            + "]]></description>\n"
            + "      <Point><coordinates>114.3,30.5,100</coordinates></Point>\n"
            + "    </Placemark>\n"
            + "  </Document>\n"
            + "</kml>\n";
        var collisionKmzBytes = KmzArchive.BuildKmzBytesAsync(
            Encoding.UTF8.GetBytes(collisionKml), albumDir, fileRoot).GetAwaiter().GetResult();
        var collisionKmz = Path.Combine(temporary, "built-collision.kmz");
        File.WriteAllBytes(collisionKmz, collisionKmzBytes);
        var collisionExtractDir = Path.Combine(temporary, "kmz-collision-extract");
        Directory.CreateDirectory(collisionExtractDir);
        KmzArchive.ExtractDocument(collisionKmz, collisionExtractDir);
        Check("KMZ preserves both direct files/photo.png and remapped ../shared/photo.png without collision",
            File.Exists(Path.Combine(collisionExtractDir, "files", "photo.png"))
            && File.ReadAllBytes(Path.Combine(collisionExtractDir, "files", "photo.png")).SequenceEqual(directPhoto)
            && File.Exists(Path.Combine(collisionExtractDir, "files", "photo-2.png"))
            && File.ReadAllBytes(Path.Combine(collisionExtractDir, "files", "photo-2.png")).SequenceEqual(photo2));
    }

    private static void TestAtomicFile(string temporary)
    {
        var folder = Path.Combine(temporary, "atomic");
        Directory.CreateDirectory(folder);
        var target = Path.Combine(folder, "overlay.png");
        using var first = new MemoryStream(Encoding.UTF8.GetBytes("first"));
        AtomicFile.Write(target, first);
        Check("an atomic file is published", File.ReadAllText(target) == "first");

        using var second = new MemoryStream(Encoding.UTF8.GetBytes("second"));
        AtomicFile.Write(target, second);
        Check("an existing atomic file is replaced", File.ReadAllText(target) == "second");
        AtomicFile.WriteText(target, "text");
        Check("the shared text writer publishes UTF-8", File.ReadAllText(target) == "text");
        AtomicFile.WriteBytes(target, new byte[] { 1, 2, 3 });
        Check("the shared byte writer publishes exact bytes",
            File.ReadAllBytes(target).SequenceEqual(new byte[] { 1, 2, 3 }));
        Check("no temporary atomic files are left", Directory.GetFiles(folder, "*.tmp").Length == 0);
    }

    private static void TestAttachmentExport(string temporary)
    {
        var source = Path.Combine(temporary, "attachments", "track.gpx");
        Directory.CreateDirectory(Path.GetDirectoryName(source));
        File.WriteAllText(source, "<gpx/>");
        var folder = AttachmentExport.FolderTarget(source);
        Check("attachment folder sits beside the original track",
            folder == Path.Combine(temporary, "attachments", "track-photos"), folder);

        var closing = new AttachmentExport(source);
        var slotsField = typeof(AttachmentExport).GetField(
            "_downloadSlots", BindingFlags.Instance | BindingFlags.NonPublic);
        var slots = slotsField?.GetValue(closing) as SemaphoreSlim;
        Check("attachment download slots are available to the close-race test", slots != null);
        if (slots != null)
        {
            slots.Wait();
            closing.Dispose();
            try
            {
                slots.Release(); // the in-flight DownloadAsync finally block
                Check("closing an attachment export does not dispose active download slots", true);
            }
            catch (ObjectDisposedException)
            {
                Check("closing an attachment export does not dispose active download slots", false);
            }
            closing.Dispose();
        }

        var canceled = new AttachmentExport(source);
        var canceledSlots = slotsField?.GetValue(canceled) as SemaphoreSlim;
        Check("attachment slots are available for the cancellation test", canceledSlots != null);
        if (canceledSlots != null)
        {
            canceledSlots.Wait();
            canceledSlots.Wait();
            canceledSlots.Wait();
            var pending = canceled.DownloadAsync(
                "job-2\t9\tphoto.jpg\t" + Uri.EscapeDataString("https://images.example/photo.jpg"));
            canceled.Dispose();
            var result = pending.GetAwaiter().GetResult();
            Check("a queued download returns a failure after the host closes",
                !result.Ok && result.Detail == "download canceled", result.Detail);
            canceledSlots.Release();
            canceledSlots.Release();
            canceledSlots.Release();
        }

        using (var export = new AttachmentExport(source))
        {
            const string batch = "job-1";
            export.BeginUpload(batch + "\t0\timage-0\t1\t..%2Fphoto.png");
            export.AppendUpload("image-0\t0\t1\t" + Base64("first"));
            var first = export.CompleteUpload(batch + "\t0\timage-0\t1");
            Check("an uploaded attachment is published", first.Ok && File.Exists(first.Path), first.Detail);
            Check("an attachment cannot escape the photo folder",
                Path.GetDirectoryName(first.Path) == folder && File.ReadAllText(first.Path) == "first",
                first.Path);

            export.BeginUpload(batch + "\t1\timage-1\t1\tphoto.png");
            export.AppendUpload("image-1\t0\t1\t" + Base64("second"));
            var second = export.CompleteUploadAsync(batch + "\t1\timage-1\t1")
                .GetAwaiter().GetResult();
            Check("a duplicate attachment name receives a suffix",
                second.Ok && Path.GetFileName(second.Path) == "photo-2.png", second.Path);

            var embedded = Path.Combine(Path.GetDirectoryName(source), "embedded.png");
            File.WriteAllText(embedded, "embedded");
            var local = export.CopyLocalAsync(batch + "\t2\tembedded.png\tembedded.png")
                .GetAwaiter().GetResult();
            Check("an embedded image is copied directly by the host",
                local.Ok && File.ReadAllText(local.Path) == "embedded", local.Detail);
            var escaped = export.CopyLocal(batch + "\t3\tescape.png\t..%2Fescape.png");
            Check("a direct local copy cannot escape the file root", !escaped.Ok);

            using (var resumed = new AttachmentExport(source))
            {
                var state = resumed.ResumeAsync(batch + "\t0,1,2").GetAwaiter().GetResult();
                Check("resume reads the manifest without rewriting completed images",
                    state.Completed.SequenceEqual(new[] { 0, 1, 2 }), string.Join(",", state.Completed));
                Check("resume returns the original export folder", state.Folder == folder, state.Folder);
            }

            File.Delete(second.Path);
            using (var resumed = new AttachmentExport(source))
            {
                var state = resumed.Resume(batch + "\t0,1,2");
                Check("a deleted exported image is scheduled again",
                    state.Completed.SequenceEqual(new[] { 0, 2 }), string.Join(",", state.Completed));
            }

            var manifest = Path.Combine(folder, ".trailviewer-photo-export.json");
            Check("the resume manifest is hidden",
                File.Exists(manifest)
                && (File.GetAttributes(manifest) & FileAttributes.Hidden) != 0);
            File.AppendAllText(source, " ");
            using (var resumed = new AttachmentExport(source))
            {
                var state = resumed.Resume(batch + "\t0,1,2");
                Check("editing the source track invalidates the old manifest", state.Completed.Length == 0);
            }
        }

        Check("external images require HTTPS",
            AttachmentExport.IsAllowedUri("https://images.example/photo.jpg"));
        Check("HTTP image links are rejected",
            !AttachmentExport.IsAllowedUri("http://images.example/photo.jpg"));
        Check("credential-bearing image links are rejected",
            !AttachmentExport.IsAllowedUri("https://user:secret@images.example/photo.jpg"));
        Check("loopback image links are rejected",
            !AttachmentExport.IsAllowedUri("https://127.0.0.1/photo.jpg")
            && !AttachmentExport.IsAllowedUri("https://localhost/photo.jpg"));
        Check("private-network image links are rejected",
            !AttachmentExport.IsAllowedUri("https://192.168.1.4/photo.jpg")
            && !AttachmentExport.IsAllowedUri("https://[fd00::1]/photo.jpg"));
        Check("multicast and reserved image links are rejected",
            !AttachmentExport.IsAllowedUri("https://224.0.0.1/photo.jpg")
            && !AttachmentExport.IsAllowedUri("https://240.0.0.1/photo.jpg")
            && !AttachmentExport.IsAllowedUri("https://198.18.0.1/photo.jpg")
            && !AttachmentExport.IsAllowedUri("https://192.0.2.1/photo.jpg")
            && !AttachmentExport.IsAllowedUri("https://198.51.100.1/photo.jpg")
            && !AttachmentExport.IsAllowedUri("https://203.0.113.1/photo.jpg")
            && !AttachmentExport.IsAllowedUri("https://[::]/photo.jpg")
            && !AttachmentExport.IsAllowedUri("https://[2001:db8::1]/photo.jpg"));
        Check("a TUN proxy fake address is allowed only after hostname resolution",
            !AttachmentExport.IsAllowedUri("https://198.18.1.1/photo.jpg")
            && !AttachmentExport.IsBlockedResolved(
                System.Net.IPAddress.Parse("198.18.1.1"))
            && AttachmentExport.IsBlockedResolved(
                System.Net.IPAddress.Parse("192.168.1.4")));
        Check("the IPv6 unspecified address is blocked",
            !AttachmentExport.IsAllowedUri("https://[::]/photo.jpg")
            && AttachmentExport.IsBlockedResolved(System.Net.IPAddress.IPv6None));
        using (var fallbackSource = new MemoryStream(new byte[] { 1, 2, 3, 4 }))
        {
            fallbackSource.Position = 3;
            AttachmentExport.PrepareFallbackSource(fallbackSource);
            Check("an attachment stream is rewound before the fallback copy",
                fallbackSource.Position == 0);
        }
        var signatures = new[]
        {
            AttachmentExport.ImageExtensionFor(new byte[] { 0xff, 0xd8, 0xff, 0xe0 }),
            AttachmentExport.ImageExtensionFor(new byte[] { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a }),
            AttachmentExport.ImageExtensionFor(new byte[] { 0x47, 0x49, 0x46, 0x38, 0x39, 0x61 }),
            AttachmentExport.ImageExtensionFor(new byte[] {
                0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50 }),
            AttachmentExport.ImageExtensionFor(new byte[] {
                0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66 }),
        };
        Check("supported image signatures are recognised",
            signatures.SequenceEqual(new[] { ".jpg", ".png", ".gif", ".webp", ".avif" }),
            string.Join(",", signatures));
        Check("a disguised non-image payload is rejected",
            AttachmentExport.ImageExtensionFor(Encoding.UTF8.GetBytes("<html>not an image</html>")) == null);
    }

    private static void TestViewerMessages()
    {
        string routed = null;
        var statsRequested = false;
        var cacheCleared = false;
        var router = new ViewerMessageRouter(new ViewerMessageActions
        {
            BeginAttachment = body => routed = body,
            RequestTileCacheStats = () => statsRequested = true,
            ClearTileCache = () => cacheCleared = true,
        });
        router.Route("attachmentbegin\tjob\theader");
        router.Route("tile-cache\tstats");
        router.Route("tile-cache\tclear");
        Check("the host message router dispatches attachment headers",
            routed == "job\theader", routed);
        Check("the host message router dispatches tile cache stats and clear commands",
            statsRequested && cacheCleared);
        Check("tile cache host messages format byte counts and tile totals",
            ViewerMessages.TileCacheStats(1024, 3) == "tileCacheStats\t1024\t3"
            && ViewerMessages.TileCacheCleared(0, 0) == "tileCacheCleared\t0\t0");
        Check("clipboard failure uses a string WebMessage with an explicit false flag",
            ViewerMessages.ClipboardResult("clip-1", false, "denied")
                == "clipboardResult\tclip-1\t0\tdenied");
        var failed = new AttachmentResult("job-1", 7, false, "/tmp/photo one.jpg", "write failed");
        Check("attachment failure uses the shared WebMessage contract",
            ViewerMessages.AttachmentResult(failed)
                == "attachmentResult\tjob-1\t7\t0\t%2Ftmp%2Fphoto%20one.jpg\twrite%20failed");
        var resumed = new AttachmentResumeResult("job-1", new[] { 1, 3 }, "/tmp/photo one");
        Check("attachment resume uses the shared WebMessage contract",
            ViewerMessages.AttachmentResume(resumed)
                == "attachmentResume\tjob-1\t1,3\t%2Ftmp%2Fphoto%20one");
        Check("attachment resume failures preserve the batch",
            ViewerMessages.AttachmentResumeFailure("job-1") == "attachmentResume\tjob-1\t\t");
        Check("overlay result callbacks avoid script source",
            ViewerMessages.OverlayExported("/tmp/a b.png") == "overlayExported\t%2Ftmp%2Fa%20b.png"
            && ViewerMessages.OverlayFailed("bad 'file'")
                == "overlayFailed\tbad%20%27file%27");
        Check("key and Tianditu callbacks use URL-encoded WebMessages",
            ViewerMessages.PressKey("m") == "pressKey\tm"
            && ViewerMessages.SetTiandituKey("0123abcd") == "setTiandituKey\t0123abcd"
            && ViewerMessages.SetTiandituKey(null) == "setTiandituKey\t");
    }

    private static string Base64(string text) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(text));

    private static string ReadText(Stream stream)
    {
        stream.Position = 0;
        using var reader = new StreamReader(stream, Encoding.UTF8, true, 1024, true);
        return reader.ReadToEnd();
    }

    private static void WriteEntry(ZipArchive archive, string name, string text)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Optimal);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(text);
    }

    private static void WriteEntry(ZipArchive archive, string name, byte[] bytes)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Optimal);
        using var stream = entry.Open();
        stream.Write(bytes, 0, bytes.Length);
    }

    private static void ExpectInvalidData(string what, Action action)
    {
        try
        {
            action();
            Check(what, false, "no exception");
        }
        catch (InvalidDataException)
        {
            Check(what, true);
        }
    }

    private static void Check(string what, bool okay, string detail = null)
    {
        Console.WriteLine($"{(okay ? "PASS" : "FAIL")}  host: {what}{(detail == null ? "" : "  (" + detail + ")")}");
        if (!okay)
            _failures++;
    }

    private static void TestUpdateChecker(string temporary)
    {
        Check("update checker compares semantic versions accurately",
            UpdateChecker.CompareVersions("v1.30.0", "1.29.0") > 0
            && UpdateChecker.CompareVersions("1.29.0", "v1.29.0") == 0
            && UpdateChecker.CompareVersions("1.29.0", "1.29.0-beta.1") > 0
            && UpdateChecker.CompareVersions("1.28.9", "1.29.0") < 0);
        Check("update checker enforces GitHub HTTPS allowlist for assets and release pages",
            UpdateChecker.IsAllowedReleaseAssetUrl("https://github.com/luluuuse/QuickLook.Plugin.TrailViewer/releases/download/v1.30.0/pkg.qlplugin")
            && UpdateChecker.IsAllowedReleaseAssetUrl("https://objects.githubusercontent.com/github-production-release-asset/123")
            && !UpdateChecker.IsAllowedReleaseAssetUrl("http://github.com/a.qlplugin")
            && !UpdateChecker.IsAllowedReleaseAssetUrl("https://evil.example.com/a.qlplugin")
            && UpdateChecker.IsAllowedReleasePageUrl("https://github.com/luluuuse/QuickLook.Plugin.TrailViewer/releases/tag/v1.30.0")
            && !UpdateChecker.IsAllowedReleasePageUrl("https://github.com/other/repo/releases"));

        var sampleJson =
            "{"
            + "\"tag_name\":\"v1.30.0\","
            + "\"draft\":false,"
            + "\"prerelease\":false,"
            + "\"published_at\":\"2026-11-26T08:00:00Z\","
            + "\"html_url\":\"https://github.com/luluuuse/QuickLook.Plugin.TrailViewer/releases/tag/v1.30.0\","
            + "\"body\":\"### 中文\\n- 新增检查更新\\n\\n### English\\n- Added update checker\","
            + "\"assets\":[{\"name\":\"QuickLook.Plugin.TrailViewer-1.30.0.qlplugin\",\"size\":850000,"
            + "\"browser_download_url\":\"https://github.com/luluuuse/QuickLook.Plugin.TrailViewer/releases/download/v1.30.0/QuickLook.Plugin.TrailViewer-1.30.0.qlplugin\"}]"
            + "}";
        var statePath = Path.Combine(temporary, "update-state.json");
        var fetchCount = 0;
        var firstCheck = UpdateChecker.CheckLatestAsync(
            force: false,
            CancellationToken.None,
            statePath: statePath,
            currentVersion: "1.29.0",
            fetcher: _ => { fetchCount++; return System.Threading.Tasks.Task.FromResult(sampleJson); })
            .GetAwaiter().GetResult();
        Check("update checker detects newer release and extracts bilingual notes",
            firstCheck.Status == "available"
            && firstCheck.HasUpdate
            && firstCheck.LatestVersion == "1.30.0"
            && firstCheck.NotesZh.Contains("新增检查更新")
            && firstCheck.NotesEn.Contains("Added update checker")
            && firstCheck.AssetName == "QuickLook.Plugin.TrailViewer-1.30.0.qlplugin");

        var cachedCheck = UpdateChecker.CheckLatestAsync(
            force: false,
            CancellationToken.None,
            statePath: statePath,
            currentVersion: "1.29.0",
            fetcher: _ => { fetchCount++; return System.Threading.Tasks.Task.FromResult(sampleJson); })
            .GetAwaiter().GetResult();
        Check("update checker reuses 24h cache for background checks without refetching",
            fetchCount == 1 && cachedCheck.FromCache && cachedCheck.HasUpdate);

        var ignored = UpdateChecker.IgnoreVersion("1.30.0", statePath, "1.29.0");
        Check("update checker persists ignored version and clears badge flag",
            ignored.Status == "ignored" && !ignored.HasUpdate && ignored.IgnoredVersion == "1.30.0");

        var validPkg = Path.Combine(temporary, "valid.qlplugin");
        using (var archive = ZipFile.Open(validPkg, ZipArchiveMode.Create))
            WriteEntry(archive, "QuickLook.Plugin.Metadata.config", Encoding.UTF8.GetBytes("<Metadata/>"));
        UpdateChecker.VerifyPluginPackage(validPkg);
        Check("update checker accepts valid .qlplugin archive containing metadata config", true);

        var invalidPkg = Path.Combine(temporary, "invalid.qlplugin");
        using (var archive = ZipFile.Open(invalidPkg, ZipArchiveMode.Create))
            WriteEntry(archive, "readme.txt", Encoding.UTF8.GetBytes("nope"));
        ExpectInvalidData("update checker rejects .qlplugin archive missing metadata config", () =>
            UpdateChecker.VerifyPluginPackage(invalidPkg));
    }

    private static string FindRepositoryRoot()
    {
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppDomain.CurrentDomain.BaseDirectory })
        {
            var folder = new DirectoryInfo(start);
            while (folder != null)
            {
                if (Directory.Exists(Path.Combine(folder.FullName, "tests", "fixtures")))
                    return folder.FullName;
                folder = folder.Parent;
            }
        }
        throw new DirectoryNotFoundException("could not locate tests/fixtures");
    }
}
