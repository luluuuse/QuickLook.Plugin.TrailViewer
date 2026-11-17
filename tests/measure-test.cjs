// Distance measurement and the combined toolbox. The route exists only in memory; right-click commits a
// point while Leaflet keeps ownership of ordinary dragging and wheel zoom.
const path = require('path');
const {
  launchBrowser,
  openViewer,
  waitForLayout,
  waitForMapIdle,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures, finish } = createChecker('measure');
const artifacts = createArtifacts('measure');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await artifacts.start(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await openViewer(page, base, 'kml-photos.kml');
  await waitForLayout(page);
  check('the measurement track index is lazy before first use',
    await page.evaluate(() => window.trailViewer.measure.indexed()) === false);

  // 1. Both tasks live behind one toolbox entry.
  check('the old standalone export button is gone',
    (await page.locator('.export-switch').count()) === 0);
  check('the toolbox has its own map control',
    (await page.locator('.toolbox-switch > button').count()) === 1);
  await page.click('.toolbox-switch button');
  check('the toolbox opens as a labelled dialog',
    await page.locator('#toolbox-panel').getAttribute('role') === 'dialog'
      && await page.locator('#toolbox-panel').getAttribute('aria-labelledby') === 'toolbox-heading');
  check('the toolbox contains distance measurement and overlay export',
    await page.locator('.toolbox-action[data-tool="measure"]').count() === 1
      && await page.locator('.toolbox-action[data-tool="export"]').count() === 1);
  check('the toolbox contains the route weather card',
    await page.locator('.toolbox-action[data-tool="weather"]').count() === 1
      && (await page.$$eval('.toolbox-weather-mode', (nodes) => nodes.map((node) => node.textContent)))
        .join('/') === 'Start/End/Peak');
  check('a file with elevation enables all three weather points',
    !(await page.locator('[data-weather-mode="highest"]').isDisabled())
      && !(await page.locator('[data-weather-mode="start"]').isDisabled()));
  await page.locator('[data-weather-mode="end"]').click();
  check('the weather target exposes its selected state',
    await page.locator('[data-weather-mode="end"]').getAttribute('aria-pressed') === 'true');
  const weatherIcons = await page.$$eval('.toolbox-weather-mode svg', (nodes) => nodes.map((node) => ({
    name: node.dataset.weatherMark,
    fill: node.getAttribute('fill'),
    stroke: node.getAttribute('stroke'),
    width: node.getAttribute('width'),
  })));
  check('route weather uses the selected coloured map-point icons',
    weatherIcons.map((item) => item.name).join('|') === 'start|end|highest'
      && weatherIcons.every((item) => item.fill === null
        && item.stroke === null && item.width === '16'),
    JSON.stringify(weatherIcons));
  const toolboxSurface = await page.locator('#toolbox-panel').evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, filter: style.backdropFilter };
  });
  check('the toolbox uses the shared translucent tool surface',
    toolboxSurface.background === 'rgba(24, 24, 24, 0.78)'
      && toolboxSurface.filter.includes('blur(14px)')
      && toolboxSurface.filter.includes('saturate(0.9)'),
    JSON.stringify(toolboxSurface));
  const iconGeometry = await page.evaluate(() => {
    const icon = (tool) => document.querySelector(
      `.toolbox-action[data-tool="${tool}"] .toolbox-action-icon svg`,
    );
    const measure = icon('measure');
    const exportIcon = icon('export');
    return {
      measure: measure?.getBoundingClientRect(),
      measureStroke: measure?.getAttribute('stroke-width'),
      exportIcon: Boolean(exportIcon),
      exportStroke: exportIcon?.getAttribute('stroke-width'),
    };
  });
  check('distance measurement uses the 16 px ruler template',
    iconGeometry.measure?.width === 16 && iconGeometry.measure?.height === 16
      && iconGeometry.measureStroke === '1.75',
    JSON.stringify(iconGeometry));
  check('overlay export uses the matching image-download template',
    iconGeometry.exportIcon && iconGeometry.exportStroke === '1.75',
    JSON.stringify(iconGeometry));
  const toolboxRight = await page.locator('#toolbox-panel').evaluate((node) =>
    Math.round(innerWidth - node.getBoundingClientRect().right));
  check('the toolbox panel is anchored to the right edge', toolboxRight === 10, `${toolboxRight}px`);
  await page.evaluate(() => window.trailViewer.pressKey('X'));
  check('opening export closes the toolbox to prevent overlap',
    await page.evaluate(() => window.trailViewer.panelOpen())
      && await page.evaluate(() => !window.trailViewer.measure.toolboxOpen()));
  await page.evaluate(() => window.trailViewer.pressKey('X'));

  // 2. Snapping is resolved in screen pixels and uses the source data, not visible pins.
  const snaps = await page.evaluate(() => {
    const api = window.trailViewer;
    const map = api.map;
    const start = api.gpx.waypoints[0];
    const at = (point, dx) => map.containerPointToLatLng(
      map.latLngToContainerPoint([point.lat, point.lon]).add([dx, 0]),
    );
    return {
      marker: api.measure.snapAt(at(start, 9)),
    };
  });
  check('a nearby waypoint snaps as a marker', snaps.marker.kind === 'marker', snaps.marker.kind);
  check('the first snap builds the measurement track index',
    await page.evaluate(() => window.trailViewer.measure.indexed()) === true);

  await page.evaluate(() => window.trailViewer.pins.hide());
  const hiddenSnap = await page.evaluate(() => {
    const api = window.trailViewer;
    const point = api.gpx.waypoints[0];
    return api.measure.snapAt({ lat: point.lat, lon: point.lon }).kind;
  });
  check('hidden waypoint pins still provide snapping targets', hiddenSnap === 'marker', hiddenSnap);

  // A pure track has no waypoint that could win the nearest-target comparison.
  await openViewer(page, base, 'gpx10.gpx');
  await waitForLayout(page);
  const trackSnaps = await page.evaluate(() => {
    const api = window.trailViewer;
    const map = api.map;
    const track = api.gpx.tracks[0].segments[0][7];
    const at = (dx) => map.containerPointToLatLng(
      map.latLngToContainerPoint([track.lat, track.lon]).add([dx, 0]),
    );
    return { exact: api.measure.snapAt(at(9)), far: api.measure.snapAt(at(20)), track };
  });
  check('a nearby recorded sample snaps to its exact point',
    trackSnaps.exact.kind === 'track'
      && trackSnaps.exact.lat === trackSnaps.track.lat
      && trackSnaps.exact.lon === trackSnaps.track.lon,
    JSON.stringify(trackSnaps.exact));
  check('an offset beyond the snap radius stays free',
    trackSnaps.far.kind === 'free', trackSnaps.far.kind);

  // M is the same global toggle through the page and the QuickLook host route.
  await page.keyboard.press('m');
  check('M starts measuring', await page.evaluate(() => window.trailViewer.measure.active()) === true);
  await page.keyboard.press('m');
  check('M finishes measuring', await page.evaluate(() => window.trailViewer.measure.active()) === false);
  await page.evaluate(() => window.trailViewer.pressKey('m'));
  check('the host M route starts measuring',
    await page.evaluate(() => window.trailViewer.measure.active()) === true);
  await page.evaluate(() => window.trailViewer.pressKey('m'));
  check('the host M route finishes measuring',
    await page.evaluate(() => window.trailViewer.measure.active()) === false);

  // 3. Start measuring from the toolbox, then use the map itself.
  await page.click('.toolbox-switch > button');
  await page.click('.toolbox-action[data-tool="measure"]');
  check('the measure action enters the measuring state',
    await page.evaluate(() => window.trailViewer.measure.active()) === true);
  check('the map exposes the measuring cursor class',
    await page.evaluate(() => document.body.classList.contains('measuring')) === true);

  // Left click and a left drag are map gestures, never point insertions.
  await page.click('#map', { button: 'left', position: { x: 560, y: 360 } });
  await waitForLayout(page);
  check('a left click does not add a point',
    (await page.evaluate(() => window.trailViewer.measure.summary().pointCount)) === 0);
  const centerBefore = await page.evaluate(() => {
    const center = window.trailViewer.map.getCenter();
    return [center.lat, center.lng];
  });
  await page.mouse.move(570, 420);
  await page.mouse.down();
  await page.mouse.move(650, 470, { steps: 8 });
  await page.mouse.up();
  await waitForMapIdle(page);
  const centerAfter = await page.evaluate(() => {
    const center = window.trailViewer.map.getCenter();
    return [center.lat, center.lng];
  });
  check('left-drag still pans the map',
    centerBefore[0] !== centerAfter[0] || centerBefore[1] !== centerAfter[1]);
  check('panning adds no measurement point',
    (await page.evaluate(() => window.trailViewer.measure.summary().pointCount)) === 0);

  const zoomBefore = await page.evaluate(() => window.trailViewer.map.getZoom());
  await page.mouse.move(620, 410);
  await page.mouse.wheel(0, -240);
  await page.waitForFunction((before) => window.trailViewer.map.getZoom() > before, zoomBefore);
  await waitForMapIdle(page);
  check('the wheel still zooms for precise placement',
    await page.evaluate((before) => window.trailViewer.map.getZoom() > before, zoomBefore));
  check('zooming adds no measurement point',
    (await page.evaluate(() => window.trailViewer.measure.summary().pointCount)) === 0);

  await page.evaluate(() => window.trailViewer.locate());
  await waitForMapIdle(page);
  const visibleTrackPoint = await page.evaluate(() => {
    const api = window.trailViewer;
    const width = innerWidth;
    const height = innerHeight;
    for (const segment of api.gpx.tracks.flatMap((track) => track.segments)) {
      for (const point of segment) {
        const screen = api.map.latLngToContainerPoint([point.lat, point.lon]);
        if (screen.x > 100 && screen.x < width - 100 && screen.y > 100 && screen.y < height - 100) {
          return { ...point, x: screen.x, y: screen.y };
        }
      }
    }
    return null;
  });
  check('a recorded point is available for the interaction test', Boolean(visibleTrackPoint));
  await page.mouse.move(visibleTrackPoint.x + 9, visibleTrackPoint.y);
  await page.waitForFunction(() => {
    const node = document.querySelector('.measure-snap-label');
    return Boolean(node) && getComputedStyle(node).display !== 'none';
  });
  check('hovering near a track point paints the snap target',
    (await page.locator('.measure-snap-label').textContent()).includes('track point'));

  await page.mouse.click(visibleTrackPoint.x + 9, visibleTrackPoint.y, { button: 'right' });
  await page.waitForFunction(() => window.trailViewer.measure.summary().pointCount === 1);
  await page.mouse.click(680, 440, { button: 'right' });
  await page.waitForFunction(() => window.trailViewer.measure.summary().pointCount === 2);
  const first = await page.evaluate(() => window.trailViewer.measure.summary());
  check('right-click commits measurement points', first.pointCount === 2, `${first.pointCount}`);
  check('each leg contributes to the total', first.totalMeters > 0, `${first.totalMeters}`);
  const snappedPoint = await page.evaluate(() => window.trailViewer.measure.sections()[0][0]);
  check('the committed first point keeps the exact snapped coordinates',
    snappedPoint.kind === 'track'
      && snappedPoint.lat === visibleTrackPoint.lat
      && snappedPoint.lon === visibleTrackPoint.lon,
    JSON.stringify(snappedPoint));

  await page.keyboard.press('Control+z');
  check('Ctrl+Z undoes the last point',
    await page.evaluate(() => window.trailViewer.measure.summary().pointCount) === 1);
  check('the undone point becomes available for redo',
    await page.evaluate(() => window.trailViewer.measure.canRedo()) === true);
  await page.keyboard.press('Control+Shift+z');
  check('Ctrl+Shift+Z redoes the point',
    await page.evaluate(() => window.trailViewer.measure.summary().pointCount) === 2);

  // 4. Ending a section starts an independent line; totals and rows stay separate.
  await page.evaluate(() => window.trailViewer.measure.endSection());
  await page.evaluate(() => window.trailViewer.measure.add({ lat: 46.555, lon: 8.012 }));
  await page.evaluate(() => window.trailViewer.measure.add({ lat: 46.556, lon: 8.013 }));
  const sections = await page.evaluate(() => window.trailViewer.measure.summary());
  check('ending a section starts a second independent section',
    sections.sectionCount === 2 && sections.pointCount === 4, JSON.stringify(sections));
  const distanceLabelSurface = await page.locator('.measure-section-label span').last().evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow };
  });
  check('distance labels are translucent enough to keep the route visible',
    distanceLabelSurface.background === 'rgba(7, 20, 26, 0.58)'
      && distanceLabelSurface.border === 'rgb(255, 242, 168)'
      && distanceLabelSurface.shadow.includes('0.22'),
    JSON.stringify(distanceLabelSurface));

  await page.evaluate(() => window.trailViewer.measure.openToolbox());
  await waitForLayout(page);
  check('the toolbox presents a live total',
    await page.locator('.toolbox-measure-total').textContent() !== '0 m');
  check('the toolbox lists both distance sections',
    await page.locator('.toolbox-section-row').count() === 2);

  await page.click('.toolbox-measure-actions [data-measure="undo"]');
  check('undo removes the last point',
    await page.evaluate(() => window.trailViewer.measure.summary().pointCount) === 3);
  check('the toolbox exposes the redo state',
    await page.locator('.toolbox-measure-actions [data-measure="redo"]').isEnabled());
  await page.click('.toolbox-measure-actions [data-measure="redo"]');
  check('the redo button restores the point',
    await page.evaluate(() => window.trailViewer.measure.summary().pointCount) === 4);
  await page.click('.toolbox-measure-actions [data-measure="undo"]');
  await page.click('.toolbox-measure-actions [data-measure="center"]');
  check('the centre button provides a keyboard-operable point action',
    await page.evaluate(() => window.trailViewer.measure.summary().pointCount) === 4);

  // 5. Export remains the existing panel, now reached from the toolbox.
  await page.evaluate(() => window.trailViewer.measure.stop());
  await page.click('.toolbox-action[data-tool="export"]');
  check('the toolbox opens the existing overlay export panel',
    await page.locator('#export').isVisible());
  const exportSurface = await page.locator('#export').evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, filter: style.backdropFilter };
  });
  check('the export tool page uses the same translucent surface',
    exportSurface.background === toolboxSurface.background
      && exportSurface.filter === toolboxSurface.filter,
    JSON.stringify(exportSurface));
  check('the toolbox closes as the export panel opens',
    await page.evaluate(() => window.trailViewer.measure.toolboxOpen()) === false);
  await page.evaluate(() => window.trailViewer.pressKey('X'));
  check('the existing Shift+X path still closes the export panel',
    await page.evaluate(() => window.trailViewer.panelOpen()) === false);

  // 6. Language updates the labels without resetting points.
  await page.locator('.lang-switch button').click();
  await waitForLayout(page);
  check('the toolbox translates to Chinese',
    await page.locator('#toolbox-panel .toolbox-heading').textContent() === '工具箱');
  check('the measurement result survives the language switch',
    await page.evaluate(() => window.trailViewer.measure.summary().pointCount) === 4);

  await page.evaluate(() => {
    window.trailViewer.measure.start();
    window.trailViewer.measure.openToolbox();
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await waitForLayout(page);
  const narrow = await page.evaluate(() => {
    const rect = document.getElementById('toolbox-panel').getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: innerWidth,
      height: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  check('the measurement panel stays inside a 360 px preview',
    narrow.left >= 0 && narrow.right <= narrow.width
      && narrow.top >= 0 && narrow.bottom <= narrow.height,
    JSON.stringify(narrow));
  check('the toolbox adds no horizontal page overflow', narrow.overflow === false, JSON.stringify(narrow));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await artifacts.capture(page, failures, errors);
  await browser.close();
  server.close();
  process.exit(finish('measurement OK'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
