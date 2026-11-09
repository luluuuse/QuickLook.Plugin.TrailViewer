// Waypoint insight phase 1: local semantic labels, negation, multi-label rows, category filters and map selection.
const path = require('path');
const { launchBrowser, openViewer, settlePopup, waitForLayout } = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const { check, failures } = createChecker('insights');
const artifacts = createArtifacts('insights');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openViewer(page, base, 'kml-insights.kml');
  await page.locator('.waypoint-overview-switch button').click();
  const collapsed = await page.evaluate(() => ({
    expanded: document.querySelector('.waypoint-filter-trigger')?.getAttribute('aria-expanded'),
    menuOpen: document.querySelector('.insight-filter') !== null,
    briefRemoved: document.querySelector('.waypoint-route-brief') === null,
    filterRowRemoved: document.querySelector('.waypoint-overview-filters') === null,
  }));
  check('the filter starts collapsed without a second slider row',
    collapsed.expanded === 'false' && collapsed.menuOpen === false
      && collapsed.briefRemoved && collapsed.filterRowRemoved,
    JSON.stringify(collapsed));

  await page.locator('.waypoint-filter-trigger').click();
  const initial = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.insight-filter')].map((node) => ({
      filter: node.dataset.filter,
      text: node.textContent,
      active: node.classList.contains('active'),
      role: node.getAttribute('role'),
      checked: node.getAttribute('aria-checked'),
    }));
    const rows = [...document.querySelectorAll('.waypoint-overview-item')].map((node) => ({
      index: Number(node.dataset.waypoint),
      name: node.querySelector('.heading strong')?.textContent,
      primary: node.dataset.primary || '',
      badges: [...node.querySelectorAll('.waypoint-insight-badge')].map((badge) => badge.textContent),
      evidence: node.querySelector('.waypoint-evidence')?.textContent || '',
      title: node.title,
    }));
    return {
      chips,
      rows,
      expanded: document.querySelector('.waypoint-filter-trigger')?.getAttribute('aria-expanded'),
    };
  });

  check('the compact filter control opens a menu', initial.expanded === 'true', initial.expanded);
  check('the overview exposes classified filter counts',
    initial.chips.map((chip) => chip.text).join('|')
      === 'All 8|Important 4|Danger 2|Water 2|Camp 1|Junction 1|Summit / pass 1|Viewpoint 1',
    initial.chips.map((chip) => chip.text).join('|'));
  check('filter choices are checked menu items',
    initial.chips.every((chip) => chip.role === 'menuitemradio')
      && initial.chips.filter((chip) => chip.checked === 'true').length === 1,
    initial.chips.map((chip) => `${chip.role}:${chip.checked}`).join('|'));
  check('all rows remain in route order', initial.rows.map((row) => row.index).join(',') === '0,1,2,3,4,5,6,7');
  check('the danger point uses a danger tint',
    initial.rows.find((row) => row.name === '危险冰坡')?.primary === 'danger',
    JSON.stringify(initial.rows[0]));
  check('water, camp, junction and summit points get their own primary classes',
    ['water', 'camp', 'junction', 'summit'].every((primary) =>
      initial.rows.some((row) => row.primary === primary)), initial.rows.map((row) => row.primary).join(','));

  const mixed = initial.rows.find((row) => row.name === '危险水源');
  check('a waypoint can carry multiple insight badges',
    mixed?.primary === 'danger' && mixed.badges.join('|') === 'Danger|Water',
    JSON.stringify(mixed));
  check('the row keeps the matched words as evidence',
    /Detected:.*落石区.*泉水/.test(mixed?.evidence || '')
      && /Detected:.*危险.*落石.*水源/.test(mixed?.title || ''),
    `${mixed?.evidence} / ${mixed?.title}`);
  check('category-specific negation leaves dry water and closed camp neutral',
    initial.rows.find((row) => row.name === '干涸水源')?.primary === ''
      && initial.rows.find((row) => row.name === '旧营地')?.primary === '',
    initial.rows.slice(-2).map((row) => row.primary).join('/'));

  await page.locator('.insight-filter[data-filter="important"]').click();
  let filtered = await page.evaluate(() => ({
    names: [...document.querySelectorAll('.waypoint-overview-item .heading strong')]
      .map((node) => node.textContent),
    trigger: document.querySelector('.waypoint-filter-trigger')?.textContent,
  }));
  check('important-only keeps danger, water and camp points',
    filtered.names.join('|') === '危险冰坡|无名水源|草甸营地|危险水源',
    filtered.names.join('|'));
  check('the active filter is reflected in the collapsed control',
    /Important 4/.test(filtered.trigger || ''), filtered.trigger);

  await page.locator('.waypoint-filter-trigger').click();
  const waterChecked = await page.locator('.insight-filter[data-filter="water"]').getAttribute('aria-checked');
  await page.locator('.insight-filter[data-filter="water"]').click();
  filtered = await page.evaluate(() => ({
    names: [...document.querySelectorAll('.waypoint-overview-item .heading strong')]
      .map((node) => node.textContent),
    checked: document.querySelector('.waypoint-filter-trigger')?.textContent,
  }));
  check('water filtering uses all matching categories, not only the primary colour',
    filtered.names.join('|') === '无名水源|危险水源', filtered.names.join('|'));
  check('filters expose their checked state in the menu', waterChecked === 'false', waterChecked);
  check('the collapsed control names the active filter', /Water 2/.test(filtered.checked || ''), filtered.checked);

  await page.locator('.waypoint-overview-item[data-waypoint="5"]').click();
  await settlePopup(page, '.leaflet-popup', 1);
  const selected = await page.evaluate(() => ({
    index: window.trailViewer.nav.index(),
    title: document.querySelector('.gpx-pin.selected')?.title,
    highlighted: document.querySelector('.waypoint-overview-item.selected')?.dataset.waypoint,
  }));
  check('clicking a highlighted row locates its waypoint',
    selected.index === 5 && selected.title === '危险水源' && selected.highlighted === '5',
    `${selected.index}/${selected.title}/${selected.highlighted}`);

  await page.locator('.lang-switch button').click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await waitForLayout(page);
  await page.locator('.waypoint-filter-trigger').click();
  const translated = await page.evaluate(() => ({
    title: document.querySelector('.waypoint-overview-header strong')?.textContent,
    chips: [...document.querySelectorAll('.insight-filter')].map((node) => node.textContent),
    badges: [...document.querySelectorAll('.waypoint-insight-badge')].map((node) => node.textContent),
    filter: document.querySelector('.insight-filter.active')?.dataset.filter,
    trigger: document.querySelector('.waypoint-filter-trigger')?.textContent,
  }));
  check('insight labels follow the interface language',
    translated.title === '标记点速览' && translated.chips.includes('危险 2')
      && translated.chips.includes('水源 2') && translated.badges.includes('危险'),
    `${translated.title}/${translated.chips.join('|')}/${translated.badges.join('|')}`);
  check('the active category survives a language switch', translated.filter === 'water', translated.filter);

  await page.setViewportSize({ width: 360, height: 740 });
  await waitForLayout(page);
  await page.locator('.waypoint-filter-trigger').click();
  const narrow = await page.evaluate(() => {
    const panel = document.querySelector('.waypoint-overview').getBoundingClientRect().toJSON();
    const panelNode = document.querySelector('.waypoint-overview');
    const list = document.querySelector('.waypoint-overview-list');
    const menu = document.querySelector('.waypoint-filter-menu')?.getBoundingClientRect().toJSON();
    return {
      panel,
      menu,
      width: innerWidth,
      horizontalOverflow: panelNode.scrollWidth > panelNode.clientWidth + 1
        || list.scrollWidth > list.clientWidth + 1,
    };
  });
  check('the insight filters stay inside a narrow overview',
    narrow.panel.left >= 0 && narrow.panel.right <= narrow.width + 0.5,
    `${narrow.panel.left}..${narrow.panel.right} in ${narrow.width}`);
  check('the filter menu stays inside the narrow window',
    narrow.menu.left >= 0 && narrow.menu.right <= narrow.width + 0.5
      && narrow.menu.top >= 0 && narrow.menu.bottom <= 740,
    JSON.stringify(narrow.menu));
  check('the overview no longer has a horizontal list scrollbar', narrow.horizontalOverflow === false,
    String(narrow.horizontalOverflow));

  if (shot) await page.screenshot({ path: shot });
  check('no page errors', pageErrors.length === 0, pageErrors.join('; '));
  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  console.log(failures.length === 0 ? '\nwaypoint insights OK' : `\n${failures.length} insight checks failed`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
