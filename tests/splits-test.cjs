// Independent per-kilometre split panel: collapsed by default, explicit expansion, stopwatch notation,
// moving speed, totals, localization, responsive layout and the data model reserved for the detailed phase.
const path = require('path');
const {
  launchBrowser,
  openViewer,
  switchLanguage,
  waitForMapIdle,
  waitForLayout,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures } = createChecker('splits');
const artifacts = createArtifacts('splits');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await page.addInitScript(() => localStorage.setItem('trailviewer.infoDetails', 'compact'));
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openViewer(page, base, 'track-time-ele.gpx');
  await waitForLayout(page);

  const splitState = () => page.evaluate(() => {
    const panel = document.getElementById('splits');
    const toggle = document.querySelector('.split-toggle');
    const scroller = document.querySelector('.splits-scroll');
    const fastest = document.querySelector('.splits-table tbody tr.fastest');
    const info = document.getElementById('info');
    const infoBox = info.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const zoomBox = document.querySelector('#map .leaflet-top.leaflet-left')?.getBoundingClientRect();
    const safe = window.trailViewer?.mapLayout().safe;
    const totals = document.querySelector('.splits-totals')?.getBoundingClientRect();
    const loaded = window.trailViewer.splitPanel.loaded();
    const model = loaded ? window.trailViewer.splits : null;
    return {
      present: !panel.hidden,
      parent: panel.parentElement?.tagName,
      infoContainsPanel: info.contains(panel),
      belowInfo: panelBox.top > infoBox.bottom + 5,
      zoomClear: !zoomBox || zoomBox.left >= panelBox.right + 6 || zoomBox.bottom <= panelBox.top - 5,
      zoomLeft: zoomBox ? zoomBox.left : null,
      mapClearsPanel: !safe || safe.top >= panelBox.bottom,
      expanded: toggle?.getAttribute('aria-expanded'),
      toggleText: toggle?.textContent.replace(/\s+/g, ' ').trim(),
      mode: window.trailViewer.splitPanel.mode(),
      modeButton: document.querySelector('.split-mode-toggle')?.textContent || '',
      modePressed: document.querySelector('.split-mode-toggle')?.getAttribute('aria-pressed'),
      tableMode: document.querySelector('.splits-table')?.classList.contains('detailed') ? 'detailed' : 'basic',
      panelWidth: panelBox.width,
      contentPresent: Boolean(document.getElementById('splits-content')),
      headers: [...document.querySelectorAll('.splits-table th')].map((node) => node.textContent),
      columnWidths: [...document.querySelectorAll('.splits-table th')]
        .map((node) => Math.round(node.getBoundingClientRect().width)),
      cellPadding: [...document.querySelectorAll('.splits-table tbody tr:first-child td')]
        .map((node) => {
          const style = getComputedStyle(node);
          return `${style.paddingLeft}/${style.paddingRight}`;
        }),
      separatorWidths: [...document.querySelectorAll('.splits-table tbody tr:first-child td')]
        .map((node) => getComputedStyle(node).borderRightWidth),
      rows: [...document.querySelectorAll('.splits-table tbody tr')].map((row) => (
        [...row.cells].map((cell) => cell.textContent)
      )),
      tabbableRows: document.querySelectorAll('.splits-table tbody tr[tabindex="0"]').length,
      totals: [...document.querySelectorAll('.split-total')].map((node) => ({
        value: node.querySelector('strong').textContent,
        label: node.querySelector('span').textContent,
      })),
      scrollable: scroller ? scroller.scrollHeight > scroller.clientHeight : false,
      stickyHeader: document.querySelector('.splits-table thead')
        ? getComputedStyle(document.querySelector('.splits-table thead th')).position
        : null,
      fastestRows: document.querySelectorAll('.splits-table tbody tr.fastest').length,
      selectedRows: document.querySelectorAll('.splits-table tbody tr.selected').length,
      selectedIndex: window.trailViewer.splitPanel.selected(),
      highlightLines: document.querySelectorAll('.gpx-split-highlight').length,
      profileFocus: (() => {
        const focus = document.querySelector('#profile .split-focus');
        const band = document.querySelector('#profile .split-focus-band');
        const badge = document.querySelector('#profile .label .split-focus-badge');
        const label = document.querySelector('#profile .label');
        const line = document.querySelector('#profile .split-focus-line');
        const chart = document.querySelector('#profile .chart');
        if (!focus || !chart || !label) return null;
        const chartRect = chart.getBoundingClientRect();
        const labelRect = label.getBoundingClientRect();
        const bandRect = band?.getBoundingClientRect();
        const badgeRect = badge && !badge.hidden ? badge.getBoundingClientRect() : null;
        return {
          visible: !focus.hidden && getComputedStyle(focus).display !== 'none',
          badgeVisible: Boolean(badge && !badge.hidden && getComputedStyle(badge).display !== 'none'),
          lineVisible: Boolean(line && line.style.display !== 'none' && line.getAttribute('d')),
          badge: badge?.textContent || '',
          bandLeft: bandRect ? bandRect.left - chartRect.left : null,
          bandWidth: bandRect ? bandRect.width : null,
          chartWidth: chartRect.width,
          badgeInside: badgeRect
            ? badgeRect.left >= labelRect.left - 1
              && badgeRect.right <= labelRect.right + 1
              && badgeRect.bottom <= chartRect.top + 1
              && badgeRect.height <= 18
            : null,
        };
      })(),
      zoom: window.trailViewer.map.getZoom(),
      center: window.trailViewer.map.getCenter(),
      home: window.trailViewer.mapLayout().home,
      mapMoves: window.__splitMapMoves || 0,
      fastestSpeedColour: fastest
        ? getComputedStyle(fastest.querySelector('.split-speed')).color
        : null,
      infoOverflow: {
        horizontal: info.scrollWidth - info.clientWidth,
        vertical: info.scrollHeight - info.clientHeight,
      },
      totalsVisible: Boolean(totals) && totals.top >= panelBox.top && totals.bottom <= panelBox.bottom + 1,
      loaded,
      model: model && {
        count: model.splits.length,
        fields: Object.keys(model.splits[0] || {}),
        fastestIndex: model.fastestIndex,
        totalDistance: model.totalDistanceMeters,
        totalTime: model.totalTimeSeconds,
        movingTime: model.movingTimeSeconds,
      },
    };
  });

  let state = await splitState();
  const collapsedZoomLeft = state.zoomLeft;
  const collapsedView = { zoom: state.zoom, center: state.center };
  check('a timed route gets an independent split entry below the summary',
    state.present && state.parent === 'BODY' && !state.infoContainsPanel && state.belowInfo,
    JSON.stringify(state));
  check('the split panel opens collapsed and renders no row data',
    state.expanded === 'false' && !state.contentPresent && state.rows.length === 0
      && state.mode === 'basic',
    `${state.expanded}/${state.contentPresent}/${state.rows.length}/${state.mode}`);
  check('the collapsed entry still names the feature and its size',
    state.toggleText.includes('Splits') && state.toggleText.includes('16 rows'), state.toggleText);
  check('the collapsed split panel does not calculate per-kilometre data',
    state.loaded === false && state.model === null, JSON.stringify({ loaded: state.loaded }));

  await page.evaluate(() => {
    window.__splitMapMoves = 0;
    const count = () => { window.__splitMapMoves += 1; };
    window.trailViewer.map.on('zoomstart', count);
    window.trailViewer.map.on('movestart', count);
  });
  await page.locator('.split-toggle').click();
  await waitForLayout(page);
  state = await splitState();
  check('clicking the entry reveals the split data',
    state.expanded === 'true' && state.contentPresent && state.rows.length > 0 && state.loaded,
    `${state.expanded}/${state.rows.length}/${state.loaded}`);
  check('the opened panel does not sit underneath the zoom controls', state.zoomClear,
    JSON.stringify(state));
  check('an unselected split panel leaves the profile focus hidden',
    state.profileFocus
      && state.profileFocus.visible === false
      && state.profileFocus.badgeVisible === false
      && state.profileFocus.lineVisible === false,
    JSON.stringify(state.profileFocus));
  check('opening the split panel does not move the zoom/locate/export column',
    state.zoomLeft === collapsedZoomLeft, `${collapsedZoomLeft} -> ${state.zoomLeft}`);
  check('opening the split panel does not refit or move the map',
    state.zoom === collapsedView.zoom
      && state.center.lat === collapsedView.center.lat
      && state.center.lng === collapsedView.center.lng
      && state.mapMoves === 0,
    `${collapsedView.zoom}@${collapsedView.center.lat},${collapsedView.center.lng} -> `
      + `${state.zoom}@${state.center.lat},${state.center.lng}, moves=${state.mapMoves}`);
  check('the map safe area starts below the opened split panel', state.mapClearsPanel,
    JSON.stringify(state));
  check('phase one exposes four requested columns',
    state.headers.join('|') === 'Split|Distance|Time|Moving speed', state.headers.join('|'));
  check('the expanded panel starts in basic mode with a one-click details control',
    state.mode === 'basic' && state.modeButton === 'Details' && state.modePressed === 'false'
      && state.tableMode === 'basic',
    JSON.stringify({ mode: state.mode, button: state.modeButton, pressed: state.modePressed }));
  check('every split row remains reachable with Tab',
    state.tabbableRows === state.rows.length,
    `${state.tabbableRows}/${state.rows.length} tabbable rows`);
  check('the route has a whole-kilometre row for every split',
    state.rows.length === Math.ceil(state.model.totalDistance / 1000), `${state.rows.length}`);
  check('the basic grid has fixed columns and a uniform gutter',
    state.columnWidths.join('|') === '28|54|54|64'
      && state.cellPadding.every((value) => value === '6px/6px')
      && state.separatorWidths.slice(0, -1).every((value) => value === '1px')
      && state.separatorWidths.at(-1) === '0px'
      && state.panelWidth <= 250,
    `${state.columnWidths.join('|')} / ${state.cellPadding.join(',')} / ${state.panelWidth}px`);
  check('the first row carries distance, time and speed',
    state.rows[0][1] === '1.00 km' && /^\d+:\d{2}$/.test(state.rows[0][2])
      && /^\d+\.\d km\/h$/.test(state.rows[0][3]), state.rows[0].join('|'));
  check('the final row is the remaining partial kilometre',
    Number(state.rows.at(-1)[1].split(' ')[0]) > 0
      && Number(state.rows.at(-1)[1].split(' ')[0]) < 1, state.rows.at(-1).join('|'));
  check('the rows scroll under a fixed table header',
    state.scrollable && state.stickyHeader === 'sticky', JSON.stringify(state));
  check('the fastest moving split is highlighted',
    state.fastestRows === 1 && state.fastestSpeedColour === 'rgb(255, 98, 109)',
    `${state.fastestRows}/${state.fastestSpeedColour}`);
  check('total and moving time sit at the bottom of the opened panel',
    state.totals.length === 2 && state.totals[0].value === '1:00:00'
      && state.totals[1].value === '1:00:00'
      && state.totals[0].label === 'Total time' && state.totals[1].label === 'Moving time',
    JSON.stringify(state.totals));
  check('the totals stay visible without an outer summary scrollbar',
    state.totalsVisible && state.infoOverflow.horizontal <= 1 && state.infoOverflow.vertical <= 1,
    JSON.stringify(state.infoOverflow));
  check('the detailed phase keeps its fields in the shared data model',
    ['cumulativeSeconds', 'ascentMeters', 'descentMeters', 'averageHeartRate', 'verticalSpeedMps']
      .every((field) => state.model.fields.includes(field)),
    state.model.fields.join(','));

  const detailedColumns = await page.evaluate(async () => {
    const module = await import('./split-view.js');
    return module.DETAIL_COLUMNS;
  });
  check('the detailed phase column contract is reserved',
    detailedColumns.join('|') === 'index|distance|time|cumulativeTime|ascent|descent|heartRate|movingSpeed|verticalSpeed',
    detailedColumns.join('|'));

  const basicPanelWidth = state.panelWidth;
  const zoomBeforeMode = state.zoom;
  await page.locator('.split-mode-toggle').click();
  await waitForLayout(page);
  state = await splitState();
  check('one click switches the same panel to detailed data',
    state.mode === 'detailed' && state.tableMode === 'detailed'
      && state.modeButton === 'Basic' && state.modePressed === 'true',
    JSON.stringify({ mode: state.mode, button: state.modeButton, pressed: state.modePressed }));
  check('a route without heart rate omits that detailed column',
    state.headers.join('|') === 'Split|Distance|Time|Cumulative|Ascent|Descent|Moving speed|Vertical speed',
    state.headers.join('|'));
  check('detailed rows carry cumulative time, elevation and vertical speed',
    state.rows[0].length === 8 && state.rows[0][3] === '3:20'
      && /^\d+ m$/.test(state.rows[0][4]) && /^\d+ m$/.test(state.rows[0][5])
      && /^-?\d+ m\/h$/.test(state.rows[0][7]),
    state.rows[0].join('|'));
  check('detailed totals place rest time after total and moving time',
    state.totals.length === 3
      && state.totals.map((item) => item.label).join('|') === 'Total time|Moving time|Rest time'
      && state.totals[2].value === '0:00:00',
    JSON.stringify(state.totals));
  check('the detailed grid uses deterministic compact columns and equal gutters',
    state.columnWidths.join('|') === '28|54|54|60|40|40|64|72'
      && state.cellPadding.every((value) => value === '6px/6px')
      && state.separatorWidths.slice(0, -1).every((value) => value === '1px')
      && state.panelWidth <= 460,
    `${state.columnWidths.join('|')} / ${state.cellPadding.join(',')} / ${state.panelWidth}px`);
  check('the detailed panel is wider than basic without refitting the map',
    state.panelWidth > basicPanelWidth && state.zoom === zoomBeforeMode && state.mapMoves === 0,
    `${basicPanelWidth} -> ${state.panelWidth}; zoom ${zoomBeforeMode} -> ${state.zoom}`);

  const firstSplitRow = page.locator('.splits-table tbody tr').first();
  await firstSplitRow.focus();
  await firstSplitRow.press('Enter');
  await firstSplitRow.press('Space');
  state = await splitState();
  check('Tab focus selects a split; Enter/Space add no extra shortcut',
    state.selectedIndex === 1 && state.selectedRows === 1 && state.highlightLines >= 2,
    JSON.stringify({ selected: state.selectedIndex, lines: state.highlightLines }));

  const zoomBeforeSelection = state.zoom;
  await firstSplitRow.click();
  await waitForMapIdle(page);
  state = await splitState();
  check('selecting a split highlights its trajectory on the map',
    state.selectedIndex === 1 && state.selectedRows === 1 && state.highlightLines >= 2,
    JSON.stringify({ selected: state.selectedIndex, rows: state.selectedRows, lines: state.highlightLines }));
  check('selecting a split focuses the map on that trajectory',
    state.home === false
      && (state.zoom > zoomBeforeSelection
        || state.center.lat !== collapsedView.center.lat
        || state.center.lng !== collapsedView.center.lng),
    `${zoomBeforeSelection} -> ${state.zoom} @ ${state.center.lat},${state.center.lng}`);
  const firstBandLeft = state.profileFocus?.bandLeft ?? null;
  check('selecting a split highlights and labels its range on the elevation profile',
    state.profileFocus?.visible === true
      && state.profileFocus?.badgeVisible === true
      && state.profileFocus?.lineVisible === true
      && state.profileFocus?.badge === 'Split 1 · 0–1 km'
      && state.profileFocus?.bandLeft >= -1
      && state.profileFocus?.bandLeft <= 1
      && state.profileFocus?.bandWidth >= 8
      && state.profileFocus?.badgeInside === true,
    JSON.stringify(state.profileFocus));

  const secondRow = page.locator('.splits-table tbody tr').nth(1);
  await secondRow.click();
  await waitForMapIdle(page);
  state = await splitState();
  check('clicking another split moves the highlight',
    state.selectedIndex === 2 && state.selectedRows === 1 && state.highlightLines >= 2,
    JSON.stringify({ selected: state.selectedIndex, rows: state.selectedRows, lines: state.highlightLines }));
  check('clicking another split shifts the profile focus to the new range',
    state.profileFocus?.visible === true
      && state.profileFocus?.lineVisible === true
      && state.profileFocus?.badge === 'Split 2 · 1–2 km'
      && firstBandLeft !== null
      && state.profileFocus?.bandLeft > firstBandLeft,
    JSON.stringify({ firstBandLeft, current: state.profileFocus }));

  const chartBox = await page.locator('#profile .chart').boundingBox();
  await page.mouse.move(chartBox.x + chartBox.width * 0.5, chartBox.y + chartBox.height * 0.5);
  const scrubVisible = await page.evaluate(() => !document.querySelector('#profile .readout')?.hidden);
  check('profile hover scrub remains interactive while a split is focused', scrubVisible, String(scrubVisible));
  await page.mouse.move(10, 10);

  await page.locator('.info-details-toggle').click();
  await waitForLayout(page);
  state = await splitState();
  check('expanding summary details and splits together keeps the two cards stacked',
    state.belowInfo,
    JSON.stringify({ belowInfo: state.belowInfo }));

  await page.locator('.split-toggle').click();
  await waitForLayout(page);
  state = await splitState();
  const fullCollapsedZoom = state.zoomLeft;
  check('collapsing splits clears the trajectory highlight',
    state.selectedIndex === null && state.highlightLines === 0
      && state.profileFocus?.visible === false
      && state.profileFocus?.badgeVisible === false
      && state.profileFocus?.lineVisible === false,
    JSON.stringify({ selected: state.selectedIndex, lines: state.highlightLines, profileFocus: state.profileFocus }));
  await page.locator('.split-toggle').click();
  await waitForLayout(page);
  state = await splitState();
  check('opening splits under an expanded summary leaves the control column fixed',
    state.zoomLeft === fullCollapsedZoom, `${fullCollapsedZoom} -> ${state.zoomLeft}`);
  await page.locator('.splits-table tbody tr').nth(1).click();
  await waitForMapIdle(page);

  await switchLanguage(page, 'zh');
  state = await splitState();
  check('an open split panel keeps its state while the labels change language',
    state.expanded === 'true'
      && state.headers.join('|') === '圈|距离|时间|累计时间|上升|下降|运动速度|垂直速度'
      && state.totals[0].label === '总时间' && state.totals[1].label === '运动时间'
      && state.totals[2].label === '休息时间'
      && state.selectedIndex === 2 && state.highlightLines >= 2 && state.modeButton === '简要'
      && state.profileFocus?.visible === true
      && state.profileFocus?.badge === '第 2 段 · 1–2 km',
    `${state.expanded}/${state.headers.join('|')}/${state.selectedIndex}/${state.profileFocus?.badge}`);

  const stickyAlignment = await page.evaluate(async () => {
    const scroller = document.querySelector('.splits-scroll');
    scroller.scrollTop = Math.min(80, scroller.scrollHeight - scroller.clientHeight);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const header = document.querySelector('.splits-table thead th');
    const row = document.querySelector('.splits-table tbody tr:nth-child(4)');
    const tops = [...row.cells].map((cell) => cell.getBoundingClientRect().top);
    return {
      headerOffset: Math.round(header.getBoundingClientRect().top - scroller.getBoundingClientRect().top),
      headerHeight: Math.round(header.getBoundingClientRect().height),
      rowOffset: Math.round(Math.max(...tops) - Math.min(...tops)),
      firstLabel: header.textContent,
    };
  });
  check('the sticky icon header stays aligned while rows scroll',
    stickyAlignment.headerOffset <= 2 && stickyAlignment.headerHeight <= 40
      && stickyAlignment.rowOffset <= 1 && stickyAlignment.firstLabel === '圈',
    JSON.stringify(stickyAlignment));

  await page.setViewportSize({ width: 360, height: 740 });
  await waitForLayout(page);
  const narrow = await page.evaluate(() => {
    const panel = document.getElementById('splits');
    const scroller = document.querySelector('.splits-scroll');
    const table = document.querySelector('.splits-table');
    const box = panel.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      overflow: panel.scrollWidth - panel.clientWidth,
      tableOverflow: table.scrollWidth - scroller.clientWidth,
    };
  });
  check('the open split panel fits a 360 px window without horizontal overflow',
    narrow.left >= 0 && narrow.right <= 360 && narrow.overflow <= 1 && narrow.tableOverflow > 0,
    JSON.stringify(narrow));
  const narrowProfile = await splitState();
  check('profile focus stays inside the chart after resizing to 360 px',
    narrowProfile.profileFocus?.visible === true && narrowProfile.profileFocus?.badgeInside === true,
    JSON.stringify(narrowProfile.profileFocus));

  await page.locator('.split-toggle').click();
  await waitForLayout(page);
  state = await splitState();
  check('clicking the entry again removes the detailed rows',
    state.expanded === 'false' && !state.contentPresent && state.rows.length === 0
      && state.selectedIndex === null && state.highlightLines === 0,
    `${state.expanded}/${state.contentPresent}/${state.rows.length}/${state.highlightLines}`);

  await page.setViewportSize({ width: 1200, height: 800 });
  await openViewer(page, base, 'track-time-ele.gpx');
  await waitForLayout(page);
  state = await splitState();
  check('opening another file returns the split entry to its collapsed default',
    state.expanded === 'false' && !state.contentPresent && state.mode === 'basic',
    `${state.expanded}/${state.contentPresent}/${state.mode}`);

  await page.locator('.info-details-toggle').click();
  await waitForLayout(page);
  const independent = await page.evaluate(() => ({
    facts: document.querySelectorAll('#info .facts .fact').length,
    splitInInfo: document.querySelectorAll('#info #splits, #info .info-splits').length,
    splitExpanded: document.querySelector('.split-toggle').getAttribute('aria-expanded'),
  }));
  check('summary details remain independent from the split panel',
    independent.facts > 0 && independent.splitInInfo === 0 && independent.splitExpanded === 'false',
    JSON.stringify(independent));

  await openViewer(page, base, 'waypoints-route.gpx');
  await waitForLayout(page);
  const noTimes = await page.evaluate(() => ({
    hidden: document.getElementById('splits').hidden,
    toggle: document.querySelectorAll('.split-toggle').length,
    loaded: window.trailViewer.splitPanel.loaded(),
  }));
  check('an untimed route hides the unusable split entry',
    noTimes.hidden && noTimes.toggle === 0 && noTimes.loaded === false, JSON.stringify(noTimes));

  await openViewer(page, base, 'synthetic.fit');
  await waitForLayout(page);
  await page.locator('.split-toggle').click();
  await page.locator('.split-mode-toggle').click();
  await waitForLayout(page);
  const heartRate = await page.evaluate(() => ({
    headers: [...document.querySelectorAll('.splits-table th')].map((node) => node.textContent),
    value: document.querySelector('.splits-table tbody tr .split-heartRate')?.textContent,
    widths: [...document.querySelectorAll('.splits-table th')]
      .map((node) => Math.round(node.getBoundingClientRect().width)),
    panelWidth: Math.round(document.getElementById('splits').getBoundingClientRect().width),
    totals: [...document.querySelectorAll('.split-total')].map((node) => ({
      value: node.querySelector('strong').textContent,
      label: node.querySelector('span').textContent,
    })),
  }));
  check('a FIT with heart rate adds the detailed heart-rate column',
    heartRate.headers.includes('心率') && /^\d+ bpm$/.test(heartRate.value || '')
      && heartRate.widths.join('|') === '28|54|54|60|40|40|52|64|72'
      && heartRate.panelWidth <= 510
      && heartRate.totals.map((item) => item.value).join('|') === '1:00:00|0:55:00|0:05:00'
      && heartRate.totals[2].label === '休息时间',
    JSON.stringify(heartRate));

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();

  if (failures.length > 0) process.exit(1);
  console.log('\nsplit panel OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
