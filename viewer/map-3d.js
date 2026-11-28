import { distanceMeters } from './geo.js';
import { formatScaleDenominator, roundScaleDenominator } from './swiss-scale.js';
import { computeColorSegments, normalizeTrackColorMode } from './track-color.js';
import { resolveTrackEndpoints, trackColorForIndex } from './track-layer.js';

export const TERRARIUM_DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const EXAGGERATION_LEVELS = Object.freeze([1.0, 1.3, 1.8]);
export const DEFAULT_EXAGGERATION = 1.0;
export const DEFAULT_PITCH = 58;
export const DEFAULT_BEARING = 0;
export const ROTATE_BEARING_SENSITIVITY = 0.22;
export const ROTATE_PITCH_SENSITIVITY = 0.18;

const MIN_EXAGGERATION = 0.5;
const MAX_EXAGGERATION = 3.0;
const EMPTY_FC = Object.freeze({ type: 'FeatureCollection', features: [] });

let maplibreLoadPromise = null;

/** Clamp and normalize terrain exaggeration into a safe numeric range. */
export function normalizeExaggeration(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_EXAGGERATION;
  return Math.round(Math.min(MAX_EXAGGERATION, Math.max(MIN_EXAGGERATION, num)) * 100) / 100;
}

/** Expand Leaflet-style `{s}` subdomain placeholders into concrete tile URLs for MapLibre. */
export function expandSubdomains(url, subdomains) {
  if (!url || typeof url !== 'string') return [];
  if (!url.includes('{s}')) return [url];
  const chars = typeof subdomains === 'string' && subdomains.length > 0
    ? [...subdomains]
    : Array.isArray(subdomains) && subdomains.length > 0
      ? subdomains.map(String)
      : ['a', 'b', 'c'];
  return chars.map((sub) => url.replace(/\{s\}/g, sub));
}

function tiandituWmtsUrl(layer, key) {
  return `https://t{s}.tianditu.gov.cn/${layer}_w/wmts`
    + '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
    + `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles`
    + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
    + `&tk=${encodeURIComponent(key)}`;
}

/**
 * Convert the active 2D layer specification into MapLibre raster sources and layers.
 * Supports single-layer XYZ/ArcGIS, Tianditu dual-layer WMTS, custom sources, overlays, and no-map mode.
 */
export function buildRasterSourcesAndLayers(layerSpec) {
  const sources = {};
  const layers = [];
  const key = layerSpec?.key || 'none';
  const provider = layerSpec?.provider || null;
  const directKey = layerSpec?.directKey || '';
  const overlays = Array.isArray(layerSpec?.overlays) ? layerSpec.overlays : [];
  const noMap = key === 'none' || !provider;
  const backgroundColor = (layerSpec?.noMapBg || '').trim() || '#181a1f';

  if (!noMap) {
    if (provider.custom?.url) {
      const custom = provider.custom;
      const sourceId = 'tv-base-0';
      const tileSize = Number(custom.tileSize) === 512 ? 512 : 256;
      const maxzoom = Number.isFinite(Number(custom.maxZoom)) ? Number(custom.maxZoom) : 19;
      const minzoom = Number.isFinite(Number(custom.minZoom)) ? Math.max(0, Number(custom.minZoom)) : 0;
      sources[sourceId] = {
        type: 'raster',
        tiles: expandSubdomains(custom.url, custom.subdomains),
        tileSize,
        minzoom,
        maxzoom,
        ...(custom.tms === true ? { scheme: 'tms' } : {}),
      };
      layers.push({
        id: sourceId,
        type: 'raster',
        source: sourceId,
      });
    } else if (provider.requiresKey === 'tianditu' && directKey && Array.isArray(provider.layers)) {
      provider.layers.forEach((item, index) => {
        const sourceId = `tv-base-${index}`;
        const maxzoom = item.options?.maxNativeZoom || item.options?.maxZoom || 18;
        sources[sourceId] = {
          type: 'raster',
          tiles: expandSubdomains(tiandituWmtsUrl(item.layer, directKey), '01234567'),
          tileSize: 256,
          maxzoom,
        };
        layers.push({
          id: sourceId,
          type: 'raster',
          source: sourceId,
        });
      });
    } else if (provider.url) {
      const sourceId = 'tv-base-0';
      const maxzoom = provider.options?.maxNativeZoom || provider.options?.maxZoom || 18;
      sources[sourceId] = {
        type: 'raster',
        tiles: expandSubdomains(provider.url, provider.options?.subdomains),
        tileSize: 256,
        maxzoom,
      };
      layers.push({
        id: sourceId,
        type: 'raster',
        source: sourceId,
      });
    }
  }

  overlays.forEach((overlay, index) => {
    if (!overlay?.url) return;
    const sourceId = `tv-overlay-${index}`;
    const maxzoom = overlay.options?.maxNativeZoom || overlay.options?.maxZoom || 18;
    const opacity = Number.isFinite(overlay.options?.opacity) ? overlay.options.opacity : 0.85;
    sources[sourceId] = {
      type: 'raster',
      tiles: expandSubdomains(overlay.url, overlay.options?.subdomains),
      tileSize: 256,
      maxzoom,
    };
    layers.push({
      id: sourceId,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': opacity,
      },
    });
  });

  return {
    sources,
    layers,
    noMap: noMap || Object.keys(sources).length === 0,
    backgroundColor,
  };
}

