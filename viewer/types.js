/** @typedef {{ lat: number, lon: number, ele?: number, time?: Date, name?: string, description?: string, insightText?: string, images?: string[], icon?: string }} TrackPoint */
/** @typedef {{ name?: string | null, segments: TrackPoint[][] }} Track */
/** @typedef {{ name?: string | null, points: TrackPoint[] }} Route */
/** @typedef {{ name?: string | null, rings: TrackPoint[][] }} Area */
/** @typedef {{ version?: string | null, name?: string | null, tracks: Track[], routes: Route[], waypoints: TrackPoint[], areas?: Area[], timeUsedSeconds?: number, pauseSeconds?: number }} ParsedTrack */
/** @typedef {{ tracks: number, segments: number, routes: number, waypoints: number, areas: number, points: number, distanceMeters: number, start: Date | null, end: Date | null, durationSeconds: number | null, movingDurationSeconds: number | null, pausedSeconds: number | null, movingTimeSource: 'metadata' | 'estimated', stops: number, gaps: number, gapEvents: number, gapDistanceMeters: number, anomalies: number, anomalyEvents: number, anomalyDistanceMeters: number, elevation: boolean }} TrackSummary */
/** @typedef {TrackPoint & { along: number }} ElevationSample */
/** @typedef {{ from: number, to: number, slope: number, grade: 'flat' | 'up' | 'steepUp' | 'down' | 'steepDown' }} GroundCell */
/** @typedef {{ grade: GroundCell['grade'], from: number, to: number }} GroundRun */
/** @typedef {{ flatUp: number, gentleUp: number, steepUp: number, flatDown: number, gentleDown: number, steepDown: number }} SlopeBins */
/** @typedef {{ points: ElevationSample[], samples: ElevationSample[], min: number, max: number, total: number, ascent: number, descent: number, rawAscent: number, rawDescent: number, cells: GroundCell[], runs: GroundRun[], steep: { metres: number, maxSlope: number }, slopeBins: SlopeBins }} ProfileData */
/** @typedef {{ key: string, width: number, height: number, pixels: number }} ExportPreset */
/** @typedef {{ name?: string, marker: any, point: TrackPoint, photos: string[] }} WaypointStop */
/** @typedef {{ size: '1:1' | '9:16' | '4:3', ink: 'black' | 'white', scrim: 'none' | 'soft' }} ExportSettings */

export {};
