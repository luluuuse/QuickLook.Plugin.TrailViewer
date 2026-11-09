// Test for keyboard navigation: arrows and A/D walk the waypoint markers, each selection showing its card on
// the map, and the same keys keep walking photos while the full-size viewer is open.
//
//   NODE_PATH=<folder containing playwright-core> node tests/nav-test.cjs [screenshot.png]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
const fs = require('fs');
const path = require('path');
const {
  launchBrowser,
  settlePopup,
  waitForLayout,
  waitForPhoto,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const fixture = 'kml-photos.kml';
const { check, failures } = createChecker('nav');
const artifacts = createArtifacts('nav');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  // Pinned to en-US: the assertions below read English labels, and the viewer follows the system language.
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const cspViolations = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text());
  });

  const remote = fs.readFileSync(path.join(root, 'tests/fixtures/photo2.png'));
  await page.route('https://example.test/**', (route) => route.fulfill({ body: remote, contentType: 'image/png' }));

  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));

  const state = async () => page.evaluate(() => ({
    index: window.gpxViewer.nav.index(),
    stops: window.gpxViewer.nav.stops().length,
    photoStops: window.gpxViewer.nav.photoStops().length,
    selected: document.querySelector('.gpx-pin.selected')?.getAttribute('title') || '',
    card: document.querySelector('.leaflet-popup-content')?.textContent || '',
    thumbs: document.querySelectorAll('.photo-popup .photo-thumb').length,
    viewing: window.gpxViewer.photos.isOpen(),
    caption: document.querySelector('.photo-titles strong')?.textContent || '',
    counter: document.querySelector('.photo-counter')?.hidden === false
      ? document.querySelector('.photo-counter').textContent : '',
    src: (document.querySelector('.photo-image')?.getAttribute('src') || '').split('/').pop(),
  }));

  // Wait for the popup transition where it applies. Presses inside the full-size viewer leave the map card
  // closed, so those wait for the next image instead of assuming that every key opens a Leaflet popup.
  const press = async (key) => {
    await page.keyboard.press(key);
    if (await page.evaluate(() => window.gpxViewer.photos.isOpen())) await waitForLayout(page);
    else await settlePopup(page, '.leaflet-popup', 1);
  };

  check('five markers and three of them with photos',
    (await page.evaluate(() => [window.gpxViewer.nav.stops().length, window.gpxViewer.nav.photoStops().length]))
      .join('/') === '5/3');

  // 1. Nothing selected until a key is pressed; the key grabs the first marker, not the second.
  let s = await state();
  check('nothing is selected at load', s.index === -1 && s.selected === '', `${s.index} ${s.selected}`);

  await press('ArrowRight');
  await page.waitForSelector('.leaflet-popup-content');
  s = await state();
  check('right arrow selects the first marker', s.index === 0 && s.selected === 'Remote', `${s.index} ${s.selected}`);
  check('the first marker card is open', s.card.includes('Remote') && s.card.includes('Standing on the bridge'), s.card);
  check('the card shows the photo thumbnail', s.thumbs === 1, `${s.thumbs}`);
  check('the arrow does not open the full viewer', s.viewing === false);

  // 2. Stepping forward and back through the markers.
  await press('ArrowRight');
  s = await state();
  check('right arrow moves to the second marker', s.index === 1 && s.selected === 'Album', `${s.index} ${s.selected}`);
  check('the second marker card carries its album', s.thumbs === 2, `${s.thumbs}`);
  check('only one marker is selected', (await page.locator('.gpx-pin.selected').count()) === 1);

  await press('d');
  s = await state();
  check('D steps forward like the right arrow', s.index === 2 && s.selected === 'Inline', `${s.index} ${s.selected}`);

  await press('a');
  s = await state();
  check('A steps back like the left arrow', s.index === 1 && s.selected === 'Album', `${s.index} ${s.selected}`);

  await press('A');
  s = await state();
  check('capital A works too', s.index === 0 && s.selected === 'Remote', `${s.index} ${s.selected}`);

  // 3. Wrapping around at both ends.
  await press('ArrowLeft');
  s = await state();
  check('left arrow wraps to the last marker', s.index === 4 && s.selected === 'Plain', `${s.index} ${s.selected}`);
  check('a pin without photos still shows its own card', s.card.includes('Plain') && s.thumbs === 0, `${s.card} / ${s.thumbs}`);

  await press('ArrowRight');
  s = await state();
  check('right arrow wraps to the first marker', s.index === 0 && s.selected === 'Remote', `${s.index} ${s.selected}`);

  // 4. The keys work while the full-size photo is open, and follow the markers' photos.
  await page.locator('.photo-popup .photo-thumb').nth(0).click();
  await waitForPhoto(page);
  s = await state();
  check('the viewer opens on the selected marker', s.viewing === true && s.caption === 'Remote', s.caption);
  check('a single photo has no counter', s.counter === '', s.counter);

  // Remote has one photo, so the next press continues with the next pin rather than staying put.
  await press('ArrowRight');
  await waitForPhoto(page);
  s = await state();
  check('right arrow moves to the next pin', s.viewing === true && s.caption === 'Album', `${s.caption} ${s.src}`);
  check('the viewer starts at that pin\'s first photo', s.counter === '1 / 2', s.counter);
  check('the map selection follows the viewer', s.selected === 'Album', s.selected);

  // Inside an album the key moves one photo first.
  await press('D');
  await waitForPhoto(page);
  s = await state();
  check('inside an album the key steps one photo', s.caption === 'Album' && s.counter === '2 / 2', `${s.caption} ${s.counter}`);
  check('the second photo is on screen', s.src === 'photo2.png', s.src);

  await press('ArrowRight');
  await waitForPhoto(page);
  s = await state();
  check('past the last photo the next pin follows', s.caption === 'Inline' && s.viewing === true, s.caption);

  await press('ArrowRight');
  await waitForPhoto(page);
  s = await state();
  check('the last photo pin wraps to the first', s.caption === 'Remote', s.caption);

  // 5. Going back lands on the previous pin's last photo, not its first.
  await press('ArrowLeft');
  await waitForPhoto(page);
  s = await state();
  check('left arrow goes back to the previous pin', s.caption === 'Inline', s.caption);

  await press('ArrowLeft');
  await waitForPhoto(page);
  s = await state();
  check('back into an album starts at its last photo', s.caption === 'Album' && s.counter === '2 / 2',
    `${s.caption} ${s.counter}`);

  // 6. Closing the viewer returns the keys to the map, on the marker the viewer left behind.
  await page.locator('.photo-close').click();
  s = await state();
  check('closing the viewer keeps the map selection', s.index === 1 && s.selected === 'Album', `${s.index} ${s.selected}`);

  await press('ArrowRight');
  s = await state();
  check('the keys drive the map again after closing', s.index === 2 && s.viewing === false, `${s.index}`);

  // 7. Modifier keys are not navigation: Ctrl+arrow belongs to the host application.
  await press('Control+ArrowRight');
  s = await state();
  check('ctrl+arrow is ignored', s.index === 2, `${s.index}`);

  // 8. A click does what a key press does. The card has to survive the click: it is opened by Leaflet's own
  // handler on the marker, and the plugin's handler runs before it, so an extra openPopup from the plugin
  // loses the race and is toggled shut again (which is exactly how the click appeared to do nothing).
  if (await page.locator('.leaflet-popup-close-button').count()) {
    await page.locator('.leaflet-popup-close-button').click();
    await settlePopup(page, '.leaflet-popup', 0);
  }

  await page.locator('.gpx-pin[title="Remote"]').click();
  await settlePopup(page, '.leaflet-popup', 1);
  s = await state();
  check('a click selects the marker', s.index === 0 && s.selected === 'Remote', `${s.index} ${s.selected}`);
  check('the click opens the card', s.card.includes('Standing on the bridge'), s.card);
  check('the card stays open after the click', (await page.locator('.leaflet-popup').count()) === 1);
  check('the clicked card shows its thumbnail', s.thumbs === 1, `${s.thumbs}`);

  await page.locator('.photo-popup .photo-thumb').nth(0).click();
  await waitForPhoto(page);
  s = await state();
  check('a thumbnail in the clicked card opens the photo', s.viewing === true && s.caption === 'Remote', s.caption);
  await page.locator('.photo-close').click();

  await page.locator('.gpx-pin[title="Album"]').click();
  await settlePopup(page, '.leaflet-popup', 1);
  s = await state();
  check('clicking another pin moves the selection', s.index === 1 && s.selected === 'Album', `${s.index} ${s.selected}`);
  check('only one card is open at a time', (await page.locator('.leaflet-popup').count()) === 1);

  await page.locator('.gpx-pin[title="Album"]').click();
  await settlePopup(page, '.leaflet-popup', 0);
  check('a second click on the same pin closes the card', (await page.locator('.leaflet-popup').count()) === 0);
  check('closing the card leaves the selection alone', (await state()).selected === 'Album');

  await press('ArrowRight');
  s = await state();
  check('the keys carry on from the clicked marker', s.index === 2 && s.selected === 'Inline', `${s.index} ${s.selected}`);

  if (shot) {
    await waitForLayout(page);
    await page.screenshot({ path: shot });
  }

  check('no page errors', pageErrors.length === 0, pageErrors.join('; '));
  check('no CSP violations', cspViolations.length === 0, cspViolations.join('; ').slice(0, 300));

  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} failed: ${failures.join(', ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
