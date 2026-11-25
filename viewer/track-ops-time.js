import { distanceMeters } from './geo.js';
import { clearSummaryMetadata, cloneParsedTrack, ensureTracksMutable } from './track-ops-core.js';

export function shiftTrackTimestamps(parsed, offsetSeconds) {
  const next = cloneParsedTrack(parsed);
  if (!Number.isFinite(offsetSeconds) || offsetSeconds === 0) {
    return { track: next, shiftedCount: 0 };
  }
  const deltaMs = offsetSeconds * 1000;
  let shiftedCount = 0;
  const shiftPt = (pt) => {
    if (pt.time instanceof Date && Number.isFinite(pt.time.getTime())) {
      pt.time = new Date(pt.time.getTime() + deltaMs);
      shiftedCount += 1;
    }
  };
  for (const track of next.tracks) {
    for (const seg of track.segments || []) seg.forEach(shiftPt);
  }
  for (const route of next.routes || []) {
    (route.points || []).forEach(shiftPt);
  }
  (next.waypoints || []).forEach(shiftPt);
  if (shiftedCount > 0) clearSummaryMetadata(next);
  return { track: next, shiftedCount };
}

/**
 * Generates monotonic virtual timestamps across all segments from startTimeMs at speedMps.
 * When gradeAdjusted is true and adjacent points have elevation, applies Naismith/Langmuir
 * climb and steep-descent adjustments while gracefully falling back to flat speed when elevation is missing.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} startTimeMs
 * @param {number} speedMps
 * @param {{ gradeAdjusted?: boolean }} [options]
 */
export function generateVirtualTimeline(parsed, startTimeMs, speedMps, { gradeAdjusted = false } = {}) {
  const next = cloneParsedTrack(parsed);
  if (!Number.isFinite(startTimeMs) || !Number.isFinite(speedMps) || speedMps <= 0) {
    return { track: next, durationSeconds: 0, pointCount: 0 };
  }
  const segs = ensureTracksMutable(next);
  let cursorMs = startTimeMs;
  let pointCount = 0;
  // Langmuir slope thresholds: tan(5 deg) ~= 0.08749, tan(12 deg) ~= 0.21256.
  const GENTLE_DOWN_TAN = Math.tan((5 * Math.PI) / 180);
  const STEEP_DOWN_TAN = Math.tan((12 * Math.PI) / 180);

  segs.forEach((seg, segIdx) => {
    if (segIdx > 0 && seg.length > 0) {
      cursorMs += 1000;
    }
    for (let i = 0; i < seg.length; i += 1) {
      if (i > 0) {
        const a = seg[i - 1];
        const b = seg[i];
        const d = distanceMeters(a, b);
        let stepSeconds = d / speedMps;
        if (gradeAdjusted && Number.isFinite(a.ele) && Number.isFinite(b.ele)) {
          const de = b.ele - a.ele;
          if (de > 0) {
            // Naismith: +1 h per 600 m climb (+6 s/m).
            stepSeconds += de * 6;
          } else if (de < 0 && d > 0) {
            const drop = -de;
            const slope = drop / d;
            if (slope > STEEP_DOWN_TAN) {
              // Langmuir steep descent (> 12 deg): +10 min per 300 m drop (+2 s/m).
              stepSeconds += drop * 2;
            } else if (slope >= GENTLE_DOWN_TAN) {
              // Langmuir moderate descent (5-12 deg): faster, clamped at 60% of flat time.
              stepSeconds = Math.max(stepSeconds * 0.6, stepSeconds - drop * 2);
            }
          }
        }
        cursorMs += Math.max(0, stepSeconds) * 1000;
      }
      seg[i].time = new Date(Math.round(cursorMs));
      pointCount += 1;
    }
  });
  const durationSeconds = Math.max(0, Math.round((cursorMs - startTimeMs) / 1000));
  if (pointCount > 0) clearSummaryMetadata(next);
  return { track: next, durationSeconds, pointCount };
}


function segmentAscentMeters(segs) {
  let gain = 0;
  for (const seg of segs) {
    let prevEle = null;
    for (const pt of seg) {
      if (!Number.isFinite(pt.ele)) continue;
      if (prevEle !== null && pt.ele > prevEle) gain += pt.ele - prevEle;
      prevEle = pt.ele;
    }
  }
  return Math.round(gain);
}

