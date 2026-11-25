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
  waitForMapIdle,
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

  // Helpers: a pin click opens the card; the hero photo opens the viewer.
  const openCard = async (name) => {
    await page.locator(`.gpx-pin[title="${name}"]`).click();
    await page.waitForFunction(() => {
      const img = document.querySelector('.photo-popup .photo-frame img');
      return img && img.complete && img.naturalWidth > 0;
    });
    // The click must leave the card open. Waiting for the popup transition distinguishes an open card from
    // one that Leaflet has already started fading out.
    await settlePopup(page, '.photo-popup', 1);
    await waitForMapIdle(page);
    const open = await page.locator('.photo-popup').count();
    check(`the card for "${name}" stays open after the click`, open === 1, `${open} cards`);
  };
  const openFromCard = async () => {
    await page.locator('.photo-popup .photo-frame').click();
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
  let card = await page.evaluate(() => {
    const hero = document.querySelector('.photo-popup .photo-frame');
    const cardBox = document.querySelector('.photo-popup .leaflet-popup-content-wrapper')
      .getBoundingClientRect();
    return {
      text: document.querySelector('.photo-popup .leaflet-popup-content').textContent,
      title: document.querySelector('.photo-popup .photo-card-title')?.textContent || '',
      metas: [...document.querySelectorAll('.photo-popup .photo-card-meta')].map((n) => n.textContent),
      heroSrc: document.querySelector('.photo-popup .photo-frame img')?.getAttribute('src') || '',
      heroLoaded: (document.querySelector('.photo-popup .photo-frame img')?.naturalWidth || 0) > 0,
      heroBox: hero ? (() => { const r = hero.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() : null,
      cardWidth: Math.round(cardBox.width),
      actions: [...document.querySelectorAll('.photo-popup .photo-action')].map((button) => ({
        text: button.textContent,
        disabled: button.disabled,
        title: button.title,
      })),
      next: document.querySelector('.photo-popup .photo-next')
        ? {
          width: Math.round(document.querySelector('.photo-popup .photo-next').getBoundingClientRect().width),
          title: document.querySelector('.photo-popup .photo-next').title,
        }
        : null,
      position: document.querySelector('.photo-popup .photo-position')?.textContent || '',
      contentScroll: (() => {
        const node = document.querySelector('.photo-popup .leaflet-popup-content');
        return node ? node.scrollHeight > node.clientHeight + 1 : null;
      })(),
      inlineMaxHeight: document.querySelector('.photo-popup .leaflet-popup-content')?.style.maxHeight || '',
      background: getComputedStyle(document.querySelector('.photo-popup .leaflet-popup-content-wrapper'))
        .backgroundColor,
      tipBackground: getComputedStyle(document.querySelector('.photo-popup .leaflet-popup-tip'))
        .backgroundColor,
      viewerOpen: window.trailViewer.photos.isOpen(),
      bigLoaded: Boolean(document.querySelector('.photo-image')?.getAttribute('src')),
    };
  });
  check('card opens instead of the full viewer', card.viewerOpen === false);
  check('card shows the placemark name', card.title === 'Remote', card.title);
  // The whole card is the photo. Portrait 4:3 means height : width = 4 : 3, which is how a phone shoots upright.
  check('the photo fills the entire card in portrait 4:3',
    card.heroBox !== null && card.heroBox[0] === card.cardWidth
      && Math.abs(card.heroBox[1] / card.heroBox[0] - 4 / 3) < 0.02,
    JSON.stringify({ frame: card.heroBox, card: card.cardWidth }));
  check('the photo points at the resolved image',
    card.heroSrc === 'https://example.test/remote.jpg?w=800&h=600', card.heroSrc);
  check('the photo actually loads', card.heroLoaded === true);
  // Coordinates and the "open photo" button are deliberately gone: the photo is the button, and the coordinate
  // pair was the least useful line on a card anchored to a pin the reader just clicked.
  check('the card no longer prints coordinates',
    !card.metas.some((meta) => /\d+\.\d{6}, \d+\.\d{6}/.test(meta)), JSON.stringify(card.metas));
  check('the card no longer offers an open-photo button', card.actions.length === 0,
    JSON.stringify(card.actions));
  // This fixture's pin carries no timestamp, so the line holds only the elevation. The card must not invent one.
  check('the meta line carries what the pin actually has',
    card.metas.length === 1 && /25 m/.test(card.metas[0]), JSON.stringify(card.metas));
  check('next is a round arrow with a position counter',
    card.next !== null && card.next.width === 28 && /^1\/3$/.test(card.position || ''),
    JSON.stringify({ next: card.next, position: card.position }));
  check('no full-size image before the second click', card.bigLoaded === false);
  // A viewport-relative max-height used to clamp this card and cut its facts and next arrow off the bottom.
  check('the card is not clamped by a viewport height limit',
    card.contentScroll === false && card.inlineMaxHeight === '',
    JSON.stringify({ scroll: card.contentScroll, inline: card.inlineMaxHeight }));
  check('the attachment card matches the waypoint-list transparency',
    card.background === 'rgba(250, 248, 243, 0.92)'
      && card.tipBackground === 'rgba(250, 248, 243, 0.92)',
    `${card.background} / ${card.tipBackground}`);

  // 4. The thumbnail opens the original, and the card gets out of the way.
  const layoutBeforePhoto = await page.evaluate(() => window.trailViewer.mapLayout());
  await openFromCard();
  let state = await viewer();
  check('thumbnail opens the viewer', state.open === true);
  check('absolute URL kept as is', state.src === 'https://example.test/remote.jpg?w=800&h=600', state.src);
  check('caption is the placemark name', state.caption === 'Remote', state.caption);
  // The viewer keeps the full metadata line: time, coordinates, elevation and the description.
  check('the full-size viewer still shows the metadata line',
    /\d+\.\d{6}, \d+\.\d{6}/.test(state.meta) && /Standing on the bridge/.test(state.meta), state.meta);
  // The card is the photo now, so a long placemark description is left to the full-size viewer's meta line.
  check('the description stays out of the photo-only card',
    !card.text.includes('Standing on the bridge'), card.text);
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
  const layoutDuringPhoto = await page.evaluate(() => window.trailViewer.mapLayout());
  check('a full-size photo does not change the map layout',
    JSON.stringify(layoutDuringPhoto.safe) === JSON.stringify(layoutBeforePhoto.safe),
    JSON.stringify({ before: layoutBeforePhoto.safe, during: layoutDuringPhoto.safe }));
  const photoBackground = await page.evaluate(() => {
    const root = document.querySelector('.photo-viewer');
    const bar = document.querySelector('.photo-bar');
    const stage = document.querySelector('.photo-stage');
    const surface = [root, bar, stage].map((node) => {
      const style = getComputedStyle(node);
      return {
        background: style.backgroundColor,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter || 'none',
        filter: style.filter,
      };
    });
    return {
      surfaces: surface,
      mapBehind: Boolean(document.querySelector('#map .leaflet-map-pane')),
      chromeHidden: ['.info', '#info', '#profile', '#map .leaflet-top']
        .every((selector) => {
          const node = document.querySelector(selector);
          if (!node) return true;
          const style = getComputedStyle(node);
          return style.display === 'none' || style.visibility === 'hidden';
        }),
    };
  });
  check('non-photo areas keep the map visible through a semi-transparent surface',
    photoBackground.surfaces[0].background === 'rgba(11, 11, 12, 0.42)'
      && photoBackground.surfaces.slice(1).every((item) => item.background === 'rgba(0, 0, 0, 0)')
      && photoBackground.mapBehind && photoBackground.chromeHidden,
    JSON.stringify(photoBackground));
  check('the photo viewer adds no background blur or frosted filter',
    photoBackground.surfaces.every((item) => item.backdropFilter === 'none' && item.filter === 'none'),
    JSON.stringify(photoBackground));
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

  // 6. A relative path resolves against the document it came from; the frame keeps its shape for an album.
  await openCard('Album');
  card = await page.evaluate(() => ({
    first: document.querySelector('.photo-popup .photo-frame img')?.getAttribute('src') || '',
    position: document.querySelector('.photo-popup .photo-position')?.textContent || '',
    heroBox: (() => {
      const r = document.querySelector('.photo-popup .photo-frame').getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)];
    })(),
  }));
  check('relative path resolves next to the document', /\/tests\/fixtures\/photo\.png$/.test(card.first), card.first);
  check('the frame keeps its portrait 4:3 shape for an album',
    Math.abs(card.heroBox[1] / card.heroBox[0] - 4 / 3) < 0.02, JSON.stringify(card.heroBox));
  check('the position counter follows the pin', /^2\/3$/.test(card.position), card.position);

  // 7. The album opens at its first photo; the arrows walk the rest.
  await openFromCard();
  state = await viewer();
  check('the hero opens the first photo', /photo\.png$/.test(state.src), state.src);
  check('counter starts at the first photo', state.counter === '1 / 2', state.counter);
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
  await page.waitForFunction(() => {
    const image = document.querySelector('.photo-image');
    const zoom = document.querySelector('.photo-zoom');
    return image?.naturalWidth > 0 && zoom && !zoom.hidden && zoom.textContent === '100%';
  });
  state = await viewer();
  check('next advances to the second photo', /photo2\.png$/.test(state.src), state.src);
  check('counter follows', state.counter === '2 / 2', state.counter);
  check('changing photos resets zoom to 100%', state.zoom === '100%' && state.transform === '',
    `${state.zoom} ${state.transform}`);

  // 9. Clicking the original neither closes nor steps: it is what the user asked to look at.
  await page.locator('.photo-image').click();
  state = await viewer();
  check('clicking the original keeps the viewer open', state.open === true);
  check('clicking the original does not step', state.counter === '2 / 2', state.counter);

  // 10. Clicking the backdrop closes.
  const mapBeforeBackdropClose = await page.evaluate(() => {
    const center = window.trailViewer.map.getCenter();
    return { lat: center.lat, lng: center.lng, zoom: window.trailViewer.map.getZoom() };
  });
  await page.mouse.click(20, 780);
  check('backdrop click closes', (await page.evaluate(() => window.trailViewer.photos.isOpen())) === false);
  check('closing restores focus to the map',
    await page.evaluate(() => document.activeElement?.id) === 'map');
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const mapAfterBackdropClose = await page.evaluate(() => {
    const center = window.trailViewer.map.getCenter();
    return { lat: center.lat, lng: center.lng, zoom: window.trailViewer.map.getZoom() };
  });
  check('closing a photo leaves the map where it was',
    Math.abs(mapAfterBackdropClose.lat - mapBeforeBackdropClose.lat) < 0.000001
      && Math.abs(mapAfterBackdropClose.lng - mapBeforeBackdropClose.lng) < 0.000001
      && mapAfterBackdropClose.zoom === mapBeforeBackdropClose.zoom,
    JSON.stringify({ before: mapBeforeBackdropClose, after: mapAfterBackdropClose }));

  // 11. An inline data URI loads without any network.
  await openCard('Inline');
  await openFromCard();
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
    heroes: document.querySelectorAll('.photo-frame').length,
    open: window.trailViewer.photos.isOpen(),
  }));
  check('plain pin opens the usual popup', popup.text.includes('Plain'), popup.text);
  check('plain pin has no photo card', popup.heroes === 0, `${popup.heroes}`);
  check('plain pin does not open the photo viewer', popup.open === false);

  // 13. "Next" walks to the next pin with photos, not the next frame of the same place.
  await openCard('Remote');
  const beforeNext = await page.evaluate(() => document.querySelector('.gpx-pin.selected')?.getAttribute('title'));
  await page.locator('.photo-popup .photo-next').click();
  await settlePopup(page, '.photo-popup', 1);
  await waitForMapIdle(page);
  const afterNext = await page.evaluate(() => ({
    selected: document.querySelector('.gpx-pin.selected')?.getAttribute('title'),
    title: document.querySelector('.photo-popup .photo-card-title')?.textContent,
    heroes: document.querySelectorAll('.photo-popup .photo-frame').length,
    position: document.querySelector('.photo-popup .photo-position')?.textContent || '',
    viewer: window.trailViewer.photos.isOpen(),
  }));
  check('next moves to a different pin', afterNext.selected !== beforeNext,
    `${beforeNext} -> ${afterNext.selected}`);
  check('next opens that pin card rather than the full viewer',
    afterNext.heroes === 1 && afterNext.viewer === false, JSON.stringify(afterNext));
  check('the card now names the other placemark', afterNext.title === afterNext.selected,
    `${afterNext.title} vs ${afterNext.selected}`);
  check('the position counter advanced with it', /^2\/3$/.test(afterNext.position), afterNext.position);

  // 14. The selected pin uses the standardized diamond snap reticle centred on its tip.
  const selection = await page.evaluate(() => {
    const reticle = document.querySelector('.pin-selection-reticle');
    const reticleSvg = reticle?.querySelector('svg');
    const pin = document.querySelector('.gpx-pin.selected .pin-symbol-wrap');
    const pinPath = pin?.querySelector('.pin-symbol path');
    const reticleBox = reticle?.getBoundingClientRect();
    const pinBox = pinPath?.getBoundingClientRect();
    const reticleCenterX = reticleBox ? (reticleBox.left + reticleBox.right) / 2 : NaN;
    const reticleCenterY = reticleBox ? (reticleBox.top + reticleBox.bottom) / 2 : NaN;
    const pinCenterX = pinBox ? (pinBox.left + pinBox.right) / 2 : NaN;
    const pinTipY = pinBox ? pinBox.bottom : NaN;
    return {
      reticleCount: document.querySelectorAll('.pin-selection-reticle').length,
      symbol: reticleSvg?.dataset.symbol || '',
      dx: Math.abs(reticleCenterX - pinCenterX),
      dy: Math.abs(reticleCenterY - pinTipY),
      outline: pin ? getComputedStyle(pin, '::after').content : '',
      pinFilter: pin ? getComputedStyle(pin.querySelector('svg')).filter : '',
    };
  });
  check('exactly one standardized reticle marks the selected pin',
    selection.reticleCount === 1 && selection.symbol === 'snap-marker', JSON.stringify(selection));
  check('the selection reticle centres accurately on the pin tip',
    selection.dx <= 1 && selection.dy <= 1.5, JSON.stringify(selection));
  check('the pin no longer carries a second outline', selection.outline === 'none', selection.outline);
  check('the pin itself picks up the warm accent glow', /drop-shadow/.test(selection.pinFilter), selection.pinFilter);

  // 15. A pin without photos opens the same card family: the same fixed width, the same corner close, the same
  // two type sizes -- and no coordinate pair, because the pin already marks the spot.
  await page.locator('.gpx-pin[title="Plain"]').click();
  await settlePopup(page, '.place-popup', 1);
  await waitForMapIdle(page);
  const plain = await page.evaluate(() => {
    const popup = document.querySelector('.place-popup');
    const card = popup?.querySelector('.place-card');
    const title = popup?.querySelector('.place-card-title');
    const meta = popup?.querySelector('.place-card-meta');
    const close = popup?.querySelector('.place-card-close');
    const box = card?.getBoundingClientRect();
    const closeBox = close?.getBoundingClientRect();
    const wrapper = popup?.querySelector('.leaflet-popup-content-wrapper');
    return {
      width: box ? Math.round(box.width) : 0,
      text: card?.textContent || '',
      title: title?.textContent || '',
      meta: meta?.textContent || '',
      titleSize: title ? getComputedStyle(title).fontSize : '',
      metaSize: meta ? getComputedStyle(meta).fontSize : '',
      closeSize: closeBox ? [Math.round(closeBox.width), Math.round(closeBox.height)] : null,
      closeOffset: closeBox && box
        ? [Math.round(box.right - closeBox.right), Math.round(closeBox.top - box.top)]
        : null,
      radius: wrapper ? getComputedStyle(wrapper).borderTopLeftRadius : '',
      cardBg: card ? getComputedStyle(card).backgroundColor : '',
      wrapperBg: wrapper ? getComputedStyle(wrapper).backgroundColor : '',
      inlineMaxHeight: popup?.querySelector('.leaflet-popup-content')?.style.maxHeight || '',
    };
  });
  check('a pin without photos opens the same card width', plain.width === 224, `${plain.width}`);
  check('the plain card keeps the photo card radius', plain.radius === '8px', plain.radius);
  check('the plain card carries the name and one facts line',
    plain.title === 'Plain' && /29 m/.test(plain.meta), `${plain.title} / ${plain.meta}`);
  check('the plain card keeps the photo card type sizes',
    plain.titleSize === '12.5px' && plain.metaSize === '10.5px',
    `${plain.titleSize} / ${plain.metaSize}`);
  check('both cards draw the same close button in the same corner',
    JSON.stringify(plain.closeSize) === '[24,24]' && JSON.stringify(plain.closeOffset) === '[6,6]',
    JSON.stringify({ size: plain.closeSize, offset: plain.closeOffset }));
  check('the plain card no longer prints coordinates',
    !/\d+\.\d{6}, \d+\.\d{6}/.test(plain.text), plain.text.slice(0, 120));
  check('the plain card is not clamped by a viewport height limit', plain.inlineMaxHeight === '',
    plain.inlineMaxHeight);
  // The wrapper paints --panel once, the same translucent surface the waypoint list uses. Painting the card
  // too stacked two 0.86 layers into an almost solid block.
  check('the plain card is as transparent as the waypoint list',
    plain.cardBg === 'rgba(0, 0, 0, 0)' && plain.wrapperBg === 'rgba(250, 248, 243, 0.92)',
    `${plain.cardBg} / ${plain.wrapperBg}`);
  await page.locator('.place-popup .place-card-close').click();
  await settlePopup(page, '.place-popup', 0);
  const stillOpen = await page.locator('.place-popup').count();
  check('the plain card closes from its own button', stillOpen === 0, `${stillOpen}`);

  // 16. The info panel counts what can be clicked.
  const info = await page.evaluate(() => document.getElementById('info').textContent);
  check('info box lists the photos', /Photos\s*4 photos on 3 pins/.test(info), info.replace(/\s+/g, ' ').slice(0, 160));

  if (shot) {
    await openCard('Album');
    await waitForLayout(page);
    await page.screenshot({ path: shot });
  }

  // 17. Telemetry boilerplate in KML descriptions is stripped from cards, photo meta and overview, while
  // missing timestamps are backfilled from ExtendedData Time or description time.
  const syntheticTelemetryKml = `<?xml version="1.0" encoding="utf-8"?>
  <kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
      <name>Telemetry Cleanup</name>
      <Placemark>
        <name>Track</name>
        <LineString><coordinates>114.3000,30.5000,100 114.3100,30.5100,500 114.3200,30.5200,800</coordinates></LineString>
      </Placemark>
      <Placemark>
        <name>Start</name>
        <description><![CDATA[<div>经度：114.300000</div><div>纬度：30.500000</div><div>海拔：100.4</div><div>时间：2026-10-03 12:24:22</div>]]></description>
        <Point><coordinates>114.300000,30.500000,100.4</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>Turnoff</name>
        <description><![CDATA[<div>经度：114.310000</div><div>纬度：30.510000</div><div>海拔：512.2</div><div>时间：2026-10-03 14:00:00</div>]]></description>
        <ExtendedData>
          <Data name="Time"><value>1791001462631</value></Data>
        </ExtendedData>
        <Point><coordinates>114.310000,30.510000,512.2</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>Lookout</name>
        <description><![CDATA[<div><img src="https://example.test/lookout.jpg" />Ridge fork ahead</div></br><div>经度：114.320000</div><div>纬度：30.520000</div><div>海拔：825.0</div><div>时间：2026-10-03 15:10:00</div>]]></description>
        <Point><coordinates>114.320000,30.520000,825.0</coordinates></Point>
      </Placemark>
    </Document>
  </kml>`;
  await page.route((url) => url.pathname.endsWith('/generated-telemetry-waypoints.kml'),
    (route) => route.fulfill({ body: syntheticTelemetryKml, contentType: 'application/vnd.google-earth.kml+xml' }));
  await page.goto(`${base}/viewer/index.html?src=../generated-telemetry-waypoints.kml`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await waitForLayout(page);

  await page.locator('.gpx-pin[title="Turnoff"]').click();
  await settlePopup(page, '.place-popup', 1);
  const turnoffCard = await page.evaluate(() => ({
    hasPlaceText: document.querySelector('.place-popup .place-text') !== null,
    meta: document.querySelector('.place-popup .place-card-meta')?.textContent || '',
    cardText: document.querySelector('.place-popup .place-card')?.textContent || '',
  }));
  check('telemetry-only plain card hides boilerplate text and backfills ExtendedData time',
    turnoffCard.hasPlaceText === false
      && !/经度|纬度/.test(turnoffCard.cardText)
      && /\d{2}\/\d{2}\/2026, \d{2}:\d{2}\s*·\s*512 m/.test(turnoffCard.meta),
    JSON.stringify(turnoffCard));

  await page.locator('.gpx-pin[title="Start"]').click();
  await settlePopup(page, '.place-popup', 1);
  const startCard = await page.evaluate(() => ({
    hasPlaceText: document.querySelector('.place-popup .place-text') !== null,
    meta: document.querySelector('.place-popup .place-card-meta')?.textContent || '',
  }));
  check('telemetry-only start card backfills description time with no place-text',
    startCard.hasPlaceText === false && /10\/03\/2026, 12:24\s*·\s*100 m/.test(startCard.meta),
    JSON.stringify(startCard));

  await page.locator('.place-popup .place-card-close').click();
  await settlePopup(page, '.place-popup', 0);

  await openCard('Lookout');
  await openFromCard();
  const lookoutViewer = await viewer();
  check('photo viewer meta keeps real user note and omits duplicated telemetry labels',
    /Ridge fork ahead/.test(lookoutViewer.meta) && !/经度|纬度/.test(lookoutViewer.meta),
    lookoutViewer.meta);
  await page.locator('.photo-close').click();
  await page.waitForFunction(() => !window.trailViewer.photos.isOpen());

  await page.locator('.waypoint-overview-switch button').click();
  const overviewRows = await page.evaluate(() =>
    [...document.querySelectorAll('.waypoint-overview-item')].map((node) => ({
      name: node.querySelector('.heading strong')?.textContent || '',
      description: node.querySelector('.description')?.textContent || null,
    })));
  check('waypoint overview omits boilerplate descriptions and keeps real user notes',
    overviewRows.find((r) => r.name === 'Start')?.description === null
      && overviewRows.find((r) => r.name === 'Turnoff')?.description === null
      && overviewRows.find((r) => r.name === 'Lookout')?.description === 'Ridge fork ahead',
    JSON.stringify(overviewRows));

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
