// Generated route-network regression: many independent tracks must stay on the map without being treated as
// one trip or creating per-point and per-kilometre overlays.
const path = require('path');
const {
  launchBrowser,
  waitForLayout,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures } = createChecker('network');
const artifacts = createArtifacts('network');

function networkFixture() {
  let xml = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2" '
    + 'xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Generated network</name>'
    + '<ExtendedData><Data name="segment_count"><value>24</value></Data>'
    + '<Data name="duration_seconds"><value>0</value></Data>'
    + '<Data name="distance_meters"><value>240000</value></Data></ExtendedData>'
    + '<Folder><name>Markers</name>';
  for (let index = 0; index < 300; index += 1) {
    const lat = 30 + (index % 20) * 0.001;
    const lon = 100 + Math.floor(index / 20) * 0.001;
    xml += `<Placemark><name>Marker ${index}</name><Point><coordinates>${lon},${lat},20</coordinates></Point></Placemark>`;
  }
  xml += '</Folder><Folder><name>Independent tracks</name>';
  for (let track = 0; track < 24; track += 1) {
    xml += `<Placemark><name>Track ${track}</name><gx:Track>`;
    for (let index = 0; index < 100; index += 1) {
      xml += `<when>2026-01-${String(track + 1).padStart(2, '0')}T09:`
        + `${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z</when>`;
    }
    for (let index = 0; index < 100; index += 1) {
      const lat = 30 + track * 0.0002 + index * 0.00005;
      const lon = 100 + track * 0.0002 + index * 0.00004;
      xml += `<gx:coord>${lon.toFixed(7)} ${lat.toFixed(7)} ${20 + index % 5}</gx:coord>`;
    }
    xml += '</gx:Track></Placemark>';
  }
  return `${xml}</Folder></Document></kml>`;
}

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await artifacts.start(page);
  const pageErrors = [];
  const cspViolations = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
  });
  await page.route((url) => url.pathname.endsWith('/generated-network.kml'),
    (route) => route.fulfill({ body: networkFixture(), contentType: 'application/vnd.google-earth.kml+xml' }));

  const started = Date.now();
  await page.goto(`${base}/viewer/index.html?src=../generated-network.kml`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await page.waitForFunction(() => window.trailViewer.performance().firstPaintMs !== null);
  await waitForLayout(page);
  const state = await page.evaluate(() => ({
    wallMs: null,
    network: window.trailViewer.gpx.network,
    tracks: window.trailViewer.summary.tracks,
    points: window.trailViewer.summary.points,
    waypoints: window.trailViewer.summary.waypoints,
    duration: window.trailViewer.summary.durationSeconds,
    moving: window.trailViewer.summary.movingDurationSeconds,
    source: window.trailViewer.summary.movingTimeSource,
    pointTimes: window.trailViewer.gpx.tracks
      .flatMap((track) => track.segments)
      .flat()
      .filter((point) => point.time).length,
    pointElevations: window.trailViewer.gpx.tracks
      .flatMap((track) => track.segments)
      .flat()
      .filter((point) => point.ele !== undefined).length,
    splitHidden: document.getElementById('splits').hidden,
    profileHidden: document.getElementById('profile').hidden,
    pinCount: window.trailViewer.pins.count(),
    markerNodes: document.querySelectorAll('.gpx-pin').length,
    distanceMarks: document.querySelectorAll('.gpx-distance').length,
    gapMarks: document.querySelectorAll('.gpx-gap-marker, .gpx-anomaly-marker').length,
    canvases: document.querySelectorAll('#map canvas').length,
    trackStats: window.trailViewer.trackStats(),
    measureIndexed: window.trailViewer.measure.indexed(),
    performance: window.trailViewer.performance(),
  }));
  state.wallMs = Date.now() - started;
  console.log(`generated-network.kml: ${state.wallMs} ms ${JSON.stringify(state.performance)}`);

  check('network metadata is recognised', state.network === true);
  check('all independent tracks and points remain available',
    state.tracks === 24 && state.points === 2400 && state.waypoints === 300, JSON.stringify(state));
  check('network mode does not pretend the merged routes are one trip',
    state.duration === null && state.moving === null && state.source === 'network', JSON.stringify(state));
  check('network timestamps do not allocate point Date objects', state.pointTimes === 0, `${state.pointTimes}`);
  check('network track points do not retain unused elevation fields',
    state.pointElevations === 0, `${state.pointElevations}`);
  check('network mode hides global splits and the combined profile',
    state.splitHidden && state.profileHidden, JSON.stringify(state));
  check('network mode skips per-point and per-kilometre overlays',
    state.pinCount === 300 && state.distanceMarks === 0 && state.gapMarks === 0,
    JSON.stringify(state));
  check('network measurement index is absent until measuring starts', state.measureIndexed === false);
  check('network lines use canvas while waypoint markers are viewport sampled',
    state.canvases > 0 && state.markerNodes > 0 && state.markerNodes < state.waypoints,
    `${state.canvases}/${state.markerNodes}/${state.waypoints}`);
  check('network geometry keeps full source points out of Leaflet at overview',
    state.trackStats
      && state.trackStats.renderedLines <= state.trackStats.totalLines
      && state.trackStats.renderedPoints < state.trackStats.sourcePoints,
    JSON.stringify(state.trackStats));
  check('generated network opens within the browser budget',
    state.wallMs < 10000 && state.performance.firstPaintMs < 5000,
    JSON.stringify({ wallMs: state.wallMs, ...state.performance }));

  const detailedStats = await page.evaluate(async () => {
    const { gpx, map, trackStats } = window.trailViewer;
    const point = gpx.tracks[0].segments[0][0];
    map.setView([point.lat, point.lon], 18, { animate: false });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return trackStats();
  });
  check('high zoom culls routes outside the viewport and simplifies visible points',
    detailedStats.visibleLines < detailedStats.totalLines
      && detailedStats.renderedPoints < detailedStats.sourcePoints,
    JSON.stringify(detailedStats));
  const movingStats = await page.evaluate(async () => {
    const before = window.trailViewer.trackStats().renderCount;
    window.trailViewer.map.fire('move');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { before, after: window.trailViewer.trackStats().renderCount };
  });
  check('network routes are refreshed while the map is moving', movingStats.after > movingStats.before,
    JSON.stringify(movingStats));

  const zoomMs = await page.evaluate(async () => {
    const map = window.trailViewer.map;
    const zoom = map.getZoom();
    const started = performance.now();
    for (let index = 0; index < 8; index += 1) {
      map.setZoom(Math.max(2, Math.min(19, zoom + (index % 3) - 1)), { animate: false });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return performance.now() - started;
  });
  console.log(`generated-network.kml: eight zooms ${zoomMs.toFixed(1)} ms`);
  check('network zoom stays within the browser budget', zoomMs < 2000, `${zoomMs.toFixed(1)} ms`);
  await page.evaluate(() => window.trailViewer.measure.start());
  check('starting measurement creates the optional track index',
    await page.evaluate(() => window.trailViewer.measure.indexed()) === true);
  await page.evaluate(() => window.trailViewer.measure.stop());
  check('no page errors', pageErrors.length === 0, pageErrors.join('; '));
  check('no CSP violations', cspViolations.length === 0, cspViolations.join('; ').slice(0, 300));

  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  if (failures.length > 0) process.exit(1);
  console.log('\nnetwork checks OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