function segmentPoints(segment) {
  return Array.isArray(segment) ? segment : (segment?.points || []);
}

function toCoordinates(points) {
  const coords = [];
  for (const pt of points || []) {
    if (!pt || !Number.isFinite(pt.lon) || !Number.isFinite(pt.lat)) continue;
    coords.push([pt.lon, pt.lat]);
  }
  return coords;
}

/**
 * Convert parsed GPX/KML/FIT track data into GeoJSON FeatureCollections for 3D rendering.
 */
export function buildTrackGeoJson(gpx, {
  theme = '',
  colorMode = 'single',
  trackColorStartIndex = 0,
  referenceTracks = [],
} = {}) {
  const normalizedMode = normalizeTrackColorMode(colorMode);
  const startIndex = Number.isInteger(trackColorStartIndex) ? trackColorStartIndex : 0;
  const trackFeatures = [];
  const referenceFeatures = [];
  const waypointFeatures = [];
  const endpointFeatures = [];

  const tracks = Array.isArray(gpx?.tracks) ? gpx.tracks : [];
  const trackGroups = [];
  tracks.forEach((track, trackIndex) => {
    const baseColor = trackColorForIndex(startIndex + trackIndex, theme);
    const segments = Array.isArray(track?.segments) ? track.segments : [];
    const groupSegs = [];
    for (const segment of segments) {
      const points = segmentPoints(segment);
      if (points.length < 2) continue;
      groupSegs.push({ points });

      if (normalizedMode !== 'single') {
        const colored = computeColorSegments(points, normalizedMode)?.segments || [];
        if (colored.length > 0) {
          for (const run of colored) {
            const coords = toCoordinates(run.points);
            if (coords.length < 2) continue;
            trackFeatures.push({
              type: 'Feature',
              properties: { color: run.color },
              geometry: { type: 'LineString', coordinates: coords },
            });
          }
          continue;
        }
      }

      const coords = toCoordinates(points);
      if (coords.length < 2) continue;
      trackFeatures.push({
        type: 'Feature',
        properties: { color: baseColor },
        geometry: { type: 'LineString', coordinates: coords },
      });
    }
    if (groupSegs.length > 0) trackGroups.push({ segments: groupSegs });
  });

  if (!gpx?.network && trackGroups.length > 0 && trackGroups.length <= 20) {
    const resolved = resolveTrackEndpoints(trackGroups);
    for (const ep of resolved) {
      if (ep.last && ep.showEnd && Number.isFinite(ep.last.lon) && Number.isFinite(ep.last.lat)) {
        endpointFeatures.push({
          type: 'Feature',
          properties: {
            kind: 'end',
            ele: Number.isFinite(ep.last.ele) ? ep.last.ele : null,
            timeMs: ep.last.time instanceof Date ? ep.last.time.getTime() : null,
          },
          geometry: { type: 'Point', coordinates: [ep.last.lon, ep.last.lat] },
        });
      }
      if (ep.first && ep.showStart && Number.isFinite(ep.first.lon) && Number.isFinite(ep.first.lat)) {
        endpointFeatures.push({
          type: 'Feature',
          properties: {
            kind: 'start',
            ele: Number.isFinite(ep.first.ele) ? ep.first.ele : null,
            timeMs: ep.first.time instanceof Date ? ep.first.time.getTime() : null,
          },
          geometry: { type: 'Point', coordinates: [ep.first.lon, ep.first.lat] },
        });
      }
    }
  }

  const routes = Array.isArray(gpx?.routes) ? gpx.routes : [];
  routes.forEach((route, routeIndex) => {
    const coords = toCoordinates(route?.points || []);
    if (coords.length < 2) return;
    trackFeatures.push({
      type: 'Feature',
      properties: { color: trackColorForIndex(tracks.length + routeIndex, theme) },
      geometry: { type: 'LineString', coordinates: coords },
    });
  });

  for (const refEntry of referenceTracks || []) {
    const refTrack = refEntry?.track || refEntry;
    const segments = Array.isArray(refTrack?.segments) ? refTrack.segments : [];
    for (const segment of segments) {
      const coords = toCoordinates(segmentPoints(segment));
      if (coords.length < 2) continue;
      referenceFeatures.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      });
    }
  }

  (gpx?.waypoints || []).forEach((wpt, index) => {
    if (!wpt || !Number.isFinite(wpt.lon) || !Number.isFinite(wpt.lat)) return;
    waypointFeatures.push({
      type: 'Feature',
      properties: {
        index,
        name: wpt.name || '',
        hasPhoto: Array.isArray(wpt.images) && wpt.images.length > 0,
      },
      geometry: {
        type: 'Point',
        coordinates: [wpt.lon, wpt.lat],
      },
    });
  });

  return {
    tracks: { type: 'FeatureCollection', features: trackFeatures },
    references: { type: 'FeatureCollection', features: referenceFeatures },
    waypoints: { type: 'FeatureCollection', features: waypointFeatures },
    endpoints: { type: 'FeatureCollection', features: endpointFeatures },
  };
}

