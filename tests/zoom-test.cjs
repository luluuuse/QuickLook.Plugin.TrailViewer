// Zoom test: a plain wheel notch moves a whole level, Alt turns the same notch into half of one, the buttons
// keep moving a whole level, and the fine step is put back once the gesture is over.
//
//   NODE_PATH=<folder containing playwright-core> node tests/zoom-test.cjs
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
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

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/track-time-ele.gpx`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await page.waitForTimeout(400);

  const zoom = () => page.evaluate(() => window.gpxViewer.map.getZoom());
  const step = () => page.evaluate(() => window.gpxViewer.map.options.zoomSnap);
  // Every measurement starts from the same place, with no animation left running.
  const reset = async () => {
    await page.evaluate(() => { window.gpxViewer.map.setZoom(15, { animate: false }); });
    await page.waitForTimeout(450);
  };
  const notch = async () => {
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(600);
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
  await notch();
  const plain = await zoom();
  check('a plain notch moves one level', plain - before === 1, `${before} -> ${plain}`);

  // The same notch with Alt held: half a level, and the map may stop between levels.
  await reset();
  await page.keyboard.down('Alt');
  const beforeFine = await zoom();
  await notch();
  const fine = await zoom();
  await page.keyboard.up('Alt');
  check('Alt and a notch move half a level', fine - beforeFine === 0.5, `${beforeFine} -> ${fine}`);
  check('so the map can stop between levels', !Number.isInteger(fine), `zoom ${fine}`);

  // Held down for a second notch: still half, no drift and no whole step sneaking back in.
  await page.keyboard.down('Alt');
  const beforeFine2 = await zoom();
  await notch();
  const fine2 = await zoom();
  await page.keyboard.up('Alt');
  check('a second Alt notch is half a level too', fine2 - beforeFine2 === 0.5, `${beforeFine2} -> ${fine2}`);

  // The step goes back on its own, so the next plain notch is a whole level again -- and the pixels that
  // belonged to the fine notch are not re-read at the coarse one, which would overshoot.
  await page.waitForTimeout(400);
  const restored = await step();
  check('the fine step is put back after the gesture', restored === 1, `zoomSnap ${restored}`);
  const beforeBack = await zoom();
  await notch();
  const back = await zoom();
  check('a plain notch after Alt moves one level', back - beforeBack === 1, `${beforeBack} -> ${back}`);

  // The buttons are untouched by any of this: Alt + click still moves a whole level.
  await reset();
  await page.keyboard.down('Alt');
  const beforeButton = await zoom();
  await page.evaluate(() => document.querySelector('.leaflet-control-zoom-in').click());
  await page.waitForTimeout(600);
  const button = await zoom();
  await page.keyboard.up('Alt');
  check('the buttons still move one level with Alt held', button - beforeButton === 1,
    `${beforeButton} -> ${button}`);

  // Ctrl is what a trackpad pinch sends; it must not become the fine step as well.
  await reset();
  await page.keyboard.down('Control');
  const beforeCtrl = await zoom();
  await notch();
  const ctrl = await zoom();
  await page.keyboard.up('Control');
  check('Ctrl and a notch stay a whole level', ctrl - beforeCtrl === 1, `${beforeCtrl} -> ${ctrl}`);

  check('the page threw nothing', pageErrors.length === 0, pageErrors.join(' | ') || 'clean');

  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
