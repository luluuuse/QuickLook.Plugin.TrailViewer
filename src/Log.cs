using System;
using System.IO;
using System.Linq;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// One line per previewed file in %LOCALAPPDATA%\TrailViewer\log.txt, so problems can be
/// diagnosed without a debugger. Rotated at 1 MB; never throws.
/// </summary>
internal static class Log
{
    private const long MaxBytes = 1024 * 1024;
    private static readonly object Gate = new();

    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), PluginIdentity.Name, "log.txt");
    private static readonly string LegacyFilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        PluginIdentity.LegacyName, "log.txt");

    public static void Write(string message)
    {
        try
        {
            lock (Gate)
            {
                MigrateLegacyFile(LegacyFilePath, FilePath);
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
                var info = new FileInfo(FilePath);
                if (info.Exists && info.Length > MaxBytes)
                {
                    File.Copy(FilePath, FilePath + ".old", true);
                    File.Delete(FilePath);
                }
                File.AppendAllText(FilePath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}{Environment.NewLine}");
            }
        }
        catch
        {
            // Logging must never break a preview.
        }
    }

    internal static bool MigrateLegacyFile(string legacyFile, string currentFile)
    {
        try
        {
            if (!File.Exists(legacyFile) || File.Exists(currentFile)) return false;
            Directory.CreateDirectory(Path.GetDirectoryName(currentFile) ?? string.Empty);
            File.Move(legacyFile, currentFile);
            var legacyDirectory = Path.GetDirectoryName(legacyFile);
            if (!string.IsNullOrEmpty(legacyDirectory) && Directory.Exists(legacyDirectory)
                && !Directory.EnumerateFileSystemEntries(legacyDirectory).Any())
                Directory.Delete(legacyDirectory);
            return true;
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
        {
            // Logging itself must never fail because an old log is locked.
            return false;
        }
    }
}