/** Check whether WebGL2 is available in the current browser environment. */
export function isWebGL2Supported() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}

function ensureMapLibreCss() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-maplibre-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'vendor/maplibre/maplibre-gl.css';
  link.dataset.maplibreCss = '1';
  document.head.appendChild(link);
}

/** Lazily load local MapLibre GL JS and CSS on first 3D activation. Resets cache on failure. */
export function loadMapLibre() {
  const win = /** @type {any} */ (typeof window !== 'undefined' ? window : null);
  if (win?.maplibregl) {
    ensureMapLibreCss();
    return Promise.resolve(win.maplibregl);
  }
  if (!maplibreLoadPromise) {
    maplibreLoadPromise = new Promise((resolve, reject) => {
      ensureMapLibreCss();
      const existing = document.querySelector('script[data-maplibre-js]');
      if (existing) existing.remove();
      const script = document.createElement('script');
      script.src = 'vendor/maplibre/maplibre-gl.js';
      script.async = true;
      script.dataset.maplibreJs = '1';
      script.onload = () => {
        const loaded = /** @type {any} */ (window).maplibregl;
        if (loaded) resolve(loaded);
        else {
          maplibreLoadPromise = null;
          reject(new Error('MapLibre GL JS loaded without window.maplibregl'));
        }
      };
      script.onerror = () => {
        script.remove();
        maplibreLoadPromise = null;
        reject(new Error('Failed to load local MapLibre GL JS'));
      };
      document.head.appendChild(script);
    });
  }
  return maplibreLoadPromise;
}

function readCssVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

/** Leaflet uses 256px world tiles while MapLibre uses 512px world scale (offset by 1 zoom level). */
export function leafletZoomToMapLibre(zoom) {
  const z = Number(zoom);
  const safe = Number.isFinite(z) ? z : 2;
  return Math.max(0, Math.min(20, safe - 1));
}

export function mapLibreZoomToLeaflet(zoom) {
  const z = Number(zoom);
  const safe = Number.isFinite(z) ? z : 1;
  return Math.max(1, Math.min(20, safe + 1));
}

const CSS_METERS_PER_PIXEL = 0.0254 / 96;
const CARDINAL_DIRS = Object.freeze(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);

/** Normalize MapLibre bearing into heading degrees (0..359), cardinal code, needle angle and rotation flag. */
export function formatCompassHeading(bearing) {
  const raw = Number(bearing);
  const safe = Number.isFinite(raw) ? raw : 0;
  const heading = ((Math.round(safe) % 360) + 360) % 360;
  const dir = CARDINAL_DIRS[Math.round(heading / 45) % 8];
  const normalizedSigned = ((safe + 180) % 360 + 360) % 360 - 180;
  return {
    heading,
    dir,
    needleDeg: -safe,
    isRotated: Math.abs(normalizedSigned) >= 0.5,
  };
}

