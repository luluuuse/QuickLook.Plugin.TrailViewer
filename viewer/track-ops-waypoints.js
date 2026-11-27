import { distanceMeters } from './geo.js';
import {
  cloneParsedTrack,
  clonePoint,
  ensureTracksMutable,
  interpolatePoint,
  normalizedTracks,
} from './track-ops-core.js';
import { isTrackClosedLoop } from './track-ops-geometry.js';

const routeSortCache = new WeakMap();
const LONG_SEG_METERS = 500;

function cloneForWaypointEdit(parsed) {
  return {
    ...parsed,
    tracks: parsed?.tracks || [],
    routes: parsed?.routes || [],
    waypoints: (parsed?.waypoints || []).map(clonePoint),
    areas: parsed?.areas || [],
  };
}

/**
 * Returns waypoints sorted by their projected distance along the track, keeping original indices.
 * Uses a WeakMap cache and segment bounding-box pruning for fast first-open on large tracks.
 * @param {import('./types.js').ParsedTrack} parsed
 */
export function sortWaypointsByRoute(parsed) {
  if (parsed && routeSortCache.has(parsed)) {
    return routeSortCache.get(parsed);
  }
  const wpts = parsed?.waypoints || [];
  if (wpts.length === 0) return [];
  const segs = [];
  for (const track of normalizedTracks(parsed)) {
    for (const seg of track.segments || []) {
      if (seg.length > 0) segs.push(seg);
    }
  }
  const hasSegs = segs.length > 0;
  let total = 0;
  const indexedSegs = [];
  if (hasSegs) {
    for (const seg of segs) {
      for (let i = 1; i < seg.length; i += 1) {
        const a = seg[i - 1];
        const b = seg[i];
        const step = distanceMeters(a, b);
        const segLonScale = 111320 * Math.cos(((a.lat + b.lat) * 0.5) * (Math.PI / 180));
        const dx = (b.lon - a.lon) * segLonScale;
        const dy = (b.lat - a.lat) * 111320;
        indexedSegs.push({
          a,
          alongA: total,
          step,
          lonScale: segLonScale,
          dx,
          dy,
          lenSq: dx * dx + dy * dy,
          minLat: Math.min(a.lat, b.lat),
          maxLat: Math.max(a.lat, b.lat),
          minLon: Math.min(a.lon, b.lon),
          maxLon: Math.max(a.lon, b.lon),
        });
        total += step;
      }
    }
  }
  const closed = hasSegs && isTrackClosedLoop(parsed, 50);
  const segCount = indexedSegs.length;
  const useCoarse = segCount > 512;
  const stride = useCoarse ? Math.max(1, Math.floor(segCount / 400)) : 1;
  const longSegIndices = [];
  if (useCoarse) {
    for (let i = 0; i < segCount; i += 1) {
      if (indexedSegs[i].step > LONG_SEG_METERS) longSegIndices.push(i);
    }
  }
  const result = wpts
    .map((wpt, index) => {
      let along = index;
      if (segCount > 0) {
        const cosLat = Math.max(0.1, Math.cos(wpt.lat * (Math.PI / 180)));
        const lonScale = 111320 * cosLat;
        let bestDistSq = Infinity;
        let bestAlong = 0;
        const testSeg = (segIdx) => {
          const entry = indexedSegs[segIdx];
          if (!entry) return;
          const dLat = wpt.lat < entry.minLat
            ? entry.minLat - wpt.lat
            : (wpt.lat > entry.maxLat ? wpt.lat - entry.maxLat : 0);
          const dLon = wpt.lon < entry.minLon
            ? entry.minLon - wpt.lon
            : (wpt.lon > entry.maxLon ? wpt.lon - entry.maxLon : 0);
          const minPossibleSq = (dLat * 111320) ** 2 + (dLon * lonScale) ** 2;
          if (minPossibleSq >= bestDistSq) return;
          const px = (wpt.lon - entry.a.lon) * entry.lonScale;
          const py = (wpt.lat - entry.a.lat) * 111320;
          const t = entry.lenSq > 0
            ? Math.max(0, Math.min(1, (px * entry.dx + py * entry.dy) / entry.lenSq))
            : 0;
          const ex = px - entry.dx * t;
          const ey = py - entry.dy * t;
          const distSq = ex * ex + ey * ey;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestAlong = entry.alongA + entry.step * t;
          }
        };
        if (useCoarse) {
          let best0 = -1;
          let best1 = -1;
          let best2 = -1;
          let d0 = Infinity;
          let d1 = Infinity;
          let d2 = Infinity;
          for (let i = 0; i < segCount; i += stride) {
            const pt = indexedSegs[i].a;
            const dl = pt.lat - wpt.lat;
            const dn = (pt.lon - wpt.lon) * cosLat;
            const dSq = dl * dl + dn * dn;
            if (dSq < d0) {
              d2 = d1; best2 = best1;
              d1 = d0; best1 = best0;
              d0 = dSq; best0 = i;
            } else if (dSq < d1) {
              d2 = d1; best2 = best1;
              d1 = dSq; best1 = i;
            } else if (dSq < d2) {
              d2 = dSq; best2 = i;
            }
          }
          const anchors = [best0, best1, best2];
          for (let a = 0; a < anchors.length; a += 1) {
            const center = anchors[a];
            if (center < 0) continue;
            const lo = Math.max(0, center - stride);
            const hi = Math.min(segCount - 1, center + stride);
            for (let s = lo; s <= hi; s += 1) testSeg(s);
          }
          for (let k = 0; k < longSegIndices.length; k += 1) {
            testSeg(longSegIndices[k]);
          }
        } else {
          for (let i = 0; i < segCount; i += 1) testSeg(i);
        }
        along = bestAlong;
        if (closed && along <= 50 && /终点|finish|end/i.test(wpt.name || '')) {
          along = total;
        }
        return { wpt, index, along, offTrackMeters: Math.sqrt(bestDistSq) };
      } else if (hasSegs) {
        along = 0;
      }
      return { wpt, index, along, offTrackMeters: 0 };
    })
    .sort((a, b) => (a.along - b.along) || (a.index - b.index));
  if (parsed) routeSortCache.set(parsed, result);
  return result;
}


