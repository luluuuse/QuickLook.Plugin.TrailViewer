// Locate test: the button and C put the whole track back in view, from wherever the map was left, and both
// roads (the page's own keydown and the host's pressKey) land on the same frame the file opened with.
//
//   NODE_PATH=<folder containing playwright-core> node tests/locate-test.cjs
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
  await page.waitForTimeout(600);

  // The frame the file opened with, and the ground the track actually covers.
  const view = () => page.evaluate(() => {
    const map = window.gpxViewer.map;
    const b = map.getBounds();
    const c = map.getCenter();
    return {
      lat: c.lat, lng: c.lng, zoom: map.getZoom(),
      south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast(),
    };
  });
  const track = await page.evaluate(() => {
    const g = window.gpxViewer.gpx;
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
  check('the button never keeps focus', button?.tab === -1, `tabindex ${button?.tab}`);
  check('the tooltip names the key', /C/.test(button?.title || ''), button?.title);
  check('it sits in the zoom column', button?.belowZoom === true && Math.abs(button?.dx ?? 99) <= 1,
    `${button?.width}x${button?.height}, ${button?.dx} px sideways, ${button?.dy} px under`);

  // Somewhere else entirely -- a different continent and a different zoom.
  const away = async () => {
    await page.evaluate(() => { window.gpxViewer.map.setView([0, 0], 4, { animate: false }); });
    await page.waitForTimeout(200);
    return view();
  };

  // 1. The page's own keydown.
  const parked = await away();
  check('the map can be parked away from the track', !coversTrack(parked), `zoom ${parked.zoom}`);
  await page.keyboard.press('c');
  await page.waitForTimeout(700);
  const afterKey = await view();
  check('C brings the whole track back', coversTrack(afterKey), `zoom ${afterKey.zoom}`);
  check('C lands on the same zoom the file opened with', afterKey.zoom === opening.zoom,
    `${opening.zoom} -> ${afterKey.zoom}`);
  check('C lands on the same centre', Math.abs(afterKey.lat - opening.lat) < 0.002
    && Math.abs(afterKey.lng - opening.lng) < 0.002,
    `${opening.lat.toFixed(4)},${opening.lng.toFixed(4)} -> ${afterKey.lat.toFixed(4)},${afterKey.lng.toFixed(4)}`);

  // 2. The host's road -- the same call QuickLook makes when it holds the keyboard.
  await away();
  await page.evaluate(() => window.gpxViewer.pressKey('c'));
  await page.waitForTimeout(700);
  const afterHost = await view();
  check('pressKey("c") does what the key does', coversTrack(afterHost)
    && Math.abs(afterHost.lat - opening.lat) < 0.002 && afterHost.zoom === opening.zoom,
    `zoom ${afterHost.zoom}`);

  // 3. The button.
  await away();
  await page.evaluate(() => document.querySelector('.locate-switch button').click());
  await page.waitForTimeout(700);
  const afterButton = await view();
  check('the button does what the key does', coversTrack(afterButton)
    && Math.abs(afterButton.lat - opening.lat) < 0.002 && afterButton.zoom === opening.zoom,
    `zoom ${afterButton.zoom}`);

  // 4. Pressing it while already home must not wander.
  const beforeAgain = await view();
  await page.evaluate(() => window.gpxViewer.pressKey('c'));
  await page.waitForTimeout(600);
  const again = await view();
  check('pressing it at home changes nothing', Math.abs(again.lat - beforeAgain.lat) < 1e-6
    && again.zoom === beforeAgain.zoom, `zoom ${again.zoom}`);

  // 5. With the interface away (S) the panel is display:none; the frame must not shrink into its stale rect.
  await page.keyboard.press('s');
  await page.waitForTimeout(300);
  const hidden = await page.evaluate(() => document.body.classList.contains('chrome-hidden'));
  check('S takes the interface away', hidden === true);
  await away();
  await page.keyboard.press('c');
  await page.waitForTimeout(700);
  const afterHidden = await view();
  check('C still works with the interface hidden', coversTrack(afterHidden), `zoom ${afterHidden.zoom}`);
  await page.keyboard.press('s');
  await page.waitForTimeout(300);

  // 6. The key bar mentions it.
  const hint = await page.evaluate(() => document.getElementById('keys')?.textContent || '');
  check('the key bar lists C', /C/.test(hint) && /全览/.test(hint), hint.slice(0, 60));

  // 7. The corner row must not grow: the button costs the top band nothing, which is why it went under zoom.
  const row = await page.evaluate(() => {
    const keys = document.getElementById('keys').getBoundingClientRect();
    const tools = document.querySelector('#map .leaflet-top.leaflet-right').getBoundingClientRect();
    return { gap: Math.round(tools.left - keys.right) };
  });
  check('the key bar still clears the corner switches', row.gap >= 12, `${row.gap} px between them`);

  check('the page threw nothing', pageErrors.length === 0, pageErrors.join(' | ') || 'clean');

  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
