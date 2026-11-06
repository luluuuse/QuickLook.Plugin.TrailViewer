// Test for a portrait window: the summary takes the width, the controls step down to a line under it, and
// nothing lands on top of anything else. A narrow screen used to squeeze the card into a column of numbers and
// then push the top corners onto one another.
//
//   NODE_PATH=<folder containing playwright-core> node tests/portrait-test.cjs [screenshot.png]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.gpx': 'application/gpx+xml', '.kml': 'application/vnd.google-earth.kml+xml',
};

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const failures = [];
function check(what, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(what);
}

/** Every floating piece of chrome, with the space it occupies. Missing or zero-sized ones are left out. */
const measure = (page) => page.evaluate(() => {
  const parts = {};
  const add = (name, sel) => {
    const node = document.querySelector(sel);
    if (!node) return;
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) return;
    parts[name] = { l: Math.round(box.left), r: Math.round(box.right), t: Math.round(box.top), b: Math.round(box.bottom) };
  };
  add('info', '#info');
  add('keys', '#keys');
  add('zoom', '.leaflet-control-zoom');
  add('layers', '.layer-switch');
  add('pins', '.pins-switch');
  add('lang', '.lang-switch');
  add('profile', '#profile');
  add('scale', '.leaflet-control-scale');
  add('credit', '.leaflet-control-attribution');
  return { w: innerWidth, h: innerHeight, stepped: document.body.classList.contains('stepped'), parts };
});

const overlap = (a, b) => {
  if (!a || !b) return 0;
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? w * h : 0;
};

