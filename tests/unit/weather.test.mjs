import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TERRAIN_PROVIDER,
  DEFAULT_WEATHER_CATEGORY,
  DEFAULT_WEATHER_PROVIDER,
  POINT_ZOOM,
  REGIONAL_ZOOM,
  TERRAIN_PROVIDERS,
  TERRAIN_ZOOM,
  WEATHER_CATEGORIES,
  WEATHER_PROVIDERS,
  WEATHER_TARGETS,
  WINDY_OVERLAY,
  ZOOMEARTH_LAYER,
  availableTargets,
  categoryForProvider,
  hasElevation,
  highestPoint,
  normalizeAnyWeatherProvider,
  normalizeWeatherCategory,
  normalizeWeatherProvider,
  providersForCategory,
  weatherTarget,
  weatherTargetPoint,
  weatherUrl,
  windyUrl,
  zoomFor,
} from '../../viewer/weather.js';

const track = (points) => ({
  tracks: [{ name: 'route', segments: [points] }],
  routes: [],
  waypoints: [],
  areas: [],
});

const withElevation = track([
  { lat: 30.0, lon: 114.0, ele: 800 },
  { lat: 30.5, lon: 114.5, ele: 1512 },
  { lat: 31.0, lon: 115.0, ele: 900 },
]);

const flat = track([
  { lat: 30.0, lon: 114.0 },
  { lat: 31.0, lon: 115.0 },
]);

test('the three targets are start, summit and end', () => {
  assert.deepEqual([...WEATHER_TARGETS], ['start', 'highest', 'end']);
});

test('start and end return the first and last recorded points', () => {
  assert.deepEqual(weatherTarget(withElevation, 'start'), { lat: 30.0, lon: 114.0 });
  assert.deepEqual(weatherTarget(withElevation, 'end'), { lat: 31.0, lon: 115.0 });
});

test('the summit is the point with the greatest elevation', () => {
  assert.deepEqual(weatherTarget(withElevation, 'highest'), { lat: 30.5, lon: 114.5 });
  assert.equal(highestPoint(withElevation).ele, 1512);
});

test('a file without elevation has no summit', () => {
  assert.equal(highestPoint(flat), null);
  assert.equal(hasElevation(flat), false);
  assert.equal(weatherTarget(flat, 'highest'), null);
  assert.deepEqual(availableTargets(flat), ['start', 'end']);
});

test('a file with elevation offers all three targets', () => {
  assert.equal(hasElevation(withElevation), true);
  assert.deepEqual(availableTargets(withElevation), ['start', 'highest', 'end']);
});

test('a file without coordinates offers nothing', () => {
  assert.deepEqual(availableTargets({ tracks: [], routes: [], waypoints: [], areas: [] }), []);
  assert.equal(weatherTarget(null, 'start'), null);
});

test('the first of two equal summits wins', () => {
  const twin = track([
    { lat: 30.0, lon: 114.0, ele: 1500 },
    { lat: 30.5, lon: 114.5, ele: 1400 },
    { lat: 31.0, lon: 115.0, ele: 1500 },
  ]);
  assert.deepEqual(weatherTarget(twin, 'highest'), { lat: 30.0, lon: 114.0 });
});

test('a flat file with one repeated height has no summit', () => {
  const flatline = track([
    { lat: 30.0, lon: 114.0, ele: 0 },
    { lat: 31.0, lon: 115.0, ele: 0 },
  ]);
  assert.equal(highestPoint(flatline), null);
  assert.deepEqual(availableTargets(flatline), ['start', 'end']);
});

test('a single sample is not a summit', () => {
  assert.equal(highestPoint(track([{ lat: 30, lon: 114, ele: 900 }])), null);
});

test('every target opens at street level', () => {
  for (const mode of WEATHER_TARGETS) assert.equal(zoomFor(mode), POINT_ZOOM);
});

test('the Windy link puts the point in the path so the forecast panel opens', () => {
  assert.equal(
    windyUrl({ lat: 30.5, lon: 114.25 }, 14),
    'https://www.windy.com/30.5000/114.2500?clouds,30.5000,114.2500,14',
  );
  assert.equal(windyUrl(null, 14), null);
});

test('the link opens on the cloud layer by default', () => {
  assert.equal(WINDY_OVERLAY, 'clouds');
  assert.match(windyUrl({ lat: 30.5, lon: 114.25 }, 14), /\?clouds,/);
});

test('the overlay can be omitted or replaced', () => {
  assert.equal(
    windyUrl({ lat: 30.5, lon: 114.25 }, 14, ''),
    'https://www.windy.com/30.5000/114.2500?30.5000,114.2500,14',
  );
  assert.match(windyUrl({ lat: 30.5, lon: 114.25 }, 14, 'wind'), /\?wind,/);
});

test('every target produces a path-form link on the cloud layer', () => {
  for (const mode of WEATHER_TARGETS) {
    const url = windyUrl(weatherTarget(withElevation, mode), zoomFor(mode));
    assert.match(
      url,
      /^https:\/\/www\.windy\.com\/\d+\.\d{4}\/\d+\.\d{4}\?clouds,\d+\.\d{4},\d+\.\d{4},\d+$/,
      mode,
    );
  }
});

