import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseSnap, measurementSummary, SNAP_PIXELS } from '../../viewer/measure.js';

test('measurement totals add every leg and keep sections independent', () => {
  const sections = [
    [
      { lat: 30, lon: 120 },
      { lat: 30, lon: 120.01 },
      { lat: 30.01, lon: 120.01 },
    ],
    [
      { lat: 31, lon: 121 },
      { lat: 31, lon: 121.02 },
    ],
    [],
  ];
  const summary = measurementSummary(sections);
  assert.equal(summary.sectionCount, 2);
  assert.equal(summary.pointCount, 5);
  assert.equal(summary.segmentMeters.length, 3);
  assert.equal(summary.segmentMeters[2], 0);
  assert.ok(Math.abs(summary.totalMeters
    - (summary.segmentMeters[0] + summary.segmentMeters[1])) < 1e-9);
});

test('snapping uses the nearest target inside the screen-pixel radius', () => {
  assert.deepEqual(chooseSnap([
    { kind: 'marker', distancePixels: 11 },
    { kind: 'track', distancePixels: 4 },
  ]), { kind: 'track', distancePixels: 4 });
});

test('a marker wins a tie and the threshold is exclusive outside its radius', () => {
  assert.equal(chooseSnap([
    { kind: 'track', distancePixels: 8 },
    { kind: 'marker', distancePixels: 8 },
  ]).kind, 'marker');
  assert.equal(chooseSnap([{ kind: 'track', distancePixels: SNAP_PIXELS + 0.01 }]), null);
});
