// Locate test: the button and C put the whole track back in view, from wherever the map was left, and both
// roads (the page's own keydown and the host's pressKey) land on the same frame the file opened with.
//
//   NODE_PATH=<folder containing playwright-core> node tests/locate-test.cjs
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
const path = require('path');
const {
  launchBrowser,
  waitForLayout,
  waitForMapIdle,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures } = createChecker('locate');
const artifacts = createArtifacts('locate');

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

  // The frame the file opened with, and the ground the track actually covers.
  const view = () => page.evaluate(() => {
    const map = window.trailViewer.map;
    const b = map.getBounds();
    const c = map.getCenter();
    return {
      lat: c.lat, lng: c.lng, zoom: map.getZoom(),
      south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast(),
    };
  });
  const track = await page.evaluate(() => {
    const g = window.trailViewer.gpx;
    let s = 90, n = -90, w = 180, e = -180;
    for (const t of g.tracks) {
      for (const seg of t.segments) {
        for (const p of seg) {
          s = Math.min(s, p.lat); n = Math.max(n, p.lat);
          w = Math.min(w, p.lon); e = Math.max(e, p.lon);
        }
      }
    }
    return { s, n, w, e };
  });

  const opening = await view();
  const coversTrack = (v) => v.south <= track.s + 1e-6 && v.north >= track.n - 1e-6
    && v.west <= track.w + 1e-6 && v.east >= track.e - 1e-6;
  check('the file opens showing the whole track', coversTrack(opening),
    `${opening.south.toFixed(3)}..${opening.north.toFixed(3)} vs ${track.s.toFixed(3)}..${track.n.toFixed(3)}`);

  const button = await page.evaluate(() => {
    const b = document.querySelector('.locate-switch button');
    if (!b) return null;
    // The zoom-in button for the left edge (the bar carries a 2 px border the button sits inside), the bar
    // itself for the bottom.
    const zoom = document.querySelector('.leaflet-control-zoom').getBoundingClientRect();
    const zoomIn = document.querySelector('.leaflet-control-zoom-in').getBoundingClientRect();
    const box = b.getBoundingClientRect();
    return {
      label: b.getAttribute('aria-label'), title: b.title, tab: b.tabIndex,
      icon: !!b.querySelector('svg'), width: Math.round(box.width), height: Math.round(box.height),
      belowZoom: Math.round(box.top) >= Math.round(zoom.bottom) - 1,
      dx: Math.round(box.left - zoomIn.left), dy: Math.round(box.top - zoom.bottom),
    };
  });
  check('the corner carries a locate button', button !== null, button ? `"${button.label}"` : 'missing');
  check('the button is an icon, not a word', button?.icon === true);
  check('it is labelled for screen readers', /轨迹|track/.test(button?.label || ''), button?.label);
  check('the button can be reached with Tab', button?.tab === 0, `tabindex ${button?.tab}`);
  check('the tooltip names the key', /C/.test(button?.title || ''), button?.title);
  check('it sits in the zoom column', button?.belowZoom === true && Math.abs(button?.dx ?? 99) <= 1,
    `${button?.width}x${button?.height}, ${button?.dx} px sideways, ${button?.dy} px under`);

  // Somewhere else entirely -- a different continent and a different zoom.
  const away = async () => {
    await page.evaluate(() => { window.trailViewer.map.setView([0, 0], 4, { animate: false }); });
    await waitForMapIdle(page);
    return view();
  };
  const waitForHome = async () => {
    await page.waitForFunction(({ zoom, lat, lng }) => {
      const map = window.trailViewer.map;
      const center = map.getCenter();
      return map.getZoom() === zoom && Math.abs(center.lat - lat) < 0.002
        && Math.abs(center.lng - lng) < 0.002;
    }, opening);
    await waitForMapIdle(page);
  };
  const setChromeHidden = async (hidden) => {
    await page.waitForFunction((wanted) => document.body.classList.contains('chrome-hidden') === wanted, hidden);
    await waitForLayout(page);
  };

  // 1. The page's own keydown.
  const parked = await away();
  check('the map can be parked away from the track', !coversTrack(parked), `zoom ${parked.zoom}`);
  await page.keyboard.press('c');
  await waitForHome();
  const afterKey = await view();
  check('C brings the whole track back', coversTrack(afterKey), `zoom ${afterKey.zoom}`);
  check('C lands on the same zoom the file opened with', afterKey.zoom === opening.zoom,
    `${opening.zoom} -> ${afterKey.zoom}`);
  check('C lands on the same centre', Math.abs(afterKey.lat - opening.lat) < 0.002
    && Math.abs(afterKey.lng - opening.lng) < 0.002,
    `${opening.lat.toFixed(4)},${opening.lng.toFixed(4)} -> ${afterKey.lat.toFixed(4)},${afterKey.lng.toFixed(4)}`);

  // 2. The host's road -- the same call QuickLook makes when it holds the keyboard.
  await away();
  await page.evaluate(() => window.trailViewer.pressKey('c'));
  await waitForHome();
  const afterHost = await view();
  check('pressKey("c") does what the key does', coversTrack(afterHost)
    && Math.abs(afterHost.lat - opening.lat) < 0.002 && afterHost.zoom === opening.zoom,
    `zoom ${afterHost.zoom}`);

  // 3. The button.
  await away();
  await page.evaluate(() => document.querySelector('.locate-switch button').click());
  await waitForHome();
  const afterButton = await view();
  check('the button does what the key does', coversTrack(afterButton)
    && Math.abs(afterButton.lat - opening.lat) < 0.002 && afterButton.zoom === opening.zoom,
    `zoom ${afterButton.zoom}`);

  // 4. Pressing it while already home must not wander.
  const beforeAgain = await view();
  await page.evaluate(() => window.trailViewer.pressKey('c'));
  await waitForMapIdle(page);
  const again = await view();
  check('pressing it at home changes nothing', Math.abs(again.lat - beforeAgain.lat) < 1e-6
    && again.zoom === beforeAgain.zoom, `zoom ${again.zoom}`);

  // 5. With the interface away (S) the panel is display:none; the frame must not shrink into its stale rect.
  await page.keyboard.press('s');
  await setChromeHidden(true);
  const hidden = await page.evaluate(() => document.body.classList.contains('chrome-hidden'));
  check('S takes the interface away', hidden === true);
  await away();
  await page.keyboard.press('c');
  await page.waitForFunction(({ s, n, w, e }) => {
    const bounds = window.trailViewer.map.getBounds();
    return bounds.getSouth() <= s + 1e-6 && bounds.getNorth() >= n - 1e-6
      && bounds.getWest() <= w + 1e-6 && bounds.getEast() >= e - 1e-6;
  }, track);
  await waitForMapIdle(page);
  const afterHidden = await view();
  check('C still works with the interface hidden', coversTrack(afterHidden), `zoom ${afterHidden.zoom}`);
  await page.keyboard.press('s');
  await setChromeHidden(false);

  // 6. The export button follows it down the same column: the top band belongs to the summary, and the right
  //    corner already carries three switches, so anything else about "the route as a whole" stacks here.
  const pair = await page.evaluate(() => {
    const fit = document.querySelector('.locate-switch button').getBoundingClientRect();
    const out = document.querySelector('.export-switch button').getBoundingClientRect();
    return {
      dx: Math.round(out.left - fit.left),
      dy: Math.round(out.top - fit.bottom),
      w: Math.round(out.width),
      h: Math.round(out.height),
    };
  });
  check('an export button follows the fit button down the column',
    pair.w === 30 && pair.h === 30 && Math.abs(pair.dx) <= 1 && pair.dy >= 4,
    `${pair.w}x${pair.h}, ${pair.dx} px sideways, ${pair.dy} px under`);

  check('the page threw nothing', pageErrors.length === 0, pageErrors.join(' | ') || 'clean');

  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