test('the three weather providers are windy, ventusky and zoomearth', () => {
  assert.deepEqual([...WEATHER_PROVIDERS], ['windy', 'ventusky', 'zoomearth']);
  assert.equal(DEFAULT_WEATHER_PROVIDER, 'windy');
  assert.equal(Object.isFrozen(WEATHER_PROVIDERS), true);
});

test('normalizeWeatherProvider falls back to windy for unknown values', () => {
  assert.equal(normalizeWeatherProvider('windy'), 'windy');
  assert.equal(normalizeWeatherProvider('ventusky'), 'ventusky');
  assert.equal(normalizeWeatherProvider('zoomearth'), 'zoomearth');
  assert.equal(normalizeWeatherProvider('unknown'), 'windy');
  assert.equal(normalizeWeatherProvider(''), 'windy');
  assert.equal(normalizeWeatherProvider(null), 'windy');
  assert.equal(normalizeWeatherProvider(undefined), 'windy');
});

test('zoomFor matches provider hiking view scale', () => {
  assert.equal(zoomFor('start', 'windy'), POINT_ZOOM);
  assert.equal(zoomFor('start', 'ventusky'), REGIONAL_ZOOM);
  assert.equal(zoomFor('highest', 'zoomearth'), REGIONAL_ZOOM);
  assert.equal(zoomFor('highest', 'shademap'), TERRAIN_ZOOM);
  assert.equal(zoomFor('end', 'unknown'), POINT_ZOOM);
});

test('weather categories and terrain providers are configured cleanly', () => {
  assert.deepEqual([...WEATHER_CATEGORIES], ['weather', 'terrain']);
  assert.equal(DEFAULT_WEATHER_CATEGORY, 'weather');
  assert.deepEqual([...TERRAIN_PROVIDERS], ['peakfinder', 'shademap']);
  assert.equal(DEFAULT_TERRAIN_PROVIDER, 'peakfinder');
  assert.equal(normalizeWeatherCategory('terrain'), 'terrain');
  assert.equal(normalizeWeatherCategory('invalid'), 'weather');
  assert.deepEqual([...providersForCategory('weather')], ['windy', 'ventusky', 'zoomearth']);
  assert.deepEqual([...providersForCategory('terrain')], ['peakfinder', 'shademap']);
  assert.equal(categoryForProvider('peakfinder'), 'terrain');
  assert.equal(categoryForProvider('windy'), 'weather');
  assert.equal(normalizeAnyWeatherProvider('shademap'), 'shademap');
  assert.equal(normalizeAnyWeatherProvider('unknown'), 'windy');
});

test('weatherTargetPoint preserves elevation when present', () => {
  assert.deepEqual(weatherTargetPoint(withElevation, 'highest'), { lat: 30.5, lon: 114.5, ele: 1512 });
  assert.deepEqual(weatherTargetPoint(flat, 'start'), { lat: 30.0, lon: 114.0 });
});

test('weatherUrl builds hiking-optimized links for all five providers', () => {
  const pt = { lat: 30.5, lon: 114.25 };
  assert.equal(
    weatherUrl(pt, 'windy'),
    'https://www.windy.com/30.5000/114.2500?clouds,30.5000,114.2500,14',
  );
  assert.equal(
    weatherUrl(pt, 'ventusky'),
    'https://www.ventusky.com/30.5;114.25',
  );
  assert.equal(
    weatherUrl({ lat: 31.4714, lon: 115.7952 }, 'ventusky'),
    'https://www.ventusky.com/31.471;115.795',
  );
  assert.equal(
    weatherUrl(pt, 'zoomearth'),
    `https://zoom.earth/maps/${ZOOMEARTH_LAYER}/#view=30.5000,114.2500,${REGIONAL_ZOOM}z/place=30.5000,114.2500`,
  );
  assert.equal(
    weatherUrl(pt, 'zoomearth', 12),
    'https://zoom.earth/maps/satellite/#view=30.5000,114.2500,12z/place=30.5000,114.2500',
  );
  assert.equal(
    weatherUrl(pt, 'peakfinder'),
    'https://www.peakfinder.com/?lat=30.5000&lng=114.2500',
  );
  assert.equal(
    weatherUrl({ lat: 30.5, lon: 114.25, ele: 1512.4 }, 'peakfinder'),
    'https://www.peakfinder.com/?lat=30.5000&lng=114.2500&ele=1512',
  );
  assert.equal(
    weatherUrl(pt, 'shademap'),
    `https://shademap.app/@30.5000,114.2500,${TERRAIN_ZOOM}z`,
  );
});

test('weatherUrl returns null for missing targets and falls back to windy for unknown providers', () => {
  const pt = { lat: 30.5, lon: 114.25 };
  assert.equal(weatherUrl(null, 'windy'), null);
  assert.equal(weatherUrl(null, 'ventusky'), null);
  assert.equal(weatherUrl(null, 'zoomearth'), null);
  assert.equal(
    weatherUrl(pt, 'unknown'),
    'https://www.windy.com/30.5000/114.2500?clouds,30.5000,114.2500,14',
  );
  assert.equal(
    weatherUrl(pt),
    'https://www.windy.com/30.5000/114.2500?clouds,30.5000,114.2500,14',
  );
});