function medianValue(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

/**
 * Smooths GPS elevation spikes and micro-jitter while preserving segment endpoints and all non-elevation fields.
 * Step 1: local median filter removes isolated spikes and zero-dropouts.
 * Step 2: symmetric triangular weighted moving average smooths jitter.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {{ windowSize?: number, spikeThresholdMeters?: number }} [options]
 */
export function smoothTrackElevation(parsed, { windowSize = 5, spikeThresholdMeters = 30 } = {}) {
  const next = cloneParsedTrack(parsed);
  const segs = ensureTracksMutable(next);
  const beforeAscent = segmentAscentMeters(segs);
  const radius = Math.max(1, Math.floor((Math.max(3, Number(windowSize) || 5)) / 2));
  const spikeLimit = Math.max(1, Number(spikeThresholdMeters) || 30);
  let adjustedCount = 0;

  for (const seg of segs) {
    const validIndices = [];
    for (let i = 0; i < seg.length; i += 1) {
      if (Number.isFinite(seg[i].ele)) validIndices.push(i);
    }
    if (validIndices.length < 3) continue;

    const raw = validIndices.map((idx) => seg[idx].ele);
    const cumDist = new Float64Array(validIndices.length);
    for (let k = 1; k < validIndices.length; k += 1) {
      cumDist[k] = cumDist[k - 1] + distanceMeters(seg[validIndices[k - 1]], seg[validIndices[k]]);
    }

    // Step 1: despike with local median (including first & last valid points to catch barometer startup spikes).
    const despiked = [...raw];
    const edgeSpan = Math.min(raw.length - 1, radius * 2);
    for (let k = 0; k < raw.length; k += 1) {
      const neighborhood = [];
      if (k === 0) {
        for (let j = 1; j <= edgeSpan; j += 1) neighborhood.push(raw[j]);
      } else if (k === raw.length - 1) {
        for (let j = Math.max(0, raw.length - 1 - edgeSpan); j < raw.length - 1; j += 1) neighborhood.push(raw[j]);
      } else {
        const start = Math.max(0, k - radius);
        const end = Math.min(raw.length - 1, k + radius);
        for (let j = start; j <= end; j += 1) neighborhood.push(raw[j]);
      }
      const med = medianValue(neighborhood);
      if (Math.abs(raw[k] - med) >= spikeLimit || (raw[k] === 0 && Math.abs(med) >= spikeLimit)) {
        despiked[k] = med;
      }
    }

    // Apply endpoint despike corrections directly while keeping non-spiked endpoints anchored.
    for (const edgeK of [0, despiked.length - 1]) {
      const rounded = Math.round(despiked[edgeK] * 10) / 10;
      const idx = validIndices[edgeK];
      if (Math.abs(rounded - seg[idx].ele) >= 0.05) {
        seg[idx].ele = rounded;
        adjustedCount += 1;
      }
    }

    // Step 2: distance-weighted moving average (falls back to index weights if points are stationary).
    for (let k = 1; k < despiked.length - 1; k += 1) {
      const start = Math.max(0, k - radius);
      const end = Math.min(despiked.length - 1, k + radius);
      const span = Math.max(cumDist[end] - cumDist[k], cumDist[k] - cumDist[start]);
      let weightedSum = 0;
      let weightTotal = 0;
      for (let j = start; j <= end; j += 1) {
        const w = span > 0
          ? Math.max(0.05, 1 - Math.abs(cumDist[j] - cumDist[k]) / (span * 1.05))
          : (radius + 1 - Math.abs(j - k));
        weightedSum += despiked[j] * w;
        weightTotal += w;
      }
      const smoothed = Math.round((weightedSum / weightTotal) * 10) / 10;
      const idx = validIndices[k];
      if (Math.abs(smoothed - seg[idx].ele) >= 0.05) {
        seg[idx].ele = smoothed;
        adjustedCount += 1;
      }
    }
  }

  const afterAscent = segmentAscentMeters(segs);
  if (adjustedCount > 0) clearSummaryMetadata(next);
  return { track: next, beforeAscent, afterAscent, adjustedCount };
}

