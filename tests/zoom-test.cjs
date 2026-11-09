// Zoom test: a plain wheel notch moves a whole level, Alt turns the same notch into half of one, the buttons
// keep moving a whole level, and the fine step is put back once the gesture is over.
//
//   NODE_PATH=<folder containing playwright-core> node tests/zoom-test.cjs
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
const path = require('path');
const {
  launchBrowser,
  waitForMapIdle,
  waitForZoom,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures } = createChecker('zoom');
const artifacts = createArtifacts('zoom');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' });
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/track-time-ele.gpx`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await waitForMapIdle(page);

  const zoom = () => page.evaluate(() => window.gpxViewer.map.getZoom());
  const step = () => page.evaluate(() => window.gpxViewer.map.options.zoomSnap);
  // Every measurement starts from the same place, with no animation left running.
  const reset = async () => {
    await page.evaluate(() => { window.gpxViewer.map.setZoom(15, { animate: false }); });
    await waitForZoom(page, 15);
  };
  const notch = async (wanted) => {
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -100);
    await waitForZoom(page, wanted);
  };

  const limits = await page.evaluate(() => ({
    min: window.gpxViewer.map.getMinZoom(),
    max: window.gpxViewer.map.getMaxZoom(),
    snap: window.gpxViewer.map.options.zoomSnap,
    delta: window.gpxViewer.map.options.zoomDelta,
  }));
  check('the map stops at level 19', limits.max === 19, `max ${limits.max}`);
  check('the wheel moves a whole level by default', limits.snap === 1, `zoomSnap ${limits.snap}`);
  check('the buttons move a whole level', limits.delta === 1, `zoomDelta ${limits.delta}`);

  // A plain notch: exactly one level.
  await reset();
  const before = await zoom();
  await notch(before + 1);
  const plain = await zoom();
  check('a plain notch moves one level', plain - before === 1, `${before} -> ${plain}`);

  // The same notch with Alt held: half a level, and the map may stop between levels.
  await reset();
  await page.keyboard.down('Alt');
  const beforeFine = await zoom();
  await notch(beforeFine + 0.5);
  const fine = await zoom();
  await page.keyboard.up('Alt');
  check('Alt and a notch move half a level', fine - beforeFine === 0.5, `${beforeFine} -> ${fine}`);
  check('so the map can stop between levels', !Number.isInteger(fine), `zoom ${fine}`);

  // Held down for a second notch: still half, no drift and no whole step sneaking back in.
  await page.keyboard.down('Alt');
  const beforeFine2 = await zoom();
  await notch(beforeFine2 + 0.5);
  const fine2 = await zoom();
  await page.keyboard.up('Alt');
  check('a second Alt notch is half a level too', fine2 - beforeFine2 === 0.5, `${beforeFine2} -> ${fine2}`);

  // The step goes back on its own, so the next plain notch is a whole level again -- and the pixels that
  // belonged to the fine notch are not re-read at the coarse one, which would overshoot.
  await page.waitForFunction(() => window.gpxViewer.map.options.zoomSnap === 1);
  const restored = await step();
  check('the fine step is put back after the gesture', restored === 1, `zoomSnap ${restored}`);
  const beforeBack = await zoom();
  await notch(beforeBack + 1);
  const back = await zoom();
  check('a plain notch after Alt moves one level', back - beforeBack === 1, `${beforeBack} -> ${back}`);

  // The buttons are untouched by any of this: Alt + click still moves a whole level.
  await reset();
  await page.keyboard.down('Alt');
  const beforeButton = await zoom();
  await page.evaluate(() => document.querySelector('.leaflet-control-zoom-in').click());
  await waitForZoom(page, beforeButton + 1);
  const button = await zoom();
  await page.keyboard.up('Alt');
  check('the buttons still move one level with Alt held', button - beforeButton === 1,
    `${beforeButton} -> ${button}`);

  // Ctrl is what a trackpad pinch sends; it must not become the fine step as well.
  await reset();
  await page.keyboard.down('Control');
  const beforeCtrl = await zoom();
  await notch(beforeCtrl + 1);
  const ctrl = await zoom();
  await page.keyboard.up('Control');
  check('Ctrl and a notch stay a whole level', ctrl - beforeCtrl === 1, `${beforeCtrl} -> ${ctrl}`);

  check('the page threw nothing', pageErrors.length === 0, pageErrors.join(' | ') || 'clean');

  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
