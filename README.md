# QuickLook.Plugin.TrailViewer

[简体中文](README.zh-CN.md) | English

Preview GPX, KML, KMZ and FIT tracks directly in QuickLook on Windows. Press <kbd>Space</kbd> on a track file
in Explorer to see the route, waypoints, photos and elevation profile without opening a map application.

![Current route summary, split entry, map tools and elevation profile](docs/screenshot-map.png)

## Quick start

1. Download the latest `.qlplugin` from [GitHub Releases](https://github.com/luluuuse/QuickLook.Plugin.TrailViewer/releases/latest).
2. Open the package, install it, and restart QuickLook from the tray.
3. Select a `.gpx`, `.kml`, `.kmz` or `.fit` file in Explorer and press <kbd>Space</kbd>.

Common controls:

| Action | Control |
|---|---|
| Move between waypoints | <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> |
| Fit the complete route | <kbd>C</kbd> |
| Show/hide map markers | <kbd>W</kbd> |
| Change map layer | <kbd>Q</kbd> / <kbd>E</kbd> |
| Hide interface chrome | <kbd>S</kbd> |
| Start/finish measuring | <kbd>M</kbd> |
| Measuring undo / redo | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> |
| Export overlay image | Toolbox → Export overlay |
| Open route weather | Toolbox → Route weather |

## Highlights

- **Track rendering:** GPX tracks, KML LineStrings and `gx:Track`, plus FIT activity/course records, each segment in its own colour, with
  adaptive direction arrows and distance labels.
- **Route intelligence:** moving time, recording gaps, implausible GPS jumps and a grade-aware time estimate
  using Naismith, Langmuir descents and a steep-uphill correction.
- **Per-kilometre splits:** an independent entry below the route summary opens on demand to show elapsed time
  and moving speed for every kilometre, with total/moving-time totals. Selecting a row focuses and highlights
  that part of the route on the map. A one-click details mode adds cumulative time, ascent/descent, average
  heart rate, moving speed and vertical speed.
- **Route networks:** merged networks are detected and rendered as independent routes instead of one trip;
  global speed, split and combined-profile calculations are skipped for faster loading and lower memory use.
- **Waypoints and photos:** route-ordered navigation, yellow pins, photo albums with true source-pixel
  percentages, wheel zoom up to 800% and drag-to-pan, plus a searchable overview with local
  danger/water/camp/exit insight labels. Attachment preview cards use the waypoint list's unblurred translucent
  background, and the full-size photo viewer keeps the map visible around the image.
- **Elevation profile:** gradient-coloured terrain, waypoint dots, scrub readout and a layout that preserves
  the vertical scale across window sizes. Per-point heart rate can be overlaid on its own scale and is off
  by default; a dashed line marks the whole-route average.
- **Manual measurement:** the toolbox supports multi-section point-to-point distance measurement. Right-click
  adds a point while left-drag pans and the wheel zooms; nearby waypoints and recorded track samples snap
  automatically. Section subtotals and the overall distance update on the map.
- **Copy and attachment export:** copy a shareable summary from the track card, copy WGS-84 coordinates for
  the start, end, peak, map centre or any picked point (with nearby marker snapping and elevation notes), and
  export embedded,
  Data URI and HTTPS-linked photos beside the source track.
- **Map focus:** opening the file and selecting a waypoint keep the relevant content inside the region not
  covered by the summary, toolbars, waypoint list or profile.
- **Unified icons:** map controls, task panels, the split entry, the waypoint overview, the photo viewer and
  map data symbols follow one reusable icon specification; per-kilometre data headers remain text-only.
- **Responsive UI:** measured `inline`, `wrapped` and `docked` layouts for narrow windows, bilingual UI and
  persistent map/marker/export preferences.
- **Map sources:** Road keeps the OpenStreetMap HOT base, while Terrain offers CyclOSM, OpenHikingMap and
  OpenTopoMap in a compact source menu. Tianditu road and satellite imagery are available with a user-owned key;
  the Custom category has a dedicated source list and editor for HTTPS tiles, including two-step placeholders and
  512 px addresses. The host persists custom sources across overwrite upgrades. The source panel shows only
  providers from the active map type. The top layer entry shows the active category icon and label, while the
  low-frequency no-map mode uses the Grid icon in the layer title bar.
- **Unified toolbox:** distance measurement, point coordinates, overlay export, attachment photo export and
  route weather share one entry: four tools form a 2×2 quick-launch grid, with route weather in a full-width
  strip below.
  Every tool page uses the same translucent right-hand window, header, back and close behavior, including
  overlay export. Overlay export offers square, portrait and landscape PNG layouts with selectable ink and
  backing with a live preview. The toolbox stays open after export so several styles can be exported in a row;
  each image includes the route name and date. Route networks show total route length and segment count without
  inventing trip endpoints or statistics. Attachment photos can copy embedded files quickly or
  process the complete set with three concurrent external workers. Reopening the same track resumes by skipping
  completed images and retrying only missing or failed items.
- **Unified floating panels:** the toolbox, layer panel and waypoint list share one top position and header
  height, and only one can remain open.
- **Route weather:** opens Windy in your browser with that point's hourly forecast already expanded. Choose
  start, end or peak; each opens at street level, and the peak segment is disabled when the file carries no
  reliable elevation. Windy opens on the cloud layer, and no third-party map is embedded in the preview.

Detailed behaviour, advanced controls and export examples are in [docs/USAGE.md](docs/USAGE.md).

## Compatibility

Supported inputs:

- GPX 1.0 and 1.1
- KML 2.2, including `gx:Track` and `MultiGeometry`
- Zipped `.kmz` archives
- FIT activities and courses with GPS records, compressed timestamps, elevation and course points

FIT previews focus on route data. Recorded heart rate can be overlaid on the profile. Laps, cadence, power,
temperature and workout steps are not shown in the first version.

Files with more than 20,000 recorded points still draw the route and endpoints but stop creating a clickable
marker for every sample. Invalid XML produces an explicit error page with the parser message.
Each input file is limited to 64 MB.

## Privacy

The plugin sends no track data to a server. Opening a file reads that file locally. Online basemaps contact
their tile providers when selected, and custom sources contact the addresses you configure. **No-map mode**
renders the route on a local grid. Route weather sends the selected point to Windy. Preferences are stored in
the user's local application data and are not tied to the versioned WebView cache.

## Troubleshooting

- If the preview still looks like the selected file as XML text, confirm the plugin is installed and enabled.
- If an upgrade does not appear, exit QuickLook from the tray completely and start it again.
- If online tiles are blank, check network access or enable **Grid** (No-map mode).
- Esc closes QuickLook previews; use the preview close button when needed.

More diagnostic details are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and
[docs/TESTING.md](docs/TESTING.md).

## Development

Start with [CONTRIBUTING.md](CONTRIBUTING.md). The main references are:

- [Architecture](docs/ARCHITECTURE.md)
- [Icon system](docs/ICON_SYSTEM.md)
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
