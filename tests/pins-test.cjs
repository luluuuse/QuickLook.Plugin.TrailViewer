// Test for the waypoint switch: one button hides every pin without touching the track, the choice is
// remembered, and the keyboard brings the pins back rather than moving a map with nothing on it.
//
//   NODE_PATH=<folder containing playwright-core> node tests/pins-test.cjs [screenshot.png]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
const fs = require('fs');
const path = require('path');
const {
  launchBrowser,
  settlePopup,
  waitForLayout,
  waitForZoom,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const fixture = 'kml-photos.kml';
const { check, failures } = createChecker('pins');
const artifacts = createArtifacts('pins');

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

  const open = async (name) => {
    await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${name}`);
    await page.waitForFunction(() => document.body.classList.contains('loaded'));
  };

  await page.goto(`${base}/viewer/index.html`);
  await page.evaluate(() => localStorage.removeItem('gpxviewer.pins'));
  await open(fixture);

  const state = async () => page.evaluate(() => {
    const button = document.querySelector('.pins-switch button');
    // The profile draws the same waypoints; W is meant to take both lots away at once.
    const prof = [...document.querySelectorAll('#profile .pin')];
    return {
      pins: document.querySelectorAll('.gpx-pin').length,
      stops: window.gpxViewer.nav.stops().length,
      marks: window.gpxViewer.pins.count(),
      ends: document.querySelectorAll('.gpx-start, .gpx-end').length,
      hasControl: window.gpxViewer.pins.hasControl(),
      visible: window.gpxViewer.pins.visible(),
      active: button ? button.classList.contains('active') : false,
      pressed: button ? button.getAttribute('aria-pressed') : '',
      accessibleName: button ? button.getAttribute('aria-label') : '',
      label: button ? button.textContent.trim() : '',
      title: button ? button.title : '',
      dot: button ? getComputedStyle(button.querySelector('.dot')).backgroundColor : '',
      selected: document.querySelectorAll('.gpx-pin.selected').length,
      cards: document.querySelectorAll('.leaflet-popup').length,
      index: window.gpxViewer.nav.index(),
      tracks: document.querySelectorAll('.gpx-track').length,
      profilePins: prof.length,
      profileHidden: prof.filter((p) => getComputedStyle(p).display === 'none').length,
    };
  });

  const press = async (key) => {
    await page.keyboard.press(key);
    await settlePopup(page, '.leaflet-popup', 1);
  };

  // 1. On by default, and the button says what it will do.
  let s = await state();
  check('the switch is there for a file with waypoints', s.hasControl === true);
  check('five pins are on the map at load', s.pins === 5 && s.stops === 5, `${s.pins}/${s.stops}`);
  check('the profile carries the same five as dots', s.profilePins === 5 && s.profileHidden === 0,
    `${s.profilePins}/${s.profileHidden}`);
  check('the two ends are marked from the start', s.ends === 2, `${s.ends}`);
  check('the switch starts out on', s.visible === true && s.active === true);
  check('the switch exposes its on state', s.pressed === 'true', s.pressed);
  check('it is named after what it controls', s.label === 'Markers', s.label);
  // The key is part of the tooltip now that there is no bar to spell it out on.
  check('the tooltip offers to hide them', s.title === 'Hide markers and anomaly labels (W)', s.title);
  check('and screen readers get the same action name', s.accessibleName === s.title, s.accessibleName);

  // 2. Hiding takes the pins off the map and leaves everything else alone.
  await page.locator('.pins-switch button').click();
  await waitForLayout(page);
  s = await state();
  check('the pins are gone from the page', s.pins === 0, `${s.pins}`);
  check('and so are the dots on the profile', s.profileHidden === s.profilePins && s.profilePins === 5,
    `${s.profileHidden}/${s.profilePins}`);
  check('the start and end flags stay on the map', s.ends === 2, `${s.ends}`);
  check('the markers still exist for the keyboard', s.stops === 5, `${s.stops}`);
  check('the track is untouched', s.tracks === 1, `${s.tracks}`);
  check('the switch is off', s.visible === false && s.active === false);
  check('the switch exposes its off state', s.pressed === 'false', s.pressed);
  check('the tooltip now offers to show them', s.title === 'Show markers and anomaly labels (W)', s.title);
  check('the dot is hollow while they are hidden', s.dot === 'rgba(0, 0, 0, 0)', s.dot);

  // 3. A key press outranks the hidden state: the pins come back and the first one is selected.
  await press('ArrowRight');
  s = await state();
  check('the arrow brings the pins back', s.pins === 5 && s.visible === true, `${s.pins}`);
  check('the profile dots come back with them', s.profileHidden === 0, `${s.profileHidden}`);
  check('and selects the first marker', s.index === 0 && s.selected === 1, `${s.index}/${s.selected}`);
  check('the switch follows the arrow', s.active === true);
  check('the dot is filled again', s.dot !== 'rgba(0, 0, 0, 0)', s.dot);

  // 4. The choice survives a reload: hidden stays hidden.
  await page.locator('.pins-switch button').click();
  await waitForLayout(page);
  await open(fixture);
  s = await state();
  check('a hidden choice is remembered', s.pins === 0 && s.active === false, `${s.pins}`);
  check('and the profile starts hidden too', s.profileHidden === 5, `${s.profileHidden}`);
  check('and the markers are loaded all the same', s.stops === 5, `${s.stops}`);

  // 5. Hiding while a card is open closes it: an orphan popup over the track would look broken.
  await press('ArrowRight');
  await page.waitForSelector('.leaflet-popup-content');
  s = await state();
  check('a card is open before hiding', s.cards === 1, `${s.cards}`);
  await page.locator('.pins-switch button').click();
  await settlePopup(page, '.leaflet-popup', 0);
  s = await state();
  check('hiding closes the open card', s.cards === 0, `${s.cards}`);

  // 6. Showing again paints the selection that was there before.
  await page.locator('.pins-switch button').click();
  await waitForLayout(page);
  s = await state();
  check('showing again keeps the selected marker', s.pins === 5 && s.selected === 1, `${s.pins}/${s.selected}`);
  check('the selection is the same one', s.index === 0, `${s.index}`);

  // 7. The label follows the interface language, the state does not change.
  await page.locator('.lang-switch button').click();
  await waitForLayout(page);
  s = await state();
  check('the switch speaks Chinese', s.label === '标记点', s.label);
  check('the tooltip is Chinese too', s.title === '隐藏标记点与异常标记（W）', s.title);
  check('the pins are still shown', s.pins === 5 && s.active === true, `${s.pins}`);

  await page.locator('.pins-switch button').click();
  await waitForLayout(page);
  s = await state();
  check('the Chinese button hides them',
    s.pins === 0 && s.title === '显示标记点与异常标记（W）', `${s.pins} ${s.title}`);
  await page.locator('.lang-switch button').click();
  await waitForLayout(page);

  // 8. A pure track has no waypoints, but its dots are marks too: the switch must still be there.
  await page.evaluate(() => localStorage.removeItem('gpxviewer.pins'));
  await open('gpx10.gpx');
  s = await state();
  check('a track without waypoints still gets the switch', s.hasControl === true && s.stops === 0,
    `${s.hasControl}/${s.stops}`);
  check('it counts the track dots and not the two flags', s.marks === 30, `${s.marks}`);
  check('a track without waypoints draws no profile dots', s.profilePins === 0, `${s.profilePins}`);
  await page.locator('.pins-switch button').click();
  await waitForLayout(page);
  s = await state();
  check('hiding a pure track takes every dot off the map', s.visible === false && s.pins === 0, `${s.visible}`);
  check('and leaves the line and the two flags alone', s.tracks === 1 && s.ends === 2, `${s.tracks}/${s.ends}`);

  await page.evaluate(() => localStorage.removeItem('gpxviewer.pins'));
  await open('dense-waypoints.kml');
  await waitForLayout(page);
  const dense = await page.evaluate(() => ({
    stops: window.gpxViewer.nav.stops().length,
    marks: window.gpxViewer.pins.count(),
    visiblePins: [...document.querySelectorAll('.gpx-pin')]
      .filter((node) => getComputedStyle(node).display !== 'none').length,
    clusters: document.querySelectorAll('.gpx-waypoint-cluster').length,
    importantVisible: [...document.querySelectorAll('.gpx-pin')]
      .some((node) => node.title === '危险陡崖' && getComputedStyle(node).display !== 'none'),
  }));
  check('a dense route is thinned without drawing an aggregate marker',
    dense.stops === 60 && dense.marks === 60 && dense.clusters === 0 && dense.visiblePins === 1,
    JSON.stringify(dense));
  check('important waypoints stay visible as individual pins',
    dense.visiblePins === 1 && dense.importantVisible,
    JSON.stringify(dense));

  await press('ArrowRight');
  await press('ArrowRight');
  const selectedDense = await page.evaluate(() => ({
    selected: document.querySelectorAll('.gpx-pin.selected').length,
    visiblePins: [...document.querySelectorAll('.gpx-pin')]
      .filter((node) => getComputedStyle(node).display !== 'none').length,
  }));
  check('keyboard selection always restores the selected raw pin',
    selectedDense.selected === 1 && selectedDense.visiblePins === 2,
    JSON.stringify(selectedDense));

  await page.evaluate(() => localStorage.removeItem('gpxviewer.pins'));
  await open('dense-waypoints.kml');
  await page.evaluate(() => { window.gpxViewer.map.setZoom(19); });
  await waitForZoom(page, 19);
  await waitForLayout(page);
  const zoomedPins = await page.evaluate(() =>
    [...document.querySelectorAll('.gpx-pin')].filter((node) => getComputedStyle(node).display !== 'none').length);
  check('zooming in reveals more individual waypoint pins', zoomedPins > 2, `${zoomedPins}`);
  await page.locator('.pins-switch button').click();
  await waitForLayout(page);
  check('the marker switch hides the sampled pins',
    (await page.locator('.gpx-pin').count()) === 0);

  // 9. A file that draws no marks at all — only an area — still gets no switch.
  await open('kml-polygon-only.kml');
  s = await state();
  check('no switch when the file draws no marks', s.hasControl === false && s.marks === 0, `${s.hasControl}/${s.marks}`);

  if (shot) {
    await open(fixture);
    await page.evaluate(() => window.gpxViewer.pins.hide());
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
