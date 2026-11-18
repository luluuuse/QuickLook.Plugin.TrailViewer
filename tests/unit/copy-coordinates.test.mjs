import assert from 'node:assert/strict';
import test from 'node:test';

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { languages: ['en-US'], language: 'en-US' },
});
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

const { coordinateTargets, coordinateText } = await import('../../viewer/coordinates.js');
const { trackSummaryText } = await import('../../viewer/summary-view.js');
const { setLang } = await import('../../viewer/i18n.js');

const gpx = {
  name: 'Ridge walk',
  tracks: [{
    segments: [[
      { lat: 30, lon: 114, ele: 100 },
      { lat: 30.5, lon: 114.5, ele: 500 },
      { lat: 31, lon: 115, ele: 200 },
    ]],
  }],
  routes: [],
  waypoints: [{ lat: 29.5, lon: 113.5 }],
};

const summary = {
  segments: 1,
  routes: 0,
  points: 3,
  distanceMeters: 145000,
  start: new Date('2026-01-01T00:00:00Z'),
  end: new Date('2026-01-01T08:30:00Z'),
  durationSeconds: 30600,
  movingDurationSeconds: 27000,
  movingTimeSource: 'metadata',
  elevation: true,
  network: false,
};

test('coordinate copy supports start, end and peak', () => {
  assert.deepEqual(coordinateTargets(gpx), {
    start: gpx.tracks[0].segments[0][0],
    end: gpx.tracks[0].segments[0][2],
    highest: gpx.tracks[0].segments[0][1],
  });
  assert.equal(coordinateText({ lat: 30.52, lon: 114.52 }), '30.520000, 114.520000');
});

test('a route-only file still has start, end and a waypoint fallback', () => {
  const route = { name: 'Plan', tracks: [], routes: [{ points: [
    { lat: 1, lon: 2 },
    { lat: 3, lon: 4 },
  ] }], waypoints: [] };
  assert.deepEqual(coordinateTargets(route), {
    start: { lat: 1, lon: 2 },
    end: { lat: 3, lon: 4 },
    highest: null,
  });
});

test('a flat file has no peak coordinate but keeps route endpoints', () => {
  const flat = {
    tracks: [{ segments: [[{ lat: 1, lon: 2, ele: 0 }, { lat: 3, lon: 4, ele: 0 }]] }],
    routes: [],
    waypoints: [],
  };
  const targets = coordinateTargets(flat);
  assert.deepEqual(targets.start, { lat: 1, lon: 2, ele: 0 });
  assert.deepEqual(targets.end, { lat: 3, lon: 4, ele: 0 });
  assert.equal(targets.highest, null);
});

test('the copied summary prefers shareable values and omits missing ones', () => {
  setLang('en');
  const elevations = { ascent: 980, descent: 910, max: 1512 };
  const text = trackSummaryText(gpx, summary, elevations, 'ridge.gpx');
  assert.match(text, /^Ridge walk/);
  assert.match(text, /Distance: 145\.0 km/);
  assert.match(text, /Moving time: 7 h 30 min/);
  assert.match(text, /Moving avg: 19\.3 km\/h/);
  assert.match(text, /Peak elevation: 1,512 m/);
  assert.doesNotMatch(text, /undefined|null/);
});

test('network summaries avoid invented time and elevation totals', () => {
  setLang('en');
  const text = trackSummaryText(
    { name: 'Route network' },
    {
      network: true, segments: 12, routes: 8, waypoints: 4,
      distanceMeters: 325000, elevation: false, start: null, end: null,
      durationSeconds: null, movingDurationSeconds: null, points: 5000,
    },
    null,
    'network.kml',
  );
  assert.match(text, /Route length: 325\.0 km/);
  assert.match(text, /8 routes/);
  assert.doesNotMatch(text, /Total time|Ascent|Peak/);
});
