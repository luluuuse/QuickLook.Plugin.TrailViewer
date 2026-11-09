// Focus regression: the route opens inside the unobstructed map area, selected pins and their cards stay there,
// profile scrubbing respects the panel, and the overview follows the current point without stealing map focus.
const path = require('path');
const {
  launchBrowser,
  openViewer,
  settlePopup,
  waitForLayout,
  waitForMapIdle,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures } = createChecker('focus');
const artifacts = createArtifacts('focus');

const inside = (safe, rect, tolerance = 1) => rect.l >= safe.left - tolerance
  && rect.t >= safe.top - tolerance
  && rect.r <= safe.right + tolerance
  && rect.b <= safe.bottom + tolerance;

async function routeFrame(page) {
  return page.evaluate(() => {
    const viewer = window.trailViewer;
    const safe = viewer.mapLayout().safe;
    const points = viewer.gpx.tracks.flatMap((track) => track.segments.flat())
      .concat(viewer.gpx.routes.flatMap((route) => route.points))
      .map((point) => viewer.map.latLngToContainerPoint([point.lat, point.lon]));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      state: viewer.mapLayout().state,
      safe,
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
      info: document.getElementById('info').getBoundingClientRect().toJSON(),
      profile: document.getElementById('profile').hidden
        ? null
        : document.getElementById('profile').getBoundingClientRect().toJSON(),
      horizontal: document.documentElement.scrollWidth <= innerWidth,
    };
  });
}

