using System;
using System.Linq;
using System.Reflection;

namespace QuickLook.Plugin.TrailViewer
{
    internal static class BuildInfo
    {
        internal static readonly int ViewerProtocolVersion = Metadata("TrailViewerViewerProtocolVersion", 1);
        internal static readonly int PreferencesSchemaVersion = Metadata("TrailViewerPreferencesSchemaVersion", 1);
        internal static readonly string ProductVersion = ReadProductVersion();

        private static string ReadProductVersion()
        {
            var info = typeof(BuildInfo).Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
            if (!string.IsNullOrWhiteSpace(info))
            {
                var plus = info!.IndexOf('+');
                return plus > 0 ? info.Substring(0, plus) : info;
            }
            var v = typeof(BuildInfo).Assembly.GetName().Version;
            return v != null ? $"{v.Major}.{v.Minor}.{Math.Max(0, v.Build)}" : "0.0.0";
        }

        private static int Metadata(string name, int fallback)
        {
            var value = typeof(BuildInfo).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
                .FirstOrDefault(attribute => attribute.Key == name)?.Value;
            return int.TryParse(value, out var parsed) && parsed > 0 ? parsed : fallback;
        }
    }
}
