using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace QuickLook.Plugin.TrailViewer
{
    internal static class ViewerBuildId
    {
        internal static string Compute(string folder, int protocolVersion)
        {
            if (!Directory.Exists(folder)) return "missing";
            try
            {
                using (var hash = SHA256.Create())
                {
                    Append(hash, Encoding.ASCII.GetBytes($"protocol:{protocolVersion}\n"));
                    var files = Directory.GetFiles(folder, "*", SearchOption.AllDirectories)
                        .OrderBy(path => Relative(folder, path), StringComparer.Ordinal)
                        .ToArray();
                    if (files.Length == 0) return "empty";
                    foreach (var file in files)
                    {
                        Append(hash, Encoding.UTF8.GetBytes(Relative(folder, file).Replace('\\', '/')));
                        Append(hash, new byte[] { 0 });
                        using (var stream = File.OpenRead(file))
                        {
                            var buffer = new byte[81920];
                            int read;
                            while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
                                Append(hash, buffer, read);
                        }
                        Append(hash, new byte[] { 0 });
                    }
                    hash.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
                    var hex = BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant();
                    return hex.Substring(0, 12);
                }
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                return "unavailable";
            }
        }

        private static string Relative(string folder, string file)
        {
            var root = Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            return Path.GetFullPath(file).Substring(root.Length);
        }

        private static void Append(HashAlgorithm hash, byte[] bytes, int count = -1)
        {
            hash.TransformBlock(bytes, 0, count < 0 ? bytes.Length : count, null, 0);
        }
    }
}
