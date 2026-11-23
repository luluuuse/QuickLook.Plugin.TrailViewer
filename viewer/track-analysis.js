import { bearingDegrees, distanceMeters } from './geo.js';

// Hiking pace can fall below 2 km/h in snow, scree and navigation-heavy ground. These thresholds only decide
// whether a recorder is stationary; they are deliberately lower than normal walking speed.
export const MOVEMENT_RULES = Object.freeze({
  startSpeed: 0.1,
  stopSpeed: 0.02,
  maxGapSeconds: 300,
});
const POSITION_GAP_METRES = 30;
const IMPLAUSIBLE_SPEED_MPS = 15;
const DISTANCE_INTERVALS_METRES = [1000, 2000, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 500000];
// Parsed point arrays are immutable for a preview, so the summary and map can share one gap walk.
const defaultGapCache = new WeakMap();

export function isValidHeartRate(value) {
  return Number.isFinite(value) && value > 0 && value < 255;
}

/** Arithmetic mean of valid recorded readings; missing readings do not become zero or distance weights. */
export function averageHeartRate(values) {
  let count = 0;
  let total = 0;
  for (const value of values) {
    if (!isValidHeartRate(value)) continue;
    count += 1;
    total += value;
  }
  return count > 0 ? total / count : null;
}

export function pathDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distanceMeters(points[i - 1], points[i]);
  return total;
}

/**
 * Moving time uses speed hysteresis so GPS drift around a standing person does not count as walking.
 * A time jump over five minutes is a recording break and is not counted as moving regardless of distance.
 */
export function movementSummary(tracks, {
  startSpeed = MOVEMENT_RULES.startSpeed,
  stopSpeed = MOVEMENT_RULES.stopSpeed,
  maxGapSeconds = MOVEMENT_RULES.maxGapSeconds,
} = {}) {
  let observedSeconds = 0;
  let movingSeconds = 0;
  let stops = 0;
  let timeGaps = 0;
  let previous = null;
  let boundary = false;

  for (const track of tracks) {
    for (const segment of track.segments) {
      let moving = false;
      for (const point of segment) {
        if (!previous?.time || !point.time) {
          previous = point;
          moving = false;
          continue;
        }
        const seconds = (point.time - previous.time) / 1000;
        if (!(seconds > 0)) {
          previous = point;
          moving = false;
          continue;
        }
        const startsSegment = boundary;
        boundary = false;
        observedSeconds += seconds;
        if (startsSegment || seconds > maxGapSeconds) {
          if (seconds > maxGapSeconds) timeGaps += 1;
          moving = false;
        } else {
          const speed = distanceMeters(previous, point) / seconds;
          if (!moving && speed >= startSpeed) moving = true;
          else if (moving && speed < stopSpeed) {
            moving = false;
            stops += 1;
          }
          if (moving) movingSeconds += seconds;
        }
        previous = point;
      }
      boundary = true;
    }
  }

  return {
    observedSeconds: Math.round(observedSeconds),
    movingDurationSeconds: observedSeconds > 0 ? Math.round(movingSeconds) : null,
    pausedSeconds: observedSeconds > 0 ? Math.round(observedSeconds - movingSeconds) : null,
    stops,
    timeGaps,
  };
}

