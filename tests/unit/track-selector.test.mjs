import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteModel } from '../../viewer/route-model.js';
import {
  buildTrackViewGpx,
  extractTrackChoices,
  waypointMatchesTrack,
} from '../../viewer/track-selector.js';

function makeMultiTrackDoc() {
  const track50 = {
    name: '50km组',
    folder: '50km',
    segments: [[
      { lat: 30.600, lon: 119.850, ele: 200 },
      { lat: 30.610, lon: 119.860, ele: 450 },
    ]],
  };
  const track100 = {
    name: '100km组',
    folder: '100km',
    segments: [[
      { lat: 30.600, lon: 119.850, ele: 200 },
      { lat: 30.610, lon: 119.860, ele: 450 },
      { lat: 30.720, lon: 119.950, ele: 800 },
    ]],
  };
  return {
    version: '2.2',
    name: '莫干山越野跑',
    tracks: [track50, track100],
    routes: [],
    waypoints: [
      { lat: 30.6002, lon: 119.8502, name: '起点(共用)' },
      { lat: 30.6101, lon: 119.8601, name: 'CP1-50km', folder: '50km' },
      { lat: 30.6102, lon: 119.8602, name: 'CP1-100km专属', folder: '100km' },
      { lat: 30.7201, lon: 119.9501, name: 'CP8-远端' },
    ],
    areas: [],
    network: false,
  };
}

test('buildTrackViewGpx returns original document when selection is null', () => {
  const doc = makeMultiTrackDoc();
  assert.equal(buildTrackViewGpx(doc, null), doc);
});

test('buildTrackViewGpx isolates selected track and filters waypoints by folder and proximity', () => {
  const doc = makeMultiTrackDoc();
  const view50 = buildTrackViewGpx(doc, 0);
  assert.equal(view50.name, '50km组');
  assert.equal(view50.tracks.length, 1);
  assert.equal(view50.tracks[0].name, '50km组');
  assert.deepEqual(
    view50.waypoints.map((w) => w.name),
    ['起点(共用)', 'CP1-50km'],
  );

  const view100 = buildTrackViewGpx(doc, 1);
  assert.equal(view100.name, '100km组');
  assert.deepEqual(
    view100.waypoints.map((w) => w.name),
    ['起点(共用)', 'CP1-100km专属', 'CP8-远端'],
  );
});

test('waypointMatchesTrack matches points along segment interior, not only vertices', () => {
  const track = {
    name: 'Line',
    segments: [[
      { lat: 30.000, lon: 120.000 },
      { lat: 30.100, lon: 120.000 },
    ]],
  };
  assert.equal(waypointMatchesTrack({ lat: 30.050, lon: 120.001 }, track, 350), true);
  assert.equal(waypointMatchesTrack({ lat: 30.050, lon: 120.020 }, track, 350), false);
});

test('waypointMatchesTrack handles per-segment bounding-box pruning across dense long tracks', () => {
  const points = [];
  for (let i = 0; i < 4000; i += 1) {
    points.push({ lat: 30.0 + i * 0.0001, lon: 120.0 + Math.sin(i * 0.02) * 0.01 });
  }
  const track = { name: '100km', segments: [points] };
  const mid = points[2500];
  assert.equal(waypointMatchesTrack({ lat: mid.lat + 0.001, lon: mid.lon }, track, 350), true);
  assert.equal(waypointMatchesTrack({ lat: mid.lat, lon: mid.lon + 0.05 }, track, 350), false);
  assert.equal(waypointMatchesTrack({ lat: points[0].lat - 0.002, lon: points[0].lon }, track, 350), true);
  assert.equal(waypointMatchesTrack({ lat: points[0].lat - 0.005, lon: points[0].lon }, track, 350), false);
});

test('extractTrackChoices preserves palette color index across multi-segment tracks', () => {
  const doc = {
    version: '1.1',
    tracks: [
      {
        name: 'A',
        segments: [
          [{ lat: 30.0, lon: 120.0 }, { lat: 30.01, lon: 120.0 }],
          [{ lat: 30.02, lon: 120.0 }, { lat: 30.03, lon: 120.0 }],
        ],
      },
      {
        name: 'B',
        segments: [
          [{ lat: 30.04, lon: 120.0 }, { lat: 30.05, lon: 120.0 }],
        ],
      },
    ],
    routes: [],
    waypoints: [],
  };
  const model = createRouteModel(doc);
  const choices = extractTrackChoices(doc, model);
  assert.equal(choices.length, 2);
  assert.equal(choices[0].colorIndex, 0);
  assert.equal(choices[1].colorIndex, 2);
  assert.ok(choices[0].distanceMeters > 2000);
});
