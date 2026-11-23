import {
  elevationGain,
  groundRuns,
  sliceCurveByDistance,
  smooth,
} from './profile.js';
import { isValidHeartRate } from './track-analysis.js';

const DEFAULT_MIN_LENGTH = 300;
const DEFAULT_MIN_ASCENT = 30;
const DEFAULT_MIN_AVG_GRADE = 0.04;
const BRIDGE_MAX_GAP_METERS = 150;
const BRIDGE_MAX_DROP_METERS = 10;

function isClimbGrade(grade) {
  return grade === 'up' || grade === 'steepUp';
}

function interpolateEleAt(samples, target) {
  if (!samples || samples.length === 0) return null;
  if (target <= samples[0].along) return samples[0].ele;
  if (target >= samples[samples.length - 1].along) return samples[samples.length - 1].ele;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (samples[mid].along <= target) low = mid;
    else high = mid - 1;
  }
  const a = samples[low];
  const b = samples[low + 1] || a;
  const span = b.along - a.along;
  const t = span > 0 ? Math.min(1, Math.max(0, (target - a.along) / span)) : 0;
  return a.ele + (b.ele - a.ele) * t;
}

function maxLocalGrade(sliced, cells, from, to) {
  let peak = 0;
  if (Array.isArray(cells)) {
    for (const cell of cells) {
      if (cell.to >= from && cell.from <= to && cell.slope > peak) peak = cell.slope;
    }
  }
  if (peak > 0) return peak;
  for (let i = 0; i < sliced.length; i += 1) {
    let j = i + 1;
    while (j < sliced.length && sliced[j].along - sliced[i].along < 50) j += 1;
    if (j < sliced.length) {
      const span = sliced[j].along - sliced[i].along;
      if (span > 0) peak = Math.max(peak, (sliced[j].ele - sliced[i].ele) / span);
    }
  }
  return peak;
}

/**
 * Identifies major ClimbPro-style climbing stretches from elevation samples.
 * @param {Array<{ along: number, ele: number }>} samples
 * @param {Array<{ from: number, to: number, slope: number }> | null} [cells]
 */
export function detectClimbs(samples, cells = null, {
  minLength = DEFAULT_MIN_LENGTH,
  minAscent = DEFAULT_MIN_ASCENT,
  minAvgGrade = DEFAULT_MIN_AVG_GRADE,
} = {}) {
  if (!Array.isArray(samples) || samples.length < 2) return [];
  const runs = groundRuns(samples);
  const spans = [];
  for (const run of runs) {
    if (isClimbGrade(run.grade)) {
      const prev = spans[spans.length - 1];
      if (prev && prev.open) {
        prev.to = run.to;
      } else {
        spans.push({ from: run.from, to: run.to, open: true });
      }
      continue;
    }
    const prev = spans[spans.length - 1];
    if (!prev || !prev.open) continue;
    const gap = run.to - run.from;
    if (run.grade === 'flat' && gap <= BRIDGE_MAX_GAP_METERS) {
      const eleStart = interpolateEleAt(samples, run.from);
      const eleEnd = interpolateEleAt(samples, run.to);
      if (eleStart !== null && eleEnd !== null && eleStart - eleEnd <= BRIDGE_MAX_DROP_METERS) {
        continue;
      }
    }
    prev.open = false;
  }

  const merged = [];
  for (const span of spans) {
    const prev = merged[merged.length - 1];
    if (prev && span.from - prev.to <= BRIDGE_MAX_GAP_METERS) {
      const eleStart = interpolateEleAt(samples, prev.to);
      const eleEnd = interpolateEleAt(samples, span.from);
      if (eleStart !== null && eleEnd !== null && eleStart - eleEnd <= BRIDGE_MAX_DROP_METERS) {
        prev.to = span.to;
        continue;
      }
    }
    merged.push({ from: span.from, to: span.to });
  }

  const climbs = [];
  for (const span of merged) {
    const lengthMeters = span.to - span.from;
    if (lengthMeters < minLength) continue;
    const sliced = sliceCurveByDistance(samples, span.from, span.to);
    if (sliced.length < 2) continue;
    const gain = elevationGain(smooth(sliced.map((point) => point.ele)));
    const netRise = sliced[sliced.length - 1].ele - sliced[0].ele;
    const ascent = Math.round(Math.max(gain.ascent, netRise));
    const avgGrade = netRise / lengthMeters;
    if (ascent < minAscent || avgGrade < minAvgGrade) continue;
    const maxGrade = Math.max(avgGrade, maxLocalGrade(sliced, cells, span.from, span.to));
    climbs.push({
      index: climbs.length + 1,
      fromMeters: span.from,
      toMeters: span.to,
      lengthMeters,
      ascent,
      avgGrade,
      maxGrade,
    });
  }
  return climbs;
}

function interpolateTimeMs(a, b, targetAlong) {
  if (!(a?.time instanceof Date) || !(b?.time instanceof Date)) return null;
  const aMs = a.time.getTime();
  const bMs = b.time.getTime();
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return null;
  const span = b.along - a.along;
  const ratio = span > 0 ? Math.min(1, Math.max(0, (targetAlong - a.along) / span)) : 0;
  return aMs + (bMs - aMs) * ratio;
}

/**
 * Computes distance, ascent/descent, average grade, duration, speed and heart rate for [fromMeters, toMeters].
 */
export function summariseRange(points, samples, fromMeters, toMeters) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const total = points[points.length - 1].along;
  const from = Math.max(0, Math.min(total, Number(fromMeters) || 0));
  const to = Math.max(0, Math.min(total, Number(toMeters) || 0));
  const distanceMeters = to - from;
  if (!(distanceMeters > 0)) return null;

  let ascent = null;
  let descent = null;
  let avgGrade = null;
  const sliced = Array.isArray(samples) && samples.length >= 2
    ? sliceCurveByDistance(samples, from, to)
    : [];
  if (sliced.length >= 2) {
    const gain = elevationGain(smooth(sliced.map((point) => point.ele)));
    const netChange = sliced[sliced.length - 1].ele - sliced[0].ele;
    ascent = Math.round(Math.max(gain.ascent, Math.max(0, netChange)));
    descent = Math.round(Math.max(gain.descent, Math.max(0, -netChange)));
    avgGrade = netChange / distanceMeters;
  }

  let totalMs = 0;
  let hasTime = false;
  let hrSum = 0;
  let hrCount = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p.along >= from && p.along <= to && isValidHeartRate(p.heartRate)) {
      hrSum += p.heartRate;
      hrCount += 1;
    }
    if (i === 0) continue;
    const prev = points[i - 1];
    if (prev.segmentIndex !== p.segmentIndex) continue;
    const segFrom = Math.max(from, prev.along);
    const segTo = Math.min(to, p.along);
    if (!(segTo > segFrom)) continue;
    const t0 = interpolateTimeMs(prev, p, segFrom);
    const t1 = interpolateTimeMs(prev, p, segTo);
    if (t0 !== null && t1 !== null && t1 >= t0) {
      totalMs += t1 - t0;
      hasTime = true;
    }
  }

  const durationSeconds = hasTime && totalMs > 0 ? Math.round(totalMs / 1000) : null;
  const avgSpeedMps = durationSeconds && durationSeconds > 0 ? distanceMeters / durationSeconds : null;
  const avgHeartRate = hrCount > 0 ? Math.round(hrSum / hrCount) : null;

  return {
    fromMeters: from,
    toMeters: to,
    distanceMeters,
    ascent,
    descent,
    avgGrade,
    durationSeconds,
    avgSpeedMps,
    avgHeartRate,
  };
}
