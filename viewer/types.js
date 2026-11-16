/** @typedef {{ lat: number, lon: number, ele?: number, time?: Date, name?: string, description?: string, insightText?: string, images?: string[], icon?: string, heartRate?: number }} TrackPoint */
/** @typedef {{ name?: string | null, segments: TrackPoint[][] }} Track */
/** @typedef {{ name?: string | null, points: TrackPoint[] }} Route */
/** @typedef {{ name?: string | null, rings: TrackPoint[][] }} Area */
/** @typedef {{ version?: string | null, name?: string | null, tracks: Track[], routes: Route[], waypoints: TrackPoint[], areas?: Area[], timeUsedSeconds?: number, pauseSeconds?: number, network?: boolean }} ParsedTrack */
/** @typedef {{ tracks: number, segments: number, routes: number, waypoints: number, areas: number, points: number, distanceMeters: number, start: Date | null, end: Date | null, durationSeconds: number | null, movingDurationSeconds: number | null, pausedSeconds: number | null, movingTimeSource: 'metadata' | 'estimated' | 'network', stops: number, gaps: number, gapEvents: number, gapDistanceMeters: number, anomalies: number, anomalyEvents: number, anomalyDistanceMeters: number, elevation: boolean, network?: boolean }} TrackSummary */
/** @typedef {TrackPoint & { along: number }} ElevationSample */
/** @typedef {{ along: number, heartRate: number }} HeartRateSample */
/** @typedef {{ segments: HeartRateSample[][], min: number, max: number, dataMin: number, dataMax: number, average: number, count: number }} HeartRateData */
/** @typedef {{ from: number, to: number, slope: number, grade: 'flat' | 'up' | 'steepUp' | 'down' | 'steepDown' }} GroundCell */
/** @typedef {{ grade: GroundCell['grade'], from: number, to: number }} GroundRun */
/** @typedef {{ flatUp: number, gentleUp: number, steepUp: number, flatDown: number, gentleDown: number, steepDown: number }} SlopeBins */
/** @typedef {{ points: ElevationSample[], samples: ElevationSample[], heartRate?: HeartRateData | null, min: number, max: number, total: number, ascent: number, descent: number, rawAscent: number, rawDescent: number, cells: GroundCell[], runs: GroundRun[], steep: { metres: number, maxSlope: number }, slopeBins: SlopeBins }} ProfileData */
/** @typedef {{ index: number, fromMeters: number, toMeters: number, distanceMeters: number, elapsedSeconds: number | null, movingSeconds: number | null, cumulativeSeconds: number | null, averageSpeedMps: number | null, ascentMeters: number, descentMeters: number, verticalSpeedMps: number | null, averageHeartRate: number | null }} SplitStats */
/** @typedef {{ splits: SplitStats[], totalDistanceMeters: number, totalTimeSeconds: number | null, movingTimeSeconds: number | null, fastestIndex: number | null, hasHeartRate: boolean }} SplitData */
/** @typedef {{ key: string, width: number, height: number, pixels: number }} ExportPreset */
/** @typedef {{ name?: string, marker: any, point: TrackPoint, photos: string[] }} WaypointStop */
/** @typedef {{ size: '1:1' | '9:16' | '4:3', ink: 'black' | 'white', scrim: 'none' | 'soft' }} ExportSettings */

export {};
