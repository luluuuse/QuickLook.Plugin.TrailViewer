// Interaction test for the elevation scrubber: hovering the profile reports a distance and marks that
// point on the map, clicking pins it, leaving clears it.
//
//   NODE_PATH=<folder containing playwright-core> node tests/scrub-test.cjs [screenshot.png]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
const path = require('path');
const { launchBrowser, waitForLayout } = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const { check, failures } = createChecker('scrub');
const artifacts = createArtifacts('scrub');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  // Pinned to en-US: the assertions below read English labels, and the viewer follows the system language.
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const open = async (fixture) => {
    await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${encodeURIComponent(fixture)}`);
    await page.waitForFunction(() => document.body.classList.contains('loaded'));
  };

  await open('track-time-ele.gpx');
  const total = await page.evaluate(() => window.trailViewer.summary.distanceMeters);
  const plot = await page.locator('#profile .plot svg').boundingBox();
  const at = (ratio) => ({ x: plot.x + plot.width * ratio, y: plot.y + plot.height / 2 });
  const waitForScrub = async ({ exists = true, min = -Infinity, max = Infinity }) => {
    await page.waitForFunction(({ exists: wanted, min: lower, max: upper }) => {
      const point = window.trailViewer.scrub.point();
      if (!wanted) return point === null;
      return point && point.along >= lower && point.along <= upper;
    }, { exists, min, max });
  };
  console.log(`plot ${Math.round(plot.width)}x${Math.round(plot.height)}, track ${total.toFixed(0)} m`);

  // Hovering the middle of the plot reports roughly half the track and drops a marker on the map.
  await page.mouse.move(at(0.5).x, at(0.5).y);
  await waitForScrub({ min: total * 0.45, max: total * 0.55 });
  const half = await page.evaluate(() => {
    const p = window.trailViewer.scrub.point();
    return p && { along: p.along };
  });
  check('hover reports a point', !!half);
  check('middle of the plot is about half the track', half && Math.abs(half.along - total / 2) < 300,
    half && `${Math.round(half.along)} m vs ${Math.round(total / 2)} m`);

  const readout = await page.evaluate(() => {
    const node = document.querySelector('#profile .readout');
    const box = node.getBoundingClientRect();
    return {
      ele: node.querySelector('.ele').textContent,
      meta: node.querySelector('.meta').textContent,
      left: box.left,
      width: box.width,
      alpha: Number((getComputedStyle(node).backgroundColor.match(/([\d.]+)\)\s*$/) || ['', '1'])[1]),
    };
  });
  check('readout shows the height first', /^\d+ m$/.test(readout.ele), readout.ele);
  check('and the distance and time under it', /km/.test(readout.meta) && /:/.test(readout.meta), readout.meta);
  // A label on the ground it measures: see-through enough that the band and the curve stay visible behind it,
  // opaque enough that the numbers survive a pale pink summit.
  check('the readout is see-through', readout.alpha >= 0.3 && readout.alpha <= 0.65, `alpha ${readout.alpha}`);
  check('guide line is visible', await page.locator('#profile .guide').isVisible());
  check('map marker added', (await page.locator('.scrub-marker').count()) === 1);
  check('marker has a position',
    !!(await page.evaluate(() => document.querySelector('.scrub-marker')?.getAttribute('d'))));

  const tipText = () => page.evaluate(() => {
    const node = document.querySelector('#profile .readout');
    return `${node.querySelector('.ele').textContent}|${node.querySelector('.meta').textContent}`;
  });
  const tipBox = () => page.evaluate(() => {
    const box = document.querySelector('#profile .readout').getBoundingClientRect();
    const chart = document.querySelector('#profile .chart').getBoundingClientRect();
    return { left: box.left, right: box.right, chartLeft: chart.left, chartRight: chart.right };
  });
  const pinnedTip = await tipText();

  // Clicking pins the point; moving afterwards must not change it.
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => window.trailViewer.scrub.pinned());
  check('click pins the point', await page.evaluate(() => window.trailViewer.scrub.pinned()));
  check('plot shows the pinned state', /pinned/.test(await page.locator('#profile .plot').getAttribute('class') || ''));

  const before = await page.evaluate(() => window.trailViewer.scrub.point().along);
  await page.mouse.move(at(0.15).x, at(0.15).y);
  await waitForLayout(page);
  check('pinned point ignores the mouse', before === (await page.evaluate(() => window.trailViewer.scrub.point().along)));
  check('readout stays while pinned', (await tipText()) === pinnedTip, await tipText());

  await page.mouse.move(plot.x + plot.width / 2, plot.y - 120);
  await waitForLayout(page);
  check('pinned point survives pointerleave', await page.evaluate(() => !!window.trailViewer.scrub.point()));

  // Clicking again releases it and the cursor follows the mouse once more.
  await page.mouse.move(at(0.8).x, at(0.8).y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => !window.trailViewer.scrub.pinned());
  check('second click releases the pin', !(await page.evaluate(() => window.trailViewer.scrub.pinned())));
  await page.mouse.move(at(0.2).x, at(0.2).y);
  await waitForScrub({ min: total * 0.15, max: total * 0.25 });
  const near = await page.evaluate(() => window.trailViewer.scrub.point().along);
  check('follows again after release', Math.abs(near - total * 0.2) < 300, `${Math.round(near)} m`);

  // The numbers ride with the cursor: the whole point of the change is that they are where the eye is.
  const tipLeft = await tipBox();
  await page.mouse.move(at(0.62).x, at(0.62).y);
  await waitForScrub({ min: total * 0.57, max: total * 0.67 });
  const tipRight = await tipBox();
  check('the readout follows the cursor', tipRight.left > tipLeft.left + 100,
    `${Math.round(tipLeft.left)} -> ${Math.round(tipRight.left)}`);
  check('the readout stays over the plot',
    tipRight.left >= tipRight.chartLeft - 1 && tipRight.right <= tipRight.chartRight + 1,
    `${Math.round(tipRight.left)}-${Math.round(tipRight.right)} in ${Math.round(tipRight.chartLeft)}-${Math.round(tipRight.chartRight)}`);
  // At either end it is clamped rather than hanging off the panel.
  await page.mouse.move(at(0).x, at(0).y);
  await waitForScrub({ min: 0, max: 0 });
  const tipStart = await tipBox();
  check('the readout is clamped at the start', tipStart.left >= tipStart.chartLeft - 1, `${Math.round(tipStart.left)}`);

  // Leaving unpinned clears the cursor and the marker.
  await page.mouse.move(plot.x + plot.width / 2, plot.y - 120);
  await waitForScrub({ exists: false });
  check('leaving clears the cursor', await page.evaluate(() => !window.trailViewer.scrub.point()));
  check('leaving removes the map marker', (await page.locator('.scrub-marker').count()) === 0);

  // The extreme edges clamp to the track instead of running past it.
  await page.mouse.move(plot.x + 1, plot.y + 20);
  await waitForScrub({ min: 0, max: 0 });
  check('left edge is the start', (await page.evaluate(() => window.trailViewer.scrub.point().along)) === 0);
  await page.mouse.move(plot.x + plot.width - 1, plot.y + 20);
  await waitForScrub({ min: total * 0.98 });
  const high = await page.evaluate(() => window.trailViewer.scrub.point().along);
  // One point short of the end: the cursor reports where you had got to, not the point still to come.
  check('right edge lands on the last point', high > total * 0.98, `${high.toFixed(0)} of ${total.toFixed(0)} m`);

  // A track whose points carry no time still scrubs: the readout keeps the distance.
  await open('kml-line.kml');
  if ((await page.locator('#profile .plot').count()) === 0) {
    console.log('SKIP  kml-line.kml has no profile row');
  } else {
    const box = await page.locator('#profile .plot svg').boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await waitForScrub({});
    const text = await page.evaluate(() => {
      const node = document.querySelector('#profile .readout');
      return { ele: node.querySelector('.ele').textContent, meta: node.querySelector('.meta').textContent };
    });
    check('a track without times still shows a distance', /km|m/.test(text.meta), JSON.stringify(text));
  }

  // A long recording: 30 000 points must not make scrubbing expensive. Generated on the fly.
  const n = 30000;
  let body = '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>';
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n;
    const t = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
    body += `<trkpt lat="${(46.5 + 0.05 * Math.sin(a)).toFixed(6)}" lon="${(8 + 0.07 * Math.cos(a)).toFixed(6)}">`
      + `<ele>${(1000 + 200 * Math.sin(3 * a)).toFixed(1)}</ele><time>${t}</time></trkpt>`;
  }
  body += '</trkseg></trk></gpx>';
  await page.route((url) => url.pathname.endsWith('/long-track.gpx'),
    (route) => route.fulfill({ body, contentType: 'application/gpx+xml' }));
  await open('long-track.gpx');

  const cost = await page.evaluate(() => {
    const span = window.trailViewer.summary.distanceMeters;
    const started = performance.now();
    for (let i = 0; i < 200; i += 1) window.trailViewer.scrub.at((i / 200) * span);
    return performance.now() - started;
  });
  check('long track scrubs cheaply', cost / 200 < 4, `${(cost / 200).toFixed(2)} ms per move`);

  const longBox = await page.locator('#profile .plot svg').boundingBox();
  await page.mouse.move(longBox.x + longBox.width * 0.42, longBox.y + longBox.height / 2);
  await waitForScrub({});
  const long = await page.evaluate(() => {
    const p = window.trailViewer.scrub.point();
    return { along: p && p.along, marker: !!document.querySelector('.scrub-marker') };
  });
  check('long track reports a point', long.along > 0, `${Math.round(long.along)} m`);
  check('long track keeps the map marker', long.marker);

  if (shot) await page.screenshot({ path: shot });
  for (const e of pageErrors) failures.push(`page error: ${e}`);

  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();

  if (failures.length > 0) {
    console.log(`\n${failures.length} failed`);
    process.exit(1);
  }
  console.log('\nscrubber OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
