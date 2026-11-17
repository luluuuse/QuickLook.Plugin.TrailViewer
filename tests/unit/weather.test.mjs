import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POINT_ZOOM,
  WEATHER_TARGETS,
  WINDY_OVERLAY,
  availableTargets,
  hasElevation,
  highestPoint,
  weatherTarget,
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

test('the three targets are start, end and summit', () => {
  assert.deepEqual([...WEATHER_TARGETS], ['start', 'end', 'highest']);
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
  assert.deepEqual(availableTargets(withElevation), ['start', 'end', 'highest']);
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