/** Gaps inside a segment and jumps between segments, with both map geometry and timing metadata. */
export function findTrackGaps(tracks, options = {}) {
  const cacheable = options.maxDistanceMeters === undefined && options.implausibleSpeed === undefined;
  if (cacheable && defaultGapCache.has(tracks)) return defaultGapCache.get(tracks);
  const maxDistanceMeters = options.maxDistanceMeters ?? POSITION_GAP_METRES;
  const implausibleSpeed = options.implausibleSpeed ?? IMPLAUSIBLE_SPEED_MPS;
  const items = [];
  let previous = null;

  const add = (from, to, boundary) => {
    if (!from || !to) return;
    const metres = distanceMeters(from, to);
    const seconds = from.time && to.time ? (to.time - from.time) / 1000 : null;
    const positionGap = metres > maxDistanceMeters;
    const jump = seconds !== null && seconds > 0 && metres > maxDistanceMeters
      && metres / seconds > implausibleSpeed;
    // A long pause at the same place is a pause, not a broken line. It belongs to moving-time statistics;
    // a trajectory break needs either a spatial jump or a gap between recorded segments.
    if (!jump && !(boundary && positionGap)) return;
    items.push({
      from,
      to,
      distanceMeters: metres,
      timeSeconds: seconds,
      kind: boundary && positionGap ? 'segment' : jump ? 'jump' : 'position',
    });
  };

  for (const track of tracks) {
    for (const segment of track.segments) {
      if (segment.length === 0) continue;
      if (previous) add(previous, segment[0], true);
      for (let i = 1; i < segment.length; i += 1) add(segment[i - 1], segment[i], false);
      previous = segment[segment.length - 1];
    }
  }

  const episodes = [];
  let run = [];
  const flush = () => {
    if (run.length === 0) return;
    const first = run[0];
    const last = run[run.length - 1];
    episodes.push({
      ...first,
      to: last.to,
      distanceMeters: run.reduce((sum, item) => sum + item.distanceMeters, 0),
      maxDistanceMeters: Math.max(...run.map((item) => item.distanceMeters)),
      timeSeconds: first.from?.time && last.to?.time
        ? (last.to.time - first.from.time) / 1000
        : null,
      kind: first.kind,
      continuous: run.length > 1,
      rawCount: run.length,
      rawItems: run,
    });
    run = [];
  };
  for (const item of items) {
    if (run.length > 0 && run[run.length - 1].kind === item.kind
      && run[run.length - 1].to === item.from) run.push(item);
    else {
      flush();
      run = [item];
    }
  }
  flush();

  const episodesOfKind = (kind) => episodes.filter((episode) => episode.kind === kind);
  const segmentEpisodes = episodesOfKind('segment');
  const jumpEpisodes = episodesOfKind('jump');
  const result = {
    items,
    episodes,
    count: items.length,
    episodeCount: episodes.length,
    segmentCount: segmentEpisodes.length,
    jumpCount: jumpEpisodes.length,
    distanceMeters: items.reduce((sum, item) => sum + item.distanceMeters, 0),
    segmentDistanceMeters: segmentEpisodes.reduce((sum, episode) => sum + episode.distanceMeters, 0),
    jumpDistanceMeters: jumpEpisodes.reduce((sum, episode) => sum + episode.distanceMeters, 0),
  };
  if (cacheable) defaultGapCache.set(tracks, result);
  return result;
}

/** Samples whole cumulative intervals across one or more paths without counting gaps between paths. */
export function routeDirectionSamples(paths, { interval = 1000, offset = 0 } = {}) {
  if (!(interval > 0)) return [];
  const samples = [];
  let along = 0;
  let next = interval;
  for (const points of paths) {
    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1];
      const point = points[i];
      const step = distanceMeters(previous, point);
      if (!(step > 0)) continue;
      while (along + step >= next) {
        const ratio = (next - along) / step;
        samples.push({
          distanceMeters: offset + next,
          point: {
            lat: previous.lat + (point.lat - previous.lat) * ratio,
            lon: previous.lon + (point.lon - previous.lon) * ratio,
          },
          bearing: bearingDegrees(previous, point),
        });
        next += interval;
      }
      along += step;
    }
  }
  return samples;
}

function pointAlong(a, b, ratio) {
  return {
    lat: a.lat + (b.lat - a.lat) * ratio,
    lon: a.lon + (b.lon - a.lon) * ratio,
  };
}

/**
 * Returns the parts of a route between two cumulative distances. Segment boundaries stay separate, so a
 * highlight never draws a line across a recording gap; both requested ends are interpolated exactly.
 */
export function sliceRouteByDistance(paths, { from = 0, to = Infinity, offset = 0 } = {}) {
  const slices = [];
  let along = offset;
  const end = Math.max(from, to);
  for (const points of paths) {
    let current = [];
    for (let index = 1; index < points.length; index += 1) {
      const previousPoint = points[index - 1];
      const point = points[index];
      const step = distanceMeters(previousPoint, point);
      const segmentStart = along;
      const segmentEnd = along + step;
      const start = Math.max(from, segmentStart);
      const finish = Math.min(end, segmentEnd);
      if (finish > start && step > 0) {
        const a = pointAlong(
          previousPoint,
          point,
          Math.min(1, Math.max(0, (start - segmentStart) / step)),
        );
        const b = pointAlong(
          previousPoint,
          point,
          Math.min(1, Math.max(0, (finish - segmentStart) / step)),
        );
        if (current.length === 0) current.push(a);
        current.push(b);
      }
      along = segmentEnd;
      if (along >= end) break;
    }
    if (current.length >= 2) slices.push(current);
    current = [];
    if (along >= end) break;
  }
  return slices;
}

