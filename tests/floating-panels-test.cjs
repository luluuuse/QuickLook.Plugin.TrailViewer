// The three top-right panels share one top edge and only one can be open at a time.
const path = require('path');
const {
  launchBrowser,
  waitForLayout,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures, finish } = createChecker('floating-panels');
const artifacts = createArtifacts('floating-panels');
const panels = {
  toolbox: '#toolbox-panel',
  layer: '#layer-source-menu',
  overview: '.waypoint-overview',
};
const headers = {
  toolbox: '.toolbox-header',
  layer: '.layer-menu-header',
  overview: '.waypoint-overview-header',
};

async function states(page) {
  return page.evaluate((selectors) => Object.fromEntries(Object.entries(selectors)
    .map(([name, selector]) => {
      const node = document.querySelector(selector);
      return [name, Boolean(node) && !node.hidden];
    })), panels);
}

async function geometry(page, name) {
  return page.evaluate(({ panel, header }) => {
    const outer = document.querySelector(panel).getBoundingClientRect();
    const title = document.querySelector(header).getBoundingClientRect();
    return {
      top: Math.round(outer.top * 10) / 10,
      right: Math.round(outer.right * 10) / 10,
      headerTop: Math.round(title.top * 10) / 10,
      headerHeight: Math.round(title.height * 10) / 10,
    };
  }, { panel: panels[name], header: headers[name] });
}

async function run(width, height) {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width, height }, locale: 'zh-CN' });
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.message}\n${error.stack || ''}`));
  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/waypoints-route.gpx`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await waitForLayout(page);

  await page.locator('.toolbox-switch > button').click();
  await waitForLayout(page);
  check(`${width}px: toolbox opens alone`,
    JSON.stringify(await states(page)) === JSON.stringify({
      toolbox: true, layer: false, overview: false,
    }));
  const boxes = { toolbox: await geometry(page, 'toolbox') };

  await page.locator('.layer-menu-toggle').click();
  await waitForLayout(page);
  check(`${width}px: layer panel closes the toolbox`,
    JSON.stringify(await states(page)) === JSON.stringify({
      toolbox: false, layer: true, overview: false,
    })
      && await page.evaluate(() => document.querySelector('#layer-source-menu').contains(document.activeElement)));
  boxes.layer = await geometry(page, 'layer');

  await page.locator('[data-waypoints="overview"]').click();
  await waitForLayout(page);
  check(`${width}px: waypoint list closes the layer panel`,
    JSON.stringify(await states(page)) === JSON.stringify({
      toolbox: false, layer: false, overview: true,
    })
      && await page.evaluate(() => document.activeElement?.classList.contains('close')));
  boxes.overview = await geometry(page, 'overview');

  check(`${width}px: all three panels share the same top and header geometry`,
    new Set(Object.values(boxes).map((box) => box.top)).size === 1
      && new Set(Object.values(boxes).map((box) => box.headerTop)).size === 1
      && Object.values(boxes).every((box) => box.headerHeight === 40)
      && Object.values(boxes).every((box) => box.right === width - 10),
    JSON.stringify(boxes));

  await page.locator('.toolbox-switch > button').click();
  await waitForLayout(page);
  check(`${width}px: toolbox closes the waypoint list`,
    JSON.stringify(await states(page)) === JSON.stringify({
      toolbox: true, layer: false, overview: false,
    }));
  await page.locator('.toolbox-switch > button').click();
  await waitForLayout(page);
  check(`${width}px: clicking the active control closes its own panel`,
    Object.values(await states(page)).every((open) => !open));

  check(`${width}px: no page errors`, pageErrors.length === 0, pageErrors[0]);
  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
}

async function main() {
  await run(1200, 800);
  await run(360, 740);
  process.exit(finish());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
