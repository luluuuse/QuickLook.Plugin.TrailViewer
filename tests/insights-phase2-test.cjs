// Waypoint insight phase 2: full-text classification, icon hints, nearby merging and compact manual fixes.
const path = require('path');
const { launchBrowser, openViewer, waitForLayout } = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const { check, failures } = createChecker('insights2');
const artifacts = createArtifacts('insights2');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openViewer(page, base, 'kml-insights-phase2.kml');
  await page.locator('.waypoint-overview-switch button').click();
  const collapsed = await page.evaluate(() => ({
    rows: document.querySelectorAll('.waypoint-overview-item').length,
    editors: [...document.querySelectorAll('.waypoint-correct-button')]
      .every((node) => node.getAttribute('aria-expanded') === 'false'),
    menus: document.querySelectorAll('.waypoint-correct-menu').length,
    sliders: document.querySelectorAll('.waypoint-route-brief, .waypoint-overview-filters').length,
  }));
  check('correction controls are compact and closed by default',
    collapsed.rows === 8 && collapsed.editors && collapsed.menus === 0 && collapsed.sliders === 0,
    JSON.stringify(collapsed));

  await page.locator('.waypoint-filter-trigger').click();
  const initial = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.waypoint-overview-item')].map((node) => ({
      name: node.querySelector('.heading strong')?.textContent,
      primary: node.dataset.primary || '',
      meta: node.querySelector('.meta')?.textContent || '',
      badges: [...node.querySelectorAll('.waypoint-insight-badge')].map((badge) => badge.textContent),
      evidence: node.querySelector('.waypoint-evidence')?.textContent || '',
      possible: [...node.querySelectorAll('.waypoint-insight-badge.possible')].map((badge) => badge.textContent),
    }));
    return {
      rows,
      chips: [...document.querySelectorAll('.insight-filter')].map((node) => node.textContent),
      filterOpen: document.querySelector('.waypoint-filter-trigger')?.getAttribute('aria-expanded'),
    };
  });

  check('nearby waypoints merge only in the overview',
    initial.rows.length === 8
      && initial.rows.some((row) => row.name === '水源 / 营地'
        && /2 nearby points merged/.test(row.meta)),
    initial.rows.map((row) => `${row.name}:${row.meta}`).join('|'));
  check('the merged row carries both water and camp badges',
    initial.rows.find((row) => row.name === '水源 / 营地')?.badges.join('|') === 'Water|Camp',
    initial.rows.find((row) => row.name === '水源 / 营地')?.badges.join('|'));
  check('icon hints classify a generic marker as possible water',
    initial.rows.find((row) => row.name === '图标点')?.primary === 'water'
      && initial.rows.find((row) => row.name === '图标点')?.possible.includes('Water'),
    JSON.stringify(initial.rows.find((row) => row.name === '图标点')));
  check('the compact filter menu keeps important semantic locations one click away',
    initial.filterOpen === 'true' && initial.chips.includes('Important 6'),
    initial.chips.join('|'));
  check('new support categories are exposed in filters',
    ['Rescue 1', 'Bailout 2', 'Supply 1', 'Crossing 1', 'Viewpoint 1']
      .every((label) => initial.chips.includes(label)), initial.chips.join('|'));

  const long = initial.rows.find((row) => row.name === '长文字提示');
  check('full-description evidence survives display truncation',
    long?.primary === 'danger' && /禁止通行/.test(long?.evidence || ''),
    JSON.stringify(long));

  const crossing = page.locator('.waypoint-overview-item', { hasText: '木桥' });
  await crossing.locator('.waypoint-correct-button').click();
  await page.locator('.waypoint-correct-option[data-value="camp"]').click();
  await waitForLayout(page);
  let corrected = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.waypoint-overview-item')]
      .find((node) => node.querySelector('.heading strong')?.textContent === '木桥');
    return {
      primary: row?.dataset.primary,
      badges: [...(row?.querySelectorAll('.waypoint-insight-badge') || [])].map((node) => node.textContent),
      stored: JSON.parse(localStorage.getItem('gpxviewer.waypoint-insights') || '{}'),
    };
  });
  check('manual correction can replace an automatic category',
    corrected.primary === 'camp' && corrected.badges.join('|') === 'Camp',
    JSON.stringify(corrected));
  check('manual corrections are stored locally', Object.values(corrected.stored).includes('camp'));

  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await page.locator('.waypoint-overview-switch button').click();
  corrected = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.waypoint-overview-item')]
      .find((node) => node.querySelector('.heading strong')?.textContent === '木桥');
    return {
      primary: row?.dataset.primary,
      badges: [...row.querySelectorAll('.waypoint-insight-badge')].map((node) => node.textContent),
    };
  });
  check('a manual correction survives a reload',
    corrected.primary === 'camp' && corrected.badges.join('|') === 'Camp',
    JSON.stringify(corrected));

  await page.locator('.waypoint-overview-item', { hasText: '木桥' })
    .locator('.waypoint-correct-button').click();
  await page.locator('.waypoint-correct-option[data-value="auto"]').click();
  corrected = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.waypoint-overview-item')]
      .find((node) => node.querySelector('.heading strong')?.textContent === '木桥');
    return { primary: row?.dataset.primary, badges: [...row.querySelectorAll('.waypoint-insight-badge')]
      .map((node) => node.textContent) };
  });
  check('automatic mode restores icon/text classification',
    corrected.primary === 'crossing' && corrected.badges.join('|') === 'Crossing',
    JSON.stringify(corrected));

  await page.locator('.waypoint-overview-item', { hasText: '木桥' })
    .locator('.waypoint-correct-button').click();
  await page.locator('.waypoint-correct-option[data-value="clear"]').click();
  corrected = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.waypoint-overview-item')]
      .find((node) => node.querySelector('.heading strong')?.textContent === '木桥');
    return { primary: row?.dataset.primary || '', badges: row.querySelectorAll('.waypoint-insight-badge').length };
  });
  check('clear labels removes automatic highlights', corrected.primary === '' && corrected.badges === 0,
    JSON.stringify(corrected));

  await page.locator('.lang-switch button').click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await waitForLayout(page);
  await page.locator('.waypoint-filter-trigger').click();
  const translated = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.insight-filter')].map((node) => node.textContent),
    filter: document.querySelector('.waypoint-filter-trigger')?.textContent,
    correct: document.querySelector('.waypoint-correct-button')?.title,
  }));
  check('phase-two categories and compact controls follow the language',
    translated.chips.includes('救援 1') && translated.chips.includes('下撤 2')
      && /筛选/.test(translated.filter || '') && translated.correct === '纠正分类',
    JSON.stringify(translated));

  if (shot) await page.screenshot({ path: shot });
  check('no page errors', pageErrors.length === 0, pageErrors.join('; '));
  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  console.log(failures.length === 0 ? '\nwaypoint insights phase two OK'
    : `\n${failures.length} phase-two insight checks failed`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
