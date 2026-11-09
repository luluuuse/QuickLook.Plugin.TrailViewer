using QuickLook.Plugin.TrailViewer;
using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;

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
            TestKmzTraversal(temporary);
            TestKmzLimit(root, temporary);
            TestPreferences(temporary);
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
            var wanted = Path.Combine(folder, Path.GetFileNameWithoutExtension(name) + ".kml");
            Check($"{name} keeps its archive name", extracted == wanted, extracted);
            Check($"{name} contains a KML root", File.ReadAllText(extracted).Contains("<kml"), extracted);
            Check($"{name} leaves no partial file", Directory.GetFiles(folder).Length == 1);
        }

        ExpectInvalidData("an archive without KML is rejected", () =>
            KmzArchive.ExtractDocument(Path.Combine(fixtures, "kmz-no-kml.kmz"), temporary));
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

    private static void TestPreferences(string temporary)
    {
        var path = Path.Combine(temporary, "settings", "viewer-settings.txt");
        Check("preferences start empty", ViewerPreferences.QueryFromFile(path) == "");

        ViewerPreferences.SaveFromQueryToFile(
            "layer=terrain&pins=0&lang=EN&evil=value&exportSize=1%3A1&exportSize=bad"
            + "&layer=satellite&exportInk=white&pins=1&exportScrim=soft&broken&%ZZ=bad",
            path);
        Check("preferences accept only the final valid values",
            ViewerPreferences.QueryFromFile(path)
                == "exportInk=white&exportScrim=soft&exportSize=1%3A1&layer=satellite&pins=1",
            ViewerPreferences.QueryFromFile(path));

        ViewerPreferences.SaveFromQueryToFile("pins=0&lang=zh&unknown=terrain", path);
        Check("a later message merges with the existing values",
            ViewerPreferences.QueryFromFile(path)
                == "exportInk=white&exportScrim=soft&exportSize=1%3A1&lang=zh&layer=satellite&pins=0",
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
        Check("no temporary preference files are left",
            !Directory.GetFiles(Path.GetDirectoryName(path), "*.tmp").Any()
            && !Directory.GetFiles(Path.GetDirectoryName(path), "*.old").Any());
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
