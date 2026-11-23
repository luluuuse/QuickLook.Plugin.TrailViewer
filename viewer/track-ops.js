import { distanceMeters } from './geo.js';
import { findTrackGaps, isValidHeartRate } from './track-analysis.js';

/**
 * Pure immutable geometry and metadata operations on ParsedTrack objects.
 * Zero DOM dependencies.
 */

function clonePoint(pt) {
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

function interpolatePoint(a, b, ratio) {
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

function clearSummaryMetadata(track) {
  track.timeUsedSeconds = undefined;
  track.pauseSeconds = undefined;
  return track;
}

function pointToSegmentMeters(pt, a, b) {
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

function minDistanceToSegments(pt, segments) {
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

function nearestProjectionOnSegments(pt, segments) {
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

const routeSortCache = new WeakMap();

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
  const result = wpts
    .map((wpt, index) => {
      let along = index;
      if (indexedSegs.length > 0) {
        const lonScale = 111320 * Math.max(0.1, Math.cos(wpt.lat * (Math.PI / 180)));
        let bestDistSq = Infinity;
        let bestAlong = 0;
        for (let i = 0; i < indexedSegs.length; i += 1) {
          const entry = indexedSegs[i];
          const dLat = wpt.lat < entry.minLat
            ? entry.minLat - wpt.lat
            : (wpt.lat > entry.maxLat ? wpt.lat - entry.maxLat : 0);
          const dLon = wpt.lon < entry.minLon
            ? entry.minLon - wpt.lon
            : (wpt.lon > entry.maxLon ? wpt.lon - entry.maxLon : 0);
          const minPossibleSq = (dLat * 111320) ** 2 + (dLon * lonScale) ** 2;
          if (minPossibleSq >= bestDistSq) continue;
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
        }
        along = bestAlong;
        if (closed && along <= 50 && /终点|finish|end/i.test(wpt.name || '')) {
          along = total;
        }
      } else if (hasSegs) {
        along = 0;
      }
      return { wpt, index, along };
    })
    .sort((a, b) => (a.along - b.along) || (a.index - b.index));
  if (parsed) routeSortCache.set(parsed, result);
  return result;
}

function pruneWaypointsByCrop(waypoints, originalSegments, keptSegments, fromMeters, toMeters) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) return waypoints;
  return waypoints.filter((wpt) => {
    const distKept = minDistanceToSegments(wpt, keptSegments);
    if (distKept <= 30) return true;
    const proj = nearestProjectionOnSegments(wpt, originalSegments);
    return proj.along >= fromMeters && proj.along <= toMeters;
  });
}

function pruneWaypointsBySegments(waypoints, removedSegments, keptSegments) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) return waypoints;
  return waypoints.filter((wpt) => {
    const distKept = minDistanceToSegments(wpt, keptSegments);
    if (distKept <= 30) return true;
    const distRemoved = minDistanceToSegments(wpt, removedSegments);
    return distKept <= distRemoved;
  });
}

/** @param {import('./types.js').ParsedTrack} parsed */
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

/**
 * Crops a ParsedTrack to cumulative distance [fromMeters, toMeters].
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} fromMeters
 * @param {number} toMeters
 */
export function cropTrack(parsed, fromMeters, toMeters) {
  const next = cloneParsedTrack(parsed);
  const sourceTracks = normalizedTracks(next);
  const total = trackTotalDistance(next);
  const from = Math.max(0, Math.min(total, Number(fromMeters) || 0));
  const to = Math.max(from, Math.min(total, Number.isFinite(toMeters) ? Number(toMeters) : total));
  if (!(to > from)) return next;

  let along = 0;
  const outTracks = [];
  for (const track of sourceTracks) {
    const outSegs = [];
    for (const seg of track.segments || []) {
      if (seg.length < 2) continue;
      const sliced = [];
      for (let i = 1; i < seg.length; i += 1) {
        const a = seg[i - 1];
        const b = seg[i];
        const step = distanceMeters(a, b);
        const segStart = along;
        const segEnd = along + step;
        along = segEnd;

        const lo = Math.max(from, segStart);
        const hi = Math.min(to, segEnd);
        if (hi > lo && step > 0) {
          const p0 = lo === segStart ? clonePoint(a) : interpolatePoint(a, b, (lo - segStart) / step);
          const p1 = hi === segEnd ? clonePoint(b) : interpolatePoint(a, b, (hi - segStart) / step);
          if (sliced.length === 0) sliced.push(p0);
          sliced.push(p1);
        }
      }
      if (sliced.length >= 2) outSegs.push(sliced);
    }
    if (outSegs.length > 0) {
      outTracks.push({ name: track.name ?? null, segments: outSegs });
    }
  }

  if (outTracks.length > 0) {
    const originalSegments = sourceTracks.flatMap((t) => t.segments || []);
    const keptSegments = outTracks.flatMap((t) => t.segments || []);
    next.waypoints = pruneWaypointsByCrop(next.waypoints, originalSegments, keptSegments, from, to);
    next.tracks = outTracks;
    next.routes = [];
  }
  return clearSummaryMetadata(next);
}

