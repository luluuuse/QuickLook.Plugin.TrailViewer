import test from 'node:test';
import assert from 'node:assert/strict';

import {
  elevationGain,
  groundRuns,
  profileSamples,
  rawElevationGain,
  slopeBins,
  slopeColor,
  SLOPE_FULL,
} from '../../viewer/profile.js';

test('elevationGain settles a monotonic climb and descent', () => {
  assert.deepEqual(elevationGain([0, 100]), { ascent: 100, descent: 0 });
  assert.deepEqual(elevationGain([100, 0]), { ascent: 0, descent: 100 });
});

test('profileSamples preserves endpoints and a one-sample summit', () => {
  const samples = Array.from({ length: 10000 }, (_, index) => ({
    along: index,
    ele: index === 5123 ? 9999 : index % 17,
  }));
  const kept = profileSamples(samples, 600);
  assert.ok(kept.length <= 1202);
  assert.equal(kept[0].along, 0);
  assert.equal(kept.at(-1).along, 9999);
  assert.ok(kept.some((sample) => sample.ele === 9999));
});

test('short alternating runs collapse into one contiguous run', () => {
  const samples = Array.from({ length: 81 }, (_, index) => ({
    along: index * 25,
    ele: index % 2 === 0 ? 0 : 20,
  }));
  assert.deepEqual(groundRuns(samples), [{ grade: 'flat', from: 0, to: 2000 }]);
});

test('slope colours saturate at the documented limit', () => {
  assert.equal(slopeColor(0.9), slopeColor(SLOPE_FULL));
});

test('raw elevation gain exposes noise removed by the filtered total', () => {
  assert.deepEqual(rawElevationGain([100, 102, 100, 104]), { ascent: 6, descent: 2 });
  assert.deepEqual(elevationGain([100, 102, 100, 104], 3), { ascent: 4, descent: 0 });
});

test('slope bins separate flat, gentle and steep ascent and descent', () => {
  const bins = slopeBins([
    { from: 0, to: 100, slope: 0.01 },
    { from: 100, to: 200, slope: 0.1 },
    { from: 200, to: 300, slope: 0.3 },
    { from: 300, to: 400, slope: -0.1 },
    { from: 400, to: 500, slope: -0.3 },
  ]);
  assert.ok(Math.abs(bins.flatUp - 1) < 1e-9);
  assert.ok(Math.abs(bins.gentleUp - 10) < 1e-9);
  assert.ok(Math.abs(bins.steepUp - 30) < 1e-9);
  assert.ok(Math.abs(bins.gentleDown - 10) < 1e-9);
  assert.ok(Math.abs(bins.steepDown - 30) < 1e-9);
});
