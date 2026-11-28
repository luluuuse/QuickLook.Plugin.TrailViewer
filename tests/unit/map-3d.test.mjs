import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EXAGGERATION,
  EXAGGERATION_LEVELS,
  TERRARIUM_DEM_URL,
  buildRasterSourcesAndLayers,
  buildSkyConfig,
  buildTrackGeoJson,
  computeScaleMetrics,
  expandSubdomains,
  formatCompassHeading,
  leafletZoomToMapLibre,
  mapLibreZoomToLeaflet,
  normalizeExaggeration,
} from '../../viewer/map-3d.js';

test('normalizeExaggeration clamps bounds and handles invalid inputs', () => {
  assert.deepEqual([...EXAGGERATION_LEVELS], [1.0, 1.3, 1.8]);
  assert.equal(DEFAULT_EXAGGERATION, 1.0);
  assert.equal(normalizeExaggeration(undefined), DEFAULT_EXAGGERATION);
  assert.equal(normalizeExaggeration('abc'), DEFAULT_EXAGGERATION);
  assert.equal(normalizeExaggeration(NaN), DEFAULT_EXAGGERATION);
  assert.equal(normalizeExaggeration(0.1), 0.5);
  assert.equal(normalizeExaggeration(9.5), 3.0);
  assert.equal(normalizeExaggeration(1.8), 1.8);
  assert.equal(normalizeExaggeration('1.3'), 1.3);
});

test('expandSubdomains expands Leaflet {s} templates cleanly', () => {
  assert.deepEqual(expandSubdomains('', 'abc'), []);
  assert.deepEqual(
    expandSubdomains('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
    ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
  );
  assert.deepEqual(
    expandSubdomains('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', 'abc'),
    [
      'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
    ],
  );
  const tdt = expandSubdomains('https://t{s}.tianditu.gov.cn/img_w/wmts?TILEMATRIX={z}', '01234567');
  assert.equal(tdt.length, 8);
  assert.equal(tdt[0], 'https://t0.tianditu.gov.cn/img_w/wmts?TILEMATRIX={z}');
  assert.equal(tdt[7], 'https://t7.tianditu.gov.cn/img_w/wmts?TILEMATRIX={z}');
});

test('buildRasterSourcesAndLayers handles Esri ArcGIS, Tianditu dual-layer, overlays and no-map', () => {
  assert.ok(TERRARIUM_DEM_URL.includes('/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'));

  // Esri ArcGIS {z}/{y}/{x}
  const esri = buildRasterSourcesAndLayers({
    key: 'satellite.esri',
    provider: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 19 },
    },
    overlays: [{
      id: 'hiking',
      url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
      options: { maxZoom: 18, opacity: 0.85 },
    }],
  });
  assert.equal(esri.noMap, false);
  assert.deepEqual(esri.sources['tv-base-0'].tiles, [
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  ]);
  assert.equal(esri.sources['tv-overlay-0'].tiles[0], 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png');
  assert.equal(esri.layers.length, 2);

  // Tianditu dual-layer
  const tdt = buildRasterSourcesAndLayers({
    key: 'satellite.tianditu',
    provider: {
      requiresKey: 'tianditu',
      layers: [
        { layer: 'img', options: { maxNativeZoom: 18 } },
        { layer: 'cia', options: { maxNativeZoom: 18 } },
      ],
    },
    directKey: '0123456789abcdef0123456789abcdef',
  });
  assert.equal(tdt.noMap, false);
  assert.equal(Object.keys(tdt.sources).length, 2);
  assert.equal(tdt.sources['tv-base-0'].tiles.length, 8);
  assert.ok(tdt.sources['tv-base-0'].tiles[0].includes('LAYER=img'));
  assert.ok(tdt.sources['tv-base-1'].tiles[0].includes('LAYER=cia'));

  // Custom source (e.g. Google Satellite preset & 512px TMS source)
  const google = buildRasterSourcesAndLayers({
    key: 'custom.google',
    provider: {
      custom: {
        url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        subdomains: '0123',
        tileSize: 256,
        minZoom: 1,
        maxZoom: 20,
        tms: false,
      },
    },
  });
  assert.equal(google.noMap, false);
  assert.equal(google.sources['tv-base-0'].tiles.length, 4);
  assert.equal(google.sources['tv-base-0'].tiles[0], 'https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}');
  assert.equal(google.sources['tv-base-0'].maxzoom, 20);
  assert.equal(google.sources['tv-base-0'].scheme, undefined);

  const tmsCustom = buildRasterSourcesAndLayers({
    key: 'custom.tms512',
    provider: {
      custom: {
        url: 'https://tiles.example.com/{z}/{x}/{y}@2x.png',
        subdomains: '',
        tileSize: 512,
        minZoom: 2,
        maxZoom: 18,
        tms: true,
      },
    },
  });
  assert.equal(tmsCustom.sources['tv-base-0'].tileSize, 512);
  assert.equal(tmsCustom.sources['tv-base-0'].scheme, 'tms');

  // No-map mode
  const none = buildRasterSourcesAndLayers({ key: 'none', noMapBg: '#f1eee5' });
  assert.equal(none.noMap, true);
  assert.equal(none.backgroundColor, '#f1eee5');
  assert.equal(none.layers.length, 0);
});

