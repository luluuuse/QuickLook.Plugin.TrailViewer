// Test for the keyboard: W flips the markers, Q and E walk the background bar, S clears the interface off the
// map. A key repeats while it is held down, a photo covers the map, and a file with nothing to hide still gets
// the key without an error.
//
//   NODE_PATH=<folder containing playwright-core> node tests/keys-test.cjs [screenshot.png]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
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
  // en-US so the assertions can read the hint line; the Chinese side is checked at the end by switching.
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const remote = fs.readFileSync(path.join(root, 'tests/fixtures/photo2.png'));
  await page.route('https://example.test/**', (route) => route.fulfill({ body: remote, contentType: 'image/png' }));

  const open = async (name) => {
    await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${name}`);
    await page.waitForFunction(() => document.body.classList.contains('loaded'));
  };

  const state = async () => page.evaluate(() => ({
    layer: window.gpxViewer.layer(),
    activeLayer: document.querySelector('.layer-switch button.active')?.dataset.layer || '',
    pins: document.querySelectorAll('.gpx-pin').length,
    marks: window.gpxViewer.pins.count(),
    pinsVisible: window.gpxViewer.pins.visible(),
    pinsActive: document.querySelector('.pins-switch button')?.classList.contains('active'),
    hasControl: window.gpxViewer.pins.hasControl(),
    photo: window.gpxViewer.photos.isOpen(),
    hint: document.getElementById('keys')?.textContent || '',
    hintShown: document.getElementById('keys')?.hidden === false,
    navHint: document.querySelectorAll('#keys .nav').length,
    summaryKeys: document.querySelectorAll('#info .keys').length,
  }));

  const press = async (key) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(180);
  };

  await page.goto(`${base}/viewer/index.html`);
  await page.evaluate(() => {
    localStorage.removeItem('gpxviewer.pins');
    localStorage.removeItem('gpxviewer.layer');
  });
  await open('kml-photos.kml');

  // 1. The keys are named on a bar of their own, above the map -- not inside the summary box.
  let s = await state();
  check('the bar above the map names the keys', s.hintShown && /markers/.test(s.hint) && /background/.test(s.hint),
    s.hint);
  check('the summary no longer carries them', s.summaryKeys === 0, `${s.summaryKeys}`);
  check('the background starts on the map', s.layer === 'map', s.layer);

  // 2. W is the marker switch: the same hide/show the button does, with the same state.
  await press('w');
  s = await state();
  check('W hides the markers', s.pins === 0 && s.pinsVisible === false, `${s.pins}/${s.pinsVisible}`);
  check('and the button follows', s.pinsActive === false);
  check('the markers are still loaded for the keyboard', s.marks === 8, `${s.marks}`);

  await press('w');
  s = await state();
  check('W brings them back', s.pins === 5 && s.pinsVisible === true && s.pinsActive === true, `${s.pins}`);

  // 3. E walks the bar forwards and wraps; Q walks it backwards.
  const order = [['e', 'terrain'], ['e', 'satellite'], ['e', 'none'], ['e', 'map'], ['q', 'none'], ['q', 'satellite']];
  for (const [key, want] of order) {
    await press(key);
    s = await state();
    check(`${key} -> ${want}`, s.layer === want && s.activeLayer === want, `${s.layer}/${s.activeLayer}`);
  }

  // 4. A photo covers the map: the three keys stand down until it is closed.
  await page.locator('.gpx-pin[title="Album"]').click();
  await page.locator('.photo-popup .photo-thumb').first().click();
  await page.waitForFunction(() => window.gpxViewer.photos.isOpen());
  s = await state();
  const before = { layer: s.layer, pins: s.pins };
  await press('w');
  await press('q');
  await press('e');
  s = await state();
  check('W does nothing while a photo is open', s.pins === before.pins, `${s.pins}`);
  check('Q and E do not change the background behind a photo', s.layer === before.layer, s.layer);
  // The host route (pressKey) has to obey the same rule: it is what QuickLook-side keys go through.
  await page.evaluate(() => {
    window.gpxViewer.pressKey('w');
    window.gpxViewer.pressKey('e');
  });
  s = await state();
  check('the host route is quiet behind a photo too', s.pins === before.pins && s.layer === before.layer,
    `${s.pins}/${s.layer}`);
  await page.locator('.photo-close').click();
  await press('e');
  s = await state();
  check('the keys work again once the photo is closed', s.layer !== before.layer, s.layer);

  // 5. A repeat is one press: holding W must not make the markers blink at thirty hertz.
  await page.locator('.pins-switch button').click(); // back to hidden, a known state
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', repeat: true, bubbles: true, cancelable: true }));
    }
  });
  await page.waitForTimeout(200);
  s = await state();
  check('a held key is ignored', s.pinsVisible === false, `${s.pinsVisible}`);
  // A modifier belongs to the host: Ctrl+W must not be read as ours.
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(150);
  s = await state();
  check('Ctrl+W is not ours', s.pinsVisible === false, `${s.pinsVisible}`);
  await page.locator('.pins-switch button').click();
  await page.waitForTimeout(150);

  // 6. A pure track has no waypoints but does have dots: W still clears them.
  await page.evaluate(() => localStorage.removeItem('gpxviewer.pins'));
  await open('gpx10.gpx');
  s = await state();
  check('a pure track gets the switch and the hint', s.hasControl === true && s.marks === 30, `${s.marks}`);
  check('no waypoints, no waypoint keys on the bar', s.navHint === 0, `${s.navHint}`);
  await press('w');
  s = await state();
  check('W hides the dots of a pure track', s.pinsVisible === false, `${s.pinsVisible}`);
  check('and keeps the line', (await page.locator('.gpx-track').count()) === 1);
  await press('w');

  // 7. When the host catches the key itself it calls pressKey: it has to mean exactly the same thing.
  const startLayer = (await state()).layer;
  await page.evaluate(() => window.gpxViewer.pressKey('e'));
  await page.waitForTimeout(150);
  s = await state();
  check('pressKey steps the background like the key does', s.layer !== startLayer, s.layer);
  await page.evaluate(() => window.gpxViewer.pressKey('q'));
  await page.waitForTimeout(150);
  s = await state();
  check('and steps back', s.layer === startLayer, s.layer);
  const startPins = s.pinsVisible;
  await page.evaluate(() => window.gpxViewer.pressKey('w'));
  await page.waitForTimeout(150);
  s = await state();
  check('pressKey flips the markers like the key does', s.pinsVisible === !startPins, `${s.pinsVisible}`);
  await page.evaluate(() => window.gpxViewer.pressKey('w'));

  // 8. A file that draws nothing but an area has no switch: the key is quiet, not an error.
  await open('kml-polygon-only.kml');
  s = await state();
  check('an area-only file has no marker switch', s.hasControl === false, `${s.hasControl}`);
  await press('w');
  check('W on such a file does not throw', pageErrors.length === 0, pageErrors.join('; '));
  check('and changes nothing', (await state()).hasControl === false);
  // Q and E still work there: the background does not depend on the file's contents.
  const layerOrder = ['map', 'terrain', 'satellite', 'none'];
  const next = layerOrder[(layerOrder.indexOf(s.layer) + 1) % layerOrder.length];
  await press('e');
  s = await state();
  check('the background keys still work on an area-only file', s.layer === next, `${s.layer}, wanted ${next}`);

  // 9. The bar follows the interface language.
  await page.locator('.lang-switch button').click();
  await page.waitForTimeout(200);
  s = await state();
  check('the bar speaks Chinese', /标记点/.test(s.hint) && /切换底图/.test(s.hint), s.hint);
  await page.locator('.lang-switch button').click();
  await page.waitForTimeout(200);

  // 10. S clears the map: the summary, the key bar, both top corners and the profile go, the route stays. The
  //     scale and the map credit are not interface -- one says how big the picture is, the other is a term of use.
  const chrome = () => page.evaluate(() => {
    const shown = (sel) => {
      const node = document.querySelector(sel);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const toast = document.getElementById('toast');
    return {
      hidden: document.body.classList.contains('chrome-hidden'),
      info: shown('#info'), keys: shown('#keys'), profile: shown('#profile'),
      zoom: shown('.leaflet-control-zoom'), layers: shown('.layer-switch'),
      pins: shown('.pins-switch'), lang: shown('.lang-switch'),
      scale: shown('.leaflet-control-scale'), credit: shown('.leaflet-control-attribution'),
      map: shown('#map'),
      markers: document.querySelectorAll('.gpx-pin').length,
      toast: toast.hidden === false, toastText: toast.textContent,
      hint: document.getElementById('keys').textContent,
    };
  });

  await open('kml-photos.kml');
  let c = await chrome();
  check('everything is on the map to begin with',
    c.info && c.keys && c.profile && c.zoom && c.layers && c.pins && c.lang, JSON.stringify(c));
  check('the bar names the new key', /S/.test(c.hint) && /interface/.test(c.hint), c.hint);

  await press('s');
  c = await chrome();
  check('S takes the summary away', c.info === false);
  check('and the key bar', c.keys === false);
  check('and the profile', c.profile === false);
  check('and the buttons in both top corners', c.zoom === false && c.layers === false && c.pins === false && c.lang === false,
    `${c.zoom}/${c.layers}/${c.pins}/${c.lang}`);
  check('the map and the route stay', c.map === true);
  // The markers are content, not interface: hiding the buttons must not hide them.
  check('the markers stay on the map', c.markers === 5, `${c.markers}`);
  check('the scale and the map credit stay', c.scale === true && c.credit === true, `${c.scale}/${c.credit}`);
  check('a line says how to get back', c.toast && /Press S/.test(c.toastText), c.toastText);

  await press('s');
  c = await chrome();
  check('S brings everything back',
    c.info && c.keys && c.profile && c.zoom && c.layers && c.pins && c.lang, JSON.stringify(c));
  check('and the class is gone', c.hidden === false);

  // The host sends the same key through pressKey when QuickLook is holding the keyboard.
  await page.evaluate(() => window.gpxViewer.pressKey('s'));
  await page.waitForTimeout(150);
  check('pressKey clears the interface like the key does', (await chrome()).info === false);
  await page.evaluate(() => window.gpxViewer.pressKey('s'));
  await page.waitForTimeout(150);

  // A photo card over the map does not take the key away -- W, Q and E keep working through it. The full-screen
  // viewer does: the map is behind it, and a change nobody can see is a change nobody asked for.
  await page.locator('.gpx-pin[title="Album"]').click();
  await page.waitForSelector('.photo-popup .photo-thumb');
  await press('s');
  check('the key works through a photo card', (await chrome()).hidden === true);
  await page.locator('.photo-popup .photo-thumb').nth(0).click();
  await page.waitForFunction(() => document.querySelector('.photo-image')?.naturalWidth > 0);
  await press('s');
  check('but not while the viewer is full screen', (await chrome()).hidden === true);

  // A fresh file opens with the interface on, whatever the last one did. (Reloading the page is also how the
  // photo viewer is dismissed here; it has its own test.)
  await open('kml-photos.kml');
  check('the next file starts with its interface on', (await chrome()).info === true);

  // 11. The background chosen by a key is remembered, the same way a click is.
  await open('kml-photos.kml');
  await press('e');
  await open('kml-photos.kml');
  s = await state();
  check('a background chosen with E survives a reload', s.layer === 'terrain' && s.activeLayer === 'terrain', s.layer);

  if (shot) {
    await open('kml-photos.kml');
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot });
  }

  check('no page errors', pageErrors.length === 0, pageErrors.join('; '));

  await browser.close();
  server.close();
  console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} failed: ${failures.join(', ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
