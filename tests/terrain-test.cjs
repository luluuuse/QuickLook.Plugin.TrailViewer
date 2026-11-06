// Test for the terrain basemap: the fourth layer switch loads CyclOSM -- the layer that carries contours,
// trails and spot heights -- keeps it out of the way of every other layer, and remembers the choice.
//
//   NODE_PATH=<folder containing playwright-core> node tests/terrain-test.cjs [screenshot.png]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
//
// The tiles themselves are stubbed here, so the suite runs offline. What is asserted is the request that
// leaves the page -- its path and the absent query string -- plus one live probe at the end, because a
// basemap that answers only from a cache is worth knowing about before it ships.
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const fixture = 'waypoints-route.gpx';
const tileHost = 'a.tile-cyclosm.openstreetmap.fr';
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.gpx': 'application/gpx+xml',
};

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const failures = [];
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(what);
}

/**
 * One real request against the live endpoint. The suite stays green without a network -- this only proves
 * that the URL in the source is still accepted, and says so loudly when it is not. Worth keeping: the
 * version of this layer that used a cached-only CDN passed every offline check and was useless in practice.
 */
function probeLive() {
  return new Promise((resolve) => {
    const req = https.get({
      host: tileHost,
      path: '/cyclosm/13/6784/3376.png',
      // OSM France closes the connection (444) for a request with no User-Agent, which Node sends by default.
      headers: { 'User-Agent': 'QuickLook.GpxViewer terrain-test' },
      timeout: 20000,
    }, (res) => {
      let bytes = 0;
      res.on('data', (chunk) => { bytes += chunk.length; });
      res.on('end', () => resolve({ status: res.statusCode, bytes }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'timeout', bytes: 0 }); });
    req.on('error', (e) => resolve({ status: e.code || 'error', bytes: 0 }));
  });
}

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  // Pinned to en-US: the assertions read English labels, and the viewer follows the system language.
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const cspViolations = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text());
  });

  // Every tile request is recorded and answered with a local image, so the run needs no network.
  const tileRequests = [];
  const tile = fs.readFileSync(path.join(root, 'tests/fixtures/photo.png'));
  await page.route(/tile-cyclosm\.openstreetmap\.fr/, (route) => {
    tileRequests.push({ url: route.request().url(), headers: route.request().headers() });
    route.fulfill({ body: tile, contentType: 'image/png' });
  });

  const open = async () => {
    await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
    await page.waitForFunction(() => document.body.classList.contains('loaded'));
  };

  await page.goto(`${base}/viewer/index.html`);
  await page.evaluate(() => localStorage.removeItem('gpxviewer.layer'));

  // --- the switch itself -------------------------------------------------------------------------
  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));

  const labels = await page.$$eval('.layer-switch button', (nodes) => nodes.map((n) => n.textContent));
  check('four layer buttons', labels.length === 4, labels.join('/'));
  check('terrain sits second, before the satellite', labels.join('/') === 'Map/Terrain/Satellite/No map', labels.join('/'));

  check('the map is still the default', await page.evaluate(() => window.gpxViewer.layer()) === 'map');
  check('no terrain tile before it is asked for', tileRequests.length === 0, `${tileRequests.length} requests`);

  // --- switching to the terrain ------------------------------------------------------------------
  await page.locator('.layer-switch button[data-layer="terrain"]').click();
  await page.waitForTimeout(2500);

  check('the chosen layer is remembered', await page.evaluate(() => window.gpxViewer.layer()) === 'terrain');
  check('the button carries the active state', await page.evaluate(
    () => document.querySelector('.layer-switch button[data-layer="terrain"]').classList.contains('active'),
  ));

  check('tiles were requested', tileRequests.length > 0, `${tileRequests.length} requests`);

  const bad = tileRequests.filter((r) => !/^\/cyclosm\/\d+\/\d+\/\d+\.png$/.test(new URL(r.url).pathname));
  check('every request uses the cyclosm path', bad.length === 0,
    bad[0] ? new URL(bad[0].url).pathname : '');

  const withQuery = tileRequests.filter((r) => new URL(r.url).search !== '');
  check('no query string is sent', withQuery.length === 0, withQuery[0] ? withQuery[0].url : '');

  const zoomLevels = new Set(tileRequests.map((r) => new URL(r.url).pathname.split('/')[2]));
  check('tiles are asked for at a sane zoom', [...zoomLevels].every((z) => Number(z) >= 10 && Number(z) <= 19),
    [...zoomLevels].join(','));

  const painted = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.leaflet-tile-pane img')];
    return imgs.filter((n) => n.src.includes('cyclosm')).length;
  });
  check('terrain tiles are in the DOM', painted > 0, `${painted} tiles`);

  // --- it must not disturb the other layers --------------------------------------------------------
  check('the grid mode is off', await page.evaluate(() => !document.body.classList.contains('no-map')));

  await page.evaluate(() => window.gpxViewer.selectLayer('map'));
  await page.waitForTimeout(500);
  const leftover = await page.evaluate(
    () => [...document.querySelectorAll('.leaflet-tile-pane img')].filter((n) => n.src.includes('cyclosm')).length,
  );
  check('switching back leaves no terrain tile behind', leftover === 0, `${leftover} tiles`);

  await page.evaluate(() => window.gpxViewer.selectLayer('none'));
  await page.waitForTimeout(300);
  check('the grid still works alongside it', await page.evaluate(() => document.body.classList.contains('no-map')));

  // --- remembered across a reload -------------------------------------------------------------------
  await page.evaluate(() => window.gpxViewer.selectLayer('terrain'));
  await page.waitForTimeout(300);
  await open();
  check('the choice survives a reload', await page.evaluate(() => window.gpxViewer.layer()) === 'terrain');

  // --- wording ---------------------------------------------------------------------------------------
  await page.locator('.lang-switch button').click();
  await page.waitForTimeout(300);
  const zhLabels = await page.$$eval('.layer-switch button', (nodes) => nodes.map((n) => n.textContent));
  check('the buttons are translated', zhLabels.join('/') === '地图/地形/卫星/无底图', zhLabels.join('/'));
  const zhTitle = await page.getAttribute('.layer-switch button[data-layer="terrain"]', 'title');
  check('the tooltip names the provider in Chinese', /CyclOSM/.test(zhTitle) && /等高线/.test(zhTitle), zhTitle);

  await page.screenshot({ path: shot || path.join(root, 'terrain-layer.png') });

  // --- the live endpoint, when there is a network ----------------------------------------------------
  const live = await probeLive();
  const liveOk = live.status === 200 && live.bytes > 5000;
  console.log(`${liveOk ? 'PASS' : 'SKIP'}  the live endpoint still answers  ${live.status} / ${live.bytes} bytes`);
  if (live.status !== 200 && live.status !== 'timeout' && !String(live.status).startsWith('E')) {
    // A 403 or a 400 is a policy change, not a flaky connection: that one has to fail the run.
    check('the endpoint did not start refusing requests', false, String(live.status));
  }

  check('no page errors', pageErrors.length === 0, pageErrors[0]);
  check('no CSP violations', cspViolations.length === 0, cspViolations[0]);

  await browser.close();
  server.close();
  console.log(`\n${failures.length === 0 ? 'all checks passed' : `${failures.length} failed`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
