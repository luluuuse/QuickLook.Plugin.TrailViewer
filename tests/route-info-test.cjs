// Route-readiness features: direction and kilometre samples, moving time, filtered ascent, recording gaps,
// Naismith time and waypoint search/navigation.
const {
  launchBrowser,
  openViewer,
  settlePopup,
  waitForLayout,
  waitForZoom,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const path = require('path');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const { check, failures } = createChecker('route');
const artifacts = createArtifacts('route');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await page.addInitScript(() => localStorage.setItem('trailviewer.infoDetails', 'full'));
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openViewer(page, base, 'track-time-ele.gpx');
  const route = await page.evaluate(() => ({
    distance: window.trailViewer.summary.distanceMeters,
    duration: window.trailViewer.summary.durationSeconds,
    moving: window.trailViewer.summary.movingDurationSeconds,
    estimate: window.trailViewer.hikeEstimate,
    gaps: window.trailViewer.summary.gaps,
    ascent: window.trailViewer.profile.ascent,
    rawAscent: window.trailViewer.profile.rawAscent,
    stats: [...document.querySelectorAll('#info .stats dt')].map((node) => node.textContent),
    ascentTitle: [...document.querySelectorAll('#info .stats .pair')]
      .find((node) => node.querySelector('dt')?.textContent === 'Ascent')?.title || '',
    totalTitle: [...document.querySelectorAll('#info .stats .pair')]
      .find((node) => node.querySelector('dt')?.textContent === 'Total time')?.title || '',
    facts: [...document.querySelectorAll('#info .fact')].map((node) => ({
      label: node.querySelector('dt')?.textContent,
      value: node.querySelector('dd')?.textContent,
      title: node.title,
    })),
    arrows: document.querySelectorAll('.gpx-distance').length,
    bearings: [...document.querySelectorAll('.gpx-direction')].map((node) => node.style.getPropertyValue('--bearing')),
    kilometres: [...document.querySelectorAll('.gpx-km')].map((node) => node.textContent),
  }));

  check('the score row separates moving speed from total time',
    route.stats.slice(0, 6).join('|').includes('Moving avg') && route.stats.includes('Total time'),
    route.stats.join('|'));
  check('moving duration is available beside the total',
    route.moving !== null && route.duration !== null && route.moving <= route.duration,
    `${route.moving}/${route.duration}`);
  check('the route has direction samples', route.arrows >= 15, `${route.arrows} samples`);
  check('every direction sample carries a bearing',
    route.bearings.length === route.arrows && route.bearings.every((value) => /deg$/.test(value)),
    route.bearings.slice(0, 3).join(','));
  check('kilometre labels count whole kilometres',
    route.kilometres.includes('1 km') && route.kilometres.includes('10 km'), route.kilometres.join(','));
  check('the fitted route keeps labels to a readable count',
    route.kilometres.length <= 18, `${route.kilometres.length} labels`);
  check('a grade-aware estimate is calculated', route.estimate > 0, `${route.estimate}`);
  check('moving and estimated time live in the total-time tooltip',
    /Moving time:/.test(route.totalTitle) && /Grade-aware estimate:/.test(route.totalTitle),
    route.totalTitle);
  check('the estimate names its uphill and downhill model',
    /Naismith.*Langmuir.*steep-uphill/.test(route.totalTitle), route.totalTitle);
  check('moving and estimated time no longer occupy fact rows',
    !route.facts.some((fact) => fact.label === 'Moving time' || /ETA/.test(fact.label || '')),
    route.facts.map((fact) => fact.label).join('|'));
  check('raw ascent is retained for the filter explanation',
    Number.isFinite(route.rawAscent) && route.rawAscent >= route.ascent,
    `${route.ascent}/${route.rawAscent}`);
  check('the displayed ascent explains its noise filter',
    /GPS noise filtered/.test(route.ascentTitle) && route.ascentTitle.includes(`${route.rawAscent} m`),
    route.ascentTitle);
  if (shot) await page.screenshot({ path: shot });

  await page.evaluate(() => { window.trailViewer.map.setZoom(10); });
  await waitForZoom(page, 10);
  await waitForLayout(page);
  const overviewScale = await page.evaluate(() => ({
    arrows: document.querySelectorAll('.gpx-distance').length,
    labels: [...document.querySelectorAll('.gpx-km')].map((node) => node.textContent),
  }));
  check('zooming out coarsens the kilometre labels',
    overviewScale.labels.length === 1 && overviewScale.labels[0] === '10 km',
    overviewScale.labels.join(','));
  check('zooming out leaves direction arrows for the whole route',
    overviewScale.arrows >= 3 && overviewScale.arrows < route.arrows,
    `${overviewScale.arrows} arrows`);

  await page.evaluate(() => { window.trailViewer.map.setZoom(15); });
  await waitForZoom(page, 15);
  await waitForLayout(page);
  const zoomedIn = await page.evaluate(() => ({
    arrows: document.querySelectorAll('.gpx-distance').length,
    labels: [...document.querySelectorAll('.gpx-km')].map((node) => node.textContent),
  }));
  check('zooming in restores kilometre detail',
    zoomedIn.labels.length >= 2 && zoomedIn.labels[0] === '9 km'
      && zoomedIn.labels[zoomedIn.labels.length - 1] === '15 km'
      && zoomedIn.labels.every((label, index) => index === 0
        || Number.parseInt(label, 10) > Number.parseInt(zoomedIn.labels[index - 1], 10)),
    zoomedIn.labels.join(','));

  await openViewer(page, base, 'multi-segment.gpx');
  const gaps = await page.evaluate(() => ({
    regions: window.trailViewer.summary.gaps,
    events: window.trailViewer.summary.gapEvents,
    distance: window.trailViewer.summary.gapDistanceMeters,
    markers: document.querySelectorAll('.gpx-gap-marker').length,
    clustered: document.querySelectorAll('.gpx-gap-marker.clustered').length,
    connectors: document.querySelectorAll('.gpx-gap').length,
    fact: [...document.querySelectorAll('#info .fact')]
      .find((node) => node.querySelector('dt')?.textContent === 'Track anomalies')
      ?.querySelector('dd')?.textContent || '',
    factTitle: [...document.querySelectorAll('#info .fact')]
      .find((node) => node.querySelector('dt')?.textContent === 'Track anomalies')?.title || '',
  }));
  check('the segmented fixture reports its recording breaks', gaps.regions > 0, `${gaps.regions}`);
  check('raw events collapse into fewer recording-break regions',
    gaps.events >= gaps.regions, `${gaps.events}/${gaps.regions}`);
  check('breaks carry measurable gap distance', gaps.distance > 0, `${gaps.distance}`);
  check('the map clusters nearby recording-break regions',
    gaps.markers > 0 && gaps.markers <= gaps.regions, `${gaps.markers}/${gaps.regions}`);
  check('large breaks get a dashed connector', gaps.connectors > 0, `${gaps.connectors}`);
  check('the summary names the break count and distance', /\d+.* · .*km/.test(gaps.fact), gaps.fact);
  check('data gaps and speed anomalies share one summary column',
    /Data gaps/.test(gaps.fact), gaps.fact);
  check('the summary retains the raw warning count in its tooltip',
    gaps.events > gaps.regions ? /\d+ raw GPS break events/.test(gaps.factTitle) : true,
    gaps.factTitle);
  await page.locator('.gpx-gap-marker').first().hover();
  await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tooltip')]
    .some((node) => /data-gap event/.test(node.textContent)));
  const gapHint = await page.locator('.leaflet-tooltip').last().textContent();
  check('a gap icon explains its count, missing distance and click action',
    /data-gap event/.test(gapHint || '') && /missing/.test(gapHint || '')
      && /click to zoom/.test(gapHint || ''),
    gapHint);
  await page.evaluate(() => window.trailViewer.pins.hide());
  await waitForLayout(page);
  const hiddenGapMarks = await page.evaluate(() => ({
    markers: document.querySelectorAll('.gpx-gap-marker').length,
    connectors: document.querySelectorAll('.gpx-gap').length,
  }));
  check('the marker switch hides gap icons but keeps their track connectors',
    hiddenGapMarks.markers === 0 && hiddenGapMarks.connectors === gaps.connectors,
    JSON.stringify(hiddenGapMarks));
  await page.evaluate(() => window.trailViewer.pins.show());
  await waitForLayout(page);

  await page.evaluate(() => { window.trailViewer.map.setZoom(4); });
  await waitForZoom(page, 4);
  await waitForLayout(page);
  const clusteredGaps = await page.evaluate(() => ({
    markers: document.querySelectorAll('.gpx-gap-marker').length,
    count: document.querySelector('.gpx-gap-marker.clustered span')?.textContent,
  }));
  check('zooming out merges nearby warning markers into one counted cluster',
    clusteredGaps.markers === 1 && clusteredGaps.count === '\u00d72',
    JSON.stringify(clusteredGaps));

  await openViewer(page, base, 'gps-anomaly.gpx');
  const anomaly = await page.evaluate(() => ({
    dataGaps: window.trailViewer.summary.gaps,
    anomalyRegions: window.trailViewer.summary.anomalies,
    anomalyEvents: window.trailViewer.summary.anomalyEvents,
    redWarnings: document.querySelectorAll('.gpx-gap-marker').length,
    gpsMarkers: [...document.querySelectorAll('.gpx-anomaly-marker span')].map((node) => node.textContent),
    overlays: document.querySelectorAll('.gpx-anomaly-segment').length,
    fact: [...document.querySelectorAll('#info .fact')]
      .find((node) => node.querySelector('dt')?.textContent === 'Track anomalies')?.textContent || '',
  }));
  check('one bad sample is a speed anomaly, not a data gap',
    anomaly.dataGaps === 0 && anomaly.anomalyRegions === 1 && anomaly.anomalyEvents === 2,
    JSON.stringify(anomaly));
  check('speed anomalies use the distinct GPS marker and line treatment',
    anomaly.redWarnings === 0 && anomaly.gpsMarkers.join('|') === 'GPS \u00d72'
      && anomaly.overlays === 2,
    JSON.stringify(anomaly));
  check('the combined summary names the speed-anomaly measurement',
    /Track anomalies.*Speed anomalies 1 \u00b7/.test(anomaly.fact), anomaly.fact);
  await page.locator('.gpx-anomaly-marker').first().hover();
  await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tooltip')]
    .some((node) => /GPS anomaly band/.test(node.textContent)));
  const anomalyHint = await page.locator('.leaflet-tooltip').last().textContent();
  check('a GPS icon explains its count, affected distance and click action',
    /GPS anomaly band/.test(anomalyHint || '') && /affected/.test(anomalyHint || '')
      && /click to zoom/.test(anomalyHint || ''),
    anomalyHint);
  await page.evaluate(() => window.trailViewer.pins.hide());
  await waitForLayout(page);
  const hiddenAnomalyMarks = await page.evaluate(() => ({
    markers: document.querySelectorAll('.gpx-anomaly-marker').length,
    overlays: document.querySelectorAll('.gpx-anomaly-segment').length,
  }));
  check('the marker switch hides GPS labels but keeps anomaly lines',
    hiddenAnomalyMarks.markers === 0 && hiddenAnomalyMarks.overlays === anomaly.overlays,
    JSON.stringify(hiddenAnomalyMarks));
  await page.evaluate(() => window.trailViewer.pins.show());

  await openViewer(page, base, 'gps-anomaly-band.gpx');
  await page.evaluate(() => { window.trailViewer.map.setZoom(10); });
  await waitForZoom(page, 10);
  await waitForLayout(page);
  const anomalyBand = await page.evaluate(() => ({
    regions: window.trailViewer.summary.anomalies,
    labels: [...document.querySelectorAll('.gpx-anomaly-marker span')].map((node) => node.textContent),
    overlays: document.querySelectorAll('.gpx-anomaly-segment').length,
    summaryRows: [...document.querySelectorAll('#info .fact dt')]
      .filter((node) => node.textContent === 'Track anomalies').length,
  }));
  check('low zoom merges nearby speed-anomaly labels into one GPS band',
    anomalyBand.regions === 3 && anomalyBand.labels.join('|') === 'GPS'
      && anomalyBand.overlays === 6,
    JSON.stringify(anomalyBand));
  check('the two anomaly measurements share one summary row',
    anomalyBand.summaryRows === 1, `${anomalyBand.summaryRows}`);

  await openViewer(page, base, 'mixed-anomalies.gpx');
  const mixedSummary = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#info .fact')]
      .filter((node) => node.querySelector('dt')?.textContent === 'Track anomalies');
    return {
      rows: rows.length,
      text: rows[0]?.querySelector('dd')?.textContent || '',
      title: rows[0]?.title || '',
      gaps: window.trailViewer.summary.gaps,
      anomalies: window.trailViewer.summary.anomalies,
    };
  });
  check('data gaps and speed anomalies occupy the same summary column',
    mixedSummary.rows === 1 && mixedSummary.gaps > 0 && mixedSummary.anomalies > 0
      && /Data gaps/.test(mixedSummary.text) && /Speed anomalies/.test(mixedSummary.text),
    JSON.stringify(mixedSummary));

  await openViewer(page, base, 'kml-pause.kml');
  const recorded = await page.evaluate(() => ({
    total: window.trailViewer.summary.durationSeconds,
    moving: window.trailViewer.summary.movingDurationSeconds,
    paused: window.trailViewer.summary.pausedSeconds,
    source: window.trailViewer.summary.movingTimeSource,
    totalTitle: [...document.querySelectorAll('#info .stats .pair')]
      .find((node) => node.querySelector('dt')?.textContent === 'Total time')?.title || '',
    speedTitle: [...document.querySelectorAll('#info .stats .pair')]
      .find((node) => node.querySelector('dt')?.textContent === 'Moving avg')?.title,
  }));
  check('recorded pause totals take priority over speed guessing',
    recorded.total === 3600 && recorded.paused === 1200 && recorded.moving === 2400,
    `${recorded.total}-${recorded.paused}=${recorded.moving}`);
  check('the moving-time source is metadata', recorded.source === 'metadata', recorded.source);
  check('the total-time tooltip displays the recorded moving time',
    /Moving time: 40 min 0 s/.test(recorded.totalTitle), recorded.totalTitle);
  check('the moving speed explains where its duration came from',
    /pause total recorded/.test(recorded.speedTitle || ''), recorded.speedTitle);

  await openViewer(page, base, 'kml-photos.kml');
  const overviewButton = page.locator('.waypoint-overview-switch button');
  let overview = await page.evaluate(() => ({
    present: window.trailViewer.nav.hasOverview(),
    open: window.trailViewer.nav.overviewOpen(),
    title: document.querySelector('.waypoint-overview-switch button')?.title,
    searchRemoved: document.querySelector('.waypoint-search') === null,
  }));
  check('the search box is gone', overview.searchRemoved === true);
  check('a waypoint overview is available', overview.present === true);
  check('the overview starts closed', overview.open === false);
  check('the overview button explains itself', /overview/.test(overview.title || ''), overview.title);

  await overviewButton.click();
  overview = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.waypoint-overview-item')].map((row) => ({
      index: Number(row.dataset.waypoint),
      name: row.querySelector('.heading strong')?.textContent,
      meta: row.querySelector('.meta')?.textContent || '',
      description: row.querySelector('.description')?.textContent || '',
    }));
    const distance = (meta) => {
      const value = meta.split(' · ')[0] || '';
      const number = parseFloat(value);
      return value.endsWith('km') ? number * 1000 : number;
    };
    return {
      open: window.trailViewer.nav.overviewOpen(),
      title: document.querySelector('.waypoint-overview-header strong')?.textContent,
      rows,
      sorted: rows.every((row, index) => index === 0
        || distance(rows[index - 1].meta) <= distance(row.meta)),
      expanded: document.querySelector('.waypoint-overview-switch button')?.getAttribute('aria-expanded'),
    };
  });
  check('the overview opens as a named list',
    overview.open === true && overview.title === 'Waypoint overview' && overview.expanded === 'true',
    `${overview.open}/${overview.title}/${overview.expanded}`);
  check('every waypoint has a readable row', overview.rows.length === 5, `${overview.rows.length}`);
  check('rows show route distance and elevation',
    overview.rows.every((row) => /m|km/.test(row.meta) && /\d+\s*m/.test(row.meta)),
    overview.rows.map((row) => row.meta).join(' | '));
  check('the overview follows route order', overview.sorted, overview.rows.map((row) => row.meta).join(' | '));
  const album = overview.rows.find((row) => row.name === 'Album');
  check('the overview exposes photo count and description',
    /2 photos/.test(album?.meta || '') && /Two shots/.test(album?.description || ''),
    JSON.stringify(album));

  await page.locator('.waypoint-overview-item[data-waypoint="1"]').click();
  await settlePopup(page, '.leaflet-popup', 1);
  let found = await page.evaluate(() => ({
    index: window.trailViewer.nav.index(),
    selected: document.querySelector('.gpx-pin.selected')?.title,
    highlighted: document.querySelector('.waypoint-overview-item.selected')?.dataset.waypoint,
    stillOpen: window.trailViewer.nav.overviewOpen(),
  }));
  check('clicking a row locates its waypoint', found.index === 1 && found.selected === 'Album',
    `${found.index}/${found.selected}`);
  check('the active row stays highlighted', found.highlighted === '1', found.highlighted);
  check('the overview stays open for browsing', found.stillOpen === true);

  await page.locator('.lang-switch button').click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  const translated = await page.evaluate(() => ({
    title: document.querySelector('.waypoint-overview-header strong')?.textContent,
    close: document.querySelector('.waypoint-overview-header .close')?.title,
    button: document.querySelector('.waypoint-overview-switch button')?.title,
  }));
  check('the overview follows the interface language',
    translated.title === '标记点速览' && translated.close === '关闭标记点速览'
      && translated.button === '打开标记点速览',
    `${translated.title}/${translated.close}/${translated.button}`);

  await page.setViewportSize({ width: 360, height: 740 });
  await waitForLayout(page);
  const narrow = await page.evaluate(() => {
    const boxes = ['.waypoint-overview-switch', '.layer-switch', '.pins-switch', '.lang-switch']
      .map((selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON());
    const info = document.getElementById('info').getBoundingClientRect().toJSON();
    const panel = document.querySelector('.waypoint-overview').getBoundingClientRect().toJSON();
    const profile = document.getElementById('profile').getBoundingClientRect().toJSON();
    return { boxes, info, panel, profile, width: innerWidth };
  });
  check('the overview button wraps inside a narrow window',
    narrow.boxes.every((box) => box && box.left >= 0 && box.right <= narrow.width + 0.5),
    narrow.boxes.map((box) => `${Math.round(box.left)}..${Math.round(box.right)}`).join(' '));
  check('the wrapped controls clear the summary',
    narrow.boxes.every((box) => box.bottom <= narrow.info.top || box.top >= narrow.info.bottom),
    `info ${Math.round(narrow.info.bottom)}, controls ${Math.round(Math.min(...narrow.boxes.map((box) => box.top)))}`);
  check('the narrow overview stays above the profile',
    narrow.panel.left >= 0 && narrow.panel.right <= narrow.width && narrow.panel.bottom <= narrow.profile.top,
    `${Math.round(narrow.panel.left)}..${Math.round(narrow.panel.right)}, ${Math.round(narrow.panel.bottom)} vs ${Math.round(narrow.profile.top)}`);

  await page.locator('.waypoint-overview-header .close').click();
  found = await page.evaluate(() => ({
    open: window.trailViewer.nav.overviewOpen(),
    expanded: document.querySelector('.waypoint-overview-switch button')?.getAttribute('aria-expanded'),
  }));
  check('the overview closes cleanly', found.open === false && found.expanded === 'false',
    `${found.open}/${found.expanded}`);

  check('no page errors', pageErrors.length === 0, pageErrors.join('; '));
  if (shot) {
    const parsed = path.parse(shot);
    await page.screenshot({ path: path.join(parsed.dir, `${parsed.name}-overview${parsed.ext}`) });
  }

  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  console.log(failures.length === 0 ? '\nroute information OK' : `\n${failures.length} route checks failed`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