async function selectedFrame(page) {
  return page.evaluate(() => {
    const safe = window.trailViewer.mapLayout().safe;
    const pin = document.querySelector('.gpx-pin.selected')?.getBoundingClientRect();
    const popup = document.querySelector('.leaflet-popup')?.getBoundingClientRect();
    return {
      safe,
      pin: pin ? { l: pin.left, t: pin.top, r: pin.right, b: pin.bottom } : null,
      popup: popup ? { l: popup.left, t: popup.top, r: popup.right, b: popup.bottom } : null,
    };
  });
}

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const pageErrors = [];
  const firstPage = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await artifacts.start(firstPage);
  firstPage.on('pageerror', (error) => pageErrors.push(error.message));

  const matrix = [
    [360, 740, 'zh-CN', 'full', 'track-time-ele.gpx'],
    [480, 800, 'en-US', 'full', 'track-time-ele.gpx'],
    [640, 600, 'zh-CN', 'full', 'track-time-ele.gpx'],
    [760, 560, 'en-US', 'compact', 'track-time-ele.gpx'],
    [850, 561, 'zh-CN', 'compact', 'track-time-ele.gpx'],
    [900, 620, 'en-US', 'full', 'track-time-ele.gpx'],
    [960, 620, 'zh-CN', 'compact', 'track-time-ele.gpx'],
    [1200, 800, 'en-US', 'compact', 'track-time-ele.gpx'],
    [480, 800, 'zh-CN', 'full', 'flat-city.gpx'],
  ];

  for (const [width, height, locale, details, fixture] of matrix) {
    const page = await browser.newPage({ viewport: { width, height }, locale });
    await page.addInitScript((mode) => localStorage.setItem('trailviewer.infoDetails', mode), details);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await openViewer(page, base, fixture);
    await waitForLayout(page);
    await waitForMapIdle(page);
    const frame = await routeFrame(page);
    const safe = frame.safe;
    check(`${width}x${height} ${details} uses a measured layout`,
      ['inline', 'wrapped', 'docked'].includes(frame.state), frame.state);
    check(`${width}x${height} route stays inside the safe frame`,
      frame.left >= safe.left - 1 && frame.top >= safe.top - 1
        && frame.right <= safe.right + 1 && frame.bottom <= safe.bottom + 1,
      JSON.stringify(frame));
    const centreError = Math.hypot(
      (frame.left + frame.right) / 2 - (safe.left + safe.right) / 2,
      (frame.top + frame.bottom) / 2 - (safe.top + safe.bottom) / 2,
    );
    check(`${width}x${height} route is centred in the safe frame`, centreError <= 2,
      `${centreError.toFixed(2)} px`);
    check(`${width}x${height} keeps summary and profile apart`,
      !frame.profile || frame.info.bottom <= frame.profile.top,
      `${frame.info.bottom} vs ${frame.profile?.top}`);
    check(`${width}x${height} adds no horizontal overflow`, frame.horizontal);
    await page.close();
  }

  // A selected pin at the far corner, including its popup, is brought back into the usable map.
  await openViewer(firstPage, base, 'kml-photos.kml');
  await firstPage.evaluate(() => window.trailViewer.nav.select(0));
  await settlePopup(firstPage, '.leaflet-popup', 1);
  await waitForMapIdle(firstPage);
  let frame = await selectedFrame(firstPage);
  check('a selected pin and its card start inside the safe frame',
    inside(frame.safe, frame.pin) && inside(frame.safe, frame.popup),
    JSON.stringify(frame));

  await firstPage.evaluate(() => {
    const viewer = window.trailViewer;
    const point = viewer.nav.stops()[1].point;
    const at = viewer.map.latLngToContainerPoint([point.lat, point.lon]);
    viewer.map.closePopup();
    viewer.map.panBy([at.x - 8, at.y - 8], { animate: false });
  });
  await waitForMapIdle(firstPage);
  await firstPage.evaluate(() => window.trailViewer.nav.select(1));
  await settlePopup(firstPage, '.leaflet-popup', 1);
  await waitForMapIdle(firstPage);
  frame = await selectedFrame(firstPage);
  check('switching an edge pin returns the pin and card to the safe frame',
    inside(frame.safe, frame.pin) && inside(frame.safe, frame.popup),
    JSON.stringify(frame));

  await firstPage.locator('.info-details-toggle').click();
  await waitForLayout(firstPage);
  await waitForMapIdle(firstPage);
  frame = await selectedFrame(firstPage);
  check('expanding the summary keeps the current card visible',
    inside(frame.safe, frame.pin) && inside(frame.safe, frame.popup),
    JSON.stringify(frame));

  await firstPage.setViewportSize({ width: 760, height: 560 });
  await waitForLayout(firstPage);
  await firstPage.waitForFunction(() => {
    const safe = window.trailViewer.mapLayout().safe;
    const popup = document.querySelector('.leaflet-popup')?.getBoundingClientRect();
    return Boolean(popup) && popup.left >= safe.left - 1 && popup.top >= safe.top - 1
      && popup.right <= safe.right + 1 && popup.bottom <= safe.bottom + 1;
  });
  await waitForMapIdle(firstPage);
  frame = await selectedFrame(firstPage);
  check('resizing keeps the current card visible',
    inside(frame.safe, frame.pin) && inside(frame.safe, frame.popup),
    JSON.stringify(frame));

  const profilePage = await browser.newPage({ viewport: { width: 640, height: 600 }, locale: 'en-US' });
  profilePage.on('pageerror', (error) => pageErrors.push(error.message));
  await openViewer(profilePage, base, 'track-time-ele.gpx');
  await waitForLayout(profilePage);
  await profilePage.evaluate(() => window.trailViewer.scrub.at(window.trailViewer.profile.total));
  await waitForMapIdle(profilePage);
  const scrub = await profilePage.evaluate(() => {
    const safe = window.trailViewer.mapLayout().safe;
    const rect = document.querySelector('.scrub-marker').getBoundingClientRect();
    const profile = document.getElementById('profile').getBoundingClientRect();
    return {
      safe,
      marker: { l: rect.left, t: rect.top, r: rect.right, b: rect.bottom },
      profile: { t: profile.top },
    };
  });
  check('profile scrubbing clears the profile panel',
    inside(scrub.safe, scrub.marker) && scrub.marker.b <= scrub.profile.t,
    JSON.stringify(scrub));
  await profilePage.close();

  const overviewPage = await browser.newPage({ viewport: { width: 1000, height: 760 }, locale: 'en-US' });
  overviewPage.on('pageerror', (error) => pageErrors.push(error.message));
  await openViewer(overviewPage, base, 'kml-insights.kml');
  await overviewPage.evaluate(() => window.trailViewer.nav.select(5));
  await settlePopup(overviewPage, '.leaflet-popup', 1);
  await overviewPage.locator('.waypoint-overview-switch button').click();
  await overviewPage.locator('.waypoint-filter-trigger').click();
  await overviewPage.locator('.insight-filter[data-filter="camp"]').click();
  const pinned = await overviewPage.evaluate(() => {
    const row = document.querySelector('.waypoint-overview-item.current-pinned');
    return {
      name: row?.querySelector('.heading strong')?.textContent,
      selected: row?.classList.contains('selected'),
      label: row?.querySelector('.waypoint-current-label')?.textContent,
      index: window.trailViewer.nav.index(),
    };
  });
  check('a filter that hides the current pin keeps a pinned current row',
    pinned.name === '危险水源' && pinned.selected === true && pinned.index === 5,
    JSON.stringify(pinned));
  await overviewPage.close();

  const scrollPage = await browser.newPage({ viewport: { width: 900, height: 620 }, locale: 'en-US' });
  scrollPage.on('pageerror', (error) => pageErrors.push(error.message));
  await openViewer(scrollPage, base, 'dense-waypoints.kml');
  await scrollPage.locator('.waypoint-overview-switch button').click();
  const last = await scrollPage.evaluate(() => window.trailViewer.nav.stops().length - 1);
  await scrollPage.evaluate((index) => window.trailViewer.nav.select(index), last);
  await settlePopup(scrollPage, '.leaflet-popup', 1);
  await waitForLayout(scrollPage);
  const scrolled = await scrollPage.evaluate(() => {
    const list = document.querySelector('.waypoint-overview-list').getBoundingClientRect();
    const row = document.querySelector('.waypoint-overview-item.selected')?.getBoundingClientRect();
    return {
      active: document.activeElement?.classList.contains('waypoint-overview-item') || false,
      visible: Boolean(row) && row.bottom > list.top && row.top < list.bottom,
      row: row?.toJSON(),
      list: list.toJSON(),
    };
  });
  check('external selection scrolls the open overview without taking keyboard focus',
    scrolled.visible && !scrolled.active, JSON.stringify(scrolled));
  await scrollPage.close();

  const anomalyPage = await browser.newPage({ viewport: { width: 1100, height: 760 }, locale: 'en-US' });
  anomalyPage.on('pageerror', (error) => pageErrors.push(error.message));
  await openViewer(anomalyPage, base, 'gps-anomaly.gpx');
  await anomalyPage.waitForSelector('.gpx-anomaly-marker');
  await waitForLayout(anomalyPage);
  const beforeZoom = await anomalyPage.evaluate(() => window.trailViewer.map.getZoom());
  await anomalyPage.locator('.gpx-anomaly-marker').first().click();
  await anomalyPage.waitForFunction((zoom) => window.trailViewer.map.getZoom() > zoom, beforeZoom);
  await waitForMapIdle(anomalyPage);
  const clickedZoom = await anomalyPage.evaluate(() => window.trailViewer.map.getZoom());
  check('clicking a GPS anomaly zooms into it', clickedZoom > beforeZoom, `${beforeZoom} -> ${clickedZoom}`);
  await anomalyPage.evaluate(() => window.trailViewer.locate());
  await waitForMapIdle(anomalyPage);
  await waitForLayout(anomalyPage);
  await anomalyPage.locator('.gpx-anomaly-marker').first().focus();
  const tab = await anomalyPage.locator('.gpx-anomaly-marker').first().getAttribute('tabindex');
  await anomalyPage.keyboard.press('Enter');
  await anomalyPage.waitForFunction((zoom) => window.trailViewer.map.getZoom() > zoom, beforeZoom);
  await waitForMapIdle(anomalyPage);
  const keyZoom = await anomalyPage.evaluate(() => window.trailViewer.map.getZoom());
  check('an anomaly label is keyboard focusable and Enter zooms it',
    tab === '0' && keyZoom > beforeZoom, `tab=${tab}, zoom ${keyZoom}`);
  await anomalyPage.close();

  check('focus tests raised no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await artifacts.capture(firstPage, failures, pageErrors);
  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
