// Per-kilometre route statistics. The first UI phase reads only distance, elapsed time and moving speed;
// the remaining fields are calculated here so the detailed split view can be added without changing the
// source model or duplicating the route walk.

import { distanceMeters } from './geo.js';

const MOVE_START_MPS = 0.1;
const MOVE_STOP_MPS = 0.02;
const TIME_GAP_SECONDS = 300;
const EPSILON = 1e-6;

/** @typedef {import('./types.js').ParsedTrack} ParsedTrack */
/** @typedef {import('./types.js').TrackSummary} TrackSummary */
/** @typedef {import('./types.js').SplitData} SplitData */

function secondsBetween(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return null;
  const seconds = (end.getTime() - start.getTime()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function traversal(gpx) {
  const intervals = [];
  let along = 0;

  for (const track of gpx.tracks) {
    for (const segment of track.segments) {
      let previous = null;
      for (const point of segment) {
        if (previous) {
          const metres = distanceMeters(previous, point);
          intervals.push({
            from: along,
            to: along + metres,
            metres,
            startTime: previous.time,
            endTime: point.time,
            startEle: previous.ele,
            endEle: point.ele,
            startHeartRate: previous.heartRate,
            endHeartRate: point.heartRate,
            moving: false,
          });
          along += metres;
        }
        previous = point;
      }
    }
  }
  return { intervals, total: along };
}

function markMoving(intervals) {
  let moving = false;
  for (const interval of intervals) {
    const seconds = secondsBetween(interval.startTime, interval.endTime);
    if (!(seconds > 0) || seconds > TIME_GAP_SECONDS) {
      moving = false;
      continue;
    }
    const speed = interval.metres / seconds;
    if (!moving && speed >= MOVE_START_MPS) moving = true;
    else if (moving && speed < MOVE_STOP_MPS) {
      moving = false;
      continue;
    }
    interval.moving = moving;
  }
}

function timeAt(intervals, distance, total, side = 'start') {
  const starts = [];
  const ends = [];
  for (const interval of intervals) {
    if (distance < interval.from - EPSILON || distance > interval.to + EPSILON) continue;
    const hasTimes = interval.startTime instanceof Date && interval.endTime instanceof Date;
    if (hasTimes && distance > interval.from + EPSILON && distance < interval.to - EPSILON
        && interval.metres > 0) {
      const ratio = Math.min(1, Math.max(0, (distance - interval.from) / interval.metres));
      const milliseconds = interval.startTime.getTime()
        + (interval.endTime.getTime() - interval.startTime.getTime()) * ratio;
      const value = new Date(milliseconds);
      if (!Number.isNaN(value.getTime())) return value;
    }
    if (interval.startTime instanceof Date && Math.abs(distance - interval.from) <= EPSILON) {
      starts.push(interval.startTime);
    }
    if (interval.endTime instanceof Date && Math.abs(distance - interval.to) <= EPSILON) {
      ends.push(interval.endTime);
    }
  }
  const earliest = (values) => values.length > 0
    ? new Date(Math.min(...values.map((value) => value.getTime())))
    : null;
  const latest = (values) => values.length > 0
    ? new Date(Math.max(...values.map((value) => value.getTime())))
    : null;
  if (distance <= EPSILON) return earliest(starts) || earliest(ends);
  if (distance >= total - EPSILON) return latest(ends) || latest(starts);
  return side === 'end'
    ? earliest(ends) || earliest(starts)
    : latest(starts) || latest(ends);
}

function intervalHeartRate(interval) {
  const rates = [interval.startHeartRate, interval.endHeartRate]
    .filter((value) => Number.isFinite(value) && value > 0);
  return rates.length > 0 ? rates.reduce((sum, value) => sum + value, 0) / rates.length : null;
}

function splitMetrics(intervals, from, to) {
  let movingSeconds = 0;
  let ascent = 0;
  let descent = 0;
  let heartWeight = 0;
  let heartDistance = 0;

  for (const interval of intervals) {
    const overlap = Math.min(to, interval.to) - Math.max(from, interval.from);
    if (!(overlap > 0)) continue;
    const fraction = interval.metres > 0 ? overlap / interval.metres : 0;

    const seconds = secondsBetween(interval.startTime, interval.endTime);
    if (interval.moving && seconds > 0) movingSeconds += seconds * fraction;

    if (Number.isFinite(interval.startEle) && Number.isFinite(interval.endEle)) {
      const change = (interval.endEle - interval.startEle) * fraction;
      if (change > 0) ascent += change;
      else descent -= change;
    }

    const heartRate = intervalHeartRate(interval);
    if (heartRate !== null) {
      heartWeight += overlap;
      heartDistance += heartRate * overlap;
    }
  }

  return {
    movingSeconds,
    ascent,
    descent,
    averageHeartRate: heartWeight > 0 ? heartDistance / heartWeight : null,
  };
}

/**
 * Cuts recorded tracks into whole-kilometre splits, with the final row holding the remainder.
 * Distances between recorded segments are not invented; time still spans the real timestamps at a split
 * boundary, while moving time only counts plausible movement intervals.
 * @param {ParsedTrack} gpx
 * @param {TrackSummary | null} [summary]
 * @returns {SplitData}
 */
export function analyseSplits(gpx, summary = null) {
  const { intervals, total } = traversal(gpx);
  if (!(total > 0) || intervals.length === 0) {
    return {
      splits: [],
      totalDistanceMeters: 0,
      totalTimeSeconds: null,
      movingTimeSeconds: null,
      fastestIndex: null,
      hasHeartRate: false,
    };
  }

  markMoving(intervals);
  const recordedStart = timeAt(intervals, 0, total, 'start');
  const splits = [];
  for (let from = 0, index = 1; from < total - EPSILON; from += 1000, index += 1) {
    const to = Math.min(total, from + 1000);
    const distance = to - from;
    const startTime = timeAt(intervals, from, total, 'start');
    const endTime = timeAt(intervals, to, total, 'end');
    const elapsed = secondsBetween(startTime, endTime);
    const metrics = splitMetrics(intervals, from, to);
    const metadataRatio = summary?.movingTimeSource === 'metadata'
      && summary.durationSeconds > 0
      && summary.movingDurationSeconds !== null
      ? Math.min(1, Math.max(0, summary.movingDurationSeconds / summary.durationSeconds))
      : null;
    const movingSeconds = metadataRatio !== null && elapsed !== null
      ? elapsed * metadataRatio
      : metrics.movingSeconds;
    const speedSeconds = movingSeconds > 0 ? movingSeconds : elapsed;
    const averageSpeedMps = speedSeconds > 0 ? distance / speedSeconds : null;
    const cumulativeSeconds = secondsBetween(recordedStart, endTime);
    const verticalSpeedMps = movingSeconds > 0
      ? (metrics.ascent - metrics.descent) / movingSeconds
      : null;

    splits.push({
      index,
      fromMeters: from,
      toMeters: to,
      distanceMeters: distance,
      elapsedSeconds: elapsed === null ? null : Math.round(elapsed),
      movingSeconds: movingSeconds > 0 ? Math.round(movingSeconds) : null,
      cumulativeSeconds: cumulativeSeconds === null ? null : Math.round(cumulativeSeconds),
      averageSpeedMps,
      ascentMeters: metrics.ascent,
      descentMeters: metrics.descent,
      verticalSpeedMps,
      averageHeartRate: metrics.averageHeartRate,
    });
  }

  const totalEnd = timeAt(intervals, total, total, 'end');
  const totalTime = secondsBetween(recordedStart, totalEnd);
  const splitMovingTime = splits.reduce((sum, split) => sum + (split.movingSeconds || 0), 0);
  const movingTime = totalTime === null ? splitMovingTime : Math.min(splitMovingTime, totalTime);
  let fastestIndex = null;
  let fastestSpeed = -Infinity;
  for (const split of splits) {
    if (split.averageSpeedMps !== null && split.averageSpeedMps > fastestSpeed) {
      fastestSpeed = split.averageSpeedMps;
      fastestIndex = split.index;
    }
  }

  return {
    splits,
    totalDistanceMeters: total,
    totalTimeSeconds: totalTime === null ? null : Math.round(totalTime),
    movingTimeSeconds: movingTime > 0 ? Math.round(movingTime) : null,
    fastestIndex,
    hasHeartRate: splits.some((split) => split.averageHeartRate !== null),
  };
}
