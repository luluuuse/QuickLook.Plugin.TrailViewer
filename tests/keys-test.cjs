// Test for the keyboard: W flips the markers, Q and E walk the background bar, S clears the interface off the
// map. A key repeats while it is held down, a photo covers the map, and a file with nothing to hide still gets
// the key without an error.
//
//   NODE_PATH=<folder containing playwright-core> node tests/keys-test.cjs [screenshot.png]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
const fs = require('fs');
const path = require('path');
const {
  launchBrowser,
  waitForLayout,
  waitForPhoto,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const { check, failures, finish } = createChecker('keys');
const artifacts = createArtifacts('keys');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  // en-US so the assertions can read the tooltips; the Chinese side is checked at the end by switching.
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const remote = fs.readFileSync(path.join(root, 'tests/fixtures/photo2.png'));
  await page.route('https://example.test/**', (route) => route.fulfill({ body: remote, contentType: 'image/png' }));

  const open = async (name) => {
    await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${name}`);
    await page.waitForFunction(() => document.body.classList.contains('loaded'));
  };

  const state = async () => page.evaluate(() => ({
    layer: window.trailViewer.layer(),
    layerCategory: window.trailViewer.layerCategory(),
    activeLayer: document.querySelector('.layer-category-button.active')?.dataset.layer || '',
    activePressed: document.querySelector('.layer-category-button.active')?.getAttribute('aria-checked') || '',
    pins: document.querySelectorAll('.gpx-pin').length,
    marks: window.trailViewer.pins.count(),
    pinsVisible: window.trailViewer.pins.visible(),
    pinsActive: document.querySelector('.pins-switch button')?.classList.contains('active'),
    pinsPressed: document.querySelector('.pins-switch button')?.getAttribute('aria-pressed') || '',
    hasControl: window.trailViewer.pins.hasControl(),
    photo: window.trailViewer.photos.isOpen(),
    bar: !!document.getElementById('keys'),
    layerTitle: document.querySelector('.layer-menu-toggle')?.title || '',
    pinsTitle: document.querySelector('.pins-switch button')?.title || '',
    fitTitle: document.querySelector('.locate-switch button')?.title || '',
    exportTitle: document.querySelector('.export-switch button')?.title || '',
    infoLive: document.getElementById('info')?.getAttribute('aria-live') || '',
    summaryKeys: document.querySelectorAll('#info .keys').length,
  }));

  const press = async (key) => {
    await page.keyboard.press(key);
    await waitForLayout(page);
  };

  await page.goto(`${base}/viewer/index.html`);
  await page.evaluate(() => {
    localStorage.removeItem('trailviewer.pins');
    localStorage.removeItem('trailviewer.layer');
  });
  await open('kml-photos.kml');

  // 1. There is no key bar any more: each key is named on the tooltip of the button it stands for, so the
  //    place that shows the map is not also a cheat sheet for it.
  let s = await state();
  check('the key bar is gone', s.bar === false);
  check('the background buttons name Q and E', /Q\s*\/\s*E/.test(s.layerTitle), s.layerTitle);
  check('the marker button names W', /\(W\)/.test(s.pinsTitle), s.pinsTitle);
  check('the fit button names C', /\(C\)/.test(s.fitTitle), s.fitTitle);
  check('and the export button names X', /\(X\)/.test(s.exportTitle), s.exportTitle);
  check('the summary does not carry them either', s.summaryKeys === 0, `${s.summaryKeys}`);
  check('the summary announces changes politely', s.infoLive === 'polite', s.infoLive);
  check('the background starts on the road source', s.layer === 'road.osm' && s.layerCategory === 'road', s.layer);
  check('the active background exposes its pressed state', s.activePressed === 'true', s.activePressed);

  // Buttons are now reachable with Tab. Space must still belong to QuickLook, while Enter activates the focused
  // control normally.
  await page.locator('.pins-switch button').focus();
  await page.keyboard.press('Space');
  await waitForLayout(page);
  s = await state();
  check('Space does not activate a focused viewer button', s.pinsVisible === true);
  await page.keyboard.press('Enter');
  await waitForLayout(page);
  s = await state();
  check('Enter activates the focused viewer button', s.pinsVisible === false);
  await page.keyboard.press('Enter');
  await waitForLayout(page);

  // 2. W is the marker switch: the same hide/show the button does, with the same state.
  await press('w');
  s = await state();
  check('W hides the markers', s.pins === 0 && s.pinsVisible === false, `${s.pins}/${s.pinsVisible}`);
  check('and the button follows', s.pinsActive === false);
  check('and its pressed state follows', s.pinsPressed === 'false', s.pinsPressed);
  check('the markers are still loaded for the keyboard', s.marks === 8, `${s.marks}`);

  await press('w');
  s = await state();
  check('W brings them back', s.pins === 5 && s.pinsVisible === true && s.pinsActive === true, `${s.pins}`);

  // 3. E walks the bar forwards and wraps; Q walks it backwards.
  const order = [
    ['e', 'terrain.cyclosm', 'terrain'],
    ['e', 'satellite.esri', 'satellite'],
    ['e', 'none', 'none'],
    ['e', 'road.osm', 'road'],
    ['q', 'none', 'none'],
    ['q', 'satellite.esri', 'satellite'],
  ];
  for (const [key, want, category] of order) {
    await press(key);
    s = await state();
    check(`${key} -> ${want}`, s.layer === want && s.layerCategory === category && s.activeLayer === category,
      `${s.layer}/${s.layerCategory}/${s.activeLayer}`);
  }

  // 4. A photo covers the map: the three keys stand down until it is closed.
  await page.locator('.gpx-pin[title="Album"]').click();
  await page.locator('.photo-popup .photo-thumb').first().click();
  await waitForPhoto(page);
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
    window.trailViewer.pressKey('w');
    window.trailViewer.pressKey('e');
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
  await waitForLayout(page);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', repeat: true, bubbles: true, cancelable: true }));
    }
  });
  await waitForLayout(page);
  s = await state();
  check('a held key is ignored', s.pinsVisible === false, `${s.pinsVisible}`);
  // A modifier belongs to the host: Ctrl+W must not be read as ours.
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await waitForLayout(page);
  s = await state();
  check('Ctrl+W is not ours', s.pinsVisible === false, `${s.pinsVisible}`);
  await page.locator('.pins-switch button').click();
  await waitForLayout(page);

  // 6. A pure track has no waypoints but does have dots: W still clears them.
  await page.evaluate(() => localStorage.removeItem('trailviewer.pins'));
  await open('gpx10.gpx');
  s = await state();
  check('a pure track gets the switch', s.hasControl === true && s.marks === 30, `${s.marks}`);
  await press('w');
  s = await state();
  check('W hides the dots of a pure track', s.pinsVisible === false, `${s.pinsVisible}`);
  check('and keeps the line', (await page.locator('.gpx-track').count()) === 1);
  await press('w');

  // 7. When the host catches the key itself it calls pressKey: it has to mean exactly the same thing.
  const startLayer = (await state()).layer;
  await page.evaluate(() => window.trailViewer.pressKey('e'));
  await waitForLayout(page);
  s = await state();
  check('pressKey steps the background like the key does', s.layer !== startLayer, s.layer);
  await page.evaluate(() => window.trailViewer.pressKey('q'));
  await waitForLayout(page);
  s = await state();
  check('and steps back', s.layer === startLayer, s.layer);
  const startPins = s.pinsVisible;
  await page.evaluate(() => window.trailViewer.pressKey('w'));
  await waitForLayout(page);
  s = await state();
  check('pressKey flips the markers like the key does', s.pinsVisible === !startPins, `${s.pinsVisible}`);
  await page.evaluate(() => window.trailViewer.pressKey('w'));

  // 8. A file that draws nothing but an area has no switch: the key is quiet, not an error.
  await open('kml-polygon-only.kml');
  s = await state();
  check('an area-only file has no marker switch', s.hasControl === false, `${s.hasControl}`);
  await press('w');
  check('W on such a file does not throw', pageErrors.length === 0, pageErrors.join('; '));
  check('and changes nothing', (await state()).hasControl === false);
  // Q and E still work there: the background does not depend on the file's contents.
  const layerOrder = ['road.osm', 'terrain.cyclosm', 'satellite.esri', 'none'];
  const next = layerOrder[(layerOrder.indexOf(s.layer) + 1) % layerOrder.length];
  await press('e');
  s = await state();
  check('the background keys still work on an area-only file', s.layer === next, `${s.layer}, wanted ${next}`);

  // 9. The tooltips follow the interface language.
  await page.locator('.lang-switch button').click();
  await waitForLayout(page);
  s = await state();
  check('the tooltips speak Chinese', /切换/.test(s.layerTitle) && /（C）/.test(s.fitTitle),
    `${s.layerTitle} | ${s.fitTitle}`);
  await page.locator('.lang-switch button').click();
  await waitForLayout(page);

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
      info: shown('#info'), profile: shown('#profile'),
      zoom: shown('.leaflet-control-zoom'), layers: shown('.layer-switch'),
      pins: shown('.pins-switch'), lang: shown('.lang-switch'),
      scale: shown('.leaflet-control-scale'), credit: shown('.leaflet-control-attribution'),
      map: shown('#map'),
      markers: document.querySelectorAll('.gpx-pin').length,
      toast: toast.hidden === false, toastText: toast.textContent,
    };
  });

  await open('kml-photos.kml');
  let c = await chrome();
  check('everything is on the map to begin with',
    c.info && c.profile && c.zoom && c.layers && c.pins && c.lang, JSON.stringify(c));

  await press('s');
  c = await chrome();
  check('S takes the summary away', c.info === false);
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
    c.info && c.profile && c.zoom && c.layers && c.pins && c.lang, JSON.stringify(c));
  check('and the class is gone', c.hidden === false);

  // The host sends the same key through pressKey when QuickLook is holding the keyboard.
  await page.evaluate(() => window.trailViewer.pressKey('s'));
  await waitForLayout(page);
  check('pressKey clears the interface like the key does', (await chrome()).info === false);
  await page.evaluate(() => window.trailViewer.pressKey('s'));
  await waitForLayout(page);

  // A photo card over the map does not take the key away -- W, Q and E keep working through it. The full-screen
  // viewer does: the map is behind it, and a change nobody can see is a change nobody asked for.
  await page.locator('.gpx-pin[title="Album"]').click();
  await page.waitForSelector('.photo-popup .photo-thumb');
  await press('s');
  check('the key works through a photo card', (await chrome()).hidden === true);
  await page.locator('.photo-popup .photo-thumb').nth(0).click();
  await waitForPhoto(page);
  await press('s');
  check('but not while the viewer is full screen', (await chrome()).hidden === true);

  // A fresh file opens with the interface on, whatever the last one did. (Reloading the page is also how the
  // photo viewer is dismissed here; it has its own test.)
  await open('kml-photos.kml');
  check('the next file starts with its interface on', (await chrome()).info === true);

  // 11. The background chosen by a key is remembered, the same way a click is.
  await open('kml-photos.kml');
  await press('e');
  const chosenLayer = (await state()).layer;
  await open('kml-photos.kml');
  s = await state();
  check('a background chosen with E survives a reload',
    s.layer === chosenLayer && s.layerCategory === s.activeLayer, `${chosenLayer} -> ${s.layer}/${s.activeLayer}`);

  if (shot) {
    await open('kml-photos.kml');
    await waitForLayout(page);
    await page.screenshot({ path: shot });
  }

  check('no page errors', pageErrors.length === 0, pageErrors.join('; '));

  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  process.exit(finish());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
