// Browser test of the web viewer against the fixtures in tests/fixtures/ (values in expected.json).
//
//   NODE_PATH=<folder containing playwright-core> node tests/viewer-test.cjs [screenshot-dir]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
// Map mode needs internet access for the tiles; everything else runs offline.
const fs = require('fs');
const path = require('path');
const {
  launchBrowser,
  waitForTiles,
} = require('./support/browser.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const expected = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/expected.json'), 'utf8')).viewer;
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
const artifacts = createArtifacts('viewer');
function iso(value) {
  return value ? new Date(value).toISOString().replace('.000Z', 'Z') : null;
}

async function open(page, base, fixture) {
  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${encodeURIComponent(fixture)}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded') || document.body.classList.contains('failed'));
}

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  // Pinned to en-US: the assertions below read English labels, and the viewer follows the system language.
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  const page = await context.newPage();
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  if (shots) fs.mkdirSync(shots, { recursive: true });

  const failures = [];
  const check = (fixture, what, got, want, detail) => {
    if (got !== want) failures.push(`${fixture}: ${what} is ${got}, expected ${want}${detail ? ` (${detail})` : ''}`);
  };

  for (const [fixture, want] of Object.entries(expected)) {
    await open(page, base, fixture);

    if (want.error) {
      const shown = await page.evaluate(() => ({
        failed: document.body.classList.contains('failed'),
        text: document.getElementById('message').innerText,
      }));
      check(fixture, 'error page', shown.failed, true);
      console.log(`${fixture}: error page "${shown.text.replace(/\s+/g, ' ')}"`);
      if (shots) await page.screenshot({ path: path.join(shots, `${fixture}.error.png`) });
      continue;
    }

    const got = await page.evaluate(() => {
      const s = window.gpxViewer.summary;
      return {
        ...s,
        start: s.start && s.start.toISOString(),
        end: s.end && s.end.toISOString(),
        lines: document.querySelectorAll('path.gpx-track').length,
        dashed: document.querySelectorAll('path.gpx-route').length,
        pins: document.querySelectorAll('.gpx-pin').length,
        startMarkers: document.querySelectorAll('path.gpx-start').length,
        endMarkers: document.querySelectorAll('path.gpx-end').length,
        profile: !document.getElementById('profile').hidden,
        info: document.getElementById('info').innerText,
      };
    });
    for (const key of ['tracks', 'segments', 'routes', 'waypoints', 'areas', 'points', 'durationSeconds', 'elevation']) {
      check(fixture, key, got[key], want[key]);
    }
    check(fixture, 'start', iso(got.start), want.start);
    check(fixture, 'end', iso(got.end), want.end);
    if (Math.abs(got.distanceMeters - want.distanceMeters) > 0.5) {
      failures.push(`${fixture}: distance ${got.distanceMeters.toFixed(1)} m, expected ${want.distanceMeters} m`);
    }
    check(fixture, 'track lines', got.lines, want.segments);
    check(fixture, 'dashed routes', got.dashed, want.routes);
    check(fixture, 'waypoint pins', got.pins, want.waypoints);
    check(fixture, 'start markers', got.startMarkers, want.tracks);
    check(fixture, 'end markers', got.endMarkers, want.tracks);
    check(fixture, 'elevation profile', got.profile, want.elevation);
    if (want.segments > 0 && !got.info.includes('Distance')) failures.push(`${fixture}: info box has no distance`);

    const span = got.start ? `${iso(got.start)} – ${iso(got.end)} (${got.durationSeconds} s)` : 'no timestamps';
    console.log(`${fixture}: ${got.tracks} tracks, ${got.segments} segments, ${got.routes} routes, `
      + `${got.waypoints} waypoints, ${got.points} points, ${(got.distanceMeters / 1000).toFixed(3)} km, ${span}`);

    if (shots) {
      for (const layer of ['map', 'none']) {
        await page.evaluate((key) => window.gpxViewer.selectLayer(key), layer);
        await page.waitForLoadState('networkidle');
        if (layer === 'map') await waitForTiles(page);
        else await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile-pane img').length === 0);
        const tiles = await page.evaluate(() => document.querySelectorAll('img.leaflet-tile-loaded').length);
        if (layer === 'map' && tiles === 0) failures.push(`${fixture}: no map tiles loaded`);
        if (layer === 'none' && tiles !== 0) failures.push(`${fixture}: ${tiles} map tiles in "No map" mode`);
        await page.screenshot({ path: path.join(shots, `${fixture}.${layer}.png`) });
      }
    }
  }

  // Long recordings (1 Hz for hours) must load well within the plugin's 20 s timeout. Generated on the fly.
  for (const n of [15000, 30000]) {
    let body = '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>';
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      const t = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
      body += `<trkpt lat="${(46.5 + 0.05 * Math.sin(a)).toFixed(6)}" lon="${(8 + 0.07 * Math.cos(a)).toFixed(6)}">`
        + `<ele>${(1000 + 200 * Math.sin(3 * a)).toFixed(1)}</ele><time>${t}</time></trkpt>`;
    }
    body += '</trkseg></trk></gpx>';
    await page.route((url) => url.pathname.endsWith(`/generated-${n}.gpx`), (route) => route.fulfill({ body, contentType: 'application/gpx+xml' }));
    const started = Date.now();
    await open(page, base, `generated-${n}.gpx`);
    const seconds = (Date.now() - started) / 1000;
    const points = await page.evaluate(() => window.gpxViewer?.summary.points);
    const curveVertices = await page.evaluate(() => {
      const d = document.querySelector('#profile .line')?.getAttribute('d') || '';
      return (d.match(/[ML]/g) || []).length;
    });
    console.log(`generated-${n}.gpx: ${points} points loaded in ${seconds.toFixed(1)} s`);
    check(`generated-${n}.gpx`, 'points', points, n);
    if (n === 30000) check('generated-30000.gpx', 'profile path is pixel bounded', curveVertices <= 1202,
      true, `${curveVertices} vertices`);
    if (seconds > 10) failures.push(`generated-${n}.gpx: took ${seconds.toFixed(1)} s (limit 10 s)`);
  }

  // The chosen layer is remembered for the next preview.
  await open(page, base, 'track-time-ele.gpx');
  await page.evaluate(() => window.gpxViewer.selectLayer('none'));
  await open(page, base, 'track-time-ele.gpx');
  check('layer choice', 'after reload', await page.evaluate(() => window.gpxViewer.layer()), 'none');
  await page.evaluate(() => window.gpxViewer.selectLayer('map'));

  // The viewer origin changes with each plugin release, so the host passes durable preferences in the URL.
  // Query values must win over whatever localStorage the current test origin contains.
  const preferencePage = await context.newPage();
  await preferencePage.goto(`${base}/viewer/index.html?src=../tests/fixtures/track-time-ele.gpx`
    + '&lang=zh&layer=none&pins=0&exportSize=1:1&exportInk=white&exportScrim=soft');
  await preferencePage.waitForFunction(() => document.body.classList.contains('loaded'));
  const preferences = await preferencePage.evaluate(() => ({
    lang: document.documentElement.lang,
    layer: window.gpxViewer.layer(),
    pins: window.gpxViewer.pins.visible(),
    settings: window.gpxViewer.exportSettings(),
    tiles: document.querySelectorAll('.leaflet-tile-pane img').length,
  }));
  check('host preferences', 'language', preferences.lang, 'zh-CN');
  check('host preferences', 'layer', preferences.layer, 'none');
  check('host preferences', 'pins', preferences.pins, false);
  check('host preferences', 'no-map downloads no tiles', preferences.tiles, 0);
  check('host preferences', 'export',
    JSON.stringify(preferences.settings), '{"size":"1:1","ink":"white","scrim":"soft"}');
  await preferencePage.close();

  // Parse-only regressions that do not need another fixture on disk.
  const parserChecks = await page.evaluate(async () => {
    const gpx = await import('./gpx.js');
    const kml = await import('./kml.js');
    const summary = gpx.summarize(gpx.parseGpx(
      '<?xml version="1.0"?><gpx><trk><trkseg>'
      + '<trkpt lat="46" lon="8"><time>2026-01-01T09:00:00Z</time></trkpt>'
      + '<trkpt lat="46.01" lon="8.01"><time>2026-01-01T10:00:00Z</time></trkpt>'
      + '</trkseg></trk><wpt lat="46" lon="8"><time>2027-01-01T00:00:00Z</time></wpt></gpx>'));
    const track = kml.parseKml(
      '<kml xmlns="http://www.opengis.net/kml/2.2">'
      + '<Placemark><gx:Track xmlns:gx="http://www.google.com/kml/ext/2.2">'
      + '<when>2026-01-01T09:00:00Z</when><when>2026-01-01T09:01:00Z</when>'
      + '<gx:coord>not-a-point</gx:coord><gx:coord>8 46 10</gx:coord>'
      + '</gx:Track></Placemark></kml>');
    return {
      duration: summary.durationSeconds,
      trackTime: track.tracks[0].segments[0][0].time.toISOString(),
    };
  });
  check('parser regression', 'waypoint times do not extend a recorded trip', parserChecks.duration, 3600);
  check('parser regression', 'an invalid gx:Track point does not shift the next time',
    parserChecks.trackTime, '2026-01-01T09:01:00.000Z');

  // The k-d tree must be an optimisation only: every nearest sample has to match the old linear scan,
  // including duplicate points and equal-distance ties.
  const indexCheck = await page.evaluate(async () => {
    const m = await import('./spatial.js');
    let seed = 123456789;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const points = Array.from({ length: 2000 }, (_, i) => ({
      lat: 46 + random() * 0.2,
      lon: 8 + random() * 0.2,
      i,
    }));
    points.push({ ...points[0] });
    const index = m.createPointIndex(points);
    let mismatch = -1;
    for (let q = 0; q < 100 && mismatch < 0; q += 1) {
      const target = { lat: 46 + random() * 0.2, lon: 8 + random() * 0.2 };
      let best = 0;
      let distance = Infinity;
      for (let i = 0; i < points.length; i += 1) {
        const d = (points[i].lat - target.lat) ** 2 + (points[i].lon - target.lon) ** 2;
        if (d < distance) { best = i; distance = d; }
      }
      if (index.nearest(target) !== points[best]) mismatch = q;
    }
    return mismatch;
  });
  check('spatial index', 'matches the linear nearest-point result', indexCheck, -1);

  for (const e of pageErrors) failures.push(`page error: ${e}`);
  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();

  if (failures.length > 0) {
    console.log(`\n${failures.length} failure(s):\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`\nAll ${Object.keys(expected).length} fixtures OK`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
