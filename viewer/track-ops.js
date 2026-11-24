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

function isValidSegSnap(snap, segs) {
  if (!snap || !Number.isInteger(snap.flatSegIndex) || snap.flatSegIndex < 0 || snap.flatSegIndex >= segs.length) {
    return false;
  }
  const seg = segs[snap.flatSegIndex];
  if (!Number.isInteger(snap.ptIndex) || snap.ptIndex < 0 || snap.ptIndex >= seg.length) return false;
  const segT = Number.isFinite(snap.segT) ? Math.max(0, Math.min(1, snap.segT)) : 0;
  if (segT > 0 && snap.ptIndex >= seg.length - 1) return false;
  return true;
}

function normalizeSnapPosition(snap, seg) {
  const rawT = Number.isFinite(snap.segT) ? Math.max(0, Math.min(1, snap.segT)) : 0;
  if (rawT <= 1e-6) {
    return { index: snap.ptIndex, t: 0, pos: snap.ptIndex, point: clonePoint(seg[snap.ptIndex]) };
  }
  if (rawT >= 1 - 1e-6 && snap.ptIndex + 1 < seg.length) {
    const nextIdx = snap.ptIndex + 1;
    return { index: nextIdx, t: 0, pos: nextIdx, point: clonePoint(seg[nextIdx]) };
  }
  const anchor = interpolatePoint(seg[snap.ptIndex], seg[snap.ptIndex + 1], rawT);
  return { index: snap.ptIndex, t: rawT, pos: snap.ptIndex + rawT, point: anchor };
}

function clearSegmentTimestamps(seg) {
  let cleared = false;
  for (const pt of seg) {
    if (pt.time !== undefined) {
      delete pt.time;
      cleared = true;
    }
  }
  return cleared;
}

/**
 * Applies a hand-drawn path to the track:
 * 1) Both ends snapped to distinct positions (vertices or arbitrary interpolated points) on the same segment ->
 *    replace [lo..hi] with drawn path (gap fill / detour), linearly interpolating middle elevations by cumulative
 *    distance when both anchors have elevation.
 * 2) Exactly one end snapped to the first or last point of a segment -> extend that segment without fabricating ele.
 * 3) Otherwise -> append drawn points as a new segment.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {Array<{ lat: number, lon: number, ele?: number }>} drawnPoints
 * @param {{ startSnap?: { flatSegIndex: number, ptIndex: number, segT?: number } | null, endSnap?: { flatSegIndex: number, ptIndex: number, segT?: number } | null }} [options]
 */
