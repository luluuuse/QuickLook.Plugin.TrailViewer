import { elevationGain } from './profile.js';
import { clonePoint } from './track-ops-core.js';
import { cloneParsedTrack, trackTotalDistance } from './track-ops.js';

export const MAX_EDITOR_HISTORY = 50;
const LARGE_TRACK_POINTS = 20000;
const LARGE_TRACK_MAX_HISTORY = 20;

function snapshotNextTrack(nextParsed, previous, original) {
  if (nextParsed === original) return original;
  if (previous && nextParsed && nextParsed.tracks === previous.tracks && nextParsed.routes === previous.routes) {
    return {
      ...nextParsed,
      tracks: previous.tracks,
      routes: previous.routes,
      waypoints: (nextParsed.waypoints || []).map(clonePoint),
      areas: previous.areas === nextParsed.areas ? previous.areas : (nextParsed.areas || []),
    };
  }
  return cloneParsedTrack(nextParsed);
}

function countPoints(parsed) {
  let count = 0;
  for (const t of parsed?.tracks || []) {
    for (const seg of t.segments || []) count += seg.length;
  }
  for (const r of parsed?.routes || []) count += (r.points || []).length;
  return count;
}

function trackAscent(parsed) {
  let total = 0;
  for (const t of parsed?.tracks || []) {
    for (const seg of t.segments || []) {
      const eles = [];
      for (const pt of seg) {
        if (Number.isFinite(pt.ele)) eles.push(pt.ele);
      }
      if (eles.length >= 2) total += elevationGain(eles).ascent;
    }
  }
  for (const r of parsed?.routes || []) {
    const eles = [];
    for (const pt of r.points || []) {
      if (Number.isFinite(pt.ele)) eles.push(pt.ele);
    }
    if (eles.length >= 2) total += elevationGain(eles).ascent;
  }
  return Math.round(total);
}

/**
 * Immutable snapshot command store for the track editor with 50-step bounded undo/redo.
 * @param {{ maxHistory?: number, onChange?: (track: any, label: string) => void, onStateChange?: (state: any, reason: string) => void }} [opts]
 */
export function createTrackEditorStore({
  maxHistory = MAX_EDITOR_HISTORY,
  onChange = () => {},
  onStateChange = () => {},
} = {}) {
  /** @type {(track: any, label: string) => void} */
  const handleChange = onChange;
  /** @type {(state: any, reason: string) => void} */
  const handleStateChange = onStateChange;
  let active = false;
  let dirty = false;
  let original = null;
  let current = null;
  let undoStack = [];
  let redoStack = [];
  let originalStats = null;
  let effectiveMaxHistory = maxHistory;
  let nextVersionId = 1;
  let currentVersionId = 0;
  let savedVersionId = 0;

  function statsOf(parsed) {
    return {
      distanceMeters: trackTotalDistance(parsed),
      ascentMeters: trackAscent(parsed),
      points: countPoints(parsed),
      waypoints: (parsed?.waypoints || []).length,
    };
  }

  function snapshot() {
    return {
      active,
      dirty,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undoCount: undoStack.length,
      redoCount: redoStack.length,
      current,
      original,
    };
  }

  function notify(reason) {
    handleStateChange(snapshot(), reason);
  }

  function enter(parsed) {
    original = cloneParsedTrack(parsed);
    current = original;
    originalStats = statsOf(original);
    effectiveMaxHistory = originalStats.points > LARGE_TRACK_POINTS
      ? Math.min(maxHistory, LARGE_TRACK_MAX_HISTORY)
      : maxHistory;
    undoStack = [];
    redoStack = [];
    currentVersionId = 0;
    savedVersionId = 0;
    active = true;
    dirty = false;
    notify('enter');
  }

  function exit() {
    active = false;
    dirty = false;
    undoStack = [];
    redoStack = [];
    original = null;
    current = null;
    originalStats = null;
    notify('exit');
  }

  function apply(label, nextParsed) {
    if (!active || !current) return false;
    undoStack.push({ label, track: current, versionId: currentVersionId });
    if (undoStack.length > effectiveMaxHistory) undoStack.shift();
    redoStack = [];
    current = snapshotNextTrack(nextParsed, current, original);
    currentVersionId = (nextVersionId += 1);
    dirty = currentVersionId !== savedVersionId;
    handleChange(current, label);
    notify('apply');
    return true;
  }

  function undo() {
    if (!active || undoStack.length === 0 || !current) return false;
    const entry = undoStack.pop();
    redoStack.push({ label: entry.label, track: current, versionId: currentVersionId });
    current = entry.track;
    currentVersionId = entry.versionId;
    dirty = currentVersionId !== savedVersionId;
    handleChange(current, `undo:${entry.label}`);
    notify('undo');
    return true;
  }

  function redo() {
    if (!active || redoStack.length === 0 || !current) return false;
    const entry = redoStack.pop();
    undoStack.push({ label: entry.label, track: current, versionId: currentVersionId });
    current = entry.track;
    currentVersionId = entry.versionId;
    dirty = currentVersionId !== savedVersionId;
    handleChange(current, `redo:${entry.label}`);
    notify('redo');
    return true;
  }

  function reset() {
    if (!active || !original || !current) return false;
    if (!dirty && undoStack.length === 0) return false;
    return apply('reset', original);
  }

  function markSaved(versionId = currentVersionId) {
    if (!active || !current) return;
    savedVersionId = versionId;
    dirty = currentVersionId !== savedVersionId;
    notify('saved');
  }

  function diffSummary() {
    if (!current || !originalStats) return null;
    const now = statsOf(current);
    return {
      currentDistanceMeters: now.distanceMeters,
      currentAscentMeters: now.ascentMeters,
      currentPoints: now.points,
      currentWaypoints: now.waypoints,
      distanceDeltaMeters: now.distanceMeters - originalStats.distanceMeters,
      ascentDeltaMeters: now.ascentMeters - originalStats.ascentMeters,
      pointDelta: now.points - originalStats.points,
      waypointDelta: now.waypoints - originalStats.waypoints,
    };
  }

  return {
    enter,
    exit,
    apply,
    undo,
    redo,
    reset,
    markSaved,
    diffSummary,
    snapshot,
    isActive: () => active,
    isDirty: () => dirty,
    getVersion: () => currentVersionId,
    getCurrent: () => current,
    getOriginal: () => original,
  };
}
