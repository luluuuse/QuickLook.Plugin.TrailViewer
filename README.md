# QuickLook.Plugin.TrailViewer

[简体中文](README.zh-CN.md) | English

Preview GPX, KML and KMZ tracks directly in QuickLook on Windows. Press <kbd>Space</kbd> on a track file
in Explorer to see the route, waypoints, photos and elevation profile without opening a map application.

![A track with the route summary, waypoint overview and elevation profile](docs/screenshot-map.jpg)

## Quick start

1. Download the latest `.qlplugin` from [GitHub Releases](https://github.com/luluuuse/QuickLook.Plugin.TrailViewer/releases/latest).
2. Open the package, install it, and restart QuickLook from the tray.
3. Select a `.gpx`, `.kml` or `.kmz` file in Explorer and press <kbd>Space</kbd>.

Common controls:

| Action | Control |
|---|---|
| Move between waypoints | <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> |
| Fit the complete route | <kbd>C</kbd> |
| Show/hide map markers | <kbd>W</kbd> |
| Change map layer | <kbd>Q</kbd> / <kbd>E</kbd> |
| Hide interface chrome | <kbd>S</kbd> |
| Export overlay image | <kbd>X</kbd> / <kbd>Shift</kbd>+<kbd>X</kbd> |

## Highlights

- **Track rendering:** GPX tracks, KML LineStrings and `gx:Track`, each segment in its own colour, with
  adaptive direction arrows and distance labels.
- **Route intelligence:** moving time, recording gaps, implausible GPS jumps and a grade-aware time estimate
  using Naismith, Langmuir descents and a steep-uphill correction.
- **Waypoints and photos:** route-ordered navigation, yellow pins, photo albums and a searchable overview
  with local danger/water/camp/exit insight labels.
- **Elevation profile:** gradient-coloured terrain, waypoint dots, scrub readout and a layout that preserves
  the vertical scale across window sizes.
- **Map focus:** opening the file and selecting a waypoint keep the relevant content inside the region not
  covered by the summary, toolbars, waypoint list or profile.
- **Responsive UI:** measured `inline`, `wrapped` and `docked` layouts for narrow windows, bilingual UI and
  persistent map/marker/export preferences.
- **Overlay export:** square, portrait and landscape PNG layouts with selectable ink and backing.

Detailed behaviour, advanced controls and export examples are in [docs/USAGE.md](docs/USAGE.md).

## Compatibility

Supported inputs:

- GPX 1.0 and 1.1
- KML 2.2, including `gx:Track` and `MultiGeometry`
- Zipped `.kmz` archives

Files with more than 20,000 recorded points still draw the route and endpoints but stop creating a clickable
marker for every sample. Invalid XML produces an explicit error page with the parser message.

## Privacy

The plugin sends no track data to a server. Opening a file reads that file locally. Online basemaps contact
their tile providers when selected; **No map** renders the route on a local grid. Preferences are stored in
the user's local application data and are not tied to the versioned WebView cache.

## Troubleshooting

- If the preview still looks like the selected file as XML text, confirm the plugin is installed and enabled.
- If an upgrade does not appear, exit QuickLook from the tray completely and start it again.
- If online tiles are blank, check network access or switch to **No map**.
- Esc closes QuickLook previews; use the preview close button when needed.

More diagnostic details are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and
[docs/TESTING.md](docs/TESTING.md).

## Development

Start with [CONTRIBUTING.md](CONTRIBUTING.md). The main references are:

- [Architecture](docs/ARCHITECTURE.md)
- [Development setup](docs/DEVELOPMENT.md)
- [Testing](docs/TESTING.md)
- [Releasing](docs/RELEASING.md)
- [Changelog](CHANGELOG.md)

Typical local gate:

```text
npm ci
npm run check
dotnet build src/QuickLook.Plugin.TrailViewer.csproj -c Release
npm test
```

Product versions follow Semantic Versioning. WebView cache identity is derived from viewer content and is
independent from the release number.

## Credits and license

This project is a fork of
[McBenac/QuickLook.Plugin.GpxViewer](https://github.com/McBenac/QuickLook.Plugin.GpxViewer), licensed under
the MIT License. The upstream copyright notice is preserved verbatim in [LICENSE](LICENSE), alongside the
copyright for changes made in this fork.
