using QuickLook.Common.Helpers;
using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace QuickLook.Plugin.TrailViewer;

/// <summary>
/// Stores the user's Tianditu token for the current Windows account. The token never belongs in the
/// repository, release notes or the viewer URL; the host decrypts it only for the current preview.
/// </summary>
internal static class TiandituKeyStore
{
    private static readonly Regex KeyPattern = new("^[0-9a-fA-F]{32}$", RegexOptions.CultureInvariant);

    internal static string DefaultFilePath => Path.Combine(
        SettingHelper.LocalDataPath, PluginIdentity.Name, "secrets", "tianditu.bin");

    internal static bool IsValid(string key) => KeyPattern.IsMatch((key ?? string.Empty).Trim());

    internal static string Load(string path = null)
    {
        return LoadFromFile(path ?? DefaultFilePath);
    }

    internal static bool HasKey(string path = null) => !string.IsNullOrEmpty(Load(path));

    internal static bool Save(string key, string path = null)
    {
        key = (key ?? string.Empty).Trim();
        if (!IsValid(key)) return false;

        var target = path ?? DefaultFilePath;
        string temporary = null;
        try
        {
            var directory = Path.GetDirectoryName(target);
            if (string.IsNullOrEmpty(directory)) return false;
            Directory.CreateDirectory(directory);
            var plain = Encoding.UTF8.GetBytes(key);
            var encrypted = ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser);
            Array.Clear(plain, 0, plain.Length);

            temporary = target + "." + Guid.NewGuid().ToString("n") + ".tmp";
            File.WriteAllBytes(temporary, encrypted);
            if (File.Exists(target))
            {
                var backup = target + ".old";
                File.Replace(temporary, target, backup, true);
                File.Delete(backup);
            }
            else
            {
                File.Move(temporary, target);
            }
            temporary = null;
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or CryptographicException)
        {
            return false;
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

    internal static bool Delete(string path = null)
    {
        try
        {
            var target = path ?? DefaultFilePath;
            if (File.Exists(target)) File.Delete(target);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    internal static string LoadFromFile(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            var encrypted = File.ReadAllBytes(path);
            var plain = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
            try
            {
                var key = Encoding.UTF8.GetString(plain).Trim();
                return IsValid(key) ? key : null;
            }
            finally
            {
                Array.Clear(plain, 0, plain.Length);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or CryptographicException)
        {
            return null;
        }
    }
}
