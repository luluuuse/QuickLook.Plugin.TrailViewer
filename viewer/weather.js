// Weather & mountain-view hand-off for the current track. The viewer does not embed a third-party map: it
// builds a deep link for a chosen point of the route and lets the host open it in the default browser. That
// keeps the page free of extra network origins and of any API key.
//
// Each provider opens on the view where it adds the most hiking value:
// - Windy: street-level clouds layer with the point-forecast panel (/lat/lon?clouds,lat,lon,14).
// - Ventusky: canonical 3-decimal point route (/lat;lon) so the 14-day point forecast card opens.
// - Zoom Earth: regional near-real-time satellite imagery with place card (/maps/satellite/#view=lat,lon,9z/place=lat,lon).
// - PeakFinder: 360° mountain horizon & sun/moon path (?lat=lat&lng=lon[&ele=m]).
// - ShadeMap: global DEM terrain shadow & sunlight map (/@lat,lon,13z).

import { readStored, writeStored } from './storage.js';

const WINDY_BASE = 'https://www.windy.com/';
const VENTUSKY_BASE = 'https://www.ventusky.com/';
const ZOOMEARTH_BASE = 'https://zoom.earth/maps/';
const PEAKFINDER_BASE = 'https://www.peakfinder.com/';
const SHADEMAP_BASE = 'https://shademap.app/';

// Street level for Windy point forecasts; terrain shadow zoom for ShadeMap; regional cloud view for Zoom Earth.
export const POINT_ZOOM = 14;
export const TERRAIN_ZOOM = 13;
export const REGIONAL_ZOOM = 9;

export const WEATHER_TARGETS = Object.freeze(['start', 'highest', 'end']);
export const WEATHER_CATEGORIES = Object.freeze(['weather', 'terrain']);
export const DEFAULT_WEATHER_CATEGORY = 'weather';
export const WEATHER_CATEGORY_KEY = 'weatherCategory';

export const WEATHER_PROVIDERS = Object.freeze(['windy', 'ventusky', 'zoomearth']);
export const TERRAIN_PROVIDERS = Object.freeze(['peakfinder', 'shademap']);
export const ALL_WEATHER_PROVIDERS = Object.freeze([...WEATHER_PROVIDERS, ...TERRAIN_PROVIDERS]);
export const DEFAULT_WEATHER_PROVIDER = 'windy';
export const DEFAULT_TERRAIN_PROVIDER = 'peakfinder';
export const WEATHER_PROVIDER_KEY = 'weatherProvider';
export const TERRAIN_PROVIDER_KEY = 'terrainProvider';
export const ZOOMEARTH_LAYER = 'satellite';

export function normalizeWeatherCategory(value) {
  return WEATHER_CATEGORIES.includes(value) ? value : DEFAULT_WEATHER_CATEGORY;
}

export function savedWeatherCategory() {
  return normalizeWeatherCategory(readStored(WEATHER_CATEGORY_KEY));
}

export function saveWeatherCategory(category) {
  const next = normalizeWeatherCategory(category);
  writeStored(WEATHER_CATEGORY_KEY, next);
  return next;
}

export function providersForCategory(category) {
  return normalizeWeatherCategory(category) === 'terrain' ? TERRAIN_PROVIDERS : WEATHER_PROVIDERS;
}

export function categoryForProvider(provider) {
  return TERRAIN_PROVIDERS.includes(provider) ? 'terrain' : 'weather';
}

export function normalizeWeatherProvider(value) {
  return WEATHER_PROVIDERS.includes(value) ? value : DEFAULT_WEATHER_PROVIDER;
}

export function normalizeTerrainProvider(value) {
  return TERRAIN_PROVIDERS.includes(value) ? value : DEFAULT_TERRAIN_PROVIDER;
}

export function normalizeAnyWeatherProvider(value) {
  return ALL_WEATHER_PROVIDERS.includes(value) ? value : DEFAULT_WEATHER_PROVIDER;
}

export function savedWeatherProvider() {
  return normalizeWeatherProvider(readStored(WEATHER_PROVIDER_KEY));
}

export function saveWeatherProvider(provider) {
  const next = normalizeWeatherProvider(provider);
  writeStored(WEATHER_PROVIDER_KEY, next);
  return next;
}

export function savedTerrainProvider() {
  return normalizeTerrainProvider(readStored(TERRAIN_PROVIDER_KEY));
}

export function saveTerrainProvider(provider) {
  const next = normalizeTerrainProvider(provider);
  writeStored(TERRAIN_PROVIDER_KEY, next);
  return next;
}

export function savedProviderForCategory(category = savedWeatherCategory()) {
  return normalizeWeatherCategory(category) === 'terrain'
    ? savedTerrainProvider()
    : savedWeatherProvider();
}

export function saveProviderForCategory(category, provider) {
  return normalizeWeatherCategory(category) === 'terrain'
    ? saveTerrainProvider(provider)
    : saveWeatherProvider(provider);
}

export function savedActiveWeatherProvider() {
  return savedProviderForCategory(savedWeatherCategory());
}

function trackPoints(gpx) {
  const list = [];
  for (const track of gpx?.tracks || []) {
    for (const segment of track.segments || []) {
      for (const point of segment || []) list.push(point);
    }
  }
  for (const route of gpx?.routes || []) {
    for (const point of route.points || []) list.push(point);
  }
  return list;
}

