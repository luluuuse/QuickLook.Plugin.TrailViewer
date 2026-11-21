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
  let gridMaxX = -1;
  let bandMinX = width;
  let bandMaxX = -1;
  let bandMinY = height;
  let bandMaxY = -1;
  const gridTop = Math.round(height * 0.19);
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
        if (y >= gridTop && x > gridMaxX) gridMaxX = x;
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
    minX, minY, maxX, maxY, gridMaxX, bandMinX, bandMaxX, bandMinY, bandMaxY,
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
    window.__canvas = await window.trailViewer.overlayCanvas(opts);
    return true;
  }, options || {}).then(() => page.evaluate(measure));
}

async function rowOf(page, base, fixture, options) {
  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${encodeURIComponent(fixture)}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded') || document.body.classList.contains('failed'));
  return page.evaluate(async (opts) => {
    window.__canvas = await window.trailViewer.overlayCanvas(opts);
    return true;
  }, options || {}).then(() => page.evaluate(measureRow));
}

async function textOf(page, base, fixture, options) {
  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${encodeURIComponent(fixture)}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded') || document.body.classList.contains('failed'));
  return page.evaluate(async (opts) => {
    const texts = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function capture(text, ...args) {
      texts.push(String(text));
      return original.call(this, text, ...args);
    };
    try {
      await window.trailViewer.overlayCanvas(opts);
    } finally {
      CanvasRenderingContext2D.prototype.fillText = original;
    }
    return texts;
  }, options || {});
}

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' });
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
  const loopText = await textOf(page, base, '2026-02-01-alpine-snow-traverse-1793781751910.gpx');
  check('the exported route name identifies the track',
    loopText.includes('Alpine snow traverse'), loopText.join(' | '));
  check('the exported track date identifies the day',
    loopText.includes('2026.01.05'), loopText.join(' | '));
  const labels = ['总用时', '爬升', '最高海拔', '运动均速'];
  const labelPositions = labels.map((label) => loopText.indexOf(label));
  check('hiking metrics put ascent ahead of elevation and speed',
    labelPositions.every((index) => index >= 0)
      && labelPositions.every((index, i) => i === 0 || index > labelPositions[i - 1]),
    labelPositions.join(' '));

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
  check('and inside the left half', wide.gridMaxX < wide.width * 0.5, `figures end at ${wide.gridMaxX}`);
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

  const networkText = await textOf(page, base, 'kml-network.kml');
  check('a route network keeps its document name', networkText.includes('West Lake route network'),
    networkText.join(' | '));
  check('and is labelled as a network', networkText.includes('路网'), networkText.join(' | '));
  check('a network reports route length and segment count',
    networkText.includes('路线长度') && networkText.includes('轨迹段'), networkText.join(' | '));
  check('a network does not invent start, end or trip metrics',
    !networkText.includes('起') && !networkText.includes('终')
      && !networkText.includes('总用时') && !networkText.includes('最高海拔'),
    networkText.join(' | '));

  // ---------- the panel ----------
  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${encodeURIComponent('2026-02-01-alpine-snow-traverse-1793781751910.gpx')}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));

  check('the standalone export panel no longer exists',
    await page.locator('#export').count() === 0);
  check('black ink is the default', await page.evaluate(() => window.trailViewer.exportSettings().ink) === 'black');

  await page.evaluate(() => window.trailViewer.pressKey('X'));
  check('X no longer opens export settings',
    await page.evaluate(() => window.trailViewer.panelOpen()) === false);
  await page.click('.toolbox-switch button');
  await page.click('.toolbox-action[data-tool="export"]');
  check('the export settings are a toolbox page',
    await page.locator('#toolbox-panel .toolbox-export').isVisible()
      && await page.evaluate(() => window.trailViewer.panelOpen()) === true);
  check('opening export settings moves focus to its action',
    await page.evaluate(() => document.activeElement?.classList.contains('go')) === true);

  const shapes = await page.locator('.toolbox-export-settings .pick').first().locator('.option').allTextContents();
  check('the panel offers three shapes, named for what they are',
    shapes.join('|') === '方版|竖版|横版', shapes.join('|'));
  check('and no portrait-photo shape is left over',
    (await page.locator('.toolbox-export-settings .option[data-value="3:4"]').count()) === 0);
  const shapeHints = await page.locator('.toolbox-export-settings .pick').first().locator('.option')
    .evaluateAll((nodes) => nodes.map((node) => node.title));
  check('shape choices explain their dimensions and use',
    shapeHints[0]?.includes('1536 × 1536')
      && shapeHints[1]?.includes('1080 × 1920')
      && shapeHints[2]?.includes('2048 × 1536'),
    shapeHints.join(' | '));
  const inkHints = await page.locator('.toolbox-export-settings .pick').nth(1).locator('.option')
    .evaluateAll((nodes) => nodes.map((node) => node.title));
  check('ink choices explain when to use each colour',
    /明亮|浅色/.test(inkHints[0]) && /深色|较暗/.test(inkHints[1]), inkHints.join(' | '));
  const scrimHints = await page.locator('.toolbox-export-settings .pick').nth(2).locator('.option')
    .evaluateAll((nodes) => nodes.map((node) => node.title));
  check('backing choices explain transparency and readability',
    /透明/.test(scrimHints[0]) && /文字/.test(scrimHints[1]), scrimHints.join(' | '));

  await page.waitForFunction(() =>
    document.querySelector('.toolbox-export-preview')?.dataset.state === 'ready');
  const previewBefore = await page.locator('.toolbox-export-preview canvas').evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    pixels: canvas.toDataURL(),
    label: canvas.parentElement.getAttribute('aria-label'),
  }));
  check('the export page renders a preview at the chosen aspect ratio',
    Math.abs(previewBefore.width / previewBefore.height - 9 / 16) < 0.03
      && previewBefore.label === '叠加图预览',
    `${previewBefore.width}x${previewBefore.height} ${previewBefore.label}`);
  const previewOutline = await page.locator('.toolbox-export-preview canvas').evaluate((canvas) => {
    const style = getComputedStyle(canvas);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  check('the preview has a visible image boundary',
    previewOutline.style === 'solid' && previewOutline.width === '1px',
    JSON.stringify(previewOutline));

  await page.click('.toolbox-export-settings .pick .option[data-value="1:1"]');
  await page.waitForFunction(() =>
    document.querySelector('.toolbox-export-preview')?.dataset.size === '1:1'
      && document.querySelector('.toolbox-export-preview')?.dataset.state === 'ready');
  check('a click chooses a shape', await page.evaluate(() => window.trailViewer.exportSettings().size) === '1:1');
  check('the chosen shape exposes its pressed state',
    await page.locator('.toolbox-export-settings .option[data-value="1:1"]').getAttribute('aria-pressed') === 'true'
      && await page.locator('.toolbox-export-settings .option[data-value="9:16"]').getAttribute('aria-pressed') === 'false');
  check('the chosen cell is the marked one',
    await page.locator('.toolbox-export-settings .pick .option[data-value="1:1"]').evaluate((n) => n.classList.contains('on')));
  const squarePreview = await page.locator('.toolbox-export-preview canvas').evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    pixels: canvas.toDataURL(),
  }));
  check('the preview follows a shape change',
    Math.abs(squarePreview.width / squarePreview.height - 1) < 0.03
      && squarePreview.pixels !== previewBefore.pixels,
    `${squarePreview.width}x${squarePreview.height}`);

  await page.click('.toolbox-export-settings .pick .option[data-value="white"]');
  await page.waitForFunction(() =>
    document.querySelector('.toolbox-export-preview')?.dataset.ink === 'white'
      && document.querySelector('.toolbox-export-preview')?.dataset.state === 'ready');
  check('and an ink', await page.evaluate(() => window.trailViewer.exportSettings().ink) === 'white');
  const whitePreview = await page.locator('.toolbox-export-preview canvas').evaluate((canvas) => canvas.toDataURL());
  check('the preview follows an ink change', whitePreview !== squarePreview.pixels);

  await page.click('.toolbox-export-settings .pick .option[data-value="soft"]');
  await page.waitForFunction(() =>
    document.querySelector('.toolbox-export-preview')?.dataset.scrim === 'soft'
      && document.querySelector('.toolbox-export-preview')?.dataset.state === 'ready');
  check('and a backing', await page.evaluate(() => window.trailViewer.exportSettings().scrim) === 'soft');
  const backedPreview = await page.locator('.toolbox-export-preview canvas').evaluate((canvas) => canvas.toDataURL());
  check('the preview follows a backing change', backedPreview !== whitePreview);

  // All three settings are remembered: a reload is what a new preview looks like.
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await page.click('.toolbox-switch button');
  await page.click('.toolbox-action[data-tool="export"]');
  check('the choices survive a reload',
    JSON.stringify(await page.evaluate(() => window.trailViewer.exportSettings()))
      === '{"size":"1:1","ink":"white","scrim":"soft","content":"full","profile":"off"}');

  await page.setViewportSize({ width: 360, height: 740 });
  const narrow = await page.locator('#toolbox-panel').evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right, width: innerWidth };
  });
  check('the shared export page stays inside a 360 px preview',
    narrow.left >= 0 && narrow.right <= narrow.width, JSON.stringify(narrow));

  await page.evaluate(() => {
    window.__exportNames = [];
    window.__exportDone = 0;
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      addEventListener() {},
      postMessage(message) {
        if (message.startsWith('export\t')) {
          window.__exportNames.push(decodeURIComponent(message.split('\t')[3]));
        } else if (message.startsWith('exportdone\t')) {
          window.__exportDone += 1;
        }
      },
    };
  });
  await page.click('.toolbox-export-settings .go');
  await page.waitForFunction(() => window.__exportDone >= 1);
  check('the export button keeps the shared toolbox open',
    await page.evaluate(() => window.trailViewer.panelOpen()) === true
      && await page.evaluate(() => window.trailViewer.measure.toolboxOpen()) === true);

  await page.click('.toolbox-export-settings .pick .option[data-value="4:3"]');
  await page.click('.toolbox-export-settings .pick .option[data-value="black"]');
  await page.click('.toolbox-export-settings .pick .option[data-value="none"]');
  await page.waitForFunction(() =>
    document.querySelector('.toolbox-export-preview')?.dataset.size === '4:3'
      && document.querySelector('.toolbox-export-preview')?.dataset.ink === 'black'
      && document.querySelector('.toolbox-export-preview')?.dataset.scrim === 'none'
      && document.querySelector('.toolbox-export-preview')?.dataset.state === 'ready');
  await page.click('.toolbox-export-settings .go');
  await page.waitForFunction(() => window.__exportDone >= 2);
  const exportNames = await page.evaluate(() => window.__exportNames);
  check('different styles can be exported consecutively without leaving the tool',
    exportNames.length === 2
      && exportNames[0].endsWith('-1x1-white-soft.png')
      && exportNames[1].endsWith('-4x3-black-none.png')
      && exportNames[0] !== exportNames[1],
    exportNames.join(' | '));
  check('the toolbox remains available after the second export',
    await page.evaluate(() => window.trailViewer.panelOpen()) === true);

  // Pure track & elevation silhouette modes.
  await page.click('.toolbox-export-settings .row[data-field="content"] .option[data-value="track"]');
  await page.click('.toolbox-export-settings .row[data-field="profile"] .option[data-value="ele"]');
  await page.waitForFunction(() =>
    document.querySelector('.toolbox-export-preview')?.dataset.content === 'track'
      && document.querySelector('.toolbox-export-preview')?.dataset.profile === 'ele'
      && document.querySelector('.toolbox-export-preview')?.dataset.state === 'ready');
  const bareState = await page.evaluate(() => ({
    scrimDisabled: [...document.querySelectorAll('.toolbox-export-settings .row[data-field="scrim"] .option')]
      .every((button) => button.disabled),
    settings: window.trailViewer.exportSettings(),
  }));
  check('pure track mode disables backing options and updates settings',
    bareState.scrimDisabled && bareState.settings.content === 'track' && bareState.settings.profile === 'ele',
    JSON.stringify(bareState));
  await page.click('.toolbox-export-settings .go');
  await page.waitForFunction(() => window.__exportDone >= 3);
  const bareExportName = await page.evaluate(() => window.__exportNames.at(-1) || '');
  check('pure track with silhouette exports with -bare-ele suffix',
    bareExportName.endsWith('-4x3-black-none-bare-ele.png'), bareExportName);
  const bareTexts = await textOf(page, base, '2026-02-01-alpine-snow-traverse-1793781751910.gpx', {
    content: 'track', profile: 'ele',
  });
  check('pure track export omits heading and stat text except start/end badges',
    bareTexts.length <= 2 && !bareTexts.some((item) => item.includes('km')),
    bareTexts.join(' | '));
  const bareCanvas = await overlayOf(page, base, '2026-02-01-alpine-snow-traverse-1793781751910.gpx', {
    content: 'track', profile: 'ele',
  });
  check('pure track with silhouette renders transparent PNG with ink',
    bareCanvas.corners.every((a) => a === 0) && bareCanvas.opaque > 3000,
    `${bareCanvas.opaque}`);

  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/waypoints-route.gpx`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await page.click('.toolbox-switch button');
  await page.click('.toolbox-action[data-tool="export"]');
  const noEleProfileDisabled = await page.locator(
    '.toolbox-export-settings .row[data-field="profile"] .option[data-value="ele"]',
  ).isDisabled();
  check('elevation silhouette option is disabled on files without elevation', noEleProfileDisabled === true);

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
