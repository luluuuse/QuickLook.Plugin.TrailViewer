using QuickLook.Plugin.TrailViewer;
using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;

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
            TestPreferences(temporary);
            TestProductIdentity(temporary);
            TestTianditu(temporary);
            TestViewerBuildId(temporary);
            TestOverlayTransfer();
            TestAtomicFile(temporary);
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
            for (var i = 0; i < 201; i++)
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
        ExpectInvalidData("a KMZ over the 200-image limit is rejected", () =>
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
        Check("unrelated viewer errors are not swallowed",
            !TrailViewerPanel.IsViewerShutdown(new ArgumentException("bad input")));
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
        Check("Tianditu provider IDs are valid map preferences",
            ViewerPreferences.QueryFromFile(path).Contains("layer=satellite.tianditu"),
            ViewerPreferences.QueryFromFile(path));
        Check("no temporary preference files are left",
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
        Check("no temporary atomic files are left", Directory.GetFiles(folder, "*.tmp").Length == 0);
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
