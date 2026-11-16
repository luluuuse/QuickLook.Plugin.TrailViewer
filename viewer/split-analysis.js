// Per-kilometre route statistics. The first UI phase reads only distance, elapsed time and moving speed;
// the remaining fields are calculated here so the detailed split view can be added without changing the
// source model or duplicating the route walk.

import { MOVEMENT_RULES, averageHeartRate, isValidHeartRate } from './track-analysis.js';
import { createRouteModel } from './route-model.js';

const EPSILON = 1e-6;

/** @typedef {import('./types.js').ParsedTrack} ParsedTrack */
/** @typedef {import('./types.js').TrackSummary} TrackSummary */
/** @typedef {import('./types.js').SplitData} SplitData */

function secondsBetween(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return null;
  const seconds = (end.getTime() - start.getTime()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function traversal(model) {
  const intervals = [];
  const heartSamples = [];
  let lineIndex = -1;

  for (const line of model.tracks) {
    lineIndex += 1;
    for (let index = 0; index < line.points.length; index += 1) {
      const point = line.points[index];
      if (index > 0) {
        const previous = line.points[index - 1];
        const from = line.startMeters + line.cumulative[index - 1];
        const to = line.startMeters + line.cumulative[index];
        const metres = to - from;
        intervals.push({
          from,
          to,
          metres,
          startTime: previous.time,
          endTime: point.time,
          startEle: previous.ele,
          endEle: point.ele,
          moving: false,
          segmentIndex: lineIndex,
        });
      }
      if (isValidHeartRate(point.heartRate)) {
        heartSamples.push({
          along: line.startMeters + line.cumulative[index],
          heartRate: point.heartRate,
        });
      }
    }
  }
  return { intervals, heartSamples, total: model.trackDistanceMeters };
}

function markMoving(intervals) {
  let moving = false;
  let segmentIndex = -1;
  for (const interval of intervals) {
    if (interval.segmentIndex !== segmentIndex) {
      moving = false;
      segmentIndex = interval.segmentIndex;
    }
    const seconds = secondsBetween(interval.startTime, interval.endTime);
    if (!(seconds > 0) || seconds > MOVEMENT_RULES.maxGapSeconds) {
      moving = false;
      continue;
    }
    const speed = interval.metres / seconds;
    if (!moving && speed >= MOVEMENT_RULES.startSpeed) moving = true;
    else if (moving && speed < MOVEMENT_RULES.stopSpeed) {
      moving = false;
      continue;
    }
    interval.moving = moving;
  }
}

function timeAt(intervals, distance, total, side = 'start') {
  let low = 0;
  let high = intervals.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (intervals[middle].to < distance - EPSILON) low = middle + 1;
    else high = middle;
  }
  const containing = intervals[low];
  if (containing) {
    const hasTimes = containing.startTime instanceof Date && containing.endTime instanceof Date;
    if (hasTimes && distance > containing.from + EPSILON && distance < containing.to - EPSILON
        && containing.metres > 0) {
      const ratio = Math.min(1, Math.max(0, (distance - containing.from) / containing.metres));
      const milliseconds = containing.startTime.getTime()
        + (containing.endTime.getTime() - containing.startTime.getTime()) * ratio;
      const value = new Date(milliseconds);
      if (!Number.isNaN(value.getTime())) return value;
    }
  }

  let earliestStart = null;
  let earliestEnd = null;
  let latestStart = null;
  let latestEnd = null;
  for (let index = Math.max(0, low - 1);
    index < intervals.length && intervals[index].from <= distance + EPSILON;
    index += 1) {
    const interval = intervals[index];
    if (Math.abs(distance - interval.from) <= EPSILON && interval.startTime instanceof Date) {
      if (!earliestStart || interval.startTime < earliestStart) earliestStart = interval.startTime;
      if (!latestStart || interval.startTime > latestStart) latestStart = interval.startTime;
    }
    if (Math.abs(distance - interval.to) <= EPSILON && interval.endTime instanceof Date) {
      if (!earliestEnd || interval.endTime < earliestEnd) earliestEnd = interval.endTime;
      if (!latestEnd || interval.endTime > latestEnd) latestEnd = interval.endTime;
    }
    if (interval.from > distance + EPSILON) break;
  }
  const earliest = earliestStart || earliestEnd;
  const latest = latestEnd || latestStart;
  if (distance <= EPSILON) return earliest;
  if (distance >= total - EPSILON) return latest;
  return side === 'end'
    ? earliestEnd || earliestStart
    : latestStart || latestEnd;
}

export function splitCount(distance) {
  return distance > EPSILON ? Math.max(1, Math.ceil((distance - EPSILON) / 1000)) : 0;
}

function splitMetrics(intervals, from, to, state) {
  let movingSeconds = 0;
  let ascent = 0;
  let descent = 0;

  while (state.index < intervals.length && intervals[state.index].to <= from + EPSILON) {
    state.index += 1;
  }
  for (let index = state.index; index < intervals.length; index += 1) {
    const interval = intervals[index];
    if (interval.from > to - EPSILON) break;
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
  }

  return {
    movingSeconds,
    ascent,
    descent,
  };
}

function heartRateAverageIn(samples, from, to, includeEnd) {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].along < from - EPSILON) low = middle + 1;
    else high = middle;
  }
  const rates = [];
  for (let index = low; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.along > to + EPSILON || (!includeEnd && sample.along >= to - EPSILON)) break;
    rates.push(sample.heartRate);
  }
  return averageHeartRate(rates);
}

/**
 * Cuts recorded tracks into whole-kilometre splits, with the final row holding the remainder.
 * Distances between recorded segments are not invented; time still spans the real timestamps at a split
 * boundary, while moving time only counts plausible movement intervals.
 * @param {ParsedTrack} gpx
 * @param {TrackSummary | null} [summary]
 * @returns {SplitData}
 */
export function analyseSplits(gpx, summary = null, routeModel = null) {
  const model = routeModel || createRouteModel(gpx);
  const { intervals, heartSamples, total } = traversal(model);
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
  const count = splitCount(total);
  const metricsState = { index: 0 };
  for (let from = 0, index = 1; index <= count; from += 1000, index += 1) {
    const to = Math.min(total, from + 1000);
    const distance = to - from;
    const startTime = timeAt(intervals, from, total, 'start');
    const endTime = timeAt(intervals, to, total, 'end');
    const elapsed = secondsBetween(startTime, endTime);
    const metrics = splitMetrics(intervals, from, to, metricsState);
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
      averageHeartRate: heartRateAverageIn(heartSamples, from, to, index === count),
    });
  }

  const totalEnd = timeAt(intervals, total, total, 'end');
  const totalTime = secondsBetween(recordedStart, totalEnd);
  const splitMovingTime = splits.reduce((sum, split) => sum + (split.movingSeconds || 0), 0);
  const summaryMoving = Number.isFinite(summary?.movingDurationSeconds)
    ? summary.movingDurationSeconds
    : null;
  const movingTime = summaryMoving ?? (totalTime === null
    ? splitMovingTime
    : Math.min(splitMovingTime, totalTime));
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
    totalTimeSeconds: Number.isFinite(summary?.durationSeconds)
      ? Math.round(summary.durationSeconds)
      : totalTime === null ? null : Math.round(totalTime),
    movingTimeSeconds: movingTime > 0 ? Math.round(movingTime) : null,
    fastestIndex,
    hasHeartRate: splits.some((split) => split.averageHeartRate !== null),
  };
}
