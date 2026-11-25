import { distanceMeters } from './geo.js';
import { isValidHeartRate } from './track-analysis.js';

/** High-contrast 12-color palette for multi-segment tracks (avoids common topo greens and grays). */
export const SPLIT_COLORS = Object.freeze([
  '#f97316', // orange
  '#38bdf8', // sky
  '#eab308', // amber
  '#e879f9', // fuchsia
  '#22d3ee', // cyan
  '#fb7185', // rose
  '#a78bfa', // violet
  '#2dd4bf', // teal
  '#facc15', // gold
  '#60a5fa', // blue
  '#f43f5e', // crimson
  '#c084fc', // orchid
]);

function trackColorSignature(track) {
  const segs = (track?.segments || []).filter((s) => Array.isArray(s) && s.length > 0);
  if (segs.length === 0) return '';
  let count = 0;
  for (const s of segs) count += s.length;
  const firstSeg = segs[0];
  const lastSeg = segs[segs.length - 1];
  const first = firstSeg[0];
  const last = lastSeg[lastSeg.length - 1];
  const midSeg = segs[Math.floor(segs.length / 2)];
  const mid = midSeg[Math.floor(midSeg.length / 2)];
  return `${first.lat.toFixed(6)},${first.lon.toFixed(6)}|`
    + `${mid.lat.toFixed(6)},${mid.lon.toFixed(6)}|`
    + `${last.lat.toFixed(6)},${last.lon.toFixed(6)}|${count}`;
}

function trackStartKey(track) {
  const seg = (track?.segments || []).find((s) => Array.isArray(s) && s.length > 0);
  const first = seg?.[0];
  return first ? `${first.lat.toFixed(6)},${first.lon.toFixed(6)}` : '';
}

/**
 * Creates a session-scoped color resolver so deleting an earlier segment never shifts colors
 * of remaining segments, and splitting preserves the left half's color while assigning a fresh one.
 */
export function createSegmentColorResolver() {
  /** @type {Map<string, number>} */
  const sigToColorIndex = new Map();
  /** @type {Map<string, number>} */
  const startToColorIndex = new Map();
  let nextColorIndex = 0;

  return {
    reset() {
      sigToColorIndex.clear();
      startToColorIndex.clear();
      nextColorIndex = 0;
    },
    resolve(tracks) {
      const list = Array.isArray(tracks) ? tracks : [];
      if (list.length === 0) return [];
      const activeIndices = new Set();
      const pending = [];
      const assigned = new Array(list.length).fill(-1);

      // Pass 1: preserve exact known signatures first so deletions never shift remaining colors.
      list.forEach((trk, idx) => {
        const sig = trackColorSignature(trk);
        if (sig && sigToColorIndex.has(sig)) {
          const ci = sigToColorIndex.get(sig);
          assigned[idx] = ci;
          activeIndices.add(ci);
        } else {
          pending.push({ idx, trk, sig });
        }
      });

      // Pass 2: assign unseen segments (inheriting start-point color if not already in use, else next fresh color).
      for (const { idx, trk, sig } of pending) {
        const startKey = trackStartKey(trk);
        let ci = -1;
        if (startKey && startToColorIndex.has(startKey)) {
          const inherited = startToColorIndex.get(startKey);
          if (!activeIndices.has(inherited)) ci = inherited;
        }
        if (ci < 0) {
          // Pick the next unused color index when possible to avoid collisions.
          for (let tries = 0; tries < SPLIT_COLORS.length; tries += 1) {
            const candidate = (nextColorIndex + tries) % SPLIT_COLORS.length;
            if (!activeIndices.has(candidate)) {
              ci = candidate;
              nextColorIndex = (candidate + 1) % SPLIT_COLORS.length;
              break;
            }
          }
          if (ci < 0) {
            ci = nextColorIndex % SPLIT_COLORS.length;
            nextColorIndex = (nextColorIndex + 1) % SPLIT_COLORS.length;
          }
        }
        assigned[idx] = ci;
        activeIndices.add(ci);
        if (sig) sigToColorIndex.set(sig, ci);
        if (startKey) startToColorIndex.set(startKey, ci);
      }

      return assigned.map((ci) => SPLIT_COLORS[ci % SPLIT_COLORS.length]);
    },
  };
}