function stripSplitSuffix(name) {
  return String(name || '').replace(/(?:\s*\(\d+\))+$/g, '').trim();
}

function renumberSplitTracks(tracks, fallbackBaseName) {
  const bases = tracks.map((trk) => stripSplitSuffix(trk.name) || fallbackBaseName);
  const counts = new Map();
  for (const base of bases) counts.set(base, (counts.get(base) || 0) + 1);
  const seen = new Map();
  return tracks.map((trk, idx) => {
    const base = bases[idx];
    const total = counts.get(base) || 0;
    if (total <= 1) {
      const cleaned = stripSplitSuffix(trk.name);
      return { ...trk, name: cleaned || trk.name || null };
    }
    const seq = (seen.get(base) || 0) + 1;
    seen.set(base, seq);
    return { ...trk, name: `${base} (${seq})` };
  });
}

/**
 * Splits a ParsedTrack at cumulative distance splitMeters into separate tracks.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} splitMeters
 */
export function splitTrackAt(parsed, splitMeters) {
  const next = cloneParsedTrack(parsed);
  const sourceTracks = normalizedTracks(next);
  const total = trackTotalDistance(next);
  const cut = Math.max(0, Math.min(total, Number(splitMeters) || 0));
  if (!(cut > 0 && cut < total)) return next;

  let along = 0;
  const fallbackBaseName = next.name || sourceTracks[0]?.name || 'Track';
  const resultTracks = [];

  for (const track of sourceTracks) {
    const beforeSegs = [];
    const afterSegs = [];
    for (const seg of track.segments || []) {
      if (seg.length < 2) continue;
      const partA = [];
      const partB = [];
      for (let i = 1; i < seg.length; i += 1) {
        const a = seg[i - 1];
        const b = seg[i];
        const step = distanceMeters(a, b);
        const segStart = along;
        const segEnd = along + step;
        along = segEnd;

        if (segEnd <= cut) {
          if (partA.length === 0) partA.push(clonePoint(a));
          partA.push(clonePoint(b));
        } else if (segStart >= cut) {
          if (partB.length === 0) partB.push(clonePoint(a));
          partB.push(clonePoint(b));
        } else if (step > 0) {
          const mid = interpolatePoint(a, b, (cut - segStart) / step);
          if (partA.length === 0) partA.push(clonePoint(a));
          partA.push(clonePoint(mid));
          partB.push(clonePoint(mid));
          partB.push(clonePoint(b));
        }
      }
      if (partA.length >= 2) beforeSegs.push(partA);
      if (partB.length >= 2) afterSegs.push(partB);
    }
    if (beforeSegs.length > 0 && afterSegs.length > 0) {
      const base = stripSplitSuffix(track.name) || stripSplitSuffix(fallbackBaseName) || 'Track';
      resultTracks.push({ name: base, segments: beforeSegs });
      resultTracks.push({ name: base, segments: afterSegs });
    } else if (beforeSegs.length > 0) {
      resultTracks.push({ name: track.name ?? null, segments: beforeSegs });
    } else if (afterSegs.length > 0) {
      resultTracks.push({ name: track.name ?? null, segments: afterSegs });
    }
  }

  if (resultTracks.length > 0) {
    next.tracks = renumberSplitTracks(resultTracks, stripSplitSuffix(fallbackBaseName) || 'Track');
    next.routes = [];
  }
  return clearSummaryMetadata(next);
}

/**
 * Removes a track by index when more than one track exists.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} trackIndex
 */