export function addWaypoint(parsed, waypoint) {
  const next = cloneForWaypointEdit(parsed);
  next.waypoints.push(clonePoint(waypoint));
  return next;
}

/**
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} index
 * @param {Partial<import('./types.js').TrackPoint>} patch
 */
export function updateWaypoint(parsed, index, patch) {
  const next = cloneForWaypointEdit(parsed);
  if (index < 0 || index >= next.waypoints.length) return next;
  const merged = { ...next.waypoints[index], ...patch };
  if (('description' in patch || 'desc' in patch || 'comment' in patch) && !('insightText' in patch)) {
    delete merged.insightText;
  }
  next.waypoints[index] = clonePoint(merged);
  return next;
}

/**
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} index
 * @param {number} lat
 * @param {number} lon
 */
export function moveWaypoint(parsed, index, lat, lon) {
  return updateWaypoint(parsed, index, { lat, lon });
}

/**
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} index
 */
export function deleteWaypoint(parsed, index) {
  const next = cloneForWaypointEdit(parsed);
  if (index < 0 || index >= next.waypoints.length) return next;
  next.waypoints.splice(index, 1);
  return next;
}


export function sortWaypointsAlongTrack(parsed, { offTrackThresholdMeters = 500 } = {}) {
  const next = cloneForWaypointEdit(parsed);
  if (!Array.isArray(next.waypoints) || next.waypoints.length < 2) {
    return { track: next, changed: false };
  }
  const ordered = sortWaypointsByRoute(next);
  const onTrack = ordered.filter((item) => item.offTrackMeters <= offTrackThresholdMeters);
  const offTrack = ordered
    .filter((item) => item.offTrackMeters > offTrackThresholdMeters)
    .sort((a, b) => a.index - b.index);
  const combined = [...onTrack, ...offTrack];
  const changed = combined.some((item, idx) => item.index !== idx);
  next.waypoints = combined.map((item) => clonePoint(item.wpt));
  return { track: next, changed };
}

