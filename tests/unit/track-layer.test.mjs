import assert from 'node:assert/strict';
import test from 'node:test';
import { ENDPOINT_STITCH_METERS, resolveTrackEndpoints } from '../../viewer/track-layer.js';

function groupOf(points) {
  return { segments: [{ points }] };
}

test('single track keeps both start and end markers', () => {
  const result = resolveTrackEndpoints([
    groupOf([{ lat: 25.27, lon: 110.29 }, { lat: 25.28, lon: 110.30 }]),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].showStart, true);
  assert.equal(result[0].showEnd, true);
});

test('consecutive stitched tracks within 500 m suppress intermediate start/end markers', () => {
  // ~111 m per 0.001 deg latitude; gaps here are ~30 m and ~220 m (both <= 500 m).
  const result = resolveTrackEndpoints([
    groupOf([{ lat: 25.2700, lon: 110.29 }, { lat: 25.2600, lon: 110.29 }]),
    groupOf([{ lat: 25.2597, lon: 110.29 }, { lat: 25.2500, lon: 110.29 }]),
    groupOf([{ lat: 25.2480, lon: 110.29 }, { lat: 25.2400, lon: 110.29 }]),
  ]);
  assert.deepEqual(
    result.map(({ showStart, showEnd }) => ({ showStart, showEnd })),
    [
      { showStart: true, showEnd: false },
      { showStart: false, showEnd: false },
      { showStart: false, showEnd: true },
    ],
  );
  assert.equal(ENDPOINT_STITCH_METERS, 500);
});

test('independent tracks separated by more than 500 m keep their own start and end markers', () => {
  // Gap between track 1 end (25.26) and track 2 start (25.24) is ~2.2 km (> 500 m).
  const result = resolveTrackEndpoints([
    groupOf([{ lat: 25.27, lon: 110.29 }, { lat: 25.26, lon: 110.29 }]),
    groupOf([{ lat: 25.24, lon: 110.29 }, { lat: 25.23, lon: 110.29 }]),
  ]);
  assert.deepEqual(
    result.map(({ showStart, showEnd }) => ({ showStart, showEnd })),
    [
      { showStart: true, showEnd: true },
      { showStart: true, showEnd: true },
    ],
  );
});
