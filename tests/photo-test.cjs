// Test for waypoint photos: a pin whose placemark carries an <img> opens a small preview card first, and a
// click on a thumbnail in that card opens the full-size viewer. The links are resolved (absolute, relative
// to the document, data URI), and anything with an unusable scheme is dropped.
//
//   NODE_PATH=<folder containing playwright-core> node tests/photo-test.cjs [screenshot.png]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
// Remote photos are intercepted, so this runs offline.
const path = require('path');
const {
  launchBrowser,
  settlePopup,
  waitForFocus,
  waitForLayout,
  waitForPhoto,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const fixture = 'kml-photos.kml';
const { check, failures } = createChecker('photo');
const artifacts = createArtifacts('photo');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  // Pinned to en-US: the assertions below read English labels, and the viewer follows the system language.
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await page.addInitScript(() => localStorage.setItem('trailviewer.infoDetails', 'full'));
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const cspViolations = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text());
  });

  // The remote photo in the fixture never leaves the machine. A large logical canvas makes native-pixel zoom
  // percentages observable while the viewer fits it into the window.
  const remote = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="3000">'
    + '<rect width="2000" height="3000" fill="#345"/></svg>',
  );
  await page.route('https://example.test/**', (route) => route.fulfill({ body: remote, contentType: 'image/svg+xml' }));

  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));

  // 1. The model keeps the image links and throws away the unusable ones.
  const model = await page.evaluate(() => window.trailViewer.gpx.waypoints.map((w) => ({
    name: w.name || '', images: w.images || [], description: w.description || '',
  })));
  const byName = Object.fromEntries(model.map((w) => [w.name, w.images.length]));
  check('waypoints parsed', model.length === 5, model.map((w) => `${w.name}:${w.images.length}`).join(', '));
  check('one remote photo', byName.Remote === 1);
  check('album keeps both photos', byName.Album === 2);
  check('data URI photo kept', byName.Inline === 1);
  check('javascript: and file: dropped', byName['Bad scheme'] === 0);
  check('pin without a description has no photo', byName.Plain === 0);

  // 2. Only the pins that can be opened advertise it.
  const badges = await page.locator('.gpx-pin.has-photo').count();
  check('three pins carry the photo badge', badges === 3, `${badges} badges`);

  // Helpers: a pin click opens the card; a thumbnail click opens the viewer.
  const openCard = async (name) => {
    await page.locator(`.gpx-pin[title="${name}"]`).click();
    await page.waitForFunction(() => {
      const img = document.querySelector('.photo-popup .photo-thumb img');
      return img && img.complete && img.naturalWidth > 0;
    });
    // The click must leave the card open. Waiting for the popup transition distinguishes an open card from
    // one that Leaflet has already started fading out.
    await settlePopup(page, '.photo-popup', 1);
    const open = await page.locator('.photo-popup').count();
    check(`the card for "${name}" stays open after the click`, open === 1, `${open} cards`);
  };
  const openFromCard = async (index) => {
    await page.locator('.photo-popup .photo-thumb').nth(index).click();
    await waitForPhoto(page);
    await waitForFocus(page, '.photo-close');
  };
  const viewer = async () => page.evaluate(() => ({
    open: window.trailViewer.photos.isOpen(),
    src: document.querySelector('.photo-image')?.getAttribute('src') || '',
    caption: document.querySelector('.photo-titles strong')?.textContent || '',
    meta: document.querySelector('.photo-meta')?.textContent || '',
    counterHidden: document.querySelector('.photo-counter')?.hidden,
    counter: document.querySelector('.photo-counter')?.textContent || '',
    arrows: document.querySelectorAll('.photo-arrow:not([hidden])').length,
    zoomHidden: document.querySelector('.photo-zoom')?.hidden,
    zoom: document.querySelector('.photo-zoom')?.textContent || '',
    zoomTitle: document.querySelector('.photo-zoom')?.title || '',
    transform: document.querySelector('.photo-image')?.style.transform || '',
    naturalWidth: document.querySelector('.photo-image')?.naturalWidth || 0,
    displayWidth: document.querySelector('.photo-image')?.getBoundingClientRect().width || 0,
  }));
  const waitForImageMotion = async () => {
    await page.waitForFunction(() => document.querySelector('.photo-image')
      ?.getAnimations().every((animation) => animation.playState !== 'running'));
  };
  const wheelPhoto = async (deltaY, expected = null) => {
    const before = await page.locator('.photo-zoom').textContent();
    const stage = await page.locator('.photo-stage').boundingBox();
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.wheel(0, deltaY);
    await page.waitForFunction(
      ({ previous, wanted }) => {
        const text = document.querySelector('.photo-zoom')?.textContent;
        return wanted === null ? text !== previous : text === wanted;
      },
      { previous: before, wanted: expected },
    );
    await waitForImageMotion();
  };

  // 3. The pin opens a card: details, one thumbnail, no full-size image yet.
  await openCard('Remote');
  let card = await page.evaluate(() => ({
    text: document.querySelector('.photo-popup .leaflet-popup-content').textContent,
    thumbs: document.querySelectorAll('.photo-popup .photo-thumb').length,
    single: document.querySelector('.photo-popup .photo-thumbs')?.classList.contains('single'),
    hint: document.querySelector('.photo-popup .photo-hint')?.textContent || '',
    thumbSrc: document.querySelector('.photo-popup .photo-thumb img')?.getAttribute('src') || '',
    thumbLoaded: (document.querySelector('.photo-popup .photo-thumb img')?.naturalWidth || 0) > 0,
    viewerOpen: window.trailViewer.photos.isOpen(),
    bigLoaded: Boolean(document.querySelector('.photo-image')?.getAttribute('src')),
  }));
  check('card opens instead of the full viewer', card.viewerOpen === false);
  check('card shows the placemark name', card.text.includes('Remote'), card.text);
  check('card shows the description text', card.text.includes('Standing on the bridge'), card.text);
  check('card shows coordinates', /\d+\.\d{6}, \d+\.\d{6}/.test(card.text), card.text);
  check('card holds one thumbnail', card.thumbs === 1, `${card.thumbs}`);
  check('single thumbnail grows to fill the card', card.single === true);
  check('thumbnail points at the resolved photo', card.thumbSrc === 'https://example.test/remote.jpg?w=800&h=600', card.thumbSrc);
  check('thumbnail actually loads', card.thumbLoaded === true);
  check('card says the photo can be enlarged', /full size/.test(card.hint), card.hint);
  check('no full-size image before the second click', card.bigLoaded === false);

  // 4. The thumbnail opens the original, and the card gets out of the way.
  await openFromCard(0);
  let state = await viewer();
  check('thumbnail opens the viewer', state.open === true);
  check('absolute URL kept as is', state.src === 'https://example.test/remote.jpg?w=800&h=600', state.src);
  check('caption is the placemark name', state.caption === 'Remote', state.caption);
  check('meta shows coordinates', /\d+\.\d{6}, \d+\.\d{6}/.test(state.meta), state.meta);
  check('meta shows the description text', state.meta.includes('Standing on the bridge'), state.meta);
  check('single photo hides the counter', state.counterHidden === true);
  const initialPercent = Number.parseInt(state.zoom, 10);
  const initialDisplayedPercent = Math.round(state.displayWidth / state.naturalWidth * 100);
  check('the fitted viewer reports its true source-pixel percentage',
    state.zoomHidden === false && initialPercent === initialDisplayedPercent && initialPercent < 100,
    `${state.zoom} vs ${initialDisplayedPercent}% of ${state.naturalWidth}px`);
  check('the zoom badge explains the mouse-wheel gesture',
    /of original size/.test(state.zoomTitle) && /fit the window/.test(state.zoomTitle), state.zoomTitle);
  check('opening the photo moves focus to its close button',
    await page.evaluate(() => document.activeElement?.classList.contains('photo-close')) === true);
  await page.keyboard.press('Tab');
  check('Tab reaches the percentage reset control',
    await page.evaluate(() => document.activeElement?.classList.contains('photo-zoom')) === true);
  await page.keyboard.press('Tab');
  check('a single-photo dialog traps Tab between zoom and close',
    await page.evaluate(() => document.activeElement?.classList.contains('photo-close')) === true);

  await page.setViewportSize({ width: 1200, height: 1400 });
  await page.waitForFunction((before) =>
    Number.parseInt(document.querySelector('.photo-zoom')?.textContent, 10) > before, initialPercent);
  state = await viewer();
  const resizedPercent = Number.parseInt(state.zoom, 10);
  check('fit mode updates the percentage when the window gets larger',
    resizedPercent > initialPercent && resizedPercent
      === Math.round(state.displayWidth / state.naturalWidth * 100),
    `${initialPercent}% -> ${state.zoom}`);

  await wheelPhoto(-100);
  state = await viewer();
  const manualPercent = Number.parseInt(state.zoom, 10);
  check('wheel zoom moves to an absolute source-pixel level',
    manualPercent > resizedPercent
      && Math.round(state.displayWidth / state.naturalWidth * 100) === manualPercent,
    `${state.zoom} ${state.displayWidth}/${state.naturalWidth}`);
  const rendering = await page.evaluate(() => {
    const image = document.querySelector('.photo-image');
    return {
      width: image.style.width,
      transform: image.style.transform,
      willChange: getComputedStyle(image).willChange,
    };
  });
  check('zoomed images use layout pixels rather than a scaled compositor layer',
    parseFloat(rendering.width) > 0 && !rendering.transform.includes('scale')
      && rendering.willChange === 'auto',
    JSON.stringify(rendering));
  const beforeDrag = state.transform;
  const stageBox = await page.locator('.photo-stage').boundingBox();
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + stageBox.width / 2 + 36, stageBox.y + stageBox.height / 2 + 28);
  await page.mouse.up();
  state = await viewer();
  check('a source-pixel zoom can be panned by dragging the photo',
    /translate\(-?\d/.test(state.transform) && state.transform !== beforeDrag,
    `${beforeDrag} -> ${state.transform}`);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForFunction((wanted) => {
    const image = document.querySelector('.photo-image');
    return image && Math.round(image.getBoundingClientRect().width / image.naturalWidth * 100) === wanted;
  }, manualPercent);
  await waitForImageMotion();
  state = await viewer();
  check('manual zoom keeps its source-pixel percentage after a resize',
    Number.parseInt(state.zoom, 10) === manualPercent
      && Math.round(state.displayWidth / state.naturalWidth * 100) === manualPercent,
    `${manualPercent}% -> ${state.zoom}; ${state.displayWidth}/${state.naturalWidth}`);
  await page.locator('.photo-zoom').click();
  await waitForImageMotion();
  state = await viewer();
  check('clicking the percentage returns to fit and reports the fitted percentage',
    Number.parseInt(state.zoom, 10) === initialPercent && state.transform === '',
    `${state.zoom} ${state.transform}`);
  await settlePopup(page, '.leaflet-popup', 0);
  const cardLeft = await page.locator('.photo-popup').isVisible().catch(() => false);
  check('the card is closed behind the viewer', cardLeft === false);

  // 5. Closing works with the close button, and the map keeps working afterwards.
  await page.locator('.photo-close').click();
  check('close button hides the viewer', (await page.evaluate(() => window.trailViewer.photos.isOpen())) === false);

  // 6. A relative path resolves against the document it came from; a card of two shows two thumbnails.
  await openCard('Album');
  card = await page.evaluate(() => ({
    thumbs: document.querySelectorAll('.photo-popup .photo-thumb').length,
    first: document.querySelector('.photo-popup .photo-thumb img')?.getAttribute('src') || '',
    hint: document.querySelector('.photo-popup .photo-hint')?.textContent || '',
  }));
  check('two thumbnails in the card', card.thumbs === 2, `${card.thumbs}`);
  check('relative path resolves next to the document', /\/tests\/fixtures\/photo\.png$/.test(card.first), card.first);
  check('card counts the album', /2 photos/.test(card.hint), card.hint);

  // 7. A thumbnail in the middle of an album opens that photo, not the first one.
  await openFromCard(1);
  state = await viewer();
  check('second thumbnail opens the second photo', /photo2\.png$/.test(state.src), state.src);
  check('counter starts at the clicked photo', state.counter === '2 / 2', state.counter);
  check('two arrows appear', state.arrows === 2, `${state.arrows}`);
  await wheelPhoto(-100, '125%');
  state = await viewer();
  check('one wheel notch zooms the photo in',
    state.zoom === '125%' && Math.round(state.displayWidth / state.naturalWidth * 100) === 125,
    `${state.zoom} ${state.displayWidth}/${state.naturalWidth}`);
  await wheelPhoto(-100, '150%');
  state = await viewer();
  check('further wheel input reaches the next zoom level',
    state.zoom === '150%' && Math.round(state.displayWidth / state.naturalWidth * 100) === 150,
    `${state.zoom} ${state.displayWidth}/${state.naturalWidth}`);
  await wheelPhoto(100, '125%');
  await wheelPhoto(100, '100%');
  await wheelPhoto(100, '100%');
  state = await viewer();
  check('wheel zoom stops at the fitted 100% size', state.zoom === '100%' && state.transform === '',
    `${state.zoom} ${state.transform}`);
  await wheelPhoto(-100, '125%');
  await page.keyboard.press('Shift+Tab');
  check('Shift+Tab reaches the percentage reset before the last dialog action',
    await page.evaluate(() => document.activeElement?.classList.contains('photo-zoom')) === true);
  await page.keyboard.press('Shift+Tab');
  check('Shift+Tab wraps to the last album action',
    await page.evaluate(() => document.activeElement?.classList.contains('next')) === true);
  await page.keyboard.press('Tab');
  check('Tab from the last action wraps to the percentage reset',
    await page.evaluate(() => document.activeElement?.classList.contains('photo-zoom')) === true);

  // 8. Stepping through the album and wrapping around.
  await page.locator('.photo-arrow.next').click();
  await page.waitForFunction(() => document.querySelector('.photo-image')?.naturalWidth > 0);
  state = await viewer();
  check('next wraps to the first photo', /photo\.png$/.test(state.src), state.src);
  check('counter follows', state.counter === '1 / 2', state.counter);
  check('changing photos resets zoom to 100%', state.zoom === '100%' && state.transform === '',
    `${state.zoom} ${state.transform}`);

  // 9. Clicking the original neither closes nor steps: it is what the user asked to look at.
  await page.locator('.photo-image').click();
  state = await viewer();
  check('clicking the original keeps the viewer open', state.open === true);
  check('clicking the original does not step', state.counter === '1 / 2', state.counter);

  // 10. Clicking the backdrop closes.
  await page.mouse.click(20, 780);
  check('backdrop click closes', (await page.evaluate(() => window.trailViewer.photos.isOpen())) === false);
  check('closing restores focus to the map',
    await page.evaluate(() => document.activeElement?.id) === 'map');

  // 11. An inline data URI loads without any network.
  await openCard('Inline');
  await openFromCard(0);
  check('data URI renders',
    (await page.evaluate(() => document.querySelector('.photo-image').getAttribute('src'))).startsWith('data:image/png;base64,'));
  await page.locator('.photo-close').click();
  check('close button also closes a single data URI photo',
    (await page.evaluate(() => window.trailViewer.photos.isOpen())) === false);

  // 12. Pins without photos keep the old popup and get no thumbnails.
  await page.locator('.gpx-pin[title="Plain"]').click();
  await page.waitForSelector('.leaflet-popup-content');
  const popup = await page.evaluate(() => ({
    text: document.querySelector('.leaflet-popup-content').textContent,
    thumbs: document.querySelectorAll('.photo-thumb').length,
    open: window.trailViewer.photos.isOpen(),
  }));
  check('plain pin opens the usual popup', popup.text.includes('Plain'), popup.text);
  check('plain pin has no thumbnails', popup.thumbs === 0, `${popup.thumbs}`);
  check('plain pin does not open the photo viewer', popup.open === false);

  // 13. The info panel counts what can be clicked.
  const info = await page.evaluate(() => document.getElementById('info').textContent);
  check('info box lists the photos', /Photos\s*4 photos on 3 pins/.test(info), info.replace(/\s+/g, ' ').slice(0, 160));

  if (shot) {
    await openCard('Album');
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