export function deleteTrackSegment(parsed, trackIndex) {
  const next = cloneParsedTrack(parsed);
  if (next.tracks.length === 0 && next.routes.length > 0) {
    next.tracks = normalizedTracks(next);
    next.routes = [];
  }
  if (next.tracks.length <= 1) return next;
  if (trackIndex < 0 || trackIndex >= next.tracks.length) return next;
  const removedSegments = next.tracks[trackIndex]?.segments || [];
  next.tracks.splice(trackIndex, 1);
  next.tracks = renumberSplitTracks(next.tracks, stripSplitSuffix(next.name) || 'Track');
  const keptSegments = next.tracks.flatMap((t) => t.segments || []);
  next.waypoints = pruneWaypointsBySegments(next.waypoints, removedSegments, keptSegments);
  return clearSummaryMetadata(next);
}

/**
 * Returns anomaly points detected by trackGaps (implausible speed / GPS spikes).
 * For an isolated A -> B -> C spike where A -> C is plausible, only B is flagged.
 * @param {import('./types.js').ParsedTrack} parsed
 */
export function detectAnomalyPoints(parsed) {
  const sourceTracks = normalizedTracks(parsed);
  const pointIndexMap = new WeakMap();
  for (let ti = 0; ti < sourceTracks.length; ti += 1) {
    const segs = sourceTracks[ti]?.segments || [];
    for (let si = 0; si < segs.length; si += 1) {
      const seg = segs[si];
      for (let pi = 0; pi < seg.length; pi += 1) {
        pointIndexMap.set(seg[pi], `${ti}:${si}:${pi}`);
      }
    }
  }
  const gaps = findTrackGaps(sourceTracks);
  const jumpItems = (gaps.items || []).filter((item) => item.kind === 'jump');
  const anomalies = [];
  const seen = new Set();
  for (let i = 0; i < jumpItems.length; i += 1) {
    const item = jumpItems[i];
    const pt = item.to;
    if (!pt) continue;
    const key = pointIndexMap.get(pt) || `${Number(pt.lat).toFixed(6)},${Number(pt.lon).toFixed(6)}`;
    if (!seen.has(key)) {
      seen.add(key);
      const speedMps = item.timeSeconds && item.timeSeconds > 0
        ? item.distanceMeters / item.timeSeconds
        : null;
      anomalies.push({
        key,
        lat: pt.lat,
        lon: pt.lon,
        distanceMeters: item.distanceMeters,
        speedMps,
      });
    }
    const nextItem = jumpItems[i + 1];
    if (nextItem && nextItem.from === pt && item.from && nextItem.to) {
      const distAC = distanceMeters(item.from, nextItem.to);
      const secAC = item.from.time && nextItem.to.time
        ? (nextItem.to.time - item.from.time) / 1000
        : null;
      const reasonableAC = distAC <= 30 || (secAC !== null && secAC > 0 && distAC / secAC <= 15);
      if (reasonableAC) {
        i += 1;
      }
    }
  }
  return anomalies;
}

/**
 * Removes detected GPS drift/anomaly points unless their key is in excludedKeys.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {Set<string>} [excludedKeys]
 */
export function cleanAnomalies(parsed, excludedKeys = new Set()) {
  const next = cloneParsedTrack(parsed);
  if (!next.tracks.some((trk) => (trk.segments || []).some((seg) => seg.length > 0)) && next.routes.length > 0) {
    next.tracks = normalizedTracks(next);
    next.routes = [];
  }
  const anomalies = detectAnomalyPoints(next);
  const removeKeys = new Set(
    anomalies.map((a) => a.key).filter((key) => !excludedKeys.has(key)),
  );
  if (removeKeys.size === 0) return { track: next, removedCount: 0 };

  let removedCount = 0;
  for (let ti = 0; ti < next.tracks.length; ti += 1) {
    const track = next.tracks[ti];
    track.segments = track.segments
      .map((seg, si) => {
        if (seg.length <= 2) return seg;
        const kept = seg.filter((pt, pi) => {
          const idxKey = `${ti}:${si}:${pi}`;
          const coordKey = `${Number(pt.lat).toFixed(6)},${Number(pt.lon).toFixed(6)}`;
          return !removeKeys.has(idxKey) && !removeKeys.has(coordKey);
        });
        if (kept.length >= 2 && kept.length < seg.length) {
          removedCount += seg.length - kept.length;
          return kept;
        }
        return seg;
      });
  }
  if (removedCount > 0) clearSummaryMetadata(next);
  return { track: next, removedCount };
}

