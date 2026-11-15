import assert from 'node:assert/strict';
import test from 'node:test';

import { analyseSplits } from '../../viewer/split-analysis.js';

const START = new Date('2026-01-01T09:00:00Z');

function at(seconds) {
  return new Date(START.getTime() + seconds * 1000);
}

function point(lat, seconds, extra = {}) {
  return { lat, lon: 0, time: seconds === null ? undefined : at(seconds), ...extra };
}

test('splits cut a timed route at whole kilometres and keep the final remainder', () => {
  const points = Array.from({ length: 7 }, (_, index) => point(
    index * 0.0045,
    index * 120,
    { ele: 100 + index * 10, heartRate: 110 + index },
  ));
  const data = analyseSplits({ tracks: [{ segments: [points] }] });

  assert.equal(data.splits.length, 4);
  assert.ok(data.splits.slice(0, 3).every((split) => Math.abs(split.distanceMeters - 1000) < 1e-6));
  assert.ok(data.splits[3].distanceMeters > 0 && data.splits[3].distanceMeters < 1000);
  assert.ok(Math.abs(data.splits.reduce((sum, split) => sum + split.distanceMeters, 0)
    - data.totalDistanceMeters) < 1e-6);
  assert.equal(data.splits[0].elapsedSeconds > 0, true);
  assert.equal(data.splits[0].averageSpeedMps > 0, true);
  assert.equal(data.splits.at(-1).cumulativeSeconds, 720);
  assert.equal(data.totalTimeSeconds, 720);
  assert.ok(data.movingTimeSeconds > 700);
  assert.equal(data.hasHeartRate, true);
  assert.ok(data.splits[0].averageHeartRate >= 110 && data.splits[0].averageHeartRate <= 111);
  assert.ok(data.splits[0].ascentMeters > 0);
  assert.ok(data.fastestIndex >= 1 && data.fastestIndex <= data.splits.length);
});

test('stationary time stays in elapsed time but is excluded from moving speed', () => {
  const points = [
    point(0, 0),
    point(0.002, 50),
    point(0.002, 300),
    point(0.00675, 350),
  ];
  const data = analyseSplits({ tracks: [{ segments: [points] }] });
  const split = data.splits[0];

  assert.equal(split.elapsedSeconds, 350);
  assert.equal(split.movingSeconds, 100);
  assert.ok(Math.abs(split.averageSpeedMps - split.distanceMeters / 100) < 1e-9);
  assert.equal(data.totalTimeSeconds, 350);
  assert.equal(data.movingTimeSeconds, 100);
});

test('a recorded pause total scales split moving time consistently', () => {
  const points = [
    point(0, 0),
    point(0.002, 50),
    point(0.002, 300),
    point(0.00675, 350),
  ];
  const data = analyseSplits(
    { tracks: [{ segments: [points] }] },
    {
      movingTimeSource: 'metadata',
      durationSeconds: 350,
      movingDurationSeconds: 200,
    },
  );

  assert.equal(data.splits[0].elapsedSeconds, 350);
  assert.equal(data.splits[0].movingSeconds, 200);
});

test('a route without timestamps yields no displayable split table but keeps distance rows', () => {
  const points = [point(0, null), point(0.0045, null), point(0.009, null)];
  const data = analyseSplits({ tracks: [{ segments: [points] }] });

  assert.ok(data.totalDistanceMeters > 0);
  assert.ok(data.splits.length >= 1);
  assert.ok(data.splits.every((split) => split.elapsedSeconds === null && split.averageSpeedMps === null));
});