/** Compute a rounded metric scale bar width, label and Swiss-style 1 : N ratio for a ground resolution. */
export function computeScaleMetrics(metersPerPixel, maxWidthPx = 100) {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return { widthPx: 0, label: '', ratioText: '' };
  }
  const maxMeters = metersPerPixel * Math.max(40, maxWidthPx);
  const pow10 = 10 ** Math.floor(Math.log10(maxMeters));
  const d = maxMeters / pow10;
  const rounded = d >= 5 ? 5 * pow10 : d >= 2 ? 2 * pow10 : pow10;
  const widthPx = Math.max(24, Math.round(rounded / metersPerPixel));
  const label = rounded >= 1000 ? `${rounded / 1000} km` : `${rounded} m`;
  const ratioText = formatScaleDenominator(roundScaleDenominator(metersPerPixel / CSS_METERS_PER_PIXEL));
  return { widthPx, label, ratioText };
}

function createPinImageData({ withPhoto = false, fillColor = '#297bb8', strokeColor = '#1b1b1b' } = {}) {
  if (typeof document === 'undefined') return null;
  const width = 56;
  const height = 62;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.save();
  ctx.scale(2, 2);
  // Subtle drop shadow for depth over 3D terrain.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1.5;

  // Slender diamond survey pin anchored at bottom center (14, 29).
  ctx.beginPath();
  ctx.moveTo(14, 29);
  ctx.lineTo(5.5, 14.5);
  ctx.lineTo(14, 3.5);
  ctx.lineTo(22.5, 14.5);
  ctx.closePath();
  ctx.fillStyle = withPhoto ? '#e5243b' : fillColor;
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = withPhoto ? '#ffffff' : strokeColor;
  ctx.stroke();

  // Inner survey dot contrasts against both light and dark theme pin fills.
  ctx.beginPath();
  ctx.arc(14, 14, 3, 0, Math.PI * 2);
  ctx.fillStyle = withPhoto ? '#ffffff' : strokeColor;
  ctx.fill();

  if (withPhoto) {
    // Crisp camera badge in top-right corner matching 2D photo pins.
    ctx.beginPath();
    ctx.arc(21.5, 7.5, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#1b1b1b';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Camera body + lens.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(18.5, 6, 6, 3.8);
    ctx.fillRect(20.3, 4.9, 2.4, 1.3);
    ctx.beginPath();
    ctx.arc(21.5, 7.9, 1.25, 0, Math.PI * 2);
    ctx.fillStyle = '#1b1b1b';
    ctx.fill();
  }
  ctx.restore();

  return ctx.getImageData(0, 0, width, height);
}

function registerPinIcons(mapInstance) {
  if (!mapInstance || typeof mapInstance.addImage !== 'function') return;
  const fillColor = readCssVar('--pin-fill', '#297bb8');
  const strokeColor = readCssVar('--pin-stroke', '#1b1b1b');
  const plain = createPinImageData({ withPhoto: false, fillColor, strokeColor });
  const photo = createPinImageData({ withPhoto: true, fillColor, strokeColor });
  if (plain) {
    if (mapInstance.hasImage?.('tv-pin')) mapInstance.removeImage('tv-pin');
    mapInstance.addImage('tv-pin', plain, { pixelRatio: 2 });
  }
  if (photo) {
    if (mapInstance.hasImage?.('tv-pin-photo')) mapInstance.removeImage('tv-pin-photo');
    mapInstance.addImage('tv-pin-photo', photo, { pixelRatio: 2 });
  }
}

/** Build sky & atmospheric fog colors adapted for daytime vs dark/no-map themes. */
export function buildSkyConfig({ noMap = false, isDark = false } = {}) {
  if (noMap || isDark) {
    return {
      'sky-color': '#111824',
      'sky-horizon-blend': 0.3,
      'horizon-color': '#1d2838',
      'horizon-fog-blend': 0.35,
      'fog-color': '#161e2b',
      'fog-ground-blend': 0.2,
    };
  }
  return {
    'sky-color': '#88b7e6',
    'sky-horizon-blend': 0.35,
    'horizon-color': '#dbe9f6',
    'horizon-fog-blend': 0.4,
    'fog-color': '#e8eff5',
    'fog-ground-blend': 0.25,
  };
}

function buildStyle({ layerSpec, geojson, exaggeration, waypointsVisible, casingColor, isClassicTheme }) {
  const raster = buildRasterSourcesAndLayers(layerSpec);
  const sources = {
    'terrain-dem': {
      type: 'raster-dem',
      tiles: [TERRARIUM_DEM_URL],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
    },
    'hillshade-dem': {
      type: 'raster-dem',
      tiles: [TERRARIUM_DEM_URL],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
    },
    ...raster.sources,
    'tv-ref-tracks': { type: 'geojson', data: geojson.references },
    'tv-tracks': { type: 'geojson', data: geojson.tracks },
    'tv-endpoints': { type: 'geojson', data: geojson.endpoints },
    'tv-waypoints': { type: 'geojson', data: geojson.waypoints },
    'tv-highlight': { type: 'geojson', data: EMPTY_FC },
  };

  const layers = [
    {
      id: 'tv-bg',
      type: 'background',
      paint: {
        'background-color': raster.backgroundColor,
      },
    },
    ...raster.layers,
    {
      id: 'tv-hillshade',
      type: 'hillshade',
      source: 'hillshade-dem',
      paint: {
        'hillshade-exaggeration': raster.noMap ? 0.55 : 0.24,
        'hillshade-shadow-color': raster.noMap ? '#000000' : '#1b2430',
        'hillshade-highlight-color': '#ffffff',
        'hillshade-accent-color': '#2b3a4a',
      },
    },
    {
      id: 'tv-ref-line',
      type: 'line',
      source: 'tv-ref-tracks',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#94a3b8',
        'line-width': 2.5,
        'line-opacity': 0.55,
      },
    },
    {
      id: 'tv-track-casing',
      type: 'line',
      source: 'tv-tracks',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
        visibility: isClassicTheme ? 'none' : 'visible',
      },
      paint: {
        'line-color': casingColor,
        'line-width': 6.5,
        'line-opacity': 0.9,
      },
    },
    {
      id: 'tv-track-line',
      type: 'line',
      source: 'tv-tracks',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#df2b1d'],
        'line-width': 4,
        'line-opacity': 0.96,
      },
    },
    {
      id: 'tv-endpoints-end',
      type: 'circle',
      source: 'tv-endpoints',
      filter: ['==', ['get', 'kind'], 'end'],
      paint: {
        'circle-radius': 7.5,
        'circle-color': '#df2b1d',
        'circle-stroke-color': '#18212b',
        'circle-stroke-width': 1.8,
      },
    },
    {
      id: 'tv-endpoints-start',
      type: 'circle',
      source: 'tv-endpoints',
      filter: ['==', ['get', 'kind'], 'start'],
      paint: {
        'circle-radius': 5.5,
        'circle-color': '#249e58',
        'circle-stroke-color': '#18212b',
        'circle-stroke-width': 1.8,
      },
    },
    {
      id: 'tv-waypoints-plain',
      type: 'symbol',
      source: 'tv-waypoints',
      filter: ['!', ['boolean', ['get', 'hasPhoto'], false]],
      layout: {
        visibility: waypointsVisible ? 'visible' : 'none',
        'icon-image': 'tv-pin',
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      id: 'tv-waypoints-photo',
      type: 'symbol',
      source: 'tv-waypoints',
      filter: ['boolean', ['get', 'hasPhoto'], false],
      layout: {
        visibility: waypointsVisible ? 'visible' : 'none',
        'icon-image': 'tv-pin-photo',
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      id: 'tv-waypoints-hit',
      type: 'circle',
      source: 'tv-waypoints',
      layout: {
        visibility: waypointsVisible ? 'visible' : 'none',
      },
      paint: {
        'circle-radius': 16,
        'circle-color': '#000000',
        'circle-opacity': 0,
      },
    },
    {
      id: 'tv-highlight-circle',
      type: 'circle',
      source: 'tv-highlight',
      paint: {
        'circle-radius': 7,
        'circle-color': '#e5243b',
        'circle-stroke-color': '#1b1b1b',
        'circle-stroke-width': 2,
      },
    },
  ];

  return {
    version: 8,
    sources,
    layers,
    terrain: {
      source: 'terrain-dem',
      exaggeration,
    },
    sky: buildSkyConfig({ noMap: raster.noMap, isDark: Boolean(layerSpec?.isDark) }),
  };
}

