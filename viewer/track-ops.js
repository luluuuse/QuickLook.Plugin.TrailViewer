/**
 * Pure immutable geometry, waypoint, time, and metadata operations on ParsedTrack objects.
 * Re-exports focused domain modules while preserving a single stable entry point.
 */
export {
  SPLIT_COLORS,
  createSegmentColorResolver,
  cloneParsedTrack,
  ACTIVITY_TYPE_PRESETS,
  matchActivityPreset,
  updateTrackMetadata,
  normalizedTracks,
  trackTotalDistance,
} from './track-ops-core.js';
export * from './track-ops-geometry.js';
export * from './track-ops-waypoints.js';
export * from './track-ops-time.js';
