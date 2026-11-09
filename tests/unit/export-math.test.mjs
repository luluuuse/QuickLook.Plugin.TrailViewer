import test from 'node:test';
import assert from 'node:assert/strict';

import { mercator, simplifyPath, unwrapLongitude } from '../../viewer/export.js';

test('mercator remains finite at valid polar latitudes', () => {
  assert.ok(Number.isFinite(mercator({ lat: 90, lon: 0 }).y));
  assert.ok(Number.isFinite(mercator({ lat: -90, lon: 0 }).y));
});

test('date-line longitudes take the short way', () => {
  assert.equal(unwrapLongitude(-179, 179), 181);
  assert.equal(unwrapLongitude(179, -179), -181);
});

test('path simplification keeps endpoints and a real corner', () => {
  const points = Array.from({ length: 100 }, (_, index) => ({
    xy: [index, index < 50 ? 0 : 100],
  }));
  const kept = simplifyPath(points, 0.35);
  assert.equal(kept.length, 4);
  assert.deepEqual(kept[0].xy, [0, 0]);
  assert.deepEqual(kept.at(-1).xy, [99, 100]);
  assert.ok(kept[1].xy[0] === 49 || kept[1].xy[0] === 50);
});
