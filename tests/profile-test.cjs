// Test for the elevation profile: the numbers above it, the coloured stretches under it, and the waypoint
// dots on it.
//
//   NODE_PATH=<folder containing playwright-core> node tests/profile-test.cjs [screenshot.png]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
const fs = require('fs');
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
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const { check, failures, finish } = createChecker('profile');
const artifacts = createArtifacts('profile');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  // Pinned to en-US: the assertions below read English labels, and the viewer follows the system language.
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await page.addInitScript(() => localStorage.setItem('trailviewer.infoDetails', 'full'));
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const remote = fs.readFileSync(path.join(root, 'tests/fixtures/photo2.png'));
  await page.route('https://example.test/**', (route) => route.fulfill({ body: remote, contentType: 'image/png' }));

  const open = async (name) => {
    await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${name}`);
    await page.waitForFunction(() => document.body.classList.contains('loaded'));
  };

  const rows = () => page.evaluate(() => {
    const keys = [...document.querySelectorAll('#info dt')].map((n) => n.textContent);
    const values = [...document.querySelectorAll('#info dd')].map((n) => n.textContent);
    return Object.fromEntries(keys.map((key, i) => [key, values[i]]));
  });

  // The headline numbers, with where each one sits: the grouping is part of the design, so it is measured
  // rather than eyeballed.
  const stats = () => page.evaluate(() => [...document.querySelectorAll('#info .stats .pair')].map((pair) => {
    const box = pair.getBoundingClientRect();
    return {
      label: pair.querySelector('dt').textContent,
      value: pair.querySelector('dd').textContent,
      top: Math.round(box.top),
      left: Math.round(box.left),
      right: Math.round(box.right),
    };
  }));

  const shape = () => page.evaluate(() => ({
    profile: window.trailViewer.profile && {
      min: window.trailViewer.profile.min,
      max: window.trailViewer.profile.max,
      ascent: window.trailViewer.profile.ascent,
      descent: window.trailViewer.profile.descent,
      total: window.trailViewer.profile.total,
      runs: window.trailViewer.profile.runs,
    },
    areas: [...document.querySelectorAll('#profile .area')].map((a) => a.getAttribute('fill')),
    spans: [...document.querySelectorAll('#profile .area')].map((a) => {
      const xs = [...a.getAttribute('d').matchAll(/[ML]([-\d.]+),/g)].map((m) => Number(m[1]));
      return [Math.min(...xs), Math.max(...xs)];
    }),
    extremes: [...document.querySelectorAll('#profile .extremum')].map((n) => ({
      kind: n.classList.contains('high') ? 'high' : 'low',
      text: n.textContent,
      title: n.title,
      box: n.getBoundingClientRect().toJSON(),
    })),
    scaleBar: document.querySelector('#profile .legend .scale-bar')?.style.background || null,
    // The row is two numbers now: how much of the route is steep, and the worst gradient on it.
    legend: {
      text: document.querySelector('#profile .legend .item')?.textContent,
      title: document.querySelector('#profile .legend .item')?.title,
      values: [...document.querySelectorAll('#profile .legend .item .value')].map((n) => n.textContent),
      steep: window.trailViewer.profile?.steep,
    },
    axis: [...document.querySelectorAll('#profile .axis')].map((n) => ({ text: n.textContent, box: n.getBoundingClientRect().toJSON() })),
    facts: [...document.querySelectorAll('#info .facts dd')].map((n) => n.textContent),
    chart: document.querySelector('#profile .chart')?.getBoundingClientRect().toJSON() || null,
    legendBox: document.querySelector('#profile .legend')?.getBoundingClientRect().toJSON() || null,
    colours: [...new Set([...document.querySelectorAll('#profile .area')].map((a) => a.getAttribute('fill')))],
    pins: [...document.querySelectorAll('#profile .pin')].map((n) => ({
      photo: n.classList.contains('photo'), title: n.title, left: n.style.left, top: n.style.top,
    })),
  }));

  const heart = () => page.evaluate(() => {
    const button = document.querySelector('#profile .profile-heart-toggle');
    const layer = document.querySelector('#profile .heart-rate-layer');
    const axis = document.querySelector('#profile .heart-axis');
    const averageLine = document.querySelector('#profile .heart-average-line');
    const average = document.querySelector('#profile .heart-average');
    return {
      data: window.trailViewer.profile?.heartRate || null,
      rates: window.trailViewer.gpx.tracks.flatMap((track) => track.segments)
        .flat().map((point) => point.heartRate ?? null),
      button: button?.textContent || '',
      pressed: button?.getAttribute('aria-pressed') || null,
      title: button?.title || '',
      lines: document.querySelectorAll('#profile .heart-line').length,
      visible: layer ? getComputedStyle(layer).display !== 'none' : false,
      axisHidden: axis?.hidden ?? null,
      axis: [...document.querySelectorAll('#profile .heart-axis span')].map((node) => node.textContent),
      averageLine: averageLine ? {
        y1: averageLine.getAttribute('y1'),
        y2: averageLine.getAttribute('y2'),
        dash: getComputedStyle(averageLine).strokeDasharray,
      } : null,
      averageText: average?.textContent || '',
      averageHidden: average?.hidden ?? null,
    };
  });

  // 1. A synthetic hike with heights and times: the summary gains speed, ascent and descent, in a row of
  //    their own with the extent of the route in a second row under them.
  await open('track-time-ele.gpx');
  let s = await shape();
  let r = await rows();
  const cells = await stats();
  check('the summary gains a moving average speed', r['Moving avg'] === '15.8 km/h', r['Moving avg']);
  // 283 m of the walk used to disappear because the recording stopped while still climbing.
  check('the summary gains the climb', r.Ascent === '567 m', r.Ascent);
  check('the summary gains the drop', r.Descent === '598 m', r.Descent);
  check('speed, climb and drop share one row',
    cells.slice(0, 3).map((c) => c.label).join(',') === 'Moving avg,Ascent,Descent'
      && cells[0].top === cells[1].top && cells[1].top === cells[2].top,
    cells.slice(0, 3).map((c) => `${c.label}@${c.top}`).join(' '));
  check('distance, time and points share the next row',
    cells.slice(3).map((c) => c.label).join(',') === 'Distance,Total time,Points'
      && cells[3].top === cells[4].top && cells[4].top === cells[5].top && cells[3].top > cells[2].top,
    cells.slice(3).map((c) => `${c.label}@${c.top}`).join(' '));
  // The duration moved up into that row, so the list below must not say it twice.
  const facts = await page.evaluate(() => [...document.querySelectorAll('#info .facts dt')].map((n) => n.textContent));
  check('the duration is not repeated below', !facts.includes('Time'), facts.join('/'));
  // One grid, not two rows that happen to hold three things: the point count sits under the drop.
  check('the two rows share their columns',
    cells[3].left === cells[0].left && cells[4].left === cells[1].left && cells[5].left === cells[2].left,
    cells.map((c) => `${c.label}@${c.left}`).join(' '));
  check('no cell runs into the next',
    cells.every((c, i) => i === 0 || c.top !== cells[i - 1].top || c.left >= cells[i - 1].right),
    cells.map((c) => `${c.left}-${c.right}`).join(' '));
  check('the profile agrees with the summary',
    s.profile.ascent === 567 && s.profile.descent === 598, `${s.profile.ascent}/${s.profile.descent}`);
  check('the axis covers the whole route', Math.abs(s.profile.total - 15784) < 20, `${Math.round(s.profile.total)} m`);

  // 2. The legend says how hard the route is: the length that is steep, and the worst gradient on it. The
  //    five counts it used to carry went with the five-colour fill -- they pointed at blocks that no longer
  //    exist, and repeated the ascent already in the summary.
  // The gaps between the spans are flex gaps, not characters, so the text runs together.
  check('the legend reads as two numbers', /^Steep\s*\d+(\.\d)?\s*(km|m)\s*\u00b7\s*max\s*\d+%$/.test(s.legend.text),
    s.legend.text);
  check('a legend entry says what the numbers mean', /10 % or steeper/.test(s.legend.title), s.legend.title);
  // The row and the picture have to come from the same cells, or "18 %" names a gradient the fill does not
  // show anywhere. The text is the rounded form of the number the page worked out.
  const shownKm = s.legend.values[0];
  const expectedKm = s.legend.steep.metres >= 1000
    ? `${(s.legend.steep.metres / 1000).toFixed(1)} km`
    : `${Math.round(s.legend.steep.metres / 10) * 10} m`;
  check('the steep distance is the one that was measured', shownKm === expectedKm, `${shownKm} vs ${expectedKm}`);
  check('the worst gradient is the one that was measured',
    s.legend.values[1] === `${Math.round(s.legend.steep.maxSlope * 100)}%`,
    `${s.legend.values[1]} vs ${s.legend.steep.maxSlope}`);
  check('some of the route is steep, but not all of it',
    s.legend.steep.metres > 0 && s.legend.steep.metres < s.profile.total,
    `${Math.round(s.legend.steep.metres)} of ${Math.round(s.profile.total)}`);
  // The legend starts where the ground does: at the panel edge it shared a narrow strip with the heights below.
  check('the legend clears the axis column',
    s.legendBox.left >= s.chart.left - 1,
    `legend ${Math.round(s.legendBox.left)} vs chart ${Math.round(s.chart.left)}`);

  // 3. The fill is cut finer than the five kinds of ground: the colour follows the gradient itself.
  check('the fill is cut finer than the stretches', s.areas.length > s.profile.runs.length,
    `${s.areas.length} pieces for ${s.profile.runs.length} stretches`);
  check('every piece is painted from the scale',
    s.areas.every((c) => /^rgb\(/ .test(c) || c.startsWith('url(#slope-')), s.areas.slice(0, 3).join(','));
  check('the fill uses a range of colours, not five', s.colours.length >= 5, `${s.colours.length} distinct`);
  // Each piece overlaps its neighbour by half a unit, so the anti-aliased seam between them cannot show.
  check('the pieces follow each other without a gap',
    s.spans.every((span, i) => i === 0 || (span[0] <= s.spans[i - 1][1] + 0.01 && span[0] >= s.spans[i - 1][1] - 1.1)),
    s.spans.slice(0, 5).map((p) => p.map(Math.round).join('-')).join(' '));
  check('the fill is anchored at both ends of the route',
    Math.abs(s.spans[0][0]) <= 1 && Math.abs(s.spans[s.spans.length - 1][1] - 601) <= 1.1,
    `${s.spans[0][0]} .. ${s.spans[s.spans.length - 1][1]}`);

  // 4. The two ends of the axis are written in a column of their own, clear of the drawing.
  check('the top of the axis is labelled', s.axis[0].text === '1800 m', s.axis[0].text);
  check('the bottom of the axis is labelled', s.axis[1].text === '1200 m', s.axis[1].text);
  const panel = await page.evaluate(() => document.getElementById('profile').getBoundingClientRect().toJSON());
  // The panel floats on the map like the summary instead of taking the bottom of the window out of it.
  const page_ = await page.evaluate(() => ({ map: document.getElementById('map').getBoundingClientRect().toJSON(), h: innerHeight, w: innerWidth }));
  check('the map runs to the bottom of the window', Math.round(page_.map.height) === page_.h,
    `${Math.round(page_.map.height)} of ${page_.h}`);
  check('the panel is inset from the edges',
    panel.left >= 8 && panel.right <= page_.w - 8 && panel.bottom <= page_.h - 8,
    `${Math.round(panel.left)}..${Math.round(panel.right)} x ${Math.round(panel.bottom)}`);
  check('the axis labels sit inside the panel',
    s.axis.every((a) => a.box.top >= panel.top && a.box.bottom <= panel.bottom),
    s.axis.map((a) => `${Math.round(a.box.top)}-${Math.round(a.box.bottom)} in ${Math.round(panel.top)}-${Math.round(panel.bottom)}`).join(' | '));
  check('the axis labels stay clear of the curve',
    s.axis.every((a) => a.box.right <= s.chart.left + 0.5),
    s.axis.map((a) => `${Math.round(a.box.right)} vs ${Math.round(s.chart.left)}`).join(' | '));

  // The scale itself: level is calm, a wall is hot, and past 25 % the colour stops rather than inventing
  // a sixth shade for ground the legend has already called steep.
  const ramp = await page.evaluate(async () => {
    const m = await import('./profile.js');
    return { level: m.slopeColor(0), climb: m.slopeColor(0.18), cap: m.slopeColor(m.SLOPE_FULL), over: m.slopeColor(0.9) };
  });
  check('the scale saturates at 25 %', ramp.over === ramp.cap, `${ramp.over} vs ${ramp.cap}`);
  const heat = (colour) => colour.match(/\d+/g).map(Number);
  check('a steep gradient is warmer than level ground',
    heat(ramp.climb)[0] > heat(ramp.level)[0] && heat(ramp.climb)[2] < heat(ramp.level)[2],
    `${ramp.level} -> ${ramp.climb}`);

  // A recording can end on either side of a climb. Existing fixtures reverse direction; these monotonic
  // cases guard the final, uncommitted stretch that used to be dropped entirely.
  const closed = await page.evaluate(async () => {
    const m = await import('./profile.js');
    return [
      m.elevationGain([0, 100]),
      m.elevationGain([100, 0]),
      m.elevationGain([0, 15, 1700]),
      m.elevationGain([1700, 15, 0]),
    ];
  });
  check('a route that only climbs records its ascent', closed[0].ascent === 100, JSON.stringify(closed[0]));
  check('a route that only descends records its descent', closed[1].descent === 100, JSON.stringify(closed[1]));
  check('and the same holds at the end of a larger climb or descent',
    closed[2].ascent === 1700 && closed[3].descent === 1700, JSON.stringify(closed.slice(2)));

  // The SVG viewBox is only 600 units wide. Keeping every raw sample adds path text and DOM work below one
  // pixel, while a regular stride can erase a single-pixel summit. Each pixel keeps its low and high sample.
  const sampled = await page.evaluate(async () => {
    const m = await import('./profile.js');
    const samples = Array.from({ length: 10000 }, (_, i) => ({
      along: i,
      ele: i === 5123 ? 9999 : i % 17,
    }));
    const kept = m.profileSamples(samples, 600);
    return {
      count: kept.length,
      first: kept[0].along,
      last: kept[kept.length - 1].along,
      peak: kept.some((sample) => sample.ele === 9999),
    };
  });
  check('a dense SVG profile is bounded to its pixels', sampled.count <= 1202, `${sampled.count}`);
  check('pixel sampling keeps both ends', sampled.first === 0 && sampled.last === 9999,
    `${sampled.first}..${sampled.last}`);
  check('pixel sampling keeps a one-sample summit', sampled.peak);

  const tidied = await page.evaluate(async () => {
    const m = await import('./profile.js');
    const samples = Array.from({ length: 81 }, (_, i) => ({
      along: i * 25,
      ele: i % 2 === 0 ? 0 : 20,
    }));
    return m.groundRuns(samples).map((run) => [run.from, run.to]);
  });
  check('short alternating runs collapse in one linear pass',
    tidied.length === 1 && tidied[0][0] === 0 && tidied[0][1] === 2000, JSON.stringify(tidied));
  check('the legend carries the scale it refers to',
    /^linear-gradient/.test(s.scaleBar || '') && /#3aa06e|rgb\(58, 160, 110\)/.test(s.scaleBar || ''), s.scaleBar);

  // 4b. The top and bottom of the route are written where they happen, not only as the ends of the axis.
  const high = s.extremes.find((e) => e.kind === 'high');
  const low = s.extremes.find((e) => e.kind === 'low');
  check('the highest point is labelled', high && high.text === '1800 m', high && high.text);
  check('the lowest point is labelled', low && low.text === '1200 m', low && low.text);
  check('both labels sit inside the plot',
    s.extremes.every((e) => e.box.left >= s.chart.left - 1 && e.box.right <= s.chart.right + 1
      && e.box.top >= s.chart.top - 1 && e.box.bottom <= s.chart.bottom + 1),
    s.extremes.map((e) => `${Math.round(e.box.left)}-${Math.round(e.box.right)} vs ${Math.round(s.chart.left)}-${Math.round(s.chart.right)}`).join(' | '));
  check('the two labels do not sit on top of each other',
    !high || !low || high.box.bottom < low.box.top || low.box.bottom < high.box.top || high.box.right < low.box.left
      || low.box.right < high.box.left, 'overlap');

  // 5. Hovering reports the point under the cursor, next to the cursor.
  await page.locator('#profile .chart > svg').hover({ position: { x: 300, y: 40 } });
  const tip = await page.evaluate(() => {
    const node = document.querySelector('#profile .readout');
    const box = node.getBoundingClientRect();
    const dot = document.querySelector('#profile .dot').getBoundingClientRect();
    return {
      ele: node.querySelector('.ele').textContent,
      meta: node.querySelector('.meta').textContent,
      left: box.left,
      right: box.right,
      bottom: box.bottom,
      dotTop: dot.top,
    };
  });
  check('hovering the plot names a height', /^\d+ m$/.test(tip.ele), tip.ele);
  check('and the distance behind it', /\d+ km|m\b/.test(tip.meta), tip.meta);
  check('the readout sits over the plot, not in a corner', tip.left > s.chart.left && tip.right < s.chart.right,
    `${Math.round(tip.left)}-${Math.round(tip.right)} in ${Math.round(s.chart.left)}-${Math.round(s.chart.right)}`);
  // Above the cursor, never below it: under it the tip lands on the mouse. Where the track is at its highest
  // there is no room above the point, so the tip is pushed to the top of the plot instead of flipped down.
  const cursor = s.chart.top + 40;
  check('the readout stays above the cursor', tip.bottom <= cursor,
    `tip bottom ${Math.round(tip.bottom)} vs cursor ${Math.round(cursor)}`);

  // 6. The language switch carries the axis and the legend with it.
  await page.locator('.lang-switch button').click();
  await waitForLayout(page);
  s = await shape();
  check('the axis speaks Chinese and keeps the unit', s.axis[0].text === '1800 m', s.axis[0].text);
  check('the legend speaks Chinese', /^陡坡\s*.*\s*·\s*最陡\s*\d+%$/.test(s.legend.text), String(s.legend.text));
  // The date is Intl's business, and Intl follows the system unless it is told otherwise: the interface said
  // English and the date still said 2026年1月1日.
  check('the date is written in Chinese', s.facts.some((v) => /年.*月.*日/.test(v)), s.facts.join(' | '));
  await page.locator('.lang-switch button').click();
  await waitForLayout(page);
  s = await shape();
  check('and the date goes back to English', !s.facts.some((v) => /[年月日]/.test(v)),
    s.facts.join(' | '));

  // 6b. A city ride never reaches ten percent: the row says so rather than printing a measurement of zero.
  await open('flat-city.gpx');
  s = await shape();
  check('a flat route is called flat, not 0 m steep',
    /^No steep ground\s*\u00b7\s*max\s*\d+%$/.test(s.legend.text) && s.legend.steep.metres === 0,
    `${s.legend.text} (${s.legend.steep.metres} m)`);

  // 6c. Heart rate is optional, off by default and drawn on its own scale with gaps preserved.
  await open('heart-rate.gpx');
  let h = await heart();
  check('GPX heart-rate extensions reach the point model',
    h.rates.join(',') === '100,110,120,130,,140,150,160', h.rates.join(','));
  check('the profile prepares two continuous heart-rate runs',
    h.data?.count === 7 && h.data.segments.length === 2 && h.lines === 2, JSON.stringify(h.data));
  check('heart rate is off by default',
    h.button === 'Heart rate' && h.pressed === 'false' && h.visible === false && h.axisHidden === true
      && h.averageHidden === true,
    JSON.stringify(h));
  check('the heart-rate toggle explains its action', h.title === 'Show heart rate overlay', h.title);
  await page.locator('#profile .profile-heart-toggle').click();
  h = await heart();
  check('the heart-rate overlay can be enabled',
    h.pressed === 'true' && h.visible === true && h.axisHidden === false, JSON.stringify(h));
  check('the independent heart-rate axis uses padded round limits',
    h.axis.join('/') === '170 bpm/90 bpm', h.axis.join('/'));
  check('the heart-rate overlay marks the whole-route average',
    h.data?.average === 130 && h.averageText === 'Avg 130 bpm'
      && h.averageHidden === false && h.averageLine?.y1 === '50.0'
      && h.averageLine?.y2 === '50.0' && /6px[, ]+5px/.test(h.averageLine.dash),
    JSON.stringify({ average: h.data?.average, text: h.averageText, line: h.averageLine }));
  await page.locator('#profile .chart > svg').hover({ position: { x: 300, y: 35 } });
  const heartReadout = await page.evaluate(() => ({
    value: document.querySelector('#profile .readout .heart')?.textContent || '',
    hidden: document.querySelector('#profile .readout .heart')?.hidden,
    dot: document.querySelector('#profile .heart-dot')?.hidden,
  }));
  check('hovering reports the heart rate at the route position',
    /^\d+ bpm$/.test(heartReadout.value) && heartReadout.hidden === false && heartReadout.dot === false,
    JSON.stringify(heartReadout));
  await page.locator('.lang-switch button').click();
  await waitForLayout(page);
  h = await heart();
  check('the heart-rate control follows the language',
    h.button === '心率' && h.title === '隐藏心率叠加', `${h.button}/${h.title}`);
  check('the average label follows the language', h.averageText === '平均 130 bpm', h.averageText);
  await page.locator('.lang-switch button').click();
  await waitForLayout(page);

  const heartPlacements = [];
  for (const width of [1200, 900, 700, 520, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await waitForLayout(page);
    heartPlacements.push(await page.evaluate((measuredWidth) => {
      const rect = (node) => node.getBoundingClientRect();
      const profile = rect(document.getElementById('profile'));
      const range = rect(document.querySelector('#profile .label .range'));
      const button = rect(document.querySelector('#profile .profile-heart-toggle'));
      const icon = rect(document.querySelector('#profile .profile-heart-icon'));
      const text = rect(document.querySelector('#profile .profile-heart-toggle > span'));
      const axis = [...document.querySelectorAll('#profile .heart-axis span')].map(rect);
      return {
        width: measuredWidth,
        gap: button.left - range.right,
        button: { left: button.left, right: button.right, height: button.height },
        icon: { width: icon.width, height: icon.height },
        textInside: text.left >= button.left && text.right <= button.right,
        buttonInside: button.left >= profile.left && button.right <= profile.right,
        axisInside: axis.every((box) => box.left >= profile.left && box.right <= profile.right),
      };
    }, width));
  }
  check('the heart-rate icon keeps its compact 12 px geometry',
    heartPlacements.every((item) => item.icon.width === 12 && item.icon.height === 12),
    JSON.stringify(heartPlacements));
  check('the heart-rate label stays inside the pill at every width',
    heartPlacements.every((item) => item.textInside && item.buttonInside
      && item.button.height === 16 && item.axisInside),
    JSON.stringify(heartPlacements));
  check('the heart-rate pill stays beside the profile title across layouts',
    heartPlacements.every((item) => Math.abs(item.gap - 8) <= 0.5),
    JSON.stringify(heartPlacements));
  await page.setViewportSize({ width: 1200, height: 800 });

  await open('synthetic.fit');
  h = await heart();
  check('FIT heart-rate records expose the same toggle',
    h.data?.count === 5 && h.pressed === 'false' && h.lines === 1, JSON.stringify(h));

  await open('track-time-ele.gpx');
  h = await heart();
  check('a track without heart rate gets no toggle or empty overlay',
    h.data === null && h.button === '' && h.lines === 0, JSON.stringify(h));

  // 7. Waypoints get a dot where the track passes them, and a click opens the same pin the map would.
  await open('kml-photos.kml');
  s = await shape();
  check('every waypoint has a dot on the profile', s.pins.length === 5, `${s.pins.length}`);
  check('only the waypoints with a photo are ringed',
    s.pins.filter((pin) => pin.photo).length === 3, s.pins.map((p) => p.photo).join(','));
  check('a dot is placed along the plot', s.pins.every((pin) => pin.left.endsWith('%') && pin.top.endsWith('%')), s.pins[0].left);
  // A dot that nothing covers takes a real click.
  await page.locator('#profile .pin').last().click();
  await settlePopup(page, '.leaflet-popup', 1);
  const popup = await page.evaluate(() => {
    const open = document.querySelector('.leaflet-popup');
    return { open: Boolean(open), title: open ? open.querySelector('strong')?.textContent : null };
  });
  check('clicking a dot opens its pin', popup.open && popup.title === 'Plain', JSON.stringify(popup));

  // A ringed dot opens the photo card. Dispatched rather than clicked: this fixture stacks three waypoints
  // within a few metres of each other, so a real click would always land on whichever dot is on top.
  await page.evaluate(() => window.trailViewer.map.closePopup());
  await settlePopup(page, '.leaflet-popup', 0);
  await page.evaluate(() => document.querySelector('#profile .pin.photo').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await settlePopup(page, '.leaflet-popup', 1);
  const photoCard = await page.evaluate(() => {
    const open = document.querySelector('.leaflet-popup');
    return { open: Boolean(open), images: open ? open.querySelectorAll('img').length : 0 };
  });
  check('a dotted waypoint opens its photo card', photoCard.open && photoCard.images > 0, JSON.stringify(photoCard));

  // 8. A file whose points carry no height gets no profile, and the summary says so instead of guessing.
  await open('gpx10.gpx');
  s = await shape();
  r = await rows();
  check('no profile without heights', await page.evaluate(() => document.getElementById('profile').hidden), 'hidden');
  check('the climb is a dash, not a zero', r.Ascent === '\u2014' && r.Descent === '\u2014', `${r.Ascent}/${r.Descent}`);
  check('and the profile data is absent rather than empty', s.profile === null, JSON.stringify(s.profile));

  check('the page raised no errors', pageErrors.length === 0, pageErrors.join(' | '));

  if (shot) {
    await open('track-time-ele.gpx');
    await waitForLayout(page);
    await page.screenshot({ path: shot });
  }

  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();

  if (failures.length > 0) {
    process.exit(finish());
  }
  process.exit(finish());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