/**
 * Pure immutable geometry and metadata operations on ParsedTrack objects.
 * Zero DOM dependencies.
 */


export function clonePoint(pt) {
  const copy = {
    lat: Number(pt.lat),
    lon: Number(pt.lon),
  };
  if (Number.isFinite(pt.ele)) copy.ele = Number(pt.ele);
  if (pt.time instanceof Date && Number.isFinite(pt.time.getTime())) {
    copy.time = new Date(pt.time.getTime());
  }
  if (pt.name != null) copy.name = String(pt.name);
  if (pt.description != null) copy.description = String(pt.description);
  if (pt.insightText != null) copy.insightText = String(pt.insightText);
  if (Array.isArray(pt.images) && pt.images.length > 0) copy.images = [...pt.images];
  if (pt.icon != null) copy.icon = String(pt.icon);
  if (isValidHeartRate(pt.heartRate)) copy.heartRate = Number(pt.heartRate);
  return copy;
}


/** @param {import('./types.js').ParsedTrack} parsed @returns {import('./types.js').ParsedTrack} */
export function cloneParsedTrack(parsed) {
  return {
    version: parsed?.version ?? null,
    name: parsed?.name ?? null,
    description: parsed?.description ?? null,
    activityType: parsed?.activityType ?? null,
    tracks: (parsed?.tracks || []).map((t) => ({
      name: t.name ?? null,
      segments: (t.segments || []).map((seg) => seg.map(clonePoint)),
    })),
    routes: (parsed?.routes || []).map((r) => ({
      name: r.name ?? null,
      points: (r.points || []).map(clonePoint),
    })),
    waypoints: (parsed?.waypoints || []).map(clonePoint),
    areas: (parsed?.areas || []).map((a) => ({
      name: a.name ?? null,
      rings: (a.rings || []).map((ring) => ring.map(clonePoint)),
    })),
    timeUsedSeconds: parsed?.timeUsedSeconds,
    pauseSeconds: parsed?.pauseSeconds,
    network: Boolean(parsed?.network),
  };
}

/** Common outdoor activity type presets (stored as canonical keys; custom free text is also accepted). */
export const ACTIVITY_TYPE_PRESETS = Object.freeze([
  'hiking',
  'mountaineering',
  'trail_running',
  'cycling',
  'camping',
  'other',
]);

/**
 * Returns the canonical preset key if value matches a known activity preset, otherwise null.
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function matchActivityPreset(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ACTIVITY_TYPE_PRESETS.includes(normalized) ? normalized : null;
}

/**
 * Updates document-level track metadata (name, description, activityType) immutably.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {{ name?: string | null, description?: string | null, activityType?: string | null }} patch
 * @returns {import('./types.js').ParsedTrack}
 */
export function updateTrackMetadata(parsed, patch = {}) {
  const next = cloneParsedTrack(parsed);
  const normalize = (value) => {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
  };
  if ('name' in patch) next.name = normalize(patch.name);
  if ('description' in patch) next.description = normalize(patch.description);
  if ('activityType' in patch) next.activityType = normalize(patch.activityType);
  return next;
}


export function interpolatePoint(a, b, ratio) {
  const r = Math.min(1, Math.max(0, ratio));
  const pt = {
    lat: a.lat + (b.lat - a.lat) * r,
    lon: a.lon + (b.lon - a.lon) * r,
  };
  if (Number.isFinite(a.ele) && Number.isFinite(b.ele)) {
    pt.ele = a.ele + (b.ele - a.ele) * r;
  } else if (Number.isFinite(a.ele)) {
    pt.ele = a.ele;
  } else if (Number.isFinite(b.ele)) {
    pt.ele = b.ele;
  }
  if (a.time instanceof Date && b.time instanceof Date) {
    const ms = a.time.getTime() + (b.time.getTime() - a.time.getTime()) * r;
    if (Number.isFinite(ms)) pt.time = new Date(Math.round(ms));
  }
  if (isValidHeartRate(a.heartRate) && isValidHeartRate(b.heartRate)) {
    pt.heartRate = Math.round(a.heartRate + (b.heartRate - a.heartRate) * r);
  } else if (isValidHeartRate(a.heartRate)) {
    pt.heartRate = a.heartRate;
  }
  return pt;
}


