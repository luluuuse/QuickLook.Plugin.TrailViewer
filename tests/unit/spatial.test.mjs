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

test('viewport lookup returns the same route order as a linear bounds scan', () => {
  const points = [
    { lat: 10, lon: 10, index: 0 },
    { lat: 11, lon: 11, index: 1 },
    { lat: 10.5, lon: 10.5, index: 2 },
    { lat: 50, lon: 50, index: 3 },
  ];
  const index = createPointIndex(points);
  const bounds = { south: 10, west: 10, north: 11, east: 11 };
  assert.deepEqual(index.within(bounds), points.filter((point) =>
    point.lat >= bounds.south && point.lat <= bounds.north
      && point.lon >= bounds.west && point.lon <= bounds.east));
});

test('viewport lookup spans the date line', () => {
  const points = [
    { lat: 1, lon: 179, index: 0 },
    { lat: 1, lon: -179, index: 1 },
    { lat: 1, lon: 0, index: 2 },
  ];
  const matches = createPointIndex(points).within({
    south: 0, west: 170, north: 2, east: -170,
  });
  assert.deepEqual(matches.map((point) => point.index), [0, 1]);
});