export function applyDrawnPath(parsed, drawnPoints, { startSnap = null, endSnap = null } = {}) {
  const next = cloneParsedTrack(parsed);
  if (!Array.isArray(drawnPoints) || drawnPoints.length < 2) {
    return { track: next, mode: 'noop', addedPoints: 0, timestampsCleared: false };
  }
  const drawn = drawnPoints.map((pt) => {
    /** @type {{ lat: number, lon: number, ele?: number }} */
    const clean = { lat: Number(pt.lat), lon: Number(pt.lon) };
    if (Number.isFinite(pt.ele)) clean.ele = Number(pt.ele);
    return clean;
  });
  const segs = ensureTracksMutable(next);
  const validStart = isValidSegSnap(startSnap, segs) ? startSnap : null;
  const validEnd = isValidSegSnap(endSnap, segs) ? endSnap : null;

  // Case 1: Both ends snapped onto the same segment.
  if (validStart && validEnd && validStart.flatSegIndex === validEnd.flatSegIndex) {
    const seg = segs[validStart.flatSegIndex];
    const startNorm = normalizeSnapPosition(validStart, seg);
    const endNorm = normalizeSnapPosition(validEnd, seg);
    if (Math.abs(startNorm.pos - endNorm.pos) > 1e-6) {
      const reversed = startNorm.pos > endNorm.pos;
      const loNorm = reversed ? endNorm : startNorm;
      const hiNorm = reversed ? startNorm : endNorm;
      const connectsBothEndpoints = loNorm.index === 0
        && loNorm.t === 0
        && hiNorm.index === seg.length - 1
        && hiNorm.t === 0;

      // Case 1a: Connecting segment start <-> end closes the loop instead of erasing the whole track.
      if (connectsBothEndpoints) {
        // Orient drawn path from segment end -> segment start so it appends cleanly onto the end.
        const toStart = reversed ? drawn : [...drawn].reverse();
        const middle = toStart.slice(1, -1).map((pt) => ({ ...pt }));
        const anchorEnd = seg[seg.length - 1];
        const anchorStart = clonePoint(seg[0]);
        if (middle.length > 0 && Number.isFinite(anchorEnd.ele) && Number.isFinite(anchorStart.ele)) {
          const chain = [anchorEnd, ...middle, anchorStart];
          const cumDist = [0];
          for (let i = 1; i < chain.length; i += 1) {
            cumDist.push(cumDist[i - 1] + distanceMeters(chain[i - 1], chain[i]));
          }
          const totalDist = cumDist[cumDist.length - 1];
          for (let i = 0; i < middle.length; i += 1) {
            if (!Number.isFinite(middle[i].ele)) {
              const ratio = totalDist > 0
                ? cumDist[i + 1] / totalDist
                : (i + 1) / (middle.length + 1);
              middle[i].ele = Math.round((anchorEnd.ele + (anchorStart.ele - anchorEnd.ele) * ratio) * 10) / 10;
            }
          }
        }
        delete anchorStart.time;
        seg.push(...middle, anchorStart);
        const timestampsCleared = clearSegmentTimestamps(seg);
        clearSummaryMetadata(next);
        return { track: next, mode: 'close-loop', addedPoints: middle.length + 1, timestampsCleared };
      }

      // Case 1b: Gap fill / detour replacing an interior span [lo..hi].
      const oriented = reversed ? [...drawn].reverse() : drawn;
      const middle = oriented.slice(1, -1).map((pt) => ({ ...pt }));

      const anchorLo = loNorm.point;
      const anchorHi = hiNorm.point;
      if (middle.length > 0 && Number.isFinite(anchorLo.ele) && Number.isFinite(anchorHi.ele)) {
        const chain = [anchorLo, ...middle, anchorHi];
        const cumDist = [0];
        for (let i = 1; i < chain.length; i += 1) {
          cumDist.push(cumDist[i - 1] + distanceMeters(chain[i - 1], chain[i]));
        }
        const totalDist = cumDist[cumDist.length - 1];
        for (let i = 0; i < middle.length; i += 1) {
          if (!Number.isFinite(middle[i].ele)) {
            const ratio = totalDist > 0
              ? cumDist[i + 1] / totalDist
              : (i + 1) / (middle.length + 1);
            middle[i].ele = Math.round((anchorLo.ele + (anchorHi.ele - anchorLo.ele) * ratio) * 10) / 10;
          }
        }
      }

      const prefix = seg.slice(0, loNorm.index + 1);
      if (loNorm.t > 0) prefix.push(anchorLo);
      const suffix = hiNorm.t > 0 ? [anchorHi, ...seg.slice(hiNorm.index + 1)] : seg.slice(hiNorm.index);
      const rebuilt = [...prefix, ...middle, ...suffix];
      const timestampsCleared = clearSegmentTimestamps(rebuilt);
      seg.length = 0;
      seg.push(...rebuilt);
      clearSummaryMetadata(next);
      return { track: next, mode: 'replace', addedPoints: middle.length, timestampsCleared };
    }
  }

  // Case 2: Extend from either endpoint of an existing segment.
  const startNorm = validStart ? normalizeSnapPosition(validStart, segs[validStart.flatSegIndex]) : null;
  const endNorm = validEnd ? normalizeSnapPosition(validEnd, segs[validEnd.flatSegIndex]) : null;
  const startAtStart = startNorm && startNorm.index === 0 && startNorm.t === 0;
  const startAtEnd = startNorm && startNorm.index === segs[validStart.flatSegIndex].length - 1 && startNorm.t === 0;
  const endAtStart = endNorm && endNorm.index === 0 && endNorm.t === 0;
  const endAtEnd = endNorm && endNorm.index === segs[validEnd.flatSegIndex].length - 1 && endNorm.t === 0;

  if (validStart && !validEnd && (startAtStart || startAtEnd)) {
    const seg = segs[validStart.flatSegIndex];
    const extra = drawn.slice(1).map((pt) => ({ ...pt }));
    if (startAtEnd) {
      seg.push(...extra);
    } else {
      seg.unshift(...extra.reverse());
    }
    const timestampsCleared = clearSegmentTimestamps(seg);
    clearSummaryMetadata(next);
    return {
      track: next,
      mode: startAtEnd ? 'extend-end' : 'extend-start',
      addedPoints: extra.length,
      timestampsCleared,
    };
  }

  if (validEnd && !validStart && (endAtStart || endAtEnd)) {
    const seg = segs[validEnd.flatSegIndex];
    const extra = drawn.slice(0, -1).map((pt) => ({ ...pt }));
    if (endAtStart) {
      seg.unshift(...extra);
    } else {
      seg.push(...extra.reverse());
    }
    const timestampsCleared = clearSegmentTimestamps(seg);
    clearSummaryMetadata(next);
    return {
      track: next,
      mode: endAtStart ? 'extend-start' : 'extend-end',
      addedPoints: extra.length,
      timestampsCleared,
    };
  }

  // Case 3: Append as a new branch segment.
  if (next.tracks.length === 0) {
    next.tracks.push({ name: next.name ?? null, segments: [] });
  }
  next.tracks[next.tracks.length - 1].segments.push(drawn);
  clearSummaryMetadata(next);
  return { track: next, mode: 'branch', addedPoints: drawn.length, timestampsCleared: false };
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
    // Step 1: despike with local median (preserve first & last valid points).
    const despiked = [...raw];
    for (let k = 1; k < raw.length - 1; k += 1) {
      const start = Math.max(0, k - radius);
      const end = Math.min(raw.length - 1, k + radius);
      const neighborhood = [];
      for (let j = start; j <= end; j += 1) neighborhood.push(raw[j]);
      const med = medianValue(neighborhood);
      if (Math.abs(raw[k] - med) >= spikeLimit || (raw[k] === 0 && Math.abs(med) >= spikeLimit)) {
        despiked[k] = med;
      }
    }

    // Step 2: symmetric triangular weighted moving average (preserve first & last valid points).
    for (let k = 1; k < despiked.length - 1; k += 1) {
      const start = Math.max(0, k - radius);
      const end = Math.min(despiked.length - 1, k + radius);
      let weightedSum = 0;
      let weightTotal = 0;
      for (let j = start; j <= end; j += 1) {
        const w = radius + 1 - Math.abs(j - k);
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

function waypointSignature(wpt) {
  const lat = Number.isFinite(wpt?.lat) ? wpt.lat.toFixed(5) : '0';
  const lon = Number.isFinite(wpt?.lon) ? wpt.lon.toFixed(5) : '0';
  const name = String(wpt?.name || '').trim().toLowerCase();
  return `${lat}|${lon}|${name}`;
}

/**
 * Appends tracks/segments and deduplicated waypoints from an external parsed GPX/KML into the current track.
 * When mergeIntoSingle is true, matches the closest endpoint pair (auto-reversing the incoming track if needed);
 * if all endpoint pairs are farther than maxMergeGapMeters, keeps segments separate to avoid cross-map straight lines.
 * @param {import('./types.js').ParsedTrack} currentParsed
 * @param {import('./types.js').ParsedTrack} incomingParsed
 * @param {{ mergeIntoSingle?: boolean, mergeWaypoints?: boolean, maxMergeGapMeters?: number }} [options]
 */
export function appendExternalTrack(
  currentParsed,
  incomingParsed,
  { mergeIntoSingle = false, mergeWaypoints = true, maxMergeGapMeters = 500 } = {},
) {
  const next = cloneParsedTrack(currentParsed);
  const existingSegs = ensureTracksMutable(next).filter((seg) => seg.length > 0);
  const incomingCopy = cloneParsedTrack(incomingParsed);
  const incomingTracks = normalizedTracks(incomingCopy);
  const incomingSegs = [];

  for (const trk of incomingTracks) {
    for (const seg of trk.segments || []) {
      if (seg.length > 0) incomingSegs.push(seg.map(clonePoint));
    }
  }

  let addedWaypoints = 0;
  if (mergeWaypoints && Array.isArray(incomingCopy.waypoints) && incomingCopy.waypoints.length > 0) {
    const seen = new Set((next.waypoints || []).map(waypointSignature));
    for (const wpt of incomingCopy.waypoints) {
      if (!Number.isFinite(wpt?.lat) || !Number.isFinite(wpt?.lon)) continue;
      const sig = waypointSignature(wpt);
      if (seen.has(sig)) continue;
      seen.add(sig);
      next.waypoints.push(clonePoint(wpt));
      addedWaypoints += 1;
    }
  }

  const addedSegments = incomingSegs.length;
  if (addedSegments === 0) {
    if (addedWaypoints > 0) clearSummaryMetadata(next);
    return {
      track: next,
      addedSegments: 0,
      addedWaypoints,
      merged: false,
      reversedIncoming: false,
      reorderedByTime: false,
      timestampsCleared: false,
      maxGapMeters: 0,
      skippedMergeGapMeters: 0,
    };
  }

  if (mergeIntoSingle && existingSegs.length > 0) {
    const basePts = existingSegs.flat();
    const incPts = incomingSegs.flat();
    const curStart = basePts[0];
    const curEnd = basePts[basePts.length - 1];
    const incStart = incPts[0];
    const incEnd = incPts[incPts.length - 1];

    const options = [
      { kind: 'tail-fwd', gap: distanceMeters(curEnd, incStart) },
      { kind: 'tail-rev', gap: distanceMeters(curEnd, incEnd) },
      { kind: 'head-fwd', gap: distanceMeters(incEnd, curStart) },
      { kind: 'head-rev', gap: distanceMeters(incStart, curStart) },
    ];
    options.sort((a, b) => a.gap - b.gap);
    const best = options[0];

    if (best.gap <= maxMergeGapMeters) {
      let mergedPts;
      let reversedIncoming = false;
      if (best.kind === 'tail-fwd') {
        mergedPts = [...basePts, ...incPts];
      } else if (best.kind === 'tail-rev') {
        reversedIncoming = true;
        mergedPts = [...basePts, ...[...incPts].reverse()];
      } else if (best.kind === 'head-fwd') {
        mergedPts = [...incPts, ...basePts];
      } else {
        reversedIncoming = true;
        mergedPts = [...[...incPts].reverse(), ...basePts];
      }
      const timestampsCleared = reversedIncoming
        ? clearSegmentTimestamps(mergedPts)
        : false;
      next.tracks = [{ name: next.tracks[0]?.name ?? next.name ?? null, segments: [mergedPts] }];
      next.routes = [];
      clearSummaryMetadata(next);
      return {
        track: next,
        addedSegments,
        addedWaypoints,
        merged: true,
        reversedIncoming,
        reorderedByTime: best.kind === 'head-fwd' || best.kind === 'head-rev',
        timestampsCleared,
        maxGapMeters: Math.round(best.gap),
        skippedMergeGapMeters: 0,
      };
    }

    // Endpoints are too far apart: keep as separate tracks to avoid cross-map straight-line artifacts.
    for (const trk of incomingTracks) {
      const validSegs = (trk.segments || []).filter((seg) => seg.length > 0);
      if (validSegs.length === 0) continue;
      next.tracks.push({
        name: trk.name ?? incomingCopy.name ?? null,
        segments: validSegs.map((seg) => seg.map(clonePoint)),
      });
    }
    clearSummaryMetadata(next);
    return {
      track: next,
      addedSegments,
      addedWaypoints,
      merged: false,
      reversedIncoming: false,
      reorderedByTime: false,
      timestampsCleared: false,
      maxGapMeters: Math.round(best.gap),
      skippedMergeGapMeters: Math.round(best.gap),
    };
  }

  for (const trk of incomingTracks) {
    const validSegs = (trk.segments || []).filter((seg) => seg.length > 0);
    if (validSegs.length === 0) continue;
    next.tracks.push({
      name: trk.name ?? incomingCopy.name ?? null,
      segments: validSegs.map((seg) => seg.map(clonePoint)),
    });
  }
  clearSummaryMetadata(next);
  return {
    track: next,
    addedSegments,
    addedWaypoints,
    merged: false,
    reversedIncoming: false,
    reorderedByTime: false,
    timestampsCleared: false,
    maxGapMeters: 0,
    skippedMergeGapMeters: 0,
  };
}

/**
 * Reorders waypoints along cumulative track distance, placing far off-track waypoints (> offTrackThresholdMeters)
 * at the end while preserving their relative order.
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {{ offTrackThresholdMeters?: number }} [options]
 */
export function sortWaypointsAlongTrack(parsed, { offTrackThresholdMeters = 500 } = {}) {
  const next = cloneParsedTrack(parsed);
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
  const next = cloneParsedTrack(parsed);
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
  const minGap = Math.max(0, Number(minDistanceMeters) || 50);
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
