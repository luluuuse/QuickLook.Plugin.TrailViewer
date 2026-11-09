// Test for the height of the elevation profile: how far the ground is stretched vertically, and whether
// that stays the same when the window changes.
//
//   NODE_PATH=<folder containing playwright-core> node tests/ve-test.cjs
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
//
// The number under test is vertical exaggeration: (plot pixels per metre of height) / (plot pixels per metre
// of ground). A profile has one free scale -- the width is spent fitting the whole route across the panel --
// so the height is what sets it. A fixed height made it the window's business; these assertions pin it to
// the route instead.
const path = require('path');
const { launchBrowser, waitForLayout } = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures } = createChecker('ve');
const artifacts = createArtifacts('ve');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' });
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  async function open(file) {
    await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${encodeURIComponent(file)}`);
    await page.waitForFunction(() => document.body.classList.contains('loaded'));
    await waitForLayout(page);
  }

  // Everything the assertions need, read off the page rather than assumed: the plot's height, the width the
  // route is drawn across, and the exaggeration those two imply.
  const measure = () => page.evaluate(() => {
    const plot = document.querySelector('#profile .plot');
    const chart = document.querySelector('#profile .chart');
    const box = document.getElementById('profile');
    const note = document.querySelector('#profile .scale');
    if (!plot || !chart) return null;
    const data = window.gpxViewer?.profile;
    const plotH = plot.getBoundingClientRect().height;
    const chartW = chart.getBoundingClientRect().width;
    const span = data ? data.max - data.min : 0;
    const ve = data && span > 0 ? (plotH * 0.92 / span) / (chartW / Math.max(data.total, 1)) : null;
    return {
      plotH: Math.round(plotH),
      chartW: Math.round(chartW),
      panelH: Math.round(box.getBoundingClientRect().height),
      reserved: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--profile-height')),
      note: note && !note.hidden ? note.textContent.trim() : null,
      span,
      total: data?.total,
      ve: ve === null ? null : Math.round(ve * 100) / 100,
    };
  });

  async function widen(width) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForFunction((wanted) => innerWidth === wanted, width);
    await waitForLayout(page);
    return measure();
  }

  // ---- a mountain walk: the exaggeration should not move with the window ----
  await open('track-time-ele.gpx');
  const a = await measure();
  const b = await widen(900);
  const c = await widen(700);
  check('the profile is laid out', a !== null && a.plotH > 0, `${a?.plotH} px`);
  check('a 15.8 km walk gets a taller drawing than the old 78', a.plotH > 100, `${a.plotH} px at 1200`);
  check('the panel is as tall as the drawing inside it', Math.abs(a.panelH - (a.plotH + 52)) <= 2,
    `panel ${a.panelH}, plot ${a.plotH}`);
  check('the map credit clears the panel', Math.abs(a.reserved - a.panelH) <= 1, `${a.reserved} vs ${a.panelH}`);
  check('the exaggeration lands near three', a.ve >= 2.5 && a.ve <= 3.2, `×${a.ve}`);
  check('a 900 px window draws it just as steep', Math.abs(b.ve - a.ve) < 0.15, `×${b.ve} vs ×${a.ve}`);
  check('so does a 700 px window', Math.abs(c.ve - a.ve) < 0.15, `×${c.ve} vs ×${a.ve}`);
  check('a route inside the band needs no caption', a.note === null, String(a.note));
  check('the drawing gets shorter as the window does', c.plotH < b.plotH && b.plotH < a.plotH,
    `${c.plotH} < ${b.plotH} < ${a.plotH}`);

  const wide = await widen(1600);
  check('a wide window hits the ceiling instead of growing forever', wide.plotH <= 128, `${wide.plotH} px`);
  check('and still reads as ground rather than a ruler', wide.ve >= 2, `×${wide.ve}`);

  // ---- a ride across a city: the drawing is held at the floor, and says so ----
  await page.setViewportSize({ width: 1200, height: 800 });
  await open('flat-city.gpx');
  const flat = await measure();
  check('a flat route cannot be stretched to three', flat.ve > 4, `×${flat.ve}`);
  check('it gets the floor rather than a sliver', flat.plotH === 56, `${flat.plotH} px`);
  check('and the caption says how far it was stretched', /×\d+/.test(flat.note || ''), flat.note);

  // ---- a short steep climb: the other end of the same clamp ----
  await open('steep-climb.gpx');
  const steep = await measure();
  check('a steep short climb wants more height than it can have', steep.plotH === 128, `${steep.plotH} px`);
  check('its exaggeration falls below one', steep.ve < 1, `×${steep.ve}`);
  check('the caption admits it', /×0\./.test(steep.note || ''), steep.note);

  // ---- the caption is part of the page language ----
  await page.click('.lang-switch button');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await waitForLayout(page);
  const english = await measure();
  check('the caption follows the language', /Vertical/.test(english.note || ''), english.note);

  // ---- the opening frame clears the panel it now shares the floor with ----
  await open('track-time-ele.gpx');
  const clear = await page.evaluate(() => {
    const box = document.getElementById('profile').getBoundingClientRect();
    const map = window.gpxViewer.map;
    const pts = [];
    map.eachLayer((layer) => {
      if (typeof layer.getLatLngs !== 'function') return;
      const walk = (node) => {
        if (Array.isArray(node)) for (const child of node) walk(child);
        else if (node && typeof node.lat === 'number') pts.push(node);
      };
      walk(layer.getLatLngs());
    });
    let lowest = -Infinity;
    for (const p of pts) lowest = Math.max(lowest, map.latLngToContainerPoint(p).y);
    return { lowest: Math.round(lowest), top: Math.round(box.top) };
  });
  check('the whole route is above the panel at load', clear.lowest <= clear.top,
    `route ends at ${clear.lowest}, panel starts at ${clear.top}`);

  check('the page raised no errors', pageErrors.length === 0, pageErrors.join(' | '));

  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();

  if (failures.length) {
    console.log(`\n${failures.length} failed:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