function stripTimestamps(points) {
  let cleared = false;
  for (const pt of points) {
    if (pt.time != null) {
      delete pt.time;
      cleared = true;
    }
  }
  return cleared;
}

/**
 * Reverses track direction; clears timestamps to prevent backwards time.
 * @param {import('./types.js').ParsedTrack} parsed
 */
export function reverseTrack(parsed) {
  const next = cloneParsedTrack(parsed);
  let clearedTimestamps = false;
  if (next.tracks.length === 0 && next.routes.length > 0) {
    next.routes = next.routes.reverse().map((r) => {
      const pts = r.points.slice().reverse();
      if (stripTimestamps(pts)) clearedTimestamps = true;
      return { ...r, points: pts };
    });
    return { track: clearSummaryMetadata(next), clearedTimestamps };
  }
  next.tracks = next.tracks.reverse().map((t) => ({
    ...t,
    segments: t.segments.reverse().map((seg) => {
      const pts = seg.slice().reverse();
      if (stripTimestamps(pts)) clearedTimestamps = true;
      return pts;
    }),
  }));
  return { track: clearSummaryMetadata(next), clearedTimestamps };
}

/**
 * Appends a reversed copy of the track to create an out-and-back route.
 * @param {import('./types.js').ParsedTrack} parsed
 */
export function makeOutAndBack(parsed) {
  const next = cloneParsedTrack(parsed);
  const sourceTracks = normalizedTracks(next);
  let clearedTimestamps = false;
  const allPts = [];
  for (const t of sourceTracks) {
    for (const seg of t.segments || []) {
      for (const pt of seg) allPts.push(clonePoint(pt));
    }
  }
  if (allPts.length < 2) return { track: next, clearedTimestamps: false };
  const returnPts = allPts.slice(0, -1).reverse().map(clonePoint);
  if (stripTimestamps(allPts)) clearedTimestamps = true;
  if (stripTimestamps(returnPts)) clearedTimestamps = true;
  const combined = allPts.concat(returnPts);
  next.tracks = [{ name: next.name ?? sourceTracks[0]?.name ?? null, segments: [combined] }];
  next.routes = [];
  return { track: clearSummaryMetadata(next), clearedTimestamps };
}

function endpointSegments(sourceTracks) {
  let firstSeg = null;
  let lastSeg = null;
  let totalPoints = 0;
  for (const track of sourceTracks) {
    for (const seg of track?.segments || []) {
      if (!Array.isArray(seg) || seg.length === 0) continue;
      if (!firstSeg) firstSeg = seg;
      lastSeg = seg;
      totalPoints += seg.length;
    }
  }
  return { firstSeg, lastSeg, totalPoints };
}

/**
 * Returns true if the track has at least 2 points and its start and end points are within thresholdMeters.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} [thresholdMeters]
 */
export function isTrackClosedLoop(parsed, thresholdMeters = 50) {
  const sourceTracks = normalizedTracks(parsed);
  const { firstSeg, lastSeg, totalPoints } = endpointSegments(sourceTracks);
  if (totalPoints < 2 || !firstSeg || !lastSeg) {
    return false;
  }
  const first = firstSeg[0];
  const last = lastSeg[lastSeg.length - 1];
  return distanceMeters(last, first) <= thresholdMeters;
}

/**
 * Closes a loop by connecting the last point back to the first point.
 * @param {import('./types.js').ParsedTrack} parsed
 */
export function closeLoop(parsed) {
  const next = cloneParsedTrack(parsed);
  const sourceTracks = normalizedTracks(next);
  const { firstSeg, lastSeg, totalPoints } = endpointSegments(sourceTracks);
  if (totalPoints < 2 || !firstSeg || !lastSeg) {
    return { track: next, closureMeters: 0 };
  }
  const first = firstSeg[0];
  const last = lastSeg[lastSeg.length - 1];
  const closureMeters = distanceMeters(last, first);
  if (closureMeters > 0.5) {
    const closingPt = clonePoint(first);
    delete closingPt.time;
    lastSeg.push(closingPt);
  }
  if (!next.tracks.some((trk) => (trk.segments || []).some((seg) => seg.length > 0)) && sourceTracks.length > 0) {
    next.tracks = sourceTracks;
    next.routes = [];
  }
  return { track: clearSummaryMetadata(next), closureMeters };
}