export function normalizedTracks(parsed) {
  const hasTrackPoints = Array.isArray(parsed?.tracks)
    && parsed.tracks.some((trk) => Array.isArray(trk?.segments) && trk.segments.some((seg) => seg.length > 0));
  if (hasTrackPoints) {
    return parsed.tracks;
  }
  if (Array.isArray(parsed?.routes) && parsed.routes.length > 0) {
    return parsed.routes.map((r) => ({ name: r.name ?? null, segments: [r.points || []] }));
  }
  return [];
}


export function clearSummaryMetadata(track) {
  track.timeUsedSeconds = undefined;
  track.pauseSeconds = undefined;
  return track;
}


export function pointToSegmentMeters(pt, a, b) {
  const latScale = 111320;
  const lonScale = 111320 * Math.cos(((a.lat + b.lat) * 0.5) * (Math.PI / 180));
  const ax = 0;
  const ay = 0;
  const bx = (b.lon - a.lon) * lonScale;
  const by = (b.lat - a.lat) * latScale;
  const px = (pt.lon - a.lon) * lonScale;
  const py = (pt.lat - a.lat) * latScale;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
  return Math.hypot(px - dx * t, py - dy * t);
}


export function minDistanceToSegments(pt, segments) {
  let best = Infinity;
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i += 1) {
      if (i === 0 && seg.length === 1) {
        best = Math.min(best, distanceMeters(pt, seg[0]));
      } else if (i > 0) {
        best = Math.min(best, pointToSegmentMeters(pt, seg[i - 1], seg[i]));
      }
    }
  }
  return best;
}


export function nearestProjectionOnSegments(pt, segments) {
  let bestDist = Infinity;
  let bestAlong = 0;
  let along = 0;
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i += 1) {
      if (i === 0 && seg.length === 1) {
        const d = distanceMeters(pt, seg[0]);
        if (d < bestDist) {
          bestDist = d;
          bestAlong = along;
        }
      } else if (i > 0) {
        const a = seg[i - 1];
        const b = seg[i];
        const step = distanceMeters(a, b);
        const latScale = 111320;
        const lonScale = 111320 * Math.cos(((a.lat + b.lat) * 0.5) * (Math.PI / 180));
        const bx = (b.lon - a.lon) * lonScale;
        const by = (b.lat - a.lat) * latScale;
        const px = (pt.lon - a.lon) * lonScale;
        const py = (pt.lat - a.lat) * latScale;
        const lenSq = bx * bx + by * by;
        const t = lenSq > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / lenSq)) : 0;
        const d = Math.hypot(px - bx * t, py - by * t);
        if (d < bestDist) {
          bestDist = d;
          bestAlong = along + step * t;
        }
        along += step;
      }
    }
  }
  return { dist: bestDist, along: bestAlong };
}


export function trackTotalDistance(parsed) {
  let total = 0;
  for (const track of normalizedTracks(parsed)) {
    for (const seg of track.segments || []) {
      for (let i = 1; i < seg.length; i += 1) {
        total += distanceMeters(seg[i - 1], seg[i]);
      }
    }
  }
  return total;
}

export function ensureTracksMutable(next) {
  if (next.tracks.length === 0 && next.routes.length > 0) {
    next.tracks = normalizedTracks(next);
    next.routes = [];
  }
  const flatSegs = [];
  for (const track of next.tracks) {
    for (const seg of track.segments || []) flatSegs.push(seg);
  }
  return flatSegs;
}

/**
 * Moves a single vertex in the flattened segment list.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} flatSegIndex
 * @param {number} ptIndex
 * @param {number} lat
 * @param {number} lon
 */