/**
 * Create a lazy-loaded 3D terrain map controller backed by MapLibre GL JS + AWS Terrarium DEM.
 */
export function createMap3D() {
  let map = null;
  let maplibreLib = null;
  let activePopup = null;
  let interactionAbort = null;
  let hostContainer = null;
  let currentExaggeration = DEFAULT_EXAGGERATION;
  let currentRasterIds = [];
  let mounted = false;
  let styleReady = false;
  let pendingActions = [];

  function runWhenReady(fn) {
    if (!map) return;
    if (styleReady) {
      fn();
    } else {
      pendingActions.push(fn);
    }
  }

  function flushPending() {
    if (!map) return;
    styleReady = true;
    const queue = pendingActions;
    pendingActions = [];
    for (const fn of queue) {
      try { fn(); } catch {}
    }
  }

  function prefersReducedMotion() {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async function mount(container, {
    center,
    zoom,
    pitch = DEFAULT_PITCH,
    bearing = DEFAULT_BEARING,
    gpx,
    layerSpec,
    theme = '',
    colorMode = 'single',
    trackColorStartIndex = 0,
    referenceTracks = [],
    exaggeration = currentExaggeration,
    waypointsVisible = true,
    onWaypointClick = null,
    onScaleChange = null,
    onCompassChange = null,
  }) {
    if (!isWebGL2Supported()) {
      const err = new Error('WebGL2 is not available');
      err.name = 'WebGLUnsupportedError';
      throw err;
    }

    const maplibregl = await loadMapLibre();
    if (map) destroy();
    maplibreLib = maplibregl;

    hostContainer = container;
    hostContainer.textContent = '';
    currentExaggeration = normalizeExaggeration(exaggeration);

    const geojson = buildTrackGeoJson(gpx, {
      theme, colorMode, trackColorStartIndex, referenceTracks,
    });
    const casingColor = readCssVar('--track-casing', '#ffffff');
    const isClassicTheme = theme === 'classic';
    const style = buildStyle({
      layerSpec,
      geojson,
      exaggeration: currentExaggeration,
      waypointsVisible,
      casingColor,
      isClassicTheme,
    });
    currentRasterIds = Object.keys(style.sources)
      .filter((id) => id.startsWith('tv-base-') || id.startsWith('tv-overlay-'));

    const lng = Number(center?.lng ?? center?.[1] ?? 0);
    const lat = Number(center?.lat ?? center?.[0] ?? 20);
    const mlZoom = leafletZoomToMapLibre(zoom);

    styleReady = false;
    pendingActions = [];

    map = new maplibregl.Map({
      container: hostContainer,
      style,
      center: [lng, lat],
      zoom: mlZoom,
      pitch: 0,
      bearing: 0,
      maxPitch: 82,
      attributionControl: false,
      antialias: true,
      dragRotate: false,
      pitchWithRotate: false,
    });

    // Calibrated right-drag (and Ctrl/Meta+left-drag) rotation & pitch for steady 3D control.
    const canvas = map.getCanvas();
    interactionAbort = new AbortController();
    const { signal } = interactionAbort;
    let rotating = false;
    let activePointerId = null;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    }, { signal });

    canvas.addEventListener('pointerdown', (event) => {
      const isRight = event.button === 2;
      const isModLeft = event.button === 0 && (event.ctrlKey || event.metaKey);
      if (!isRight && !isModLeft) return;
      event.preventDefault();
      event.stopPropagation();
      rotating = true;
      activePointerId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      try { canvas.setPointerCapture(event.pointerId); } catch {}
      canvas.style.cursor = 'grabbing';
    }, { signal });

    canvas.addEventListener('pointermove', (event) => {
      if (!rotating || event.pointerId !== activePointerId || !map) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      const nextBearing = map.getBearing() + dx * ROTATE_BEARING_SENSITIVITY;
      const nextPitch = Math.max(0, Math.min(82, map.getPitch() - dy * ROTATE_PITCH_SENSITIVITY));
      map.jumpTo({ bearing: nextBearing, pitch: nextPitch });
    }, { signal });

    const stopRotate = (event) => {
      if (!rotating || (event && event.pointerId !== activePointerId)) return;
      rotating = false;
      try { canvas.releasePointerCapture(activePointerId); } catch {}
      activePointerId = null;
      canvas.style.cursor = '';
    };
    canvas.addEventListener('pointerup', stopRotate, { signal });
    canvas.addEventListener('pointercancel', stopRotate, { signal });

    // Suppress transient tile/DEM network errors so offline or slow regions degrade gracefully.
    map.on('error', () => {});

    const interactiveLayers = [
      'tv-waypoints-photo', 'tv-waypoints-plain', 'tv-waypoints-hit',
      'tv-endpoints-start', 'tv-endpoints-end',
    ];
    for (const layerId of interactiveLayers) {
      map.on('mouseenter', layerId, () => {
        if (!rotating) canvas.style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => {
        if (!rotating) canvas.style.cursor = '';
      });
    }

    map.on('click', (event) => {
      const photoHits = map?.queryRenderedFeatures?.(event.point, { layers: ['tv-waypoints-photo'] }) || [];
      const wptHits = photoHits.length > 0
        ? photoHits
        : (map?.queryRenderedFeatures?.(event.point, { layers: ['tv-waypoints-plain', 'tv-waypoints-hit'] }) || []);
      if (wptHits.length > 0) {
        const feature = wptHits[0];
        const index = Number(feature.properties?.index);
        const coords = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
        onWaypointClick?.({
          index,
          lon: coords?.[0],
          lat: coords?.[1],
          name: feature.properties?.name || '',
        });
        return;
      }
      const epHits = map?.queryRenderedFeatures?.(event.point, { layers: ['tv-endpoints-start', 'tv-endpoints-end'] }) || [];
      if (epHits.length > 0) {
        const feature = epHits[0];
        const coords = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
        const ele = feature.properties?.ele;
        const timeMs = feature.properties?.timeMs;
        onWaypointClick?.({
          kind: feature.properties?.kind || 'start',
          lon: coords?.[0],
          lat: coords?.[1],
          ele: Number.isFinite(Number(ele)) && ele !== null ? Number(ele) : undefined,
          time: Number.isFinite(Number(timeMs)) && timeMs !== null ? new Date(Number(timeMs)) : undefined,
        });
        return;
      }
      closePopup();
    });

    let scaleFrame = 0;
    const emitScale = () => {
      scaleFrame = 0;
      if (!map || !onScaleChange) return;
      const w = hostContainer?.clientWidth || 0;
      const h = hostContainer?.clientHeight || 0;
      let metersPerPx = 0;
      if (w >= 200 && h >= 100) {
        try {
          const p1 = map.unproject([w / 2, h / 2]);
          const p2 = map.unproject([w / 2 + 100, h / 2]);
          if (p1 && p2) {
            metersPerPx = distanceMeters({ lat: p1.lat, lon: p1.lng }, { lat: p2.lat, lon: p2.lng }) / 100;
          }
        } catch {}
      }
      if (!Number.isFinite(metersPerPx) || metersPerPx <= 0) {
        const c = map.getCenter();
        const leafZoom = mapLibreZoomToLeaflet(map.getZoom());
        const lat = Math.max(-85, Math.min(85, c?.lat ?? 0));
        metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / (2 ** leafZoom);
      }
      onScaleChange(computeScaleMetrics(metersPerPx));
    };
    const scheduleScale = () => {
      if (!onScaleChange || scaleFrame) return;
      scaleFrame = requestAnimationFrame(emitScale);
    };
    if (onScaleChange) {
      map.on('move', scheduleScale);
      map.on('resize', scheduleScale);
      signal.addEventListener('abort', () => {
        if (scaleFrame) cancelAnimationFrame(scaleFrame);
        scaleFrame = 0;
      });
    }

    const emitCompass = () => {
      if (!map || !onCompassChange) return;
      onCompassChange(formatCompassHeading(map.getBearing()));
    };
    if (onCompassChange) {
      map.on('rotate', emitCompass);
      map.on('move', emitCompass);
    }

    map.once('load', () => {
      registerPinIcons(map);
      flushPending();
      emitScale();
      emitCompass();
      if (!map) return;
      map.easeTo({
        pitch,
        bearing,
        duration: prefersReducedMotion() ? 0 : 520,
      });
    });

    mounted = true;
  }

  function getCamera() {
    if (!map) return null;
    const c = map.getCenter();
    return {
      center: { lat: c.lat, lng: c.lng },
      zoom: mapLibreZoomToLeaflet(map.getZoom()),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    };
  }

  function setExaggeration(value) {
    currentExaggeration = normalizeExaggeration(value);
    runWhenReady(() => {
      if (!map) return;
      map.setTerrain({ source: 'terrain-dem', exaggeration: currentExaggeration });
    });
    return currentExaggeration;
  }

  function resetNorth() {
    if (!map) return;
    map.easeTo({
      bearing: DEFAULT_BEARING,
      pitch: DEFAULT_PITCH,
      duration: prefersReducedMotion() ? 0 : 420,
    });
  }

  function zoomIn() {
    if (!map) return;
    map.zoomIn({ duration: prefersReducedMotion() ? 0 : 240 });
  }

  function zoomOut() {
    if (!map) return;
    map.zoomOut({ duration: prefersReducedMotion() ? 0 : 240 });
  }

  function fitBounds(bounds, { animate = true } = {}) {
    if (!map || !bounds) return;
    const sw = typeof bounds.getSouthWest === 'function' ? bounds.getSouthWest() : null;
    const ne = typeof bounds.getNorthEast === 'function' ? bounds.getNorthEast() : null;
    if (!sw || !ne) return;
    map.fitBounds(
      [[sw.lng, sw.lat], [ne.lng, ne.lat]],
      {
        padding: { top: 64, right: 64, bottom: 130, left: 64 },
        pitch: map.getPitch(),
        bearing: map.getBearing(),
        duration: animate && !prefersReducedMotion() ? 450 : 0,
      },
    );
  }

  function setHighlightPoint(lat, lon) {
    runWhenReady(() => {
      const source = map?.getSource('tv-highlight');
      if (!source || typeof source.setData !== 'function') return;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        source.setData(EMPTY_FC);
        return;
      }
      source.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [lon, lat] },
        }],
      });
    });
  }

  function updateBaseLayer(layerSpec) {
    runWhenReady(() => {
      if (!map) return;
      const raster = buildRasterSourcesAndLayers(layerSpec);
      for (const id of currentRasterIds) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      currentRasterIds = [];

      if (map.getLayer('tv-bg')) {
        map.setPaintProperty('tv-bg', 'background-color', raster.backgroundColor);
      }
      if (map.getLayer('tv-hillshade')) {
        map.setPaintProperty('tv-hillshade', 'hillshade-exaggeration', raster.noMap ? 0.55 : 0.24);
        map.setPaintProperty('tv-hillshade', 'hillshade-shadow-color', raster.noMap ? '#000000' : '#1b2430');
      }
      try {
        map.setSky?.(buildSkyConfig({ noMap: raster.noMap, isDark: Boolean(layerSpec?.isDark) }));
      } catch {}

      const beforeId = map.getLayer('tv-hillshade') ? 'tv-hillshade' : undefined;
      for (const [id, sourceDef] of Object.entries(raster.sources)) {
        map.addSource(id, sourceDef);
        currentRasterIds.push(id);
      }
      for (const layerDef of raster.layers) {
        map.addLayer(layerDef, beforeId);
      }
    });
  }

  function updateTracks(gpx, {
    theme = '',
    colorMode = 'single',
    trackColorStartIndex = 0,
    referenceTracks = [],
  } = {}) {
    runWhenReady(() => {
      if (!map) return;
      const geojson = buildTrackGeoJson(gpx, {
      theme, colorMode, trackColorStartIndex, referenceTracks,
    });
      map.getSource('tv-tracks')?.setData?.(geojson.tracks);
      map.getSource('tv-ref-tracks')?.setData?.(geojson.references);
      map.getSource('tv-endpoints')?.setData?.(geojson.endpoints);
      map.getSource('tv-waypoints')?.setData?.(geojson.waypoints);
      if (map.getLayer('tv-track-casing')) {
        map.setLayoutProperty('tv-track-casing', 'visibility', theme === 'classic' ? 'none' : 'visible');
        map.setPaintProperty('tv-track-casing', 'line-color', readCssVar('--track-casing', '#ffffff'));
      }
      registerPinIcons(map);
    });
  }

  function setWaypointsVisible(visible) {
    runWhenReady(() => {
      if (!map) return;
      const value = visible ? 'visible' : 'none';
      for (const layerId of ['tv-waypoints-plain', 'tv-waypoints-photo', 'tv-waypoints-hit']) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', value);
      }
      if (!visible) closePopup();
    });
  }

  function closePopup() {
    if (activePopup) {
      try { activePopup.remove(); } catch {}
      activePopup = null;
    }
  }

  function showWaypointPopup(lat, lon, contentNode, { focus = true } = {}) {
    if (!map || !maplibreLib || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    closePopup();
    activePopup = new maplibreLib.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      maxWidth: 'none',
      className: 'map3d-popup',
    })
      .setLngLat([lon, lat])
      .setDOMContent(contentNode)
      .addTo(map);

    if (focus) {
      map.easeTo({
        center: [lon, lat],
        zoom: Math.max(map.getZoom(), 13),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
        duration: prefersReducedMotion() ? 0 : 420,
      });
    }
  }

  function resize() {
    map?.resize?.();
  }

  function destroy() {
    closePopup();
    interactionAbort?.abort();
    interactionAbort = null;
    pendingActions = [];
    styleReady = false;
    mounted = false;
    currentRasterIds = [];
    if (map) {
      try { map.remove(); } catch {}
      map = null;
    }
    if (hostContainer) {
      hostContainer.textContent = '';
      hostContainer = null;
    }
  }

  return {
    mount,
    isMounted: () => mounted,
    getCamera,
    setExaggeration,
    getExaggeration: () => currentExaggeration,
    resetNorth,
    zoomIn,
    zoomOut,
    fitBounds,
    setHighlightPoint,
    updateBaseLayer,
    updateTracks,
    setWaypointsVisible,
    showWaypointPopup,
    closePopup,
    resize,
    destroy,
  };
}