/** The pairs that share pixels, as text, so a failure names the two boxes instead of a number. */
function clashes(parts) {
  const names = Object.keys(parts);
  const hits = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const area = overlap(parts[names[i]], parts[names[j]]);
      if (area > 0) hits.push(`${names[i]}/${names[j]}=${area}`);
    }
  }
  return hits;
}

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const pageErrors = [];

  const openAt = async (width, height, file = 'track-time-ele.gpx') => {
    const page = await browser.newPage({ viewport: { width, height }, locale: 'en-US' });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${encodeURIComponent(file)}`);
    await page.waitForFunction(() => document.body.classList.contains('loaded'));
    await page.waitForTimeout(120);
    return page;
  };

  // 1. A phone-shaped window (664x1111, the shape of the report that started this).
  let page = await openAt(664, 1111);
  let m = await measure(page);
  let p = m.parts;

  // The card hugs its own text: a portrait window is no reason to stretch it across the map.
  check('the summary keeps its own width', p.info.l === 10 && p.info.r < m.w * 0.65,
    `${p.info.l}..${p.info.r} in ${m.w}`);
  // Four rows in a column was the old behaviour: the ceiling on the card's width collapsed and every number
  // moved to a line of its own.
  check('the card is a band, not a column', p.info.b - p.info.t < 240, `${p.info.b - p.info.t} px tall`);

  const pairs = await page.evaluate(() => [...document.querySelectorAll('#info .stats .pair')].map((n) => {
    const box = n.getBoundingClientRect();
    return { label: n.querySelector('dt').textContent, top: Math.round(box.top), left: Math.round(box.left) };
  }));
  check('the three headline numbers share a row',
    pairs.length === 6 && pairs[0].top === pairs[1].top && pairs[1].top === pairs[2].top,
    pairs.map((x) => `${x.label}@${x.top}`).join(' '));
  check('distance, time and points share the next',
    pairs[3].top === pairs[4].top && pairs[4].top === pairs[5].top && pairs[3].top > pairs[0].top,
    pairs.slice(3).map((x) => `${x.label}@${x.top}`).join(' '));
  // Three columns, not six numbers that happen to break into two lines: the point count sits under the drop.
  check('the columns line up between the two rows',
    pairs[3].left === pairs[0].left && pairs[4].left === pairs[1].left && pairs[5].left === pairs[2].left,
    pairs.map((x) => `${x.label}@${x.left}`).join(' '));

  check('the key bar stands down', !p.keys, p.keys ? `${p.keys.l}..${p.keys.r}` : 'hidden');

  // The English switches are wide enough that this corner cannot hold them beside the card, so the controls step
  // down and take a line of their own: the zoom against the left edge, the three switches against the right.
  check('this window leaves no room up top, so the controls step down', m.stepped);
  check('the zoom buttons sit below the card', p.zoom.t >= p.info.b, `${p.zoom.t} vs ${p.info.b}`);
  check('so do the three switches',
    p.layers.t >= p.info.b && p.pins.t >= p.info.b && p.lang.t >= p.info.b,
    `${p.layers.t}/${p.pins.t}/${p.lang.t} vs ${p.info.b}`);
  check('and all of it shares one line', p.zoom.t === p.layers.t && p.layers.t === p.pins.t,
    `${p.zoom.t}/${p.layers.t}/${p.pins.t}`);

  check('nothing overlaps anything', clashes(p).length === 0, clashes(p).join(' ') || 'clean');
  check('the card does not reach the profile', p.info.b < p.profile.t, `${p.info.b} vs ${p.profile.t}`);

  // 1b. The window of the report: 849x1357 with the long file name. The card is wide, but not so wide that the
  //     top band is full -- the corner is free, so the switches belong in it. Stepping them down here left them
  //     hanging in the middle of the map, a hundred pixels of nothing to their left, which is what was reported.
  const report = await openAt(849, 1357, '2026-02-01-alpine-snow-traverse-1793781751910.gpx');
  const rm = await measure(report);
  check('the reported window keeps its switches in the corner',
    !rm.stepped && rm.parts.layers.t < 60,
    `${rm.stepped ? 'stepped' : 'top band'}, layers at ${rm.parts.layers.t}`);
  check('and the zoom stands at the card edge there',
    Math.abs(rm.parts.zoom.l - rm.parts.info.r - 8) <= 1,
    `${rm.parts.zoom.l} vs card ${rm.parts.info.r}`);
  check('and nothing overlaps there', clashes(rm.parts).length === 0, clashes(rm.parts).join(' ') || 'clean');
  await report.close();

  // 2. The other side of the breakpoint: a wide window keeps the old arrangement.
  const wide = await openAt(1200, 800);
  const wm = await measure(wide);
  check('a wide window keeps the key bar', !!wm.parts.keys, wm.parts.keys ? 'shown' : 'hidden');
  check('and the card keeps its own width',
    wm.parts.info.r - wm.parts.info.l < wm.w * 0.4, `${wm.parts.info.r - wm.parts.info.l} of ${wm.w}`);
  check('the wide window has no overlaps', clashes(wm.parts).length === 0, clashes(wm.parts).join(' ') || 'clean');
  await wide.close();

  // 3. The rule is the shape of the window, not its width: a 1000x1400 window is portrait even though it is
  //    wider than any phone, and the bar that collided there is the same bar.
  const tall = await openAt(1000, 1400);
  const tallM = await measure(tall);
  check('a wide-but-tall window is portrait too',
    tallM.parts.info.l === 10 && !tallM.parts.keys,
    `${tallM.parts.info.l}..${tallM.parts.info.r} in ${tallM.w}, keys ${tallM.parts.keys ? 'shown' : 'hidden'}`);
  check('but here the card leaves the corner free, so nothing steps down',
    !tallM.stepped && tallM.parts.layers.t < 60,
    `${tallM.stepped ? 'stepped' : 'top band'}, layers at ${tallM.parts.layers.t}`);
  check('and nothing overlaps there', clashes(tallM.parts).length === 0, clashes(tallM.parts).join(' ') || 'clean');
  await tall.close();

  // Narrow landscape: not portrait, but still too narrow for the widescreen chrome. 900 is the awkward one --
  // wide enough to escape a width rule of yesteryear, too narrow for the bar and the layer switch together.
  for (const [w, h] of [[900, 620], [820, 600]]) {
    const narrow = await openAt(w, h);
    const nm = await measure(narrow);
    check(`a ${w}x${h} window is compact`,
      nm.parts.info.l === 10 && !nm.parts.keys,
      `${nm.parts.info.l}..${nm.parts.info.r} in ${nm.w}, keys ${nm.parts.keys ? 'shown' : 'hidden'}`);
    check(`and ${w}x${h} has no overlaps`, clashes(nm.parts).length === 0, clashes(nm.parts).join(' ') || 'clean');
    await narrow.close();
  }
  const narrow = await openAt(820, 600);
  const nm = await measure(narrow);
  check('a narrow landscape window is compact too',
    nm.parts.info.l === 10 && !nm.parts.keys,
    `${nm.parts.info.l}..${nm.parts.info.r} in ${nm.w}, keys ${nm.parts.keys ? 'shown' : 'hidden'}`);
  check('and has no overlaps', clashes(nm.parts).length === 0, clashes(nm.parts).join(' ') || 'clean');
  await narrow.close();

  const squat = await openAt(1100, 1000);
  const squatM = await measure(squat);
  check('a landscape window of the same size keeps the bar', !!squatM.parts.keys);
  check('and the card keeps its own width',
    squatM.parts.info.r - squatM.parts.info.l < squatM.w * 0.4,
    `${squatM.parts.info.r - squatM.parts.info.l} of ${squatM.w}`);
  await squat.close();

  // 4. Very narrow: the switches no longer fit beside the zoom, so they wrap instead of covering it.
  const tiny = await openAt(360, 740);
  const tm = await measure(tiny);
  check('a 360 px window still has no overlaps', clashes(tm.parts).length === 0, clashes(tm.parts).join(' ') || 'clean');
  check('the credit clears the scale bar',
    overlap(tm.parts.scale, tm.parts.credit) === 0,
    `${JSON.stringify(tm.parts.scale)} vs ${JSON.stringify(tm.parts.credit)}`);

  if (shot) await page.screenshot({ path: shot });
  await tiny.close();
  await page.close();
  await browser.close();
  server.close();

  check('the page raised no errors', pageErrors.length === 0, pageErrors.join(' | '));
  console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} failed`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
