import assert from 'node:assert/strict';
import test from 'node:test';

import { createRouteModel, lineDistanceAt } from '../../viewer/route-model.js';

test('route model measures each line once and carries cumulative distance across segments', () => {
  const first = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }];
  const second = [{ lat: 0, lon: 0.002 }, { lat: 0, lon: 0.003 }];
  const model = createRouteModel({
    tracks: [{ name: 'walk', segments: [first, second] }],
    routes: [],
  });

  assert.equal(model.tracks.length, 2);
  assert.equal(model.trackGroups.length, 1);
  assert.ok(model.tracks[0].length > 110 && model.tracks[0].length < 112);
  assert.equal(model.tracks[1].startMeters, model.tracks[0].length);
  assert.equal(lineDistanceAt(model.tracks[1], 0), model.tracks[0].length);
  assert.ok(model.distanceMeters > 220 && model.distanceMeters < 224);
});

test('route-only files use route distance while display lines keep track-first order', () => {
  const track = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }];
  const route = [{ lat: 1, lon: 1 }, { lat: 1, lon: 1.001 }];
  const model = createRouteModel({ tracks: [{ segments: [track] }], routes: [{ points: route }] });

  assert.deepEqual(model.lines.map((line) => line.kind), ['track', 'route']);
  assert.equal(model.routes[0].startMeters, model.trackDistanceMeters);
  assert.equal(model.distanceMeters, model.trackDistanceMeters);

  const routeOnly = createRouteModel({ tracks: [], routes: [{ points: route }] });
  assert.equal(routeOnly.distanceMeters, routeOnly.routeDistanceMeters);
});