/**
 * Merges all tracks/segments into one continuous track segment.
 * Reorders timestamped segments if out-of-order and reports max gap across segment joins.
 * @param {import('./types.js').ParsedTrack} parsed
 */
export function mergeTrackSegments(parsed) {
  const next = cloneParsedTrack(parsed);
  const sourceTracks = normalizedTracks(next);
  const segments = [];
  for (const track of sourceTracks) {
    for (const seg of track.segments || []) {
      if (seg.length === 0) continue;
      const firstTimed = seg.find((pt) => pt.time instanceof Date && Number.isFinite(pt.time.getTime()));
      segments.push({
        pts: seg.map(clonePoint),
        startMs: firstTimed ? firstTimed.time.getTime() : null,
      });
    }
  }
  if (sourceTracks.length <= 1 && (sourceTracks[0]?.segments?.length || 0) <= 1) {
    return {
      track: next,
      mergedCount: sourceTracks.length,
      reorderedByTime: false,
      timestampsCleared: false,
      maxGapMeters: 0,
    };
  }
  let reorderedByTime = false;
  let prevTimedMs = -Infinity;
  for (const item of segments) {
    if (item.startMs != null) {
      if (item.startMs < prevTimedMs) {
        reorderedByTime = true;
        break;
      }
      prevTimedMs = item.startMs;
    }
  }
  if (reorderedByTime) {
    segments.sort((a, b) => {
      if (a.startMs == null && b.startMs == null) return 0;
      if (a.startMs == null) return 1;
      if (b.startMs == null) return -1;
      return a.startMs - b.startMs;
    });
  }
  let maxGapMeters = 0;
  const mergedPoints = [];
  for (let i = 0; i < segments.length; i += 1) {
    const pts = segments[i].pts;
    if (i > 0 && mergedPoints.length > 0 && pts.length > 0) {
      const gap = distanceMeters(mergedPoints[mergedPoints.length - 1], pts[0]);
      if (gap > maxGapMeters) maxGapMeters = gap;
    }
    for (const pt of pts) mergedPoints.push(pt);
  }
  let timestampsCleared = false;
  let lastValidMs = -Infinity;
  for (const pt of mergedPoints) {
    if (pt.time instanceof Date && Number.isFinite(pt.time.getTime())) {
      const ms = pt.time.getTime();
      if (ms < lastValidMs) {
        timestampsCleared = stripTimestamps(mergedPoints);
        break;
      }
      lastValidMs = ms;
    }
  }
  next.tracks = [{
    name: sourceTracks[0]?.name || next.name || '',
    segments: mergedPoints.length > 0 ? [mergedPoints] : [],
  }];
  next.routes = [];
  return {
    track: clearSummaryMetadata(next),
    mergedCount: sourceTracks.length,
    reorderedByTime,
    timestampsCleared,
    maxGapMeters,
  };
}

/**
 * Rotates a closed loop so its start/end sits at the point closest to alongMeters.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} alongMeters
 */
export function rotateLoopStart(parsed, alongMeters) {
  const next = cloneParsedTrack(parsed);
  if (!isTrackClosedLoop(next)) return { track: next, rotated: false, timestampsCleared: false };
  const sourceTracks = normalizedTracks(next);
  const flat = [];
  const flatAlong = [];
  let acc = 0;
  for (const track of sourceTracks) {
    for (const seg of track.segments || []) {
      for (let i = 0; i < seg.length; i += 1) {
        if (i > 0) acc += distanceMeters(seg[i - 1], seg[i]);
        flat.push(clonePoint(seg[i]));
        flatAlong.push(acc);
      }
    }
  }
  if (flat.length < 4) return { track: next, rotated: false, timestampsCleared: false };
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < flat.length; i += 1) {
    const diff = Math.abs(flatAlong[i] - alongMeters);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  const hasDuplicateEnd = distanceMeters(flat[0], flat[flat.length - 1]) < 1;
  const body = hasDuplicateEnd ? flat.slice(0, flat.length - 1) : flat;
  if (bestIdx <= 0 || bestIdx >= body.length) {
    return { track: next, rotated: false, timestampsCleared: false };
  }
  const rotatedPts = [...body.slice(bestIdx), ...body.slice(0, bestIdx), clonePoint(body[bestIdx])];
  const timestampsCleared = stripTimestamps(rotatedPts);
  next.tracks = [{
    name: sourceTracks[0]?.name || next.name || '',
    segments: [rotatedPts],
  }];
  next.routes = [];
  return { track: clearSummaryMetadata(next), rotated: true, timestampsCleared };
}

