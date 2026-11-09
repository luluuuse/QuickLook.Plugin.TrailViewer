// The overlay export: a transparent picture with the track on the left and the totals in a column on the right.
//
//   NODE_PATH=<folder containing playwright-core> node tests/export-test.cjs
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
const path = require('path');
const { launchBrowser } = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures, finish } = createChecker('export');
const artifacts = createArtifacts('export');

// Everything is measured on the canvas itself: the ink's own bounding box says where the drawing went,
// which is the one thing a screenshot or a file size cannot tell us. The split between track and column is
// the rule's own position, not a number of pixels that only holds at one shape.
const measure = () => {
  const canvas = window.__canvas;
  const ctx = canvas.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rule = Math.round(width * 0.648);
  const edge = rule - 10; // the rule is a one-pixel line on the boundary; leave it out of both sides
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  let track = 0;
  let column = 0;
  let opaque = 0;
  let trackRight = -1;
  let trackBottom = -1;
  let columnLeft = width;
  let dark = 0;
  let light = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3];
      if (alpha < 16) continue;
      opaque += 1;
      // The ink the type is set in: solid pixels that are almost black, against the few that are not.
      if (alpha > 200) {
        if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60) dark += 1;
        else if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230) light += 1;
      }
      if (x < edge) {
        track += 1;
        if (x > trackRight) trackRight = x;
        if (y > trackBottom) trackBottom = y;
      } else {
        column += 1;
        if (x < columnLeft) columnLeft = x;
      }
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  const at = (x, y) => data[(y * width + x) * 4 + 3];
  return {
    width, height, rule, left, right, top, bottom, track, column, opaque, trackRight, trackBottom, columnLeft, dark, light,
    corners: [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)],
    // At the right edge, halfway down: outside every word and hairline, where a backing would show if there
    // is one and nothing else is ever drawn.
    shade: at(width - 3, Math.round(height * 0.5)),
  };
};

// The landscape page is measured by its own two halves: the figures in the top third, the track in the band
// below. The line between them is the layout's own (37 % of the height), not a number that only holds at one
// size. The ink is grouped into rows and columns, which is enough to say "a heading over a 2 x 2 block"
// without knowing a single font size.
const measureRow = () => {
  const canvas = window.__canvas;
  const ctx = canvas.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const split = Math.round(height * 0.365);
  const at = (x, y) => data[(y * width + x) * 4 + 3];
  let figures = 0;
  let band = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let bandMinX = width;
  let bandMaxX = -1;
  let bandMinY = height;
  let bandMaxY = -1;
  const rows = new Uint16Array(split);
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (data[(y * width + x) * 4 + 3] < 16) continue;
      if (y < split) {
        figures += 1;
        rows[y] += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else {
        band += 1;
        if (x < bandMinX) bandMinX = x;
        if (x > bandMaxX) bandMaxX = x;
        if (y < bandMinY) bandMinY = y;
        if (y > bandMaxY) bandMaxY = y;
      }
    }
  }
  // Lines of type: bands of rows that carry ink, once the gaps inside a letter are closed.
  const lines = [];
  for (let y = 0; y < split; y += 1) {
    if (rows[y] === 0) continue;
    const last = lines[lines.length - 1];
    if (last && y - last[1] <= 2) last[1] = y;
    else lines.push([y, y]);
  }
  // Columns of ink inside the grid half of the block: two clusters means the numbers really are two abreast.
  const gridTop = Math.round(height * 0.19);
  const hits = [];
  for (let x = 0; x < maxX; x += 2) {
    let hit = false;
    for (let y = gridTop; y < maxY; y += 2) {
      if (data[(y * width + x) * 4 + 3] > 16) { hit = true; break; }
    }
    if (hit) hits.push(x);
  }
  const columns = [];
  for (const x of hits) {
    const last = columns[columns.length - 1];
    if (last && x - last[1] <= 20) last[1] = x;
    else columns.push([x, x]);
  }
  return {
    width, height, split, figures, band,
    minX, minY, maxX, maxY, bandMinX, bandMaxX, bandMinY, bandMaxY,
    lines: lines.map(([a, b]) => ({ from: a, to: b, height: b - a })),
    columns,
    corners: [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)],
    // Inside the wash, top right: where a backing shows if there is one and the track never reaches.
    shade: at(Math.round(width * 0.6), Math.round(height * 0.12)),
    clear: at(width - 3, Math.round(height * 0.12)),
  };
};