function waypointRichnessScore(wpt) {
  let score = 0;
  if (String(wpt?.name || '').trim()) score += 4;
  if (String(wpt?.description || '').trim()) score += 3;
  if (Array.isArray(wpt?.images) && wpt.images.length > 0) score += 5;
  if (wpt?.icon && wpt.icon !== 'pin') score += 2;
  if (Number.isFinite(wpt?.ele)) score += 1;
  return score;
}

/**
 * Merges duplicate waypoints within radiusMeters, preferring entries with richer metadata (photos/name/description).
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {{ radiusMeters?: number }} [options]
 */
export function dedupeWaypoints(parsed, { radiusMeters = 20 } = {}) {
  const next = cloneForWaypointEdit(parsed);
  const wpts = next.waypoints || [];
  if (wpts.length < 2) return { track: next, removedCount: 0 };

  const radius = Math.max(1, Number(radiusMeters) || 20);
  const kept = [];
  let removedCount = 0;

  for (const wpt of wpts) {
    const matchIdx = kept.findIndex((existing) => distanceMeters(existing, wpt) <= radius);
    if (matchIdx < 0) {
      kept.push(wpt);
    } else {
      removedCount += 1;
      if (waypointRichnessScore(wpt) > waypointRichnessScore(kept[matchIdx])) {
        kept[matchIdx] = wpt;
      }
    }
  }

  next.waypoints = kept;
  return { track: next, removedCount };
}

/**
 * Generates milestone waypoints every intervalKm along the track and optionally a summit waypoint at max elevation.
 * Skips any candidate within minDistanceMeters of an existing waypoint.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {{
 *   intervalKm?: number,
 *   includeSummit?: boolean,
 *   minDistanceMeters?: number,
 *   formatKmLabel?: (km: number) => string,
 *   summitLabel?: string,
 * }} [options]
 */
export function generateMilestoneWaypoints(
  parsed,
  {
    intervalKm = 5,
    includeSummit = true,
    minDistanceMeters = 50,
    formatKmLabel = (km) => `${km} km`,
    summitLabel = '最高点',
  } = {},
) {
  const next = cloneParsedTrack(parsed);
  const segs = ensureTracksMutable(next).filter((seg) => seg.length > 0);
  if (segs.length === 0) return { track: next, addedCount: 0 };

  const stepMeters = Math.max(100, (Number(intervalKm) || 5) * 1000);
  const parsedMinGap = Number(minDistanceMeters);
  const minGap = Number.isFinite(parsedMinGap) ? Math.max(0, parsedMinGap) : 50;
  const existing = next.waypoints || [];
  const candidates = [];

  let cumDist = 0;
  let nextMilestone = stepMeters;
  let summitPt = null;

  for (const seg of segs) {
    for (let i = 0; i < seg.length; i += 1) {
      const pt = seg[i];
      if (includeSummit && Number.isFinite(pt.ele)) {
        if (!summitPt || pt.ele > summitPt.ele) summitPt = pt;
      }
      if (i === 0) continue;
      const prev = seg[i - 1];
      const d = distanceMeters(prev, pt);
      if (d <= 0) continue;
      while (cumDist + d >= nextMilestone) {
        const ratio = (nextMilestone - cumDist) / d;
        const pos = interpolatePoint(prev, pt, ratio);
        const km = Math.round((nextMilestone / 1000) * 10) / 10;
        candidates.push({
          lat: pos.lat,
          lon: pos.lon,
          ...(Number.isFinite(pos.ele) ? { ele: Math.round(pos.ele * 10) / 10 } : {}),
          name: formatKmLabel(km),
          icon: 'pin',
        });
        nextMilestone += stepMeters;
      }
      cumDist += d;
    }
  }

  if (includeSummit && summitPt) {
    candidates.push({
      lat: summitPt.lat,
      lon: summitPt.lon,
      ele: Math.round(summitPt.ele * 10) / 10,
      name: summitLabel,
      icon: 'summit',
    });
  }

  let addedCount = 0;
  for (const cand of candidates) {
    const tooClose = existing.some((wpt) => distanceMeters(wpt, cand) < minGap);
    if (tooClose) continue;
    existing.push(cand);
    addedCount += 1;
  }

  next.waypoints = existing;
  return { track: next, addedCount };
}

