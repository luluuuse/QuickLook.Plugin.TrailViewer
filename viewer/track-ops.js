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
  if (Array.isArray(parsed?.tracks) && parsed.tracks.length > 0) {
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

/**
 * Splits a ParsedTrack at cumulative distance splitMeters into two separate tracks.
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
  const firstSegs = [];
  const secondSegs = [];

  for (const track of sourceTracks) {
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
      if (partA.length >= 2) firstSegs.push(partA);
      if (partB.length >= 2) secondSegs.push(partB);
    }
  }

  const baseName = next.name || sourceTracks[0]?.name || 'Track';
  const resultTracks = [];
  if (firstSegs.length > 0) resultTracks.push({ name: `${baseName} (1)`, segments: firstSegs });
  if (secondSegs.length > 0) resultTracks.push({ name: `${baseName} (2)`, segments: secondSegs });
  if (resultTracks.length > 0) {
    next.tracks = resultTracks;
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
  const gaps = findTrackGaps(normalizedTracks(parsed));
  const jumpItems = (gaps.items || []).filter((item) => item.kind === 'jump');
  const anomalies = [];
  const seen = new Set();
  for (let i = 0; i < jumpItems.length; i += 1) {
    const item = jumpItems[i];
    const pt = item.to;
    if (!pt) continue;
    const key = `${Number(pt.lat).toFixed(6)},${Number(pt.lon).toFixed(6)}`;
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
  const anomalies = detectAnomalyPoints(next);
  const removeKeys = new Set(
    anomalies.map((a) => a.key).filter((key) => !excludedKeys.has(key)),
  );
  if (removeKeys.size === 0) return { track: next, removedCount: 0 };

  if (next.tracks.length === 0 && next.routes.length > 0) {
    next.tracks = normalizedTracks(next);
    next.routes = [];
  }

  let removedCount = 0;
  for (const track of next.tracks) {
    track.segments = track.segments
      .map((seg) => {
        if (seg.length <= 2) return seg;
        const kept = seg.filter((pt) => {
          const key = `${Number(pt.lat).toFixed(6)},${Number(pt.lon).toFixed(6)}`;
          return !removeKeys.has(key);
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

/**
 * Returns true if the track's start and end points are already within thresholdMeters (or < 2 points).
 * @param {import('./types.js').ParsedTrack} parsed
 * @param {number} [thresholdMeters]
 */
export function isTrackClosedLoop(parsed, thresholdMeters = 0.5) {
  const sourceTracks = normalizedTracks(parsed);
  const firstSeg = sourceTracks[0]?.segments?.[0];
  const lastTrack = sourceTracks[sourceTracks.length - 1];
  const lastSeg = lastTrack?.segments?.[lastTrack.segments.length - 1];
  if (!firstSeg || firstSeg.length === 0 || !lastSeg || lastSeg.length === 0) {
    return true;
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
  const firstSeg = sourceTracks[0]?.segments?.[0];
  const lastTrack = sourceTracks[sourceTracks.length - 1];
  const lastSeg = lastTrack?.segments?.[lastTrack.segments.length - 1];
  if (!firstSeg || firstSeg.length === 0 || !lastSeg || lastSeg.length === 0) {
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
  if (next.tracks.length === 0 && sourceTracks.length > 0) {
    next.tracks = sourceTracks;
    next.routes = [];
  }
  return { track: clearSummaryMetadata(next), closureMeters };
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
  next.waypoints[index] = clonePoint({ ...next.waypoints[index], ...patch });
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