function perpDistanceMeters(pt, a, b) {
  const refLat = ((a.lat + b.lat) * 0.5) * (Math.PI / 180);
  const mx = 111320 * Math.cos(refLat);
  const my = 111320;
  const ax = a.lon * mx;
  const ay = a.lat * my;
  const bx = b.lon * mx;
  const by = b.lat * my;
  const px = pt.lon * mx;
  const py = pt.lat * my;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function douglasPeucker(points, toleranceMeters) {
  if (points.length <= 2 || toleranceMeters <= 0) return points.map(clonePoint);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    if (end - start <= 1) continue;
    let maxDist = 0;
    let maxIdx = -1;
    const a = points[start];
    const b = points[end];
    for (let i = start + 1; i < end; i += 1) {
      const dist = perpDistanceMeters(points[i], a, b);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxIdx > start && maxDist > toleranceMeters) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) out.push(clonePoint(points[i]));
  }
  return out;
}

/**
 * Simplifies all segments using iterative Douglas-Peucker within toleranceMeters.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} [toleranceMeters]
 */
export function simplifyTrack(parsed, toleranceMeters = 5) {
  const next = cloneParsedTrack(parsed);
  if (next.tracks.length === 0 && next.routes.length > 0) {
    next.tracks = normalizedTracks(next);
    next.routes = [];
  }
  let beforeCount = 0;
  let afterCount = 0;
  for (const track of next.tracks) {
    track.segments = (track.segments || []).map((seg) => {
      beforeCount += seg.length;
      const simplified = douglasPeucker(seg, toleranceMeters);
      afterCount += simplified.length;
      return simplified;
    });
  }
  if (afterCount < beforeCount) clearSummaryMetadata(next);
  return { track: next, beforeCount, afterCount };
}

/**
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {import('./types.js').TrackPoint} waypoint
 */
export function addWaypoint(parsed, waypoint) {
  const next = cloneParsedTrack(parsed);
  next.waypoints.push(clonePoint(waypoint));
  return next;
}

/**
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} index
 * @param {Partial<import('./types.js').TrackPoint>} patch
 */
export function updateWaypoint(parsed, index, patch) {
  const next = cloneParsedTrack(parsed);
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
  const next = cloneParsedTrack(parsed);
  if (index < 0 || index >= next.waypoints.length) return next;
  next.waypoints.splice(index, 1);
  return next;
}