/**
 * One sample for every whole distance interval along a path, with the course at that point. The point is
 * interpolated rather than snapped to the next recorded GPS sample, so kilometre labels stay honest.
 */
export function directionSamples(points, options = {}) {
  if (points.length < 2) return [];
  return routeDirectionSamples([points], options);
}

function nextDistanceInterval(targetMeters) {
  return DISTANCE_INTERVALS_METRES.find((interval) => interval >= targetMeters)
    || Math.ceil(targetMeters / 100000) * 100000;
}

/**
 * Keeps kilometre labels readable at every zoom. The desired spacing in pixels is converted to metres using
 * the route's projected length. Labels use round 1/2/5/10... intervals; direction arrows use a tighter limit.
 */
export function adaptiveDistanceIntervals(distanceMeters, projectedLengthPixels, {
  labelSpacingPixels = 64,
  arrowSpacingPixels = 38,
} = {}) {
  if (!(distanceMeters > 0) || !(projectedLengthPixels > 0)
    || !Number.isFinite(distanceMeters) || !Number.isFinite(projectedLengthPixels)) {
    return { labelIntervalMeters: 1000, arrowIntervalMeters: 1000, pixelsPerKilometre: 0 };
  }
  const pixelsPerMetre = projectedLengthPixels / distanceMeters;
  const labelTarget = labelSpacingPixels / pixelsPerMetre;
  const arrowTarget = arrowSpacingPixels / pixelsPerMetre;
  const labelIntervalMeters = nextDistanceInterval(labelTarget);
  const arrowIntervalMeters = Math.min(labelIntervalMeters, nextDistanceInterval(arrowTarget));
  return {
    labelIntervalMeters,
    arrowIntervalMeters,
    pixelsPerKilometre: pixelsPerMetre * 1000,
  };
}

/** Naismith's rule: five kilometres per hour plus one hour for every 600 m of ascent. */
export function naismithSeconds(distance, ascent, { flatKmh = 5, ascentMetresPerHour = 600 } = {}) {
  if (!(distance >= 0) || !Number.isFinite(distance)) return null;
  const climb = Number.isFinite(ascent) ? Math.max(0, ascent) : 0;
  return Math.round(distance / (flatKmh / 3.6) + climb / (ascentMetresPerHour / 3600));
}

/**
 * Grade-aware estimate: Naismith supplies the base, Langmuir prices gentle and steep descents, and a steep
 * uphill extension applies the same 10 minutes / 300 m penalty above 12 degrees. Bins are scaled to the
 * filtered totals so fine reversals do not vanish from the account.
 */
export function gradeAwareHikeSeconds({
  distance,
  ascent,
  descent,
  bins,
  flatKmh = 5,
  ascentMetresPerHour = 600,
  penaltyMinutes = 10,
  penaltyMetres = 300,
}) {
  if (!(distance >= 0) || !Number.isFinite(distance)) return null;
  const climb = Number.isFinite(ascent) ? Math.max(0, ascent) : 0;
  const drop = Number.isFinite(descent) ? Math.max(0, descent) : 0;
  const base = distance / (flatKmh / 3.6) + climb / (ascentMetresPerHour / 3600);
  if (!bins) return Math.round(base);

  const upClassified = bins.flatUp + bins.gentleUp + bins.steepUp;
  const downClassified = bins.flatDown + bins.gentleDown + bins.steepDown;
  const upScale = upClassified > 0 ? climb / upClassified : 0;
  const downScale = downClassified > 0 ? drop / downClassified : 0;
  const penalty = penaltyMinutes * 60 / penaltyMetres;
  const correction = (
    bins.steepUp * upScale
    + bins.steepDown * downScale
    - bins.gentleDown * downScale
  ) * penalty;
  return Math.max(0, Math.round(base + correction));
}
