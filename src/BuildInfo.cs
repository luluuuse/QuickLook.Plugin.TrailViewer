using System;
using System.Linq;
using System.Reflection;

namespace QuickLook.Plugin.TrailViewer
{
    internal static class BuildInfo
    {
        internal static readonly int ViewerProtocolVersion = Metadata("TrailViewerViewerProtocolVersion", 1);
        internal static readonly int PreferencesSchemaVersion = Metadata("TrailViewerPreferencesSchemaVersion", 1);

        private static int Metadata(string name, int fallback)
        {
            var value = typeof(BuildInfo).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
                .FirstOrDefault(attribute => attribute.Key == name)?.Value;
            return int.TryParse(value, out var parsed) && parsed > 0 ? parsed : fallback;
        }
    }
}