async function overlayOf(page, base, fixture, options) {
  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${encodeURIComponent(fixture)}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded') || document.body.classList.contains('failed'));
  return page.evaluate(async (opts) => {
    window.__canvas = await window.gpxViewer.overlayCanvas(opts);
    return true;
  }, options || {}).then(() => page.evaluate(measure));
}

async function rowOf(page, base, fixture, options) {
  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${encodeURIComponent(fixture)}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded') || document.body.classList.contains('failed'));
  return page.evaluate(async (opts) => {
    window.__canvas = await window.gpxViewer.overlayCanvas(opts);
    return true;
  }, options || {}).then(() => page.evaluate(measureRow));
}

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await artifacts.start(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // The default shape, which is also the portrait page the tests below lean on.
  const loop = await overlayOf(page, base, '2026-02-01-alpine-snow-traverse-1793781751910.gpx');
  check('the default picture is 1080x1920, the portrait page', loop.width === 1080 && loop.height === 1920,
    `${loop.width}x${loop.height}`);
  check('the background is transparent', loop.corners.every((a) => a === 0), loop.corners.join(' '));
  check('something was drawn', loop.opaque > 5000, `${loop.opaque} samples`);
  check('the track sits on the left', loop.track > loop.column / 6, `${loop.track} track / ${loop.column} column`);
  check('the totals sit on the right', loop.column > 200, `${loop.column} samples`);
  check('the track keeps to its own half', loop.trackRight < loop.rule - 10 && loop.trackBottom <= loop.height * 0.88,
    `track ends at ${loop.trackRight},${loop.trackBottom}`);
  check('the column starts at the rule', loop.columnLeft >= loop.rule - 10, `column starts at ${loop.columnLeft}`);
  check('nothing runs off the edge', loop.left > 8 && loop.top > 8 && loop.right < loop.width - 8 && loop.bottom < loop.height - 8,
    `${loop.left},${loop.top} .. ${loop.right},${loop.bottom}`);
  check('the backing is off by default', loop.shade === 0, `alpha ${loop.shade}`);
  // The type is black, so the overlay can sit on a bright photo without a wash behind it. The badges take
  // their own ink from the same rule; nothing in the picture is set in white.
  check('the type is black', loop.dark > 800, `${loop.dark} solid black samples`);
  check('and no white ink is left', loop.light === 0, `${loop.light} white samples`);

  // The square: same page, a shorter canvas, and the drawing fills it rather than sitting at the top.
  const square = await overlayOf(page, base, '2026-02-01-alpine-snow-traverse-1793781751910.gpx', { size: '1:1' });
  check('1:1 is 1536x1536, the square', square.width === 1536 && square.height === 1536,
    `${square.width}x${square.height}`);
  check('the square keeps the same proportions',
    square.trackRight < square.rule - 10 && square.columnLeft >= square.rule - 10,
    `track ends at ${square.trackRight}, column starts at ${square.columnLeft}`);
  check('the square spreads the drawing down the shorter canvas',
    Math.abs(square.bottom / square.height - loop.bottom / loop.height) < 0.03,
    `${(square.bottom / square.height).toFixed(3)} vs ${(loop.bottom / loop.height).toFixed(3)}`);
  check('1:1 stays inside the frame', square.bottom < square.height - 8 && square.top > 8,
    `${square.top} .. ${square.bottom}`);

  // The backing: a wash behind the column, faint enough to still see the photo through, and soft at the
  // corners so the picture does not get a white rectangle pasted onto it. With black type the wash is light:
  // it lifts a dark photo instead of knocking down a bright one.
  const backed = await overlayOf(page, base, '2026-02-01-alpine-snow-traverse-1793781751910.gpx', { scrim: 'soft' });
  check('the backing lifts the column side', backed.shade > 20 && backed.shade < 140, `alpha ${backed.shade}`);
  check('and leaves the corners clear', backed.corners.every((a) => a === 0), backed.corners.join(' '));

  // The landscape page: figures in a column at the left, the track on the right, and no rules at all.
  const wide = await rowOf(page, base, '2026-02-01-alpine-snow-traverse-1793781751910.gpx', { size: '4:3' });
  check('4:3 is 2048x1536, the landscape page', wide.width === 2048 && wide.height === 1536,
    `${wide.width}x${wide.height}`);
  check('the landscape background is transparent', wide.corners.every((a) => a === 0), wide.corners.join(' '));
  check('the figures are in the upper third', wide.figures > 500, `${wide.figures} samples`);
  check('and the track in the band below', wide.band > 5000 && wide.bandMinY > wide.split,
    `${wide.band} samples from y ${wide.bandMinY}`);
  check('the figures start at the left margin', Math.abs(wide.minX - wide.width * 0.05) < wide.width * 0.02,
    `ink starts at ${wide.minX}`);
  check('the heading is the topmost line', wide.minY < wide.height * 0.1, `ink starts at ${wide.minY}`);
  // Six lines of ink: the heading, then a value band and a label band per row of the 2 x 2.
  check('the heading is the largest line', wide.lines.length >= 5
    && wide.lines[0].height > Math.max(...wide.lines.slice(1).map((b) => b.height)) * 1.4,
    wide.lines.map((b) => b.height).join(' '));
  check('the rest of the figures are two abreast', wide.columns.length === 2,
    wide.columns.map(([a, b]) => `${a}-${b}`).join(' '));
  check('the block stops inside the top third', wide.maxY < wide.height * 0.37, `ink ends at ${wide.maxY}`);
  check('and inside the left half', wide.maxX < wide.width * 0.5, `ink ends at ${wide.maxX}`);
  check('the block never reaches down into the track', wide.maxY < wide.bandMinY, `${wide.maxY} < ${wide.bandMinY}`);

  // The point of a landscape page: a track that runs wide uses the whole band. A loop can only fill its
  // height, so it is expected to leave the sides -- measuring both says the band is real, not a guess.
  const across = await rowOf(page, base, 'wide-track.gpx', { size: '4:3' });
  check('an east-west track spans the band', across.bandMinX < across.width * 0.1
    && across.bandMaxX > across.width * 0.9, `${across.bandMinX}..${across.bandMaxX} of ${across.width}`);
  check('a loop only fills the height of it', wide.bandMaxX - wide.bandMinX < across.bandMaxX - across.bandMinX,
    `${wide.bandMaxX - wide.bandMinX} vs ${across.bandMaxX - across.bandMinX}`);

  // The backing on a landscape page belongs behind the figures, so it sits at the top and fades before the
  // track, not over the right half as it does on a portrait one.
  const wideBacking = await rowOf(page, base, 'wide-track.gpx', { size: '4:3', ink: 'white', scrim: 'soft' });
  check('the landscape backing sits behind the figures', wideBacking.shade > 20, `alpha ${wideBacking.shade}`);
  check('and has faded out before the track', wideBacking.clear === 0, `alpha ${wideBacking.clear}`);

  // White ink, for a photo that is dark: the type flips, and the backing with it.
  const pale = await overlayOf(page, base, '2026-02-01-alpine-snow-traverse-1793781751910.gpx', { ink: 'white' });
  check('white ink draws white type', pale.light > 800, `${pale.light} white samples`);
  check('and leaves almost no black', pale.dark < 200, `${pale.dark} black samples`);
  const paleBacking = await overlayOf(page, base, '2026-02-01-alpine-snow-traverse-1793781751910.gpx',
    { ink: 'white', scrim: 'soft' });
  check('the backing goes dark behind white ink', paleBacking.shade > 20, `alpha ${paleBacking.shade}`);

  // GPX accepts +/-90 degrees although Web Mercator does not. A valid polar point must not poison the
  // whole export, and a route crossing the date line must use the short way around the globe.
  const projection = await page.evaluate(async () => {
    const m = await import('./export.js');
    return {
      north: m.mercator({ lat: 90, lon: 0 }),
      south: m.mercator({ lat: -90, lon: 0 }),
      east: m.unwrapLongitude(-179, 179),
      west: m.unwrapLongitude(179, -179),
    };
  });
  check('polar export coordinates stay finite',
    Number.isFinite(projection.north.y) && Number.isFinite(projection.south.y), JSON.stringify(projection));
  check('the date line wraps the short way', projection.east === 181 && projection.west === -181,
    JSON.stringify(projection));

  const simplified = await page.evaluate(async () => {
    const m = await import('./export.js');
    const points = Array.from({ length: 100 }, (_, i) => ({
      xy: [i, i < 50 ? 0 : 100],
    }));
    const kept = m.simplifyPath(points, 0.35);
    return { count: kept.length, first: kept[0].xy, last: kept[kept.length - 1].xy, corner: kept[1].xy };
  });
  check('pixel simplification keeps the ends and a real corner',
    simplified.count === 4 && simplified.first[0] === 0 && simplified.last[0] === 99
      && (simplified.corner[0] === 49 || simplified.corner[0] === 50), JSON.stringify(simplified));

  // A straight, flat route: no heights to colour by, so the ramp collapses to one colour and the column loses
  // the rows that would have shown a height. It still has to draw.
  const flat = await overlayOf(page, base, 'flat-city.gpx');
  check('a file without heights still exports', flat.opaque > 5000, `${flat.opaque} samples`);
  check('and loses the two height rows', flat.column < loop.column * 0.8,
    `${flat.column} vs ${loop.column}`);

  // ---------- the panel ----------
  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${encodeURIComponent('2026-02-01-alpine-snow-traverse-1793781751910.gpx')}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));

  const hiddenFirst = await page.evaluate(() => document.getElementById('export').hidden);
  check('the panel starts closed', hiddenFirst === true);
  check('black ink is the default', await page.evaluate(() => window.gpxViewer.exportSettings().ink) === 'black');

  await page.evaluate(() => window.gpxViewer.pressKey('X'));
  check('shift+X opens it', await page.evaluate(() => window.gpxViewer.panelOpen()) === true);
  check('and it is on screen', await page.locator('#export').isVisible());
  check('opening the panel moves focus to its action',
    await page.evaluate(() => document.activeElement?.classList.contains('go')) === true);
  check('the export panel is a labelled dialog',
    await page.locator('#export').getAttribute('role') === 'dialog'
      && await page.locator('#export').getAttribute('aria-labelledby') === 'export-title');

  const shapes = await page.locator('#export .pick').first().locator('.option').allTextContents();
  check('the panel offers three shapes, named for what they are',
    shapes.join('|') === '方版|竖版|横版', shapes.join('|'));
  check('and no portrait-photo shape is left over',
    (await page.locator('#export .option[data-value="3:4"]').count()) === 0);

  await page.click('#export .pick .option[data-value="1:1"]');
  check('a click chooses a shape', await page.evaluate(() => window.gpxViewer.exportSettings().size) === '1:1');
  check('the chosen shape exposes its pressed state',
    await page.locator('#export .option[data-value="1:1"]').getAttribute('aria-pressed') === 'true'
      && await page.locator('#export .option[data-value="9:16"]').getAttribute('aria-pressed') === 'false');
  check('the chosen cell is the marked one',
    await page.locator('#export .pick .option[data-value="1:1"]').evaluate((n) => n.classList.contains('on')));

  await page.click('#export .pick .option[data-value="white"]');
  check('and an ink', await page.evaluate(() => window.gpxViewer.exportSettings().ink) === 'white');

  await page.click('#export .pick .option[data-value="soft"]');
  check('and a backing', await page.evaluate(() => window.gpxViewer.exportSettings().scrim) === 'soft');

  // All three settings are remembered: a reload is what a new preview looks like.
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  check('the choices survive a reload',
    JSON.stringify(await page.evaluate(() => window.gpxViewer.exportSettings()))
      === '{"size":"1:1","ink":"white","scrim":"soft"}');

  // X on its own exports with those settings and keeps the panel out of the way.
  await page.evaluate(() => window.gpxViewer.pressKey('X'));
  await page.evaluate(() => window.gpxViewer.pressKey('x'));
  check('X closes the panel again', await page.evaluate(() => window.gpxViewer.panelOpen()) === false);

  await page.evaluate(() => window.gpxViewer.pressKey('X'));
  await page.click('#export .go');
  await page.waitForFunction(() => window.gpxViewer.panelOpen() === false);
  check('the export button closes the panel', await page.evaluate(() => window.gpxViewer.panelOpen()) === false);

  check('no page errors', errors.length === 0, errors.join(' | '));

  await artifacts.capture(page, failures, errors);
  await browser.close();
  server.close();
  process.exit(finish('overlay OK'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