function valid(point) {
  if (!point) return null;
  const lat = Number(point.lat);
  const lon = Number(point.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/**
 * The point Windy should open on.
 * @param {'start'|'end'|'highest'} mode
 */
export function weatherTarget(gpx, mode = 'start') {
  const all = trackPoints(gpx);
  const first = all[0] || gpx?.waypoints?.[0] || null;
  const last = all[all.length - 1] || gpx?.waypoints?.[gpx.waypoints.length - 1] || null;
  if (mode === 'end') return valid(last);
  if (mode === 'highest') return valid(highestPoint(gpx));
  return valid(first);
}

/** Same target point as weatherTarget(), preserving finite elevation when present (e.g. for PeakFinder). */
export function weatherTargetPoint(gpx, mode = 'start') {
  const all = trackPoints(gpx);
  const first = all[0] || gpx?.waypoints?.[0] || null;
  const last = all[all.length - 1] || gpx?.waypoints?.[gpx.waypoints.length - 1] || null;
  const raw = mode === 'end' ? last : mode === 'highest' ? highestPoint(gpx) : first;
  const coords = valid(raw);
  if (!coords) return null;
  const ele = Number(raw?.ele);
  return Number.isFinite(ele) ? { ...coords, ele } : coords;
}

/**
 * The recorded point with the greatest elevation. Network KML skips elevation on purpose, and many 2D tracks
 * carry none either, so a file without any height simply has no highest point rather than a guessed one.
 *
 * A flat file that writes the same height everywhere (0 m exports, for instance) has no summit worth naming:
 * the "highest" point would be an arbitrary first sample, which reads as a wrong answer rather than a fallback.
 */
export function highestPoint(gpx) {
  let best = null;
  let bestEle = -Infinity;
  let lowestEle = Infinity;
  let count = 0;
  for (const point of trackPoints(gpx)) {
    const ele = Number(point.ele);
    if (!Number.isFinite(ele)) continue;
    count += 1;
    if (ele < lowestEle) lowestEle = ele;
    if (ele > bestEle) {
      bestEle = ele;
      best = point;
    }
  }
  if (best === null || count < 2) return null;
  // Less than a metre of relief across the whole route is a flat file, not a summit.
  return bestEle - lowestEle >= 1 ? best : null;
}

/** True when the file carries elevation at all; the highest-point target is unavailable otherwise. */
export function hasElevation(gpx) {
  return highestPoint(gpx) !== null;
}

/** Which targets this file can actually open. */
export function availableTargets(gpx) {
  const hasPoint = trackPoints(gpx).length > 0 || (gpx?.waypoints?.length || 0) > 0;
  return WEATHER_TARGETS.filter((mode) => {
    if (mode === 'highest') return hasElevation(gpx);
    return hasPoint;
  });
}

/** Zoom level matched to the provider's best hiking view. */
export function zoomFor(mode = 'start', provider = DEFAULT_WEATHER_PROVIDER) {
  void mode;
  const active = normalizeAnyWeatherProvider(provider);
  if (active === 'windy') return POINT_ZOOM;
  if (active === 'shademap') return TERRAIN_ZOOM;
  return REGIONAL_ZOOM;
}

// Cloud cover is the layer that answers "will I be in the fog or under the sun", which is what a hiker opens
// the weather for. Windy accepts it as the first query segment and keeps the point-forecast panel either way.
export const WINDY_OVERLAY = 'clouds';

/**
 * Windy share URL. The point appears both as the path and in the query string; the path is what expands the
 * point-forecast panel, the overlay segment picks the layer, and the coordinates give the map its centre and
 * zoom. Windy normalises the order itself, so the segments go in its documented order.
 */
export function windyUrl(target, zoom = POINT_ZOOM, overlay = WINDY_OVERLAY) {
  if (!target) return null;
  const lat = target.lat.toFixed(4);
  const lon = target.lon.toFixed(4);
  const layer = overlay ? `${overlay},` : '';
  return `${WINDY_BASE}${lat}/${lon}?${layer}${lat},${lon},${zoom}`;
}

/**
 * Unified weather & mountain-view hand-off URL across supported providers. Unknown providers fall back to Windy.
 */
export function weatherUrl(target, provider = DEFAULT_WEATHER_PROVIDER, zoom) {
  if (!target) return null;
  const active = normalizeAnyWeatherProvider(provider);
  const level = zoom ?? zoomFor('start', active);
  if (active === 'windy') return windyUrl(target, level);
  const lat = target.lat.toFixed(4);
  const lon = target.lon.toFixed(4);
  if (active === 'ventusky') {
    const vLat = String(Number(target.lat.toFixed(3)));
    const vLon = String(Number(target.lon.toFixed(3)));
    return `${VENTUSKY_BASE}${vLat};${vLon}`;
  }
  if (active === 'zoomearth') {
    return `${ZOOMEARTH_BASE}${ZOOMEARTH_LAYER}/#view=${lat},${lon},${level}z/place=${lat},${lon}`;
  }
  if (active === 'peakfinder') {
    const ele = Number(target.ele);
    const eleQuery = Number.isFinite(ele) ? `&ele=${Math.round(ele)}` : '';
    return `${PEAKFINDER_BASE}?lat=${lat}&lng=${lon}${eleQuery}`;
  }
  if (active === 'shademap') {
    return `${SHADEMAP_BASE}@${lat},${lon},${level}z`;
  }
  return windyUrl(target, level);
}

/** Opens a URL in the default browser. The host cancels in-page navigation and hands https links to the OS. */
export function openExternal(url) {
  if (!url) return false;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.append(link);
  link.click();
  link.remove();
  return true;
}
