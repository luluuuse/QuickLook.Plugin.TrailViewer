import { distanceMeters } from './geo.js';

export const TRACK_COLOR_MODES = Object.freeze(['single', 'elevation', 'speed', 'heartRate']);
export const NEUTRAL_COLOR = '#7f8c8d';

const COLOR_STOPS = Object.freeze({
  elevation: [
    [0, [46, 204, 113]],
    [0.35, [241, 196, 15]],
    [0.7, [230, 126, 34]],
    [1, [255, 71, 87]],
  ],
  speed: [
    [0, [155, 89, 182]],
    [0.5, [52, 152, 219]],
    [1, [0, 229, 255]],
  ],
  heartRate: [
    [0, [248, 165, 194]],
    [0.4, [255, 107, 129]],
    [0.75, [255, 46, 76]],
    [1, [179, 18, 55]],
  ],
});

const GRADIENTS = Object.freeze({
  elevation: 'linear-gradient(90deg, #2ecc71 0%, #f1c40f 35%, #e67e22 70%, #ff4757 100%)',
  speed: 'linear-gradient(90deg, #9b59b6 0%, #3498db 50%, #00e5ff 100%)',
  heartRate: 'linear-gradient(90deg, #f8a5c2 0%, #ff6b81 40%, #ff2e4c 75%, #b31237 100%)',
});

const BUCKET_COUNT = 24;
const MIN_MOVING_SPEED_MPS = 0.15;
const MAX_PLAUSIBLE_SPEED_MPS = 35;

export function normalizeTrackColorMode(value) {
  return TRACK_COLOR_MODES.includes(value) ? value : 'single';
}

export function trackColorGradient(mode) {
  return GRADIENTS[mode] || '';
}

function segmentPoints(segment) {
  return Array.isArray(segment) ? segment : (segment?.points || []);
}

export function trackColorCapabilities(gpx) {
  let elevation = false;
  let speed = false;
  let heartRate = false;
  for (const track of gpx?.tracks || []) {
    for (const segment of track.segments || []) {
      let prevTimed = null;
      for (const point of segmentPoints(segment)) {
        if (Number.isFinite(point.ele)) elevation = true;
        if (Number.isFinite(point.heartRate) && point.heartRate > 0) heartRate = true;
        if (point.time instanceof Date && Number.isFinite(point.time.getTime())) {
          if (prevTimed && point.time.getTime() > prevTimed.time.getTime()) speed = true;
          prevTimed = point;
        }
        if (elevation && speed && heartRate) return { elevation, speed, heartRate };
      }
    }
  }
  return { elevation, speed, heartRate };
}

function rawValues(points, mode) {
  const values = new Array(points.length).fill(null);
  if (mode === 'elevation') {
    for (let i = 0; i < points.length; i += 1) {
      if (Number.isFinite(points[i].ele)) values[i] = points[i].ele;
    }
    return values;
  }
  if (mode === 'heartRate') {
    for (let i = 0; i < points.length; i += 1) {
      const hr = points[i].heartRate;
      if (Number.isFinite(hr) && hr > 0) values[i] = hr;
    }
    return values;
  }
  if (mode === 'speed') {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (!(a.time instanceof Date) || !(b.time instanceof Date)) continue;
      const dt = (b.time.getTime() - a.time.getTime()) / 1000;
      if (!Number.isFinite(dt) || dt <= 0) continue;
      const dist = distanceMeters(a, b);
      const v = dist / dt;
      if (Number.isFinite(v) && v >= MIN_MOVING_SPEED_MPS && v <= MAX_PLAUSIBLE_SPEED_MPS) {
        values[i] = v;
        if (values[i - 1] === null) values[i - 1] = v;
      }
    }
  }
  return values;
}

function smoothSeries(values) {
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) continue;
    let sum = values[i];
    let count = 1;
    if (i > 0 && Number.isFinite(values[i - 1])) {
      sum += values[i - 1];
      count += 1;
    }
    if (i + 1 < values.length && Number.isFinite(values[i + 1])) {
      sum += values[i + 1];
      count += 1;
    }
    out[i] = sum / count;
  }
  return out;
}

function sampleRamp(mode, t) {
  const stops = COLOR_STOPS[mode];
  if (!stops) return NEUTRAL_COLOR;
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i += 1) {
    const [t1, c1] = stops[i];
    if (clamped <= t1) {
      const [t0, c0] = stops[i - 1];
      const local = t1 === t0 ? 0 : (clamped - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * local);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * local);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * local);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  const last = stops[stops.length - 1][1];
  return `rgb(${last[0]}, ${last[1]}, ${last[2]})`;
}

export function trackColorRange(tracks, mode) {
  if (!COLOR_STOPS[mode]) return { min: null, max: null, valid: false };
  let min = Infinity;
  let max = -Infinity;
  for (const track of tracks || []) {
    for (const segment of track.segments || []) {
      const smoothed = smoothSeries(rawValues(segmentPoints(segment), mode));
      for (const value of smoothed) {
        if (!Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: null, max: null, valid: false };
  }
  return { min, max, valid: true };
}

export function computeColorSegments(points, mode, range = null) {
  if (!points || points.length < 2 || !COLOR_STOPS[mode]) {
    return { segments: [], min: null, max: null, valid: false };
  }
  const smoothed = smoothSeries(rawValues(points, mode));
  let min = range?.min;
  let max = range?.max;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = Infinity;
    max = -Infinity;
    for (const value of smoothed) {
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  const valid = Number.isFinite(min) && Number.isFinite(max);
  const span = valid && max > min ? max - min : 0;

  const segments = [];
  for (let i = 1; i < points.length; i += 1) {
    const v0 = smoothed[i - 1];
    const v1 = smoothed[i];
    let color = NEUTRAL_COLOR;
    if (valid && (Number.isFinite(v0) || Number.isFinite(v1))) {
      const avg = Number.isFinite(v0) && Number.isFinite(v1)
        ? (v0 + v1) / 2
        : (Number.isFinite(v0) ? v0 : v1);
      const ratio = span > 0 ? (avg - min) / span : 0.5;
      const quantized = Math.round(Math.max(0, Math.min(1, ratio)) * (BUCKET_COUNT - 1)) / (BUCKET_COUNT - 1);
      color = sampleRamp(mode, quantized);
    }
    const prev = segments[segments.length - 1];
    if (prev && prev.color === color) {
      prev.points.push(points[i]);
    } else {
      segments.push({ points: [points[i - 1], points[i]], color });
    }
  }
  return { segments, min: valid ? min : null, max: valid ? max : null, valid };
}
