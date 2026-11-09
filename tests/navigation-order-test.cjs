// Navigation order: exported waypoints can be stored in a different order from the route. Start/end
// anchors and yellow pins must still share one along-route sequence.
const path = require('path');
const {
  launchBrowser,
  settlePopup,
  waitForLayout,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures } = createChecker('navigation-order');
const artifacts = createArtifacts('navigation-order');

const document = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Route</name>
      <LineString>
        <coordinates>0,0,0 0,0.001,0 0,0.002,0 0,0.003,0</coordinates>
      </LineString>
    </Placemark>
    <Placemark><name>终点</name><Point><coordinates>0,0.003,0</coordinates></Point></Placemark>
    <Placemark><name>起点</name><Point><coordinates>0,0,0</coordinates></Point></Placemark>
    <Placemark><name>中点</name><Point><coordinates>0,0.0015,0</coordinates></Point></Placemark>
    <Placemark><name>后段</name><Point><coordinates>0,0.0025,0</coordinates></Point></Placemark>
  </Document>
</kml>`;

async function state(page) {
  return page.evaluate(() => ({
    index: window.trailViewer.nav.index(),
    nodeIndex: window.trailViewer.nav.nodeIndex(),
    nodes: window.trailViewer.nav.nodes(),
    selected: document.querySelector('.gpx-pin.selected')?.title || '',
    popup: document.querySelector('.leaflet-popup-content')?.textContent || '',
  }));
}

async function press(page, key) {
  await page.keyboard.press(key);
  await settlePopup(page, '.leaflet-popup', 1);
  await waitForLayout(page);
}

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 }, locale: 'en-US' });
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/navigation-order.kml', (route) => route.fulfill({
    body: document,
    contentType: 'application/vnd.google-earth.kml+xml',
  }));
  await page.goto(`${base}/viewer/index.html?src=${encodeURIComponent('../../navigation-order.kml')}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await waitForLayout(page);

  const initial = await state(page);
  check('the fixture stores its end waypoint before its start waypoint',
    initial.nodes.map((node) => node.name).join('|') === '起点|中点|后段|终点',
    JSON.stringify(initial.nodes));
  check('start and end anchors join their coincident yellow pins',
    initial.nodes[0].kind === 'start+waypoint' && initial.nodes[3].kind === 'end+waypoint',
    `${initial.nodes[0].kind}/${initial.nodes[3].kind}`);
  check('coincident anchors do not create duplicate navigation stops', initial.nodes.length === 4,
    String(initial.nodes.length));

  await page.evaluate(() => document.querySelector('.gpx-start')
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await settlePopup(page, '.leaflet-popup', 1);
  const started = await state(page);
  check('clicking the green start selects its unified route node',
    started.nodeIndex === 0 && started.selected === '起点' && started.index === 0,
    JSON.stringify(started));

  await press(page, 'ArrowRight');
  const middle = await state(page);
  check('right from the start goes to the next point along the route',
    middle.selected === '中点' && middle.index === 1, JSON.stringify(middle));

  await press(page, 'ArrowRight');
  const later = await state(page);
  check('the next step continues forward rather than revisiting the start',
    later.selected === '后段' && later.index === 2, JSON.stringify(later));

  await press(page, 'ArrowRight');
  const ended = await state(page);
  check('the route end follows the final waypoint',
    ended.selected === '终点' && ended.index === 3, JSON.stringify(ended));

  await press(page, 'ArrowRight');
  const wrapped = await state(page);
  check('right from the route end wraps to the start',
    wrapped.selected === '起点' && wrapped.index === 0, JSON.stringify(wrapped));

  await page.locator('.waypoint-overview-switch button').click();
  const rows = await page.evaluate(() => [...document.querySelectorAll('.waypoint-overview-item')]
    .map((row) => row.querySelector('.heading strong')?.textContent));
  check('the overview uses the same along-route order',
    rows.join('|') === '起点|中点|后段|终点', rows.join('|'));
  await page.locator('.waypoint-overview-item[data-waypoint="0"]').click();
  await settlePopup(page, '.leaflet-popup', 1);
  await press(page, 'ArrowRight');
  check('keyboard navigation continues from a row selected in the overview',
    (await state(page)).selected === '中点', JSON.stringify(await state(page)));

  check('the page raised no errors', pageErrors.length === 0, pageErrors.join(' | '));
  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