test('buildTrackGeoJson converts tracks, colored elevation segments, routes, references and waypoints', () => {
  const sampleGpx = {
    tracks: [{
      segments: [[
        { lat: 31.1, lon: 102.9, ele: 3200 },
        { lat: 31.2, lon: 103.0, ele: 3800 },
        { lat: 31.3, lon: 103.1, ele: 4400 },
      ]],
    }],
    routes: [{
      points: [
        { lat: 31.0, lon: 102.8 },
        { lat: 31.05, lon: 102.85 },
      ],
    }],
    waypoints: [
      { lat: 31.2, lon: 103.0, name: '营地' },
      { lat: NaN, lon: 103.0, name: 'invalid' },
    ],
  };

  const single = buildTrackGeoJson(sampleGpx, {
    theme: 'swiss',
    colorMode: 'single',
    trackColorStartIndex: 1,
    referenceTracks: [
      { track: { segments: [[{ lat: 31.0, lon: 102.7 }, { lat: 31.1, lon: 102.8 }]] }, colorIndex: 0 },
    ],
  });
  assert.equal(single.tracks.features.length, 2);
  assert.equal(single.tracks.features[0].properties.color, '#297bb8');
  assert.deepEqual(single.tracks.features[0].geometry.coordinates[0], [102.9, 31.1]);
  assert.equal(single.references.features.length, 1);
  assert.equal(single.waypoints.features.length, 1);
  assert.equal(single.waypoints.features[0].properties.name, '营地');
  assert.equal(single.endpoints.features.length, 2);
  assert.deepEqual(
    single.endpoints.features.map((f) => f.properties.kind).sort(),
    ['end', 'start'],
  );

  const elev = buildTrackGeoJson(sampleGpx, { theme: 'classic', colorMode: 'elevation' });
  assert.ok(elev.tracks.features.length >= 2);
  assert.match(elev.tracks.features[0].properties.color, /^(#|rgb\()/);
});

test('zoom conversion between Leaflet and MapLibre round-trips cleanly', () => {
  assert.equal(leafletZoomToMapLibre(14), 13);
  assert.equal(mapLibreZoomToLeaflet(13), 14);
  assert.equal(leafletZoomToMapLibre(0), 0);
  assert.equal(mapLibreZoomToLeaflet(25), 20);
});

test('computeScaleMetrics produces rounded metric labels and Swiss ratio', () => {
  const m = computeScaleMetrics(10, 100);
  assert.equal(m.label, '1 km');
  assert.equal(m.widthPx, 100);
  assert.ok(m.ratioText.startsWith('1 : '));

  const sub = computeScaleMetrics(2.4, 100);
  assert.equal(sub.label, '200 m');
  assert.ok(sub.widthPx >= 60 && sub.widthPx <= 100);

  const empty = computeScaleMetrics(0, 100);
  assert.equal(empty.label, '');
});

test('formatCompassHeading normalizes bearing into heading, cardinal and needle rotation', () => {
  assert.deepEqual(formatCompassHeading(0), { heading: 0, dir: 'N', needleDeg: -0, isRotated: false });
  assert.deepEqual(formatCompassHeading(45), { heading: 45, dir: 'NE', needleDeg: -45, isRotated: true });
  assert.deepEqual(formatCompassHeading(-90), { heading: 270, dir: 'W', needleDeg: 90, isRotated: true });
  assert.deepEqual(formatCompassHeading(180), { heading: 180, dir: 'S', needleDeg: -180, isRotated: true });
  assert.equal(formatCompassHeading(359.8).isRotated, false);
});

test('buildSkyConfig adapts between daytime basemaps and dark or no-map modes', () => {
  const day = buildSkyConfig({ noMap: false, isDark: false });
  const dark = buildSkyConfig({ noMap: false, isDark: true });
  const noMap = buildSkyConfig({ noMap: true, isDark: false });
  assert.notEqual(day['sky-color'], dark['sky-color']);
  assert.equal(dark['sky-color'], noMap['sky-color']);
});

test('host TileCache whitelists AWS Terrarium DEM and sets CORS header for WebGL fetches', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const tileCacheCs = fs.readFileSync(path.join(root, 'src', 'TileCache.cs'), 'utf8');
  const messagesCs = fs.readFileSync(path.join(root, 'src', 'TrailViewerPanel.Messages.cs'), 'utf8');
  assert.ok(tileCacheCs.includes('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/*'));
  assert.ok(tileCacheCs.includes('/elevation-tiles-prod/terrarium/'));
  assert.ok(messagesCs.includes('CoreWebView2WebResourceContext.All'));
  assert.ok(messagesCs.includes('Access-Control-Allow-Origin: *'));
});
