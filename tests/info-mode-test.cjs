// Summary card detail modes: compact is the default, full details are one explicit click away, and the chosen
// mode persists without bringing back the redundant file-name line.
const path = require('path');
const { launchBrowser, openViewer, waitForLayout } = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const { check, failures } = createChecker('info-mode');
const artifacts = createArtifacts('info-mode');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${base}/viewer/index.html`);
  await page.evaluate(() => localStorage.removeItem('trailviewer.infoDetails'));
  await openViewer(page, base, 'track-time-ele.gpx');
  await waitForLayout(page);

  const state = async () => page.evaluate(() => ({
    mode: document.getElementById('info').dataset.details,
    title: document.querySelector('#info h1')?.textContent || '',
    titleHint: document.querySelector('#info h1')?.title || '',
    fileLine: document.querySelectorAll('#info .file').length,
    stats: document.querySelectorAll('#info .stats .pair').length,
    facts: document.querySelectorAll('#info .facts .fact').length,
    button: document.querySelector('.info-details-toggle')?.textContent || '',
    expanded: document.querySelector('.info-details-toggle')?.getAttribute('aria-expanded'),
    titleText: document.querySelector('.info-details-toggle')?.title || '',
    width: document.getElementById('info').getBoundingClientRect().width,
    stored: localStorage.getItem('trailviewer.infoDetails'),
  }));

  const compact = await state();
  check('the summary starts in compact mode',
    compact.mode === 'compact' && compact.stats === 6 && compact.facts === 0,
    JSON.stringify(compact));
  check('the redundant file-name line is gone',
    compact.fileLine === 0 && compact.title === 'Synthetic hike', `${compact.fileLine}/${compact.title}`);
  check('the title tooltip retains the full file name',
    compact.titleHint.includes('Synthetic hike') && compact.titleHint.includes('track-time-ele.gpx'),
    compact.titleHint);
  check('compact mode offers an explicit full-details control',
    compact.button === 'More' && compact.expanded === 'false'
      && compact.titleText === 'Show full route details',
    JSON.stringify(compact));

  await page.locator('.info-details-toggle').click();
  await waitForLayout(page);
  const full = await state();
  check('full mode adds the optional facts without changing the six basics',
    full.mode === 'full' && full.stats === 6 && full.facts > 0,
    JSON.stringify(full));
  check('full mode and compact mode both omit the file-name line',
    full.fileLine === 0 && full.title === compact.title, `${full.fileLine}/${full.title}`);
  check('the full-details choice is stored locally',
    full.stored === 'full' && full.button === 'Less' && full.expanded === 'true',
    JSON.stringify(full));
  check('full mode stays within the compact-width ceiling',
    compact.width <= full.width + 1 && full.width <= 310,
    `${compact.width} -> ${full.width}`);

  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await waitForLayout(page);
  const restored = await state();
  check('the full-details choice survives a reload',
    restored.mode === 'full' && restored.facts > 0 && restored.button === 'Less',
    JSON.stringify(restored));

  await page.locator('.info-details-toggle').click();
  await page.locator('.lang-switch button').click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await waitForLayout(page);
  const translated = await state();
  check('compact mode stays compact across a language switch',
    translated.mode === 'compact' && translated.stats === 6 && translated.facts === 0,
    JSON.stringify(translated));
  check('the details control is translated',
    translated.button === '更多' && translated.titleText === '显示完整路线信息',
    `${translated.button}/${translated.titleText}`);

  const migrationPage = await browser.newPage({ viewport: { width: 1000, height: 700 }, locale: 'en-US' });
  await migrationPage.goto(`${base}/viewer/index.html`);
  await migrationPage.evaluate(() => {
    localStorage.removeItem('trailviewer.infoDetails');
    localStorage.setItem('gpxviewer.infoDetails', 'full');
  });
  await openViewer(migrationPage, base, 'track-time-ele.gpx');
  await waitForLayout(migrationPage);
  const migrated = await migrationPage.evaluate(() => ({
    mode: document.getElementById('info').dataset.details,
    current: localStorage.getItem('trailviewer.infoDetails'),
    legacy: localStorage.getItem('gpxviewer.infoDetails'),
  }));
  check('legacy GpxViewer storage keys migrate to TrailViewer',
    migrated.mode === 'full' && migrated.current === 'full' && migrated.legacy === null,
    JSON.stringify(migrated));
  await migrationPage.close();

  if (shot) await page.screenshot({ path: shot });
  check('no page errors', pageErrors.length === 0, pageErrors.join('; '));
  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  console.log(failures.length === 0 ? '\nsummary modes OK' : `\n${failures.length} summary-mode checks failed`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
