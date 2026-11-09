import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptiveDistanceIntervals,
  directionSamples,
  findTrackGaps,
  gradeAwareHikeSeconds,
  movementSummary,
  naismithSeconds,
  routeDirectionSamples,
} from '../../viewer/track-analysis.js';

const at = (offset, seconds) => ({
  lat: 0,
  lon: offset,
  time: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)),
});

test('movement time excludes a stationary interval and counts one stop', () => {
  const track = {
    segments: [[
      at(0, 0),
      at(0.001, 20),
      at(0.001, 120),
      at(0.002, 140),
    ]],
  };
  assert.deepEqual(movementSummary([track]), {
    observedSeconds: 140,
    movingDurationSeconds: 40,
    pausedSeconds: 100,
    stops: 1,
    timeGaps: 0,
  });
});

test('a recording gap is classified without pretending it was walked', () => {
  const track = {
    segments: [
      [at(0, 0), at(0.001, 10)],
      [at(0.02, 400)],
    ],
  };
  const gaps = findTrackGaps([track], { maxDistanceMeters: 200 });
  assert.equal(gaps.count, 1);
  assert.equal(gaps.items[0].kind, 'segment');
  assert.ok(gaps.items[0].timeSeconds > 300);
});

test('a GPS jump inside a segment is marked as a jump', () => {
  const track = { segments: [[at(0, 0), at(0.001, 1)]] };
  const gaps = findTrackGaps([track]);
  assert.equal(gaps.count, 1);
  assert.equal(gaps.episodeCount, 1);
  assert.equal(gaps.items[0].kind, 'jump');
});

test('one bad GPS point is one episode rather than an exit and return', () => {
  const track = {
    segments: [[
      at(0, 0),
      { lat: 1, lon: 1, time: new Date(Date.UTC(2026, 0, 1, 0, 0, 2)) },
      at(0.001, 4),
    ]],
  };
  const gaps = findTrackGaps([track]);
  assert.equal(gaps.count, 2);
  assert.equal(gaps.episodeCount, 1);
  assert.equal(gaps.episodes[0].kind, 'jump');
  assert.equal(gaps.episodes[0].continuous, true);
  assert.equal(gaps.episodes[0].rawCount, 2);
});

test('kilometre samples interpolate position and preserve bearing', () => {
  const points = [at(0, 0), at(0.01, 100)];
  const samples = directionSamples(points);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].distanceMeters, 1000);
  assert.ok(Math.abs(samples[0].bearing - 90) < 0.01);
  assert.ok(samples[0].point.lon > 0.0089 && samples[0].point.lon < 0.0091);
});

test('route samples use one continuous distance across recorded parts', () => {
  const first = [at(0, 0), at(0.018, 100)];
  const second = [at(0.020, 200), at(0.038, 300)];
  const samples = routeDirectionSamples([first, second], { interval: 3000 });
  assert.equal(samples.length, 1);
  assert.equal(samples[0].distanceMeters, 3000);
  assert.ok(samples[0].point.lon > 0.0289 && samples[0].point.lon < 0.0291);
});

test('distance markers keep kilometre detail when the route fills the screen', () => {
  const intervals = adaptiveDistanceIntervals(15783.9239, 1202.3872);
  assert.equal(intervals.labelIntervalMeters, 1000);
  assert.equal(intervals.arrowIntervalMeters, 1000);
  assert.ok(intervals.pixelsPerKilometre > 76);
});

test('a long overview coarsens labels before direction arrows', () => {
  const intervals = adaptiveDistanceIntervals(100000, 2000);
  assert.equal(intervals.labelIntervalMeters, 5000);
  assert.equal(intervals.arrowIntervalMeters, 2000);

  const far = adaptiveDistanceIntervals(100000, 100);
  assert.equal(far.labelIntervalMeters, 100000);
  assert.equal(far.arrowIntervalMeters, 50000);
});

test('an empty route falls back to the smallest supported interval', () => {
  assert.deepEqual(adaptiveDistanceIntervals(0, 0), {
    labelIntervalMeters: 1000,
    arrowIntervalMeters: 1000,
    pixelsPerKilometre: 0,
  });
});

test('Naismith adds one hour for every 600 metres of ascent', () => {
  assert.equal(naismithSeconds(10000, 600), 10800);
  assert.equal(naismithSeconds(0, 0), 0);
});

test('grade-aware estimate prices steep ascent and Langmuir descent bands', () => {
  const steep = gradeAwareHikeSeconds({
    distance: 5000,
    ascent: 600,
    descent: 600,
    bins: { flatUp: 0, gentleUp: 0, steepUp: 600, flatDown: 0, gentleDown: 0, steepDown: 600 },
  });
  assert.equal(steep, 9600);

  const gentle = gradeAwareHikeSeconds({
    distance: 5000,
    ascent: 600,
    descent: 600,
    bins: { flatUp: 0, gentleUp: 600, steepUp: 0, flatDown: 0, gentleDown: 600, steepDown: 0 },
  });
  assert.equal(gentle, 6000);
});
