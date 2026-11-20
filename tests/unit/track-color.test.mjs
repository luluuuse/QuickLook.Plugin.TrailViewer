import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEUTRAL_COLOR,
  computeColorSegments,
  normalizeTrackColorMode,
  trackColorCapabilities,
  trackColorRange,
} from '../../viewer/track-color.js';

function timedPoint(lat, lon, ele, seconds, hr = null) {
  return {
    lat,
    lon,
    ele,
    time: seconds === null ? null : new Date(1700000000000 + seconds * 1000),
    heartRate: hr,
  };
}

test('normalizeTrackColorMode accepts known modes and falls back to single', () => {
  assert.equal(normalizeTrackColorMode('elevation'), 'elevation');
  assert.equal(normalizeTrackColorMode('speed'), 'speed');
  assert.equal(normalizeTrackColorMode('heartRate'), 'heartRate');
  assert.equal(normalizeTrackColorMode('unknown'), 'single');
  assert.equal(normalizeTrackColorMode(null), 'single');
});

test('trackColorCapabilities detects elevation, speed, and heartRate independently', () => {
  const basic = trackColorCapabilities({
    tracks: [{ segments: [{ points: [{ lat: 46.5, lon: 7.9, ele: 500, time: null }] }] }],
  });
  assert.deepEqual(basic, { elevation: true, speed: false, heartRate: false });

  const full = trackColorCapabilities({
    tracks: [{
      segments: [{
        points: [
          timedPoint(46.5, 7.9, 500, 0, 120),
          timedPoint(46.501, 7.9, 520, 30, 145),
        ],
      }],
    }],
  });
  assert.deepEqual(full, { elevation: true, speed: true, heartRate: true });
});

test('computeColorSegments produces distinct elevation colors and merges matching buckets', () => {
  const points = [
    timedPoint(46.5, 7.9, 100, 0),
    timedPoint(46.501, 7.9, 100, 30),
    timedPoint(46.502, 7.9, 500, 60),
    timedPoint(46.503, 7.9, 1000, 90),
    timedPoint(46.504, 7.9, 1000, 120),
  ];
  const result = computeColorSegments(points, 'elevation');
  assert.equal(result.valid, true);
  assert.equal(result.min, 100);
  assert.equal(result.max, 1000);
  assert.ok(result.segments.length >= 2 && result.segments.length <= points.length - 1);
  assert.notEqual(result.segments[0].color, result.segments[result.segments.length - 1].color);
});

test('computeColorSegments falls back to neutral color when speed or heartRate data is missing', () => {
  const points = [
    timedPoint(46.5, 7.9, 500, null, null),
    timedPoint(46.501, 7.9, 520, null, null),
  ];
  const speedResult = computeColorSegments(points, 'speed');
  assert.equal(speedResult.valid, false);
  assert.equal(speedResult.segments[0].color, NEUTRAL_COLOR);

  const hrResult = computeColorSegments(points, 'heartRate');
  assert.equal(hrResult.valid, false);
  assert.equal(hrResult.segments[0].color, NEUTRAL_COLOR);
});

test('trackColorRange aggregates min and max across multiple tracks', () => {
  const tracks = [
    { segments: [{ points: [timedPoint(46.5, 7.9, 200, 0, 110), timedPoint(46.501, 7.9, 300, 30, 130)] }] },
    { segments: [{ points: [timedPoint(46.502, 7.9, 800, 60, 170), timedPoint(46.503, 7.9, 900, 90, 170)] }] },
  ];
  const eleRange = trackColorRange(tracks, 'elevation');
  assert.equal(eleRange.valid, true);
  assert.equal(eleRange.min, 250);
  assert.equal(eleRange.max, 850);

  const hrRange = trackColorRange(tracks, 'heartRate');
  assert.equal(hrRange.valid, true);
  assert.equal(hrRange.min, 120);
  assert.equal(hrRange.max, 170);
});
