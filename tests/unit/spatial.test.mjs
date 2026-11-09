import test from 'node:test';
import assert from 'node:assert/strict';

import { createPointIndex } from '../../viewer/spatial.js';

test('empty point indexes return null', () => {
  assert.equal(createPointIndex([]).nearest({ lat: 0, lon: 0 }), null);
});

test('nearest matches a linear scan, including duplicate points', () => {
  let seed = 123456789;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const points = Array.from({ length: 2000 }, (_, index) => ({
    lat: 46 + random() * 0.2,
    lon: 8 + random() * 0.2,
    index,
  }));
  points.push({ ...points[0] });
  const index = createPointIndex(points);
  for (let query = 0; query < 100; query += 1) {
    const target = { lat: 46 + random() * 0.2, lon: 8 + random() * 0.2 };
    let best = 0;
    let distance = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const candidate = (points[i].lat - target.lat) ** 2 + (points[i].lon - target.lon) ** 2;
      if (candidate < distance) {
        distance = candidate;
        best = i;
      }
    }
    assert.equal(index.nearest(target), points[best]);
  }
});
