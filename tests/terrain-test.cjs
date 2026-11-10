// Layer-source tests: the former Map category now lives under Road, while Terrain groups CyclOSM,
// OpenHikingMap and OpenTopoMap behind one compact source menu. Requests are stubbed so the suite stays offline.
//
//   NODE_PATH=<folder containing playwright-core> node tests/terrain-test.cjs [screenshot.png]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
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
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const cspViolations = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
  });

  const tileRequests = [];
  const tile = fs.readFileSync(path.join(root, 'tests/fixtures/photo.png'));
  const tilePattern = /tile\.openstreetmap\.fr\/hot|tile-cyclosm\.openstreetmap\.fr\/cyclosm|tile\.openmaps\.fr\/openhikingmap|tile\.opentopomap\.org|t\d\.tianditu\.gov\.cn/;
  await page.route(tilePattern, (route) => {
    tileRequests.push({ url: route.request().url(), headers: route.request().headers() });
    route.fulfill({ body: tile, contentType: 'image/png' });
  });

  const open = async () => {
    await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
    await page.waitForFunction(() => document.body.classList.contains('loaded'));
    await waitForLayout(page);
  };
  const requestsFor = (fragment) => tileRequests.filter((request) => request.url.includes(fragment));
  const openLayers = async () => {
    if (await page.locator('.layer-source-menu').evaluate((node) => node.hidden)) {
      await page.locator('.layer-menu-toggle').click();
      await waitForLayout(page);
    }
  };
  const chooseCategory = async (category) => {
    await openLayers();
    await page.locator(`.layer-category-button[data-layer="${category}"]`).click();
    await waitForLayout(page);
  };
  const chooseSource = async (category, provider) => {
    await chooseCategory(category);
    await page.locator(`.layer-provider-option[data-provider="${provider}"]`).click();
    await waitForLayout(page);
  };

  await page.goto(`${base}/viewer/index.html`);
  await page.evaluate(() => localStorage.removeItem('trailviewer.layer'));
  await open();

  const layerEntry = await page.locator('.layer-menu-toggle').evaluate((node) => ({
    label: node.querySelector('.layer-menu-label').textContent,
    expanded: node.getAttribute('aria-expanded'),
  }));
  check('the four map types share one visible layer entry',
    layerEntry.label === 'Road' && layerEntry.expanded === 'false', JSON.stringify(layerEntry));
  check('the road source is the default',
    await page.evaluate(() => window.trailViewer.layer()) === 'road.osm');
  check('the source menu starts closed',
    await page.locator('.layer-source-menu').evaluate((node) => node.hidden));
  check('no terrain tile before it is asked for', requestsFor('/cyclosm/').length === 0);

  await openLayers();
  const categoryLabels = await page.$$eval('.layer-category-button', (nodes) => nodes.map((node) => node.textContent));
  check('the layer panel exposes four map types', categoryLabels.length === 4, categoryLabels.join('/'));
  check('the former Map category is now Road',
    categoryLabels.join('/') === 'Road/Terrain/Satellite/No map', categoryLabels.join('/'));
  check('the layer entry exposes its expanded state',
    await page.getAttribute('.layer-menu-toggle', 'aria-expanded') === 'true');
  check('the active map type is checked in the layer panel',
    await page.getAttribute('.layer-category-button[data-layer="road"]', 'aria-checked') === 'true');
  await waitForLayout(page);
  check('the road menu offers OSM and Tianditu',
    (await page.$$eval('.layer-source-menu button[data-provider]:not([hidden])',
      (nodes) => nodes.map((node) => node.textContent))).join('/') === 'OpenStreetMap HOT/Tianditu road');
  check('Tianditu is marked as requiring a key before setup',
    await page.locator('.layer-source-menu button[data-provider="road.tianditu"]')
      .evaluate((node) => node.classList.contains('locked') && node.dataset.locked === 'true'));
  check('the layer list leaves key management to map settings',
    await page.locator('.layer-main-view .layer-key-action').count() === 0);
  await page.locator('.layer-settings-button').click();
  await waitForLayout(page);
  check('map settings still hides key removal before setup',
    await page.locator('.layer-settings-view:not([hidden]) .layer-key-action:not([hidden])')
      .evaluateAll((nodes) => nodes.length === 1
        && nodes[0].textContent === 'Configure Tianditu key…'));
  check('map settings reports the key as missing',
    await page.locator('.layer-setting-status').getAttribute('data-configured') === 'false');
  await page.keyboard.press('Escape');
  check('Escape returns from settings to the layer list',
    await page.locator('.layer-settings-view').evaluate((node) => node.hidden)
      && await page.locator('.layer-settings-button').evaluate((node) => document.activeElement === node));
  await page.keyboard.press('Escape');
  check('Escape returns focus to the layer entry',
    await page.locator('.layer-menu-toggle').evaluate((node) => document.activeElement === node));

  await chooseCategory('terrain');
  await waitForTiles(page, 'cyclosm');
  check('opening Terrain selects the remembered CyclOSM default',
    await page.evaluate(() => window.trailViewer.layer()) === 'terrain.cyclosm');
  check('the Terrain category is active',
    await page.locator('.layer-category-button[data-layer="terrain"]').evaluate((node) => node.classList.contains('active')));
  check('the layer panel is labelled',
    await page.locator('.layer-source-menu').evaluate((node) => !node.hidden
      && node.querySelector('.layer-source-heading').textContent === 'Map layers'));
  check('the menu exposes all three terrain sources',
    (await page.$$eval('.layer-provider-option:not([hidden])', (nodes) => nodes.map((node) => node.textContent)))
      .join('/') === 'CyclOSM/OpenHikingMap/OpenTopoMap');
  check('the current provider is checked',
    await page.locator('.layer-source-menu button[data-provider="terrain.cyclosm"]')
      .getAttribute('aria-checked') === 'true');
  await page.evaluate(() => {
    window.__terrainTile = [...document.querySelectorAll('.leaflet-tile-pane img')]
      .find((image) => image.src.includes('/cyclosm/'));
  });
  await page.locator('.layer-menu-toggle').click();
  await waitForLayout(page);
  check('closing the menu does not rebuild the active tiles',
    await page.evaluate(() => window.__terrainTile
      && [...document.querySelectorAll('.leaflet-tile-pane img')].includes(window.__terrainTile)));
  await page.locator('.layer-menu-toggle').click();
  await waitForLayout(page);
  check('reopening the menu does not rebuild the active tiles',
    await page.evaluate(() => window.__terrainTile
      && [...document.querySelectorAll('.leaflet-tile-pane img')].includes(window.__terrainTile)));
  await page.keyboard.press('Escape');
  check('Escape closes the source menu',
    await page.locator('.layer-source-menu').evaluate((node) => node.hidden));
  await openLayers();
  await waitForLayout(page);

  await chooseSource('terrain', 'terrain.openHiking');
  await waitForTiles(page, 'openhikingmap');
  const hiking = requestsFor('/openhikingmap/');
  check('OpenHikingMap is selected', await page.evaluate(() => window.trailViewer.layer()) === 'terrain.openHiking');
  check('OpenHikingMap uses the documented no-query URL',
    hiking.length > 0 && hiking.every((request) => new URL(request.url).pathname.match(/^\/openhikingmap\/\d+\/\d+\/\d+\.png$/))
      && hiking.every((request) => new URL(request.url).search === ''));
  check('the CyclOSM tiles are removed',
    await page.evaluate(() => ![...document.querySelectorAll('.leaflet-tile-pane img')]
      .some((image) => image.src.includes('/cyclosm/'))));

  await chooseSource('terrain', 'terrain.openTopo');
  await waitForTiles(page, 'opentopomap');
  const topo = requestsFor('tile.opentopomap.org');
  check('OpenTopoMap is selected', await page.evaluate(() => window.trailViewer.layer()) === 'terrain.openTopo');
  check('OpenTopoMap requests its standard tile path',
    topo.length > 0 && topo.every((request) => new URL(request.url).pathname.match(/^\/\d+\/\d+\/\d+\.png$/)));

  await page.evaluate(() => window.trailViewer.selectLayer('road'));
  await page.waitForFunction(() => ![...document.querySelectorAll('.leaflet-tile-pane img')]
    .some((image) => image.src.includes('opentopomap')));
  check('selecting a category returns to its default provider',
    await page.evaluate(() => window.trailViewer.layer()) === 'road.osm');
  check('switching category closes the source menu',
    await page.locator('.layer-source-menu').evaluate((node) => node.hidden));
  check('the road category is active',
    await page.locator('.layer-category-button[data-layer="road"]').evaluate((node) => node.classList.contains('active')));

  await page.keyboard.press('e');
  await waitForLayout(page);
  check('Q / E returns to the last terrain provider',
    await page.evaluate(() => window.trailViewer.layer()) === 'terrain.openTopo');
  await open();
  check('the chosen terrain provider survives a reload',
    await page.evaluate(() => window.trailViewer.layer()) === 'terrain.openTopo');

  await page.evaluate(() => window.trailViewer.selectLayer('none'));
  await page.waitForFunction(() => document.body.classList.contains('no-map'));
  check('No map remains available through the category API',
    await page.evaluate(() => window.trailViewer.layer()) === 'none');

  await page.locator('.lang-switch button').click();
  await waitForLayout(page);
  await openLayers();
  const zhLabels = await page.$$eval('.layer-category-button', (nodes) => nodes.map((node) => node.textContent));
  check('the categories are translated', zhLabels.join('/') === '路网/地形/卫星/无底图', zhLabels.join('/'));
  await page.locator('.layer-category-button[data-layer="terrain"]').click();
  await waitForLayout(page);
  check('the Chinese source menu is translated',
    await page.locator('.layer-source-heading').textContent() === '地图图层');
  check('the Chinese OSM source omits the humanitarian-style suffix',
    await page.locator('.layer-source-menu button[data-provider="road.osm"]').textContent() === 'OpenStreetMap');
  const zhTitle = await page.getAttribute('.layer-menu-toggle', 'title');
  check('the layer entry names the current type and source', /地形/.test(zhTitle)
    && /CyclOSM/.test(zhTitle), zhTitle);

  await chooseSource('terrain', 'terrain.cyclosm');
  await waitForTiles(page, 'cyclosm');
  await page.setViewportSize({ width: 360, height: 740 });
  await openLayers();
  await waitForLayout(page);
  const narrowMenu = await page.locator('.layer-source-menu').boundingBox();
  check('the source menu stays inside a narrow window',
    narrowMenu && narrowMenu.x >= 0 && narrowMenu.x + narrowMenu.width <= 360
      && narrowMenu.y >= 0 && narrowMenu.y + narrowMenu.height <= 740,
    JSON.stringify(narrowMenu));
  await page.screenshot({ path: shot || path.join(root, 'terrain-layer.png') });

  const tiandituBefore = requestsFor('tianditu.gov.cn').length;
  await page.evaluate(() => window.trailViewer.selectLayer('road.tianditu'));
  await waitForLayout(page);
  check('Tianditu does not switch layers without a configured key',
    await page.evaluate(() => window.trailViewer.layer()) === 'terrain.cyclosm'
      && requestsFor('tianditu.gov.cn').length === tiandituBefore);

  await page.evaluate(() => window.trailViewer.setTiandituKey('0123456789abcdef0123456789abcdef'));
  await waitForTiles(page, 'vec_w/wmts');
  check('configuring the key completes the pending Tianditu selection',
    await page.evaluate(() => window.trailViewer.layer()) === 'road.tianditu');
  const roadDirect = requestsFor('tianditu.gov.cn').filter((request) => {
    const url = new URL(request.url);
    return url.pathname.includes('_w/wmts')
      && url.searchParams.get('tk') === '0123456789abcdef0123456789abcdef';
  });
  check('Tianditu road requests its official base and label layers',
    roadDirect.some((request) => request.url.includes('/vec_w/wmts'))
      && roadDirect.some((request) => request.url.includes('/cva_w/wmts')));
  await openLayers();
  await waitForLayout(page);
  await page.locator('.layer-settings-button').click();
  await waitForLayout(page);
  check('a configured key exposes change and remove actions',
    await page.locator('.layer-settings-view:not([hidden]) .layer-key-action:not([hidden])')
      .evaluateAll((nodes) => nodes.length === 2
        && /更换/.test(nodes[0].textContent) && /移除/.test(nodes[1].textContent)));
  check('map settings reports the key as configured',
    await page.locator('.layer-setting-status').getAttribute('data-configured') === 'true');
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.trailViewer.selectLayer('satellite.tianditu'));
  await waitForTiles(page, 'img_w/wmts');
  check('Tianditu satellite requests its official imagery and label layers',
    await page.evaluate(() => window.trailViewer.layer()) === 'satellite.tianditu'
      && requestsFor('img_w/wmts').length > 0
      && requestsFor('cia_w/wmts').length > 0);
  await page.evaluate(() => window.trailViewer.tiandituKeyRejected());
  await waitForLayout(page);
  check('a rejected Tianditu key falls back to the default satellite source',
    await page.evaluate(() => window.trailViewer.layer()) === 'satellite.esri');
  check('the rejected key warning is visible',
    await page.locator('#toast').evaluate((node) => !node.hidden && node.textContent.includes('天地图')));

  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}&layer=road.tianditu`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  check('a standalone browser falls back from Tianditu to the road source',
    await page.evaluate(() => window.trailViewer.layer()) === 'road.osm');
  await openLayers();
  await page.locator('.layer-source-menu button[data-provider="road.tianditu"]').click();
  await waitForLayout(page);
  check('selecting an unconfigured Tianditu source opens map settings',
    await page.locator('.layer-settings-view').evaluate((node) => !node.hidden));
  await page.locator('.layer-settings-view .layer-key-action:not([hidden])').click();
  await waitForLayout(page);
  check('a standalone browser explains that Tianditu needs the QuickLook host',
    await page.locator('#toast').evaluate((node) => !node.hidden
      && node.textContent.includes('QuickLook') && node.textContent.includes('宿主')));

  const runtimePage = await browser.newPage({ viewport: { width: 1000, height: 720 }, locale: 'zh-CN' });
  const runtimeRequests = [];
  await runtimePage.route(/t\d\.tianditu\.gov\.cn/, (route) => {
    runtimeRequests.push(route.request().url());
    route.fulfill({ body: tile, contentType: 'image/png' });
  });
  await runtimePage.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
  await runtimePage.waitForFunction(() => document.body.classList.contains('loaded'));
  await runtimePage.evaluate(() => window.trailViewer.setTiandituKey('0123456789abcdef0123456789abcdef'));
  check('runtime key injection switches Tianditu to direct transport',
    await runtimePage.evaluate(() => window.trailViewer.tiandituTransport()) === 'direct');
  await runtimePage.evaluate(() => window.trailViewer.selectLayer('road.tianditu'));
  await waitForTiles(runtimePage, 'vec_w/wmts');
  check('runtime direct mode requests official Tianditu road layers',
    await runtimePage.evaluate(() => window.trailViewer.layer()) === 'road.tianditu'
      && runtimeRequests.some((url) => url.includes('/vec_w/wmts'))
      && runtimeRequests.some((url) => url.includes('/cva_w/wmts')));
  await runtimePage.locator('.layer-menu-toggle').click();
  await waitForLayout(runtimePage);
  await runtimePage.locator('.layer-settings-button').click();
  await waitForLayout(runtimePage);
  check('runtime direct mode keeps Tianditu key management available',
    await runtimePage.locator('.layer-settings-view:not([hidden]) .layer-key-action:not([hidden])')
      .evaluateAll((nodes) => nodes.length === 2
        && /更换/.test(nodes[0].textContent) && /移除/.test(nodes[1].textContent)));
  await runtimePage.evaluate(() => window.trailViewer.tiandituResponse(503));
  check('a temporary Tianditu response keeps the key and layer',
    await runtimePage.evaluate(() => window.trailViewer.tiandituTransport()) === 'direct'
      && await runtimePage.evaluate(() => window.trailViewer.layer()) === 'road.tianditu');
  check('the temporary failure warning does not ask for a new key',
    await runtimePage.locator('#toast').evaluate((node) => !node.hidden
      && node.textContent.includes('暂时无法加载') && !node.textContent.includes('输入')));
  await runtimePage.close();

  const directErrorPage = await browser.newPage({ viewport: { width: 1000, height: 720 }, locale: 'zh-CN' });
  await directErrorPage.addInitScript(() => {
    window.__TRAILVIEWER_RUNTIME_CONFIG__ = Object.freeze({
      tiandituKey: '0123456789abcdef0123456789abcdef',
      direct: true,
    });
  });
  await directErrorPage.route(/t\d\.tianditu\.gov\.cn/, (route) => route.fulfill({ status: 403, body: '' }));
  await directErrorPage.route(/tile\.openstreetmap\.fr\/hot/, (route) => route.fulfill({ body: tile, contentType: 'image/png' }));
  await directErrorPage.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}&layer=road.tianditu`);
  await directErrorPage.waitForFunction(() => document.body.classList.contains('loaded'));
  await directErrorPage.waitForFunction(() => {
    const toast = document.querySelector('#toast');
    return toast && !toast.hidden && toast.textContent.includes('暂时无法加载');
  });
  check('a tile error alone does not clear the direct key',
    await directErrorPage.evaluate(() => window.trailViewer.tiandituTransport()) === 'direct'
      && await directErrorPage.evaluate(() => window.trailViewer.layer()) === 'road.tianditu');
  await directErrorPage.evaluate(() => window.trailViewer.tiandituResponse(403));
  await directErrorPage.waitForFunction(() => window.trailViewer.layer() === 'road.osm');
  check('a confirmed 403 rejects the direct key and falls back to OSM',
    await directErrorPage.evaluate(() => window.trailViewer.layer()) === 'road.osm');
  await directErrorPage.close();

  check('no page errors', pageErrors.length === 0, pageErrors[0]);
  check('no CSP violations', cspViolations.length === 0, cspViolations[0]);

  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  process.exit(finish());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
