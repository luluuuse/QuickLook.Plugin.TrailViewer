// The shared icon system: every application-owned control uses the same open 24-unit geometry, while semantic
// map symbols keep their fills. No vendor file is modified.
const path = require('path');
const {
  launchBrowser,
  openViewer,
  settlePopup,
  waitForLayout,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures, finish } = createChecker('icons');
const artifacts = createArtifacts('icons');

const expectedDefault = (icon, name) => icon?.name === name
  && icon.width === 16 && icon.height === 16 && icon.stroke === '1.75'
  && icon.fill === 'none' && icon.cap === 'round' && icon.join === 'round';

const expectedCompact = (icon, name) => icon?.name === name
  && icon.width === 12 && icon.height === 12 && icon.stroke === '1.75'
  && icon.fill === 'none' && icon.cap === 'round' && icon.join === 'round';

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await page.addInitScript(() => {
    window.__readIcon = (selector) => {
      const svg = document.querySelector(selector);
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      return {
        name: svg.dataset.icon,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        stroke: svg.getAttribute('stroke-width'),
        fill: svg.getAttribute('fill'),
        cap: svg.getAttribute('stroke-linecap'),
        join: svg.getAttribute('stroke-linejoin'),
      };
    };
  });
  await artifacts.start(page);
  const errors = [];
  const csp = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) csp.push(message.text());
  });

  await openViewer(page, base, 'kml-photos.kml');
  await waitForLayout(page);
  const top = await page.evaluate(() => ({
    zoomIn: window.__readIcon('.leaflet-control-zoom-in svg'),
    zoomOut: window.__readIcon('.leaflet-control-zoom-out svg'),
    locate: window.__readIcon('.locate-switch svg'),
    layers: window.__readIcon('.layer-menu-toggle svg[data-icon="layer-road"]'),
    layerChevron: window.__readIcon('.layer-menu-chevron'),
    toolbox: window.__readIcon('.toolbox-switch > button svg'),
    pins: window.__readIcon('.pins-switch svg'),
    list: window.__readIcon('.waypoint-overview-switch svg'),
  }));
  check('Leaflet zoom controls use plus and minus icons',
    expectedDefault(top.zoomIn, 'plus') && expectedDefault(top.zoomOut, 'minus'),
    JSON.stringify(top));
  check('locate, current source, toolbox, pins and list use the shared default size',
    expectedDefault(top.locate, 'locate') && expectedDefault(top.layers, 'layer-road')
      && expectedDefault(top.toolbox, 'toolbox') && expectedDefault(top.pins, 'pin')
      && expectedDefault(top.list, 'list'), JSON.stringify(top));
  check('the layer dropdown uses the compact shared chevron',
    expectedCompact(top.layerChevron, 'chevron-down'), JSON.stringify(top.layerChevron));
  const zoomCentering = await page.evaluate(() => ['.leaflet-control-zoom-in', '.leaflet-control-zoom-out']
    .map((selector) => {
      const anchor = document.querySelector(selector).getBoundingClientRect();
      const icon = document.querySelector(`${selector} svg`).getBoundingClientRect();
      return {
        dx: Math.abs((anchor.left + anchor.right) / 2 - (icon.left + icon.right) / 2),
        dy: Math.abs((anchor.top + anchor.bottom) / 2 - (icon.top + icon.bottom) / 2),
      };
    }));
  check('zoom glyphs are optically centred in their 30 px buttons',
    zoomCentering.every(({ dx, dy }) => dx <= 1 && dy <= 1), JSON.stringify(zoomCentering));

  await page.click('.layer-menu-toggle');
  const layerPanel = await page.evaluate(() => ({
    settings: window.__readIcon('.layer-settings-button svg'),
    noMap: window.__readIcon('[data-no-map] svg'),
    close: window.__readIcon('.layer-menu-close svg'),
    selected: window.__readIcon('.layer-provider-option.selected .layer-selected-icon svg'),
  }));
  check('layer no-map, settings, close and selected-state icons share the system',
    expectedDefault(layerPanel.noMap, 'map-grid')
      && expectedDefault(layerPanel.settings, 'settings') && expectedDefault(layerPanel.close, 'close')
      && expectedCompact(layerPanel.selected, 'check'), JSON.stringify(layerPanel));
  const visibleProviders = await page.evaluate(() => [...document.querySelectorAll(
    '.layer-provider-option:not([hidden]) .layer-provider-label',
  )].map((node) => node.textContent));
  check('the layer menu shows only providers from the active map type',
    visibleProviders.join('|') === 'OpenStreetMap HOT|Tianditu road|Esri Light Gray|Esri Dark Gray',
    visibleProviders.join('|'));
  const categoryIcons = await page.$$eval('.layer-category-button', (nodes) => nodes.map((node) => ({
    name: node.querySelector('svg')?.dataset.icon,
    title: node.title,
  })));
  check('the four map categories use the selected structure icons and hover labels',
    categoryIcons.map((item) => item.name).join('|')
      === 'layer-road|layer-terrain|layer-satellite|layer-custom'
      && categoryIcons.every((item) => item.title.length > 0),
    JSON.stringify(categoryIcons));
  await page.click('.layer-settings-button');
  const back = await page.evaluate(() => window.__readIcon('.layer-menu-back svg'));
  check('the layer settings back action uses the shared chevron',
    expectedDefault(back, 'chevron-left'), JSON.stringify(back));
  await page.click('.layer-menu-close');

  await page.click('.toolbox-switch > button');
  const toolActions = await page.evaluate(() => ({
    measure: window.__readIcon('.toolbox-action[data-tool="measure"] svg'),
    export: window.__readIcon('.toolbox-action[data-tool="export"] svg'),
    coordinates: window.__readIcon('.toolbox-action[data-tool="coordinates"] svg'),
    attachments: window.__readIcon('.toolbox-action[data-tool="attachments"] svg'),
  }));
  check('toolbox operations use distinct folded-map, stacked-photo, ruler and coordinate icons',
    expectedDefault(toolActions.measure, 'ruler') && expectedDefault(toolActions.export, 'overlay-export')
      && expectedDefault(toolActions.coordinates, 'coordinates')
      && expectedDefault(toolActions.attachments, 'photo-export'),
    JSON.stringify(toolActions));
  await page.click('.toolbox-action[data-tool="measure"]');
  const measureActions = await page.evaluate(() => [...document.querySelectorAll(
    '.toolbox-measure-actions button svg',
  )].map((svg) => svg.dataset.icon));
  check('measurement actions combine labels with the icon registry',
    measureActions.join('|') === 'finish-section|center-point|undo|redo|clear|stop',
    measureActions.join('|'));
  const active = await page.evaluate(() => {
    const button = document.querySelector('.toolbox-switch > button');
    const style = getComputedStyle(button);
    return {
      theme: document.documentElement.dataset.theme,
      background: style.backgroundColor,
      color: style.color,
      shadow: style.boxShadow,
    };
  });
  check('default swiss theme uses ivory active surface with vermilion accent and underline',
    active.theme === 'swiss' && active.background === 'rgb(255, 255, 255)'
      && active.color === 'rgb(223, 43, 29)' && active.shadow.includes('inset'),
    JSON.stringify(active));

  const brandIcon = await page.evaluate(() => {
    const icon = document.querySelector('.toolbox-version-bar .toolbox-brand-icon');
    return {
      inSummary: document.querySelectorAll('#info .info-brand-icon').length,
      src: icon?.getAttribute('src') || null,
      width: icon ? getComputedStyle(icon).width : null,
    };
  });
  check('toolbox footer renders the 24 px 2B brand icon and keeps the summary header clean',
    brandIcon.inSummary === 0 && brandIcon.src === 'assets/trailviewer-icon.svg' && brandIcon.width === '24px',
    JSON.stringify(brandIcon));

  const symbols = await page.evaluate(() => {
    const pinFill = document.querySelector('.pin-symbol .symbol-fill');
    const camera = document.querySelector('.gpx-pin.has-photo .pin-camera');
    const start = document.querySelector('.gpx-start');
    const end = document.querySelector('.gpx-end');
    const profile = document.querySelector('#profile .pin');
    return {
      pin: document.querySelector('.pin-symbol')?.dataset.symbol,
      pinFill: pinFill ? getComputedStyle(pinFill).fill : '',
      pinStroke: pinFill ? getComputedStyle(pinFill).strokeWidth : '',
      camera: camera?.dataset.symbol,
      startStroke: start?.getAttribute('stroke-width'),
      endStroke: end?.getAttribute('stroke-width'),
      profileBackground: profile ? getComputedStyle(profile).backgroundColor : '',
      profileShadow: profile ? getComputedStyle(profile).boxShadow : '',
    };
  });
  check('waypoint and photo symbols use semantic fills with dark outlines in swiss theme',
    symbols.pin === 'waypoint' && symbols.pinFill === 'rgb(255, 255, 255)'
      && symbols.pinStroke === '1.5px' && symbols.camera === 'camera', JSON.stringify(symbols));
  check('start, end and profile data symbols follow the data-symbol stroke policy',
    symbols.startStroke === '1.5' && symbols.endStroke === '1.5'
      && symbols.profileBackground === 'rgb(255, 255, 255)' && /1\.4px/.test(symbols.profileShadow),
    JSON.stringify(symbols));

  // Verify manual switching to slate and classic themes (classic preserves legacy blue/yellow palette).
  await page.evaluate(() => window.trailViewer.theme.set('slate'));
  const slateTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.evaluate(() => window.trailViewer.theme.set('classic'));
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector('.toolbox-switch > button')).backgroundColor === 'rgb(35, 79, 121)');
  const themeCheck = await page.evaluate(() => {
    const button = document.querySelector('.toolbox-switch > button');
    const btnStyle = getComputedStyle(button);
    const pinFill = document.querySelector('.pin-symbol .symbol-fill');
    const profile = document.querySelector('#profile .pin');
    const res = {
      classicTheme: document.documentElement.dataset.theme,
      classicBg: btnStyle.backgroundColor,
      classicColor: btnStyle.color,
      classicPinFill: pinFill ? getComputedStyle(pinFill).fill : '',
      classicProfileBg: profile ? getComputedStyle(profile).backgroundColor : '',
    };
    window.trailViewer.theme.set('swiss');
    return res;
  });
  check('manual theme switching supports slate and preserves classic dark palette',
    slateTheme === 'slate' && themeCheck.classicTheme === 'classic'
      && themeCheck.classicBg === 'rgb(35, 79, 121)' && themeCheck.classicColor === 'rgb(143, 217, 255)'
      && themeCheck.classicPinFill === 'rgb(245, 196, 0)'
      && themeCheck.classicProfileBg === 'rgb(245, 196, 0)',
    JSON.stringify({ slateTheme, ...themeCheck }));

  await page.click('.waypoint-overview-switch button');
  const overview = await page.evaluate(() => ({
    close: window.__readIcon('.waypoint-overview-header .close svg'),
    filter: window.__readIcon('.waypoint-filter-trigger svg'),
    edit: window.__readIcon('.waypoint-correct-button svg'),
  }));
  check('overview close, filter and edit icons use default/compact size tiers',
    expectedDefault(overview.close, 'close') && expectedCompact(overview.filter, 'chevron-down')
      && expectedCompact(overview.edit, 'edit'), JSON.stringify(overview));
  await page.click('.waypoint-overview-header .close');

  await page.locator('.gpx-pin[title="Album"]').click();
  await page.waitForSelector('.photo-popup .photo-frame');
  // The card draws its own close control inside the photo frame and hides Leaflet's, so the icon assertions
  // follow the visible control.
  const popupClose = await page.evaluate(() => ({
    leafletHidden: getComputedStyle(
      document.querySelector('.photo-popup .leaflet-popup-close-button'),
    ).display === 'none',
    cardClose: Boolean(document.querySelector('.photo-popup .photo-card-close')),
  }));
  check('the card owns its close control and hides Leaflet’s',
    popupClose.leafletHidden === true && popupClose.cardClose === true,
    JSON.stringify(popupClose));
  await page.locator('.photo-popup .photo-frame').first().click();
  await page.waitForFunction(() => window.trailViewer.photos.isOpen());
  const photo = await page.evaluate(() => ({
    close: window.__readIcon('.photo-close svg'),
    previous: window.__readIcon('.photo-arrow.prev svg'),
    next: window.__readIcon('.photo-arrow.next svg'),
  }));
  check('photo close and navigation use the shared arrow/close icons',
    expectedDefault(photo.close, 'close') && expectedDefault(photo.previous, 'arrow-left')
      && expectedDefault(photo.next, 'arrow-right'), JSON.stringify(photo));
  await page.click('.photo-close');
  await settlePopup(page, '.leaflet-popup', 0);

  await openViewer(page, base, 'track-time-ele.gpx');
  await waitForLayout(page);
  await page.click('.split-toggle');
  const split = await page.evaluate(() => {
    return {
      route: window.__readIcon('.split-toggle-label svg'),
      chevron: window.__readIcon('.split-chevron'),
      columns: [...document.querySelectorAll('.splits-table th .split-icon')].map((svg) => ({
        name: svg.dataset.icon,
        width: Math.round(svg.getBoundingClientRect().width),
        height: Math.round(svg.getBoundingClientRect().height),
      })),
    };
  });
  check('the split entry uses route and chevron icons',
    expectedDefault(split.route, 'route') && expectedDefault(split.chevron, 'chevron-down'),
    JSON.stringify(split));
  check('split column headers keep labels without decorative icons',
    split.columns.length === 0, JSON.stringify(split.columns));
  await page.click('.split-mode-toggle');
  const detailedIcons = await page.evaluate(() => [...document.querySelectorAll(
    '.splits-table th .split-icon',
  )].map((svg) => `${svg.dataset.icon}:${Math.round(svg.getBoundingClientRect().width)}`));
  check('detailed split headers also remain text-only', detailedIcons.length === 0,
    detailedIcons.join('|'));

  const direction = await page.evaluate(() => {
    const symbol = document.querySelector('.gpx-direction-symbol');
    const fill = symbol?.querySelector('.symbol-fill');
    return { name: symbol?.dataset.symbol, fill: fill ? getComputedStyle(fill).fill : '' };
  });
  check('direction arrows use the shared filled data symbol',
    direction.name === 'direction' && direction.fill === 'rgb(255, 255, 255)', JSON.stringify(direction));
  await page.evaluate(() => window.trailViewer.scrub.at(200));
  const scrub = await page.evaluate(() => {
    const marker = document.querySelector('.scrub-marker');
    return {
      stroke: marker?.getAttribute('stroke-width'),
      fill: marker?.getAttribute('fill'),
    };
  });
  check('the map scrubber follows the data-symbol outline and semantic fill',
    scrub.stroke === '1.5' && scrub.fill === '#e5243b', JSON.stringify(scrub));

  await openViewer(page, base, 'multi-segment.gpx');
  await waitForLayout(page);
  const gap = await page.evaluate(() => ({
    warnings: document.querySelectorAll('.gpx-gap-marker [data-icon="warning"]').length,
    cluster: document.querySelector('.gpx-gap-marker.clustered span')?.textContent,
  }));
  check('recording-gap badges use the warning icon and retain their count',
    gap.warnings > 0 && (!gap.cluster || /^\u00d7\d+$/.test(gap.cluster)), JSON.stringify(gap));

  await openViewer(page, base, 'gps-anomaly.gpx');
  await waitForLayout(page);
  const anomaly = await page.evaluate(() => ({
    activity: document.querySelectorAll('.gpx-anomaly-marker [data-icon="activity"]').length,
    labels: [...document.querySelectorAll('.gpx-anomaly-marker span')].map((node) => node.textContent),
  }));
  check('GPS anomaly badges use the activity icon and keep their semantic text',
    anomaly.activity > 0 && anomaly.labels.every((label) => /^GPS(?:\s\u00d7\d+)?$/.test(label)),
    JSON.stringify(anomaly));

  const legacy = await page.evaluate(() => {
    const selectors = [
      '.leaflet-control-zoom-in', '.leaflet-control-zoom-out', '.locate-switch button',
      '.layer-menu-close', '.pins-switch button', '.waypoint-overview-switch button',
      '.toolbox-switch > button', '.waypoint-overview-header .close',
    ];
    return selectors.flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter((node) => /[×‹›▾✎✓]/.test(node.textContent)).map((node) => node.outerHTML.slice(0, 100));
  });
  check('target controls no longer expose text-glyph icons', legacy.length === 0, legacy.join(' | '));

  check('no page errors', errors.length === 0, errors.join(' | '));
  check('no CSP violations', csp.length === 0, csp.join(' | '));
  await artifacts.capture(page, failures, errors);
  await browser.close();
  server.close();
  process.exit(finish('icon system OK'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
