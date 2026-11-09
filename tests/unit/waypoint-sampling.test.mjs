import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleScreenPoints } from '../../viewer/waypoint-sampling.js';

test('screen sampling keeps only well-spaced points', () => {
  const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }];
  const sampled = sampleScreenPoints(points, (point) => point, { minDistance: 30 });
  assert.deepEqual(sampled.map(({ item }) => item.x), [0, 40]);
});

test('protected screen positions push ordinary samples out of their area', () => {
  const points = [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 60, y: 0 }];
  const sampled = sampleScreenPoints(points, (point) => point, {
    minDistance: 30,
    occupied: [{ x: 0, y: 0 }],
  });
  assert.deepEqual(sampled.map(({ item }) => item.x), [60]);
});