function ensureTracksMutable(next) {
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
export function moveTrackVertex(parsed, flatSegIndex, ptIndex, lat, lon) {
  const next = cloneParsedTrack(parsed);
  const seg = ensureTracksMutable(next)[flatSegIndex];
  if (!seg || ptIndex < 0 || ptIndex >= seg.length) return next;
  seg[ptIndex] = clonePoint({ ...seg[ptIndex], lat, lon });
  return clearSummaryMetadata(next);
}

/**
 * Inserts a vertex after afterIndex in the flattened segment list.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} flatSegIndex
 * @param {number} afterIndex
 * @param {number} lat
 * @param {number} lon
 * @param {number} [ele]
 */
export function insertTrackVertex(parsed, flatSegIndex, afterIndex, lat, lon, ele) {
  const next = cloneParsedTrack(parsed);
  const seg = ensureTracksMutable(next)[flatSegIndex];
  if (!seg || afterIndex < 0 || afterIndex >= seg.length) return next;
  const a = seg[afterIndex];
  const b = seg[afterIndex + 1];
  let pt;
  if (b) {
    const dTotal = distanceMeters(a, b);
    const dPart = distanceMeters(a, { lat, lon });
    const ratio = dTotal > 0 ? Math.min(1, Math.max(0, dPart / dTotal)) : 0.5;
    pt = interpolatePoint(a, b, ratio);
    pt.lat = lat;
    pt.lon = lon;
  } else {
    pt = { lat, lon };
  }
  if (Number.isFinite(ele)) pt.ele = ele;
  seg.splice(afterIndex + 1, 0, pt);
  return clearSummaryMetadata(next);
}

/**
 * Deletes a vertex in the flattened segment list (keeps at least 2 points).
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} flatSegIndex
 * @param {number} ptIndex
 */
export function deleteTrackVertex(parsed, flatSegIndex, ptIndex) {
  const next = cloneParsedTrack(parsed);
  const seg = ensureTracksMutable(next)[flatSegIndex];
  if (!seg || seg.length <= 2 || ptIndex < 0 || ptIndex >= seg.length) return next;
  seg.splice(ptIndex, 1);
  return clearSummaryMetadata(next);
}

/**
 * Removes track points inside lat/lon bounds while keeping at least one valid segment (>= 2 points).
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {{ south: number, west: number, north: number, east: number }} bounds
 */
export function eraseTrackPointsInBounds(parsed, bounds) {
  const next = cloneParsedTrack(parsed);
  if (next.tracks.length === 0 && next.routes.length > 0) {
    next.tracks = normalizedTracks(next);
    next.routes = [];
  }
  const trackCandidates = next.tracks.map((track) => (track.segments || []).map((seg) => {
    const kept = seg.filter((pt) => {
      const inside = pt.lat >= bounds.south && pt.lat <= bounds.north
        && pt.lon >= bounds.west && pt.lon <= bounds.east;
      return !inside;
    });
    return { seg, kept };
  }));
  let validSegCount = 0;
  for (const segs of trackCandidates) {
    for (const item of segs) {
      if (item.kept.length >= 2) validSegCount += 1;
    }
  }
  if (validSegCount === 0) {
    return { track: next, removedCount: 0, removedWaypointCount: 0 };
  }
  let removedCount = 0;
  next.tracks.forEach((track, tIdx) => {
    const nextSegs = [];
    for (const { seg, kept } of trackCandidates[tIdx]) {
      if (kept.length >= 2) {
        removedCount += seg.length - kept.length;
        nextSegs.push(kept);
      } else {
        removedCount += seg.length;
      }
    }
    track.segments = nextSegs;
  });
  next.tracks = next.tracks.filter((track) => (track.segments || []).length > 0);
  let removedWaypointCount = 0;
  if (Array.isArray(next.waypoints) && next.waypoints.length > 0) {
    const beforeWpts = next.waypoints.length;
    next.waypoints = next.waypoints.filter((wpt) => {
      const insideBox = wpt.lat >= bounds.south && wpt.lat <= bounds.north
        && wpt.lon >= bounds.west && wpt.lon <= bounds.east;
      return !insideBox;
    });
    removedWaypointCount = beforeWpts - next.waypoints.length;
  }
  if (removedCount > 0 || removedWaypointCount > 0) clearSummaryMetadata(next);
  return { track: next, removedCount, removedWaypointCount };
}

/**
 * Shifts all track and waypoint timestamps by offsetSeconds.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} offsetSeconds
 */
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
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} startTimeMs
 * @param {number} speedMps
 */
export function generateVirtualTimeline(parsed, startTimeMs, speedMps) {
  const next = cloneParsedTrack(parsed);
  if (!Number.isFinite(startTimeMs) || !Number.isFinite(speedMps) || speedMps <= 0) {
    return { track: next, durationSeconds: 0, pointCount: 0 };
  }
  const segs = ensureTracksMutable(next);
  let cursorMs = startTimeMs;
  let pointCount = 0;
  segs.forEach((seg, segIdx) => {
    if (segIdx > 0 && seg.length > 0) {
      cursorMs += 1000;
    }
    for (let i = 0; i < seg.length; i += 1) {
      if (i > 0) {
        const d = distanceMeters(seg[i - 1], seg[i]);
        cursorMs += (d / speedMps) * 1000;
      }
      seg[i].time = new Date(Math.round(cursorMs));
      pointCount += 1;
    }
  });
  const durationSeconds = Math.max(0, Math.round((cursorMs - startTimeMs) / 1000));
  if (pointCount > 0) clearSummaryMetadata(next);
  return { track: next, durationSeconds, pointCount };
}
