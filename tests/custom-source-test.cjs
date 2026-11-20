// Custom-source flow: add the Windy 512 px outdoor template, select it, edit the active entry, reload it and
// remove it. Network requests are stubbed so this stays deterministic and offline.
const fs = require('fs');
const path = require('path');
const {
  launchBrowser,
  waitForLayout,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const fixture = 'waypoints-route.gpx';
const windyTemplate = 'https://tiles.windy.com/v1/maptiles/outdoor/256%402x/{z}/{x}/{y}/?lang=en';
const { check, failures, finish } = createChecker('custom-source');
const artifacts = createArtifacts('custom-source');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' });
  await artifacts.start(page);
  const pageErrors = [];
  const cspViolations = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.message}\n${error.stack || ''}`));
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
  });

  const tile = fs.readFileSync(path.join(root, 'tests/fixtures/photo.png'));
  const windyRequests = [];
  await page.route(/tiles\.windy\.com\/v1\/maptiles\/outdoor\/256(?:%40|@)2x\//, (route) => {
    windyRequests.push(route.request().url());
    route.fulfill({ body: tile, contentType: 'image/png' });
  });

  await page.goto(`${base}/viewer/index.html`);
  await page.evaluate(() => localStorage.removeItem('trailviewer.customLayers'));
  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await waitForLayout(page);

  await page.locator('.layer-menu-toggle').click();
  await waitForLayout(page);
  const wideMenu = await page.locator('#layer-source-menu').boundingBox();
  check('the layer panel is 320 px wide and aligned to the right edge',
    Math.abs(wideMenu.width - 320) < 1 && Math.abs(wideMenu.x + wideMenu.width - 1190) < 1,
    JSON.stringify(wideMenu));
  check('map categories no longer include the low-frequency no-map mode',
    (await page.$$eval('.layer-category-button', (nodes) => nodes.map((node) => node.textContent)))
      .join('/') === '路网/地形/卫星/定制');
  check('the four map categories share one row',
    new Set(await page.$$eval('.layer-category-button',
      (nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)))).size === 1);

  await page.locator('.layer-category-button[data-layer="custom"]').click();
  await waitForLayout(page);
  check('an empty custom category opens its management page',
    await page.locator('.layer-custom-view').evaluate((node) => !node.hidden));
  check('the empty custom page offers an add action',
    await page.locator('[data-custom-add]').evaluate((node) => !node.hidden));

  await page.locator('[data-custom-add]').click();
  await waitForLayout(page);
  const formActions = await page.evaluate(() => {
    const read = (selector) => {
      const node = document.querySelector(selector);
      const style = getComputedStyle(node);
      return {
        width: node.getBoundingClientRect().width,
        background: style.backgroundColor,
        color: style.color,
        border: style.borderColor,
        weight: style.fontWeight,
      };
    };
    return {
      cancel: read('.layer-custom-cancel'),
      save: read('.layer-custom-save'),
    };
  });
  check('cancel and save use clearly different primary/secondary styles',
    formActions.cancel.background !== formActions.save.background
      && formActions.save.background === 'rgb(35, 79, 121)'
      && formActions.save.border === 'rgb(47, 155, 255)'
      && formActions.save.weight === '600'
      && formActions.save.width > formActions.cancel.width,
    JSON.stringify(formActions));
  await page.locator('[name="url"]').fill(windyTemplate);
  const urlBox = await page.locator('[name="url"]').boundingBox();
  await page.mouse.move(urlBox.x + 12, urlBox.y + urlBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(80, 400, { steps: 8 });
  await page.mouse.up();
  await waitForLayout(page);
  check('dragging a text selection outside the editor does not close it',
    await page.locator('.layer-custom-view').evaluate((node) => !node.hidden)
      && await page.locator('.layer-custom-form').evaluate((node) => !node.hidden));
  await page.locator('[name="name"]').fill('Windy');
  await page.locator('[name="url"]').fill('http://tiles.windy.com/{z}/{x}/{y}.png');
  check('HTTP sources are rejected before saving',
    await page.locator('[data-custom-url-status]').evaluate((node) => !node.hidden
      && /HTTPS/.test(node.textContent)));

  await page.locator('[name="url"]').fill(
    'https://mts1.google.com/vt/lyrs=y&hl=zh-CN&gl=cn&scale=2&x={$x}&y={$y}&z={$z}',
  );
  check('two-step {$x}/{$y}/{$z} placeholders are converted to Leaflet tokens',
    await page.locator('[name="url"]').inputValue()
      === 'https://mts1.google.com/vt/lyrs=y&hl=zh-CN&gl=cn&scale=2&x={x}&y={y}&z={z}');

  await page.locator('[name="url"]').fill(windyTemplate);
  await page.locator('[name="minZoom"]').fill('1');
  await page.locator('[name="maxZoom"]').fill('20');
  await page.locator('[data-custom-save]').click();
  await page.waitForFunction(() => window.trailViewer.layer().startsWith('custom.'));
  await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tile-pane img')]
    .some((image) => image.src.includes('tiles.windy.com/v1/maptiles/outdoor/')));
  await page.waitForFunction(() => document.querySelector('.layer-custom-status')?.textContent === '已加载');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('trailviewer.customLayers')));
  check('the Windy source is stored locally',
    stored.length === 1 && stored[0].name === 'Windy' && stored[0].tileSize === 512
      && stored[0].minZoom === 1 && stored[0].maxZoom === 20,
    JSON.stringify(stored));
  check('the custom list marks the active source and keeps add in the header',
    await page.locator('[data-custom-select]').getAttribute('aria-checked') === 'true'
      && await page.locator('[data-custom-add]').evaluate((node) => !node.hidden)
      && await page.locator('.layer-custom-status').textContent() === '已加载');
  check('the layer entry follows the custom category while the tooltip keeps the source name',
    await page.locator('.layer-menu-toggle').evaluate((node) =>
      node.querySelector('.layer-menu-label').textContent === '定制'
      && node.querySelector('svg')?.dataset.icon === 'layer-custom'));
  check('the Windy template requests its documented outdoor tiles',
    windyRequests.length > 0
      && windyRequests.every((url) => /\/256(?:%40|@)2x\/\d+\/\d+\/\d+\/\?lang=en$/.test(url)),
    windyRequests[0] || 'no request');
  check('512 px sources keep 512 CSS-pixel tiles',
    await page.evaluate(() => [...document.querySelectorAll('.leaflet-tile-pane img')]
      .filter((image) => image.src.includes('tiles.windy.com'))
      .every((image) => image.style.width === '512px' && image.style.height === '512px')));
  await page.locator('[data-custom-edit]').click();
  await waitForLayout(page);
  await page.locator('[name="name"]').fill('Windy Outdoor');
  await page.locator('[data-custom-save]').click();
  await page.waitForFunction(() => document.querySelector('.layer-menu-toggle')?.title.includes('Windy Outdoor'));
  check('editing the active source updates the active layer and its label',
    await page.evaluate(() => window.trailViewer.layer().startsWith('custom.'))
      && /\bWindy Outdoor\b/.test(await page.getAttribute('.layer-menu-toggle', 'title')));

  await page.locator('[data-custom-edit]').click();
  await waitForLayout(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await waitForLayout(page);
  const narrow = await page.locator('#layer-source-menu').boundingBox();
  const narrowToggle = await page.locator('.layer-menu-toggle').boundingBox();
  check('the custom editor stays 320 px wide and right-aligned in a 360 px window',
    narrow && Math.abs(narrow.width - 320) < 1
      && Math.abs(narrow.x + narrow.width - 350) < 1
      && narrow.y >= narrowToggle.y + narrowToggle.height + 3
      && narrow.y >= 0 && narrow.y + narrow.height <= 740,
    JSON.stringify(narrow));
  await page.locator('.layer-custom-cancel').click();

  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await page.waitForFunction(() => document.querySelector('.layer-custom-status')?.textContent === '已加载');
  check('the custom source survives a reload',
    await page.evaluate(() => window.trailViewer.layer().startsWith('custom.'))
      && (await page.getAttribute('.layer-menu-toggle', 'title')).includes('Windy Outdoor')
      && await page.locator('.layer-custom-status').textContent() === '已加载');

  await page.locator('.layer-menu-toggle').click();
  await waitForLayout(page);
  check('reopening with saved custom sources shows the regular source picker',
    await page.locator('.layer-main-view').evaluate((node) => !node.hidden)
      && await page.locator('.layer-custom-view').evaluate((node) => node.hidden)
      && await page.locator('[data-custom-manage]').evaluate((node) => !node.hidden));
  await page.mouse.click(80, 600);
  await waitForLayout(page);
  check('pressing the map still closes the layer panel',
    await page.locator('#layer-source-menu').evaluate((node) => node.hidden));
  await page.locator('.layer-menu-toggle').click();
  await waitForLayout(page);
  const narrowCategories = await page.evaluate(() => {
    const menu = document.querySelector('#layer-source-menu').getBoundingClientRect();
    const rects = [...document.querySelectorAll('.layer-category-button')]
      .map((node) => node.getBoundingClientRect());
    return {
      oneRow: new Set(rects.map((rect) => Math.round(rect.top))).size === 1,
      inside: rects.every((rect) => rect.left >= menu.left && rect.right <= menu.right),
    };
  });
  check('the four map categories stay on one row at 360 px',
    narrowCategories.oneRow && narrowCategories.inside, JSON.stringify(narrowCategories));

  await page.locator('.layer-category-button[data-layer="custom"]').click();
  await waitForLayout(page);
  check('clicking Custom with saved sources keeps the regular picker open',
    await page.locator('.layer-main-view').evaluate((node) => !node.hidden)
      && await page.locator('.layer-custom-view').evaluate((node) => node.hidden)
      && await page.locator('[data-provider]').filter({ hasText: 'Windy Outdoor' })
        .getAttribute('aria-checked') === 'true');

  await page.locator('[data-custom-manage]').click();
  await waitForLayout(page);
  check('the manage action opens the custom source manager',
    await page.locator('.layer-custom-view').evaluate((node) => !node.hidden));
  check('the custom source manager omits the source and licence note',
    await page.locator('.layer-custom-help').count() === 0
      && !/来源与授权说明|Source and licence/.test(
        await page.locator('.layer-custom-view').textContent(),
      ));
  await page.locator('[data-custom-select]').click();
  check('switching a saved source keeps the custom management page open',
    await page.locator('.layer-custom-view').evaluate((node) => !node.hidden)
      && await page.locator('[data-custom-select]').getAttribute('aria-checked') === 'true');
  await page.locator('[data-custom-remove]').click();
  const deleteConfirmation = await page.evaluate(() => {
    const menu = document.querySelector('#layer-source-menu');
    const view = document.querySelector('.layer-custom-view');
    const button = document.querySelector('[data-custom-remove]');
    const rect = button?.getBoundingClientRect();
    return {
      menuHidden: menu?.hidden,
      viewHidden: view?.hidden,
      buttonHidden: button?.hidden,
      rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      display: button && getComputedStyle(button).display,
      visibility: button && getComputedStyle(button).visibility,
    };
  });
  check('deleting a source requires a second confirmation click',
    await page.locator('[data-custom-remove].confirm').count() === 1
      && !deleteConfirmation.menuHidden && !deleteConfirmation.viewHidden
      && !deleteConfirmation.buttonHidden,
    JSON.stringify(deleteConfirmation));
  await page.locator('[data-custom-remove]').click();
  await page.waitForFunction(() => window.trailViewer.layer() === 'road.osm');
  check('removing the active custom source falls back to a map source',
    await page.evaluate(() => window.trailViewer.layer()) === 'road.osm'
      && await page.evaluate(() => JSON.parse(localStorage.getItem('trailviewer.customLayers')).length === 0));

  const hostedPage = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' });
  await hostedPage.addInitScript(({ sources }) => {
    window.__hostedMessages = [];
    window.__TRAILVIEWER_RUNTIME_CONFIG__ = { customSources: sources };
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage: (message) => window.__hostedMessages.push(message),
      addEventListener: () => {},
    };
  }, {
    sources: [{
      id: 'custom.hosted',
      name: 'Hosted source',
      url: windyTemplate,
      tileSize: 512,
      minZoom: 1,
      maxZoom: 20,
      subdomains: '',
      attribution: '',
      tms: false,
    }],
  });
  await hostedPage.route(/tiles\.windy\.com\/v1\/maptiles\/outdoor\/256(?:%40|@)2x\//,
    (route) => route.fulfill({ body: tile, contentType: 'image/png' }));
  await hostedPage.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
  await hostedPage.waitForFunction(() => document.body.classList.contains('loaded'));
  await hostedPage.locator('.layer-menu-toggle').click();
  await hostedPage.locator('.layer-category-button[data-layer="custom"]').click();
  check('host-owned custom sources are available in a new WebView origin',
    await hostedPage.locator('[data-provider]').filter({ hasText: 'Hosted source' }).count() === 1
      && await hostedPage.evaluate(() => window.trailViewer.layer()).then((key) => key.startsWith('custom.')));
  const firstSettingsMessage = await hostedPage.evaluate(() =>
    window.__hostedMessages.filter((message) => message.startsWith('settings\t')).at(-1) || '');
  check('switching layer immediately sends the new layer to the host instead of the previous one',
    firstSettingsMessage.includes('layer=custom.hosted'),
    firstSettingsMessage);
  await hostedPage.locator('.layer-category-button[data-layer="terrain"]').click();
  await hostedPage.locator('[data-provider="terrain.openTopo"]').click();
  const secondSettingsMessage = await hostedPage.evaluate(() =>
    window.__hostedMessages.filter((message) => message.startsWith('settings\t')).at(-1) || '');
  check('switching to a built-in provider immediately persists that provider to the host',
    secondSettingsMessage.includes('layer=terrain.openTopo'),
    secondSettingsMessage);
  await hostedPage.locator('.layer-menu-toggle').click();
  await hostedPage.locator('.layer-category-button[data-layer="custom"]').click();
  await hostedPage.locator('[data-custom-manage]').click();
  await hostedPage.locator('[data-custom-edit]').click();
  await hostedPage.locator('[name="name"]').fill('Hosted edit');
  await hostedPage.locator('[data-custom-save]').click();
  await hostedPage.waitForFunction(() => window.__hostedMessages
    .some((message) => message.startsWith('custom-sources\t') && message.includes('Hosted edit')));
  check('editing a custom source sends the durable host copy',
    await hostedPage.evaluate(() => window.__hostedMessages.some((message) =>
      message.startsWith('custom-sources\t') && message.includes('"id":"custom.hosted"'))));
  await hostedPage.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}&layer=custom.hosted`);
  await hostedPage.waitForFunction(() => document.body.classList.contains('loaded'));
  check('host-persisted custom layer parameter activates the custom source on load',
    await hostedPage.evaluate(() => window.trailViewer.layer() === 'custom.hosted'));
  await hostedPage.evaluate(() => localStorage.clear());
  await hostedPage.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}&layer=custom.missing`);
  await hostedPage.waitForFunction(() => document.body.classList.contains('loaded'));
  check('a deleted host-persisted custom layer falls back to road.osm',
    await hostedPage.evaluate(() => window.trailViewer.layer() === 'road.osm'));
  await hostedPage.close();

  const migrationPage = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' });
  await migrationPage.addInitScript(({ source }) => {
    localStorage.setItem('trailviewer.customLayers', JSON.stringify([source]));
    window.__hostedMessages = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage: (message) => window.__hostedMessages.push(message),
      addEventListener: () => {},
    };
  }, {
    source: {
      id: 'custom.migrated',
      name: 'Migrated source',
      url: windyTemplate,
      tileSize: 512,
      minZoom: 1,
      maxZoom: 20,
      subdomains: '',
      attribution: '',
      tms: false,
    },
  });
  await migrationPage.route(/tiles\.windy\.com\/v1\/maptiles\/outdoor\/256(?:%40|@)2x\//,
    (route) => route.fulfill({ body: tile, contentType: 'image/png' }));
  await migrationPage.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
  await migrationPage.waitForFunction(() => window.__hostedMessages
    .some((message) => message.startsWith('custom-sources\t') && message.includes('custom.migrated')));
  check('legacy browser sources migrate to the host on first use',
    await migrationPage.evaluate(() => window.__hostedMessages.some((message) =>
      message.startsWith('custom-sources\t') && message.includes('"id":"custom.migrated"'))));
  await migrationPage.close();

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
