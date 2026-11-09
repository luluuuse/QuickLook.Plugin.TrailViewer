// Test for the terrain basemap: the fourth layer switch loads CyclOSM -- the layer that carries contours,
// trails and spot heights -- keeps it out of the way of every other layer, and remembers the choice.
//
//   NODE_PATH=<folder containing playwright-core> node tests/terrain-test.cjs [screenshot.png]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
//
// The tiles themselves are stubbed here, so the suite runs offline. The live endpoint is a separate smoke test.
const fs = require('fs');
const path = require('path');
const {
  launchBrowser,
  waitForLayout,
  waitForTiles,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const fixture = 'waypoints-route.gpx';
const { check, failures, finish } = createChecker('terrain');
const artifacts = createArtifacts('terrain');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  // Pinned to en-US: the assertions read English labels, and the viewer follows the system language.
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await artifacts.start(page);
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
  await waitForTiles(page, 'cyclosm');

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
  await page.waitForFunction(() => ![...document.querySelectorAll('.leaflet-tile-pane img')]
    .some((node) => node.src.includes('cyclosm')));
  const leftover = await page.evaluate(
    () => [...document.querySelectorAll('.leaflet-tile-pane img')].filter((n) => n.src.includes('cyclosm')).length,
  );
  check('switching back leaves no terrain tile behind', leftover === 0, `${leftover} tiles`);

  await page.evaluate(() => window.gpxViewer.selectLayer('none'));
  await page.waitForFunction(() => document.body.classList.contains('no-map'));
  check('the grid still works alongside it', await page.evaluate(() => document.body.classList.contains('no-map')));

  // --- remembered across a reload -------------------------------------------------------------------
  await page.evaluate(() => window.gpxViewer.selectLayer('terrain'));
  await waitForTiles(page, 'cyclosm');
  await open();
  check('the choice survives a reload', await page.evaluate(() => window.gpxViewer.layer()) === 'terrain');

  // --- wording ---------------------------------------------------------------------------------------
  await page.locator('.lang-switch button').click();
  await waitForLayout(page);
  const zhLabels = await page.$$eval('.layer-switch button', (nodes) => nodes.map((n) => n.textContent));
  check('the buttons are translated', zhLabels.join('/') === '地图/地形/卫星/无底图', zhLabels.join('/'));
  const zhTitle = await page.getAttribute('.layer-switch button[data-layer="terrain"]', 'title');
  check('the tooltip names the provider in Chinese', /CyclOSM/.test(zhTitle) && /等高线/.test(zhTitle), zhTitle);

  await waitForTiles(page, 'cyclosm');
  await page.screenshot({ path: shot || path.join(root, 'terrain-layer.png') });

  check('no page errors', pageErrors.length === 0, pageErrors[0]);
  check('no CSP violations', cspViolations.length === 0, cspViolations[0]);

  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  process.exit(finish());
}

main().catch((e) => { console.error(e); process.exit(1); });
