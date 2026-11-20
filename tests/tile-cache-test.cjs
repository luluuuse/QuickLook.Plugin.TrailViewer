// Tile-cache settings UI, host bridge messages, two-step clear, localization and narrow-window fit.
const path = require('path');
const {
  launchBrowser,
  switchLanguage,
  waitForLayout,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const fixture = 'waypoints-route.gpx';
const { check, failures, finish } = createChecker('tile-cache');
const artifacts = createArtifacts('tile-cache');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const cspViolations = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
  });

  await page.route('https://**', (route) => route.abort());

  // 1. Standalone browser mode (no QuickLook host).
  await page.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  await waitForLayout(page);

  await page.locator('.layer-menu-toggle').click();
  await page.locator('.layer-settings-button').click();
  await waitForLayout(page);
  const standalone = await page.evaluate(() => ({
    heading: document.querySelector('.layer-cache-heading')?.textContent,
    toggle: document.querySelector('[data-tile-cache="toggle"]')?.textContent,
    toggleChecked: document.querySelector('[data-tile-cache="toggle"]')?.getAttribute('aria-checked'),
    limitValues: [...document.querySelectorAll('[data-tile-cache-mb]')].map((node) => node.dataset.tileCacheMb),
    limitLabels: [...document.querySelectorAll('[data-tile-cache-mb]')].map((node) => node.textContent),
    unlimitedTitle: document.querySelector('[data-tile-cache-mb="0"]')?.getAttribute('title'),
    selectedMb: document.querySelector('[data-tile-cache-mb].selected')?.dataset.tileCacheMb,
    selectedDays: document.querySelector('[data-tile-cache-days].selected')?.dataset.tileCacheDays,
    status: document.querySelector('.layer-cache-status')?.textContent,
  }));
  check('standalone browser shows default tile cache settings and host-only notice',
    standalone.heading === 'Local tile cache'
      && standalone.toggle === 'On'
      && standalone.toggleChecked === 'true'
      && JSON.stringify(standalone.limitValues) === '["256","512","2048","0"]'
      && JSON.stringify(standalone.limitLabels) === '["256 MB","512 MB","2 GB","\u221e"]'
      && standalone.unlimitedTitle === 'Unlimited'
      && standalone.selectedMb === '512'
      && standalone.selectedDays === '30'
      && standalone.status === 'Available in QuickLook preview',
    JSON.stringify(standalone));

  await page.locator('[data-tile-cache="clear"]').click();
  const standaloneToast = await page.locator('#toast').textContent();
  check('clicking clear in standalone browser shows host-only toast',
    standaloneToast?.includes('QuickLook'),
    standaloneToast);

  // 2. Host-backed WebView2 mode.
  const hostPage = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await hostPage.route('https://**', (route) => route.abort());
  await hostPage.addInitScript(() => {
    window.__TRAILVIEWER_RUNTIME_CONFIG__ = Object.freeze({
      tileCache: { enabled: true, maxMb: 512, maxAgeDays: 30 },
    });
    window.__hostMessages = [];
    window.__hostListeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage: (message) => window.__hostMessages.push(message),
      addEventListener: (type, fn) => {
        if (type === 'message') window.__hostListeners.push(fn);
      },
    };
    window.__emitHostMessage = (data) => {
      for (const fn of window.__hostListeners) fn({ data });
    };
  });

  await hostPage.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
  await hostPage.waitForFunction(() => document.body.classList.contains('loaded'));
  await waitForLayout(hostPage);

  await hostPage.locator('.layer-menu-toggle').click();
  await hostPage.locator('.layer-settings-button').click();
  await waitForLayout(hostPage);

  check('opening Map settings requests live tile cache stats from host',
    await hostPage.evaluate(() => window.__hostMessages.includes('tile-cache\tstats')));

  await hostPage.evaluate(() => window.__emitHostMessage('tileCacheStats\t134217728\t2410'));
  const statsEn = await hostPage.locator('.layer-cache-status').textContent();
  check('host tile cache stats format size and count in English',
    statsEn === '128.0 MB \u00b7 2,410 tiles', statsEn);

  await hostPage.locator('[data-tile-cache-mb="0"]').click();
  await hostPage.locator('[data-tile-cache-days="0"]').click();
  let latestSettings = await hostPage.evaluate(() =>
    window.__hostMessages.filter((message) => message.startsWith('settings\t')).at(-1) || '');
  check('selecting unlimited storage and Forever retention persists parameters to host',
    latestSettings.includes('tileCache=1')
      && latestSettings.includes('tileCacheMaxMb=0')
      && latestSettings.includes('tileCacheDays=0'),
    latestSettings);

  await hostPage.locator('[data-tile-cache-mb="2048"]').click();
  latestSettings = await hostPage.evaluate(() =>
    window.__hostMessages.filter((message) => message.startsWith('settings\t')).at(-1) || '');
  check('selecting 2 GB storage limit persists tileCacheMaxMb=2048',
    latestSettings.includes('tileCacheMaxMb=2048'),
    latestSettings);

  await hostPage.locator('[data-tile-cache="toggle"]').click();
  const disabledState = await hostPage.evaluate(() => ({
    checked: document.querySelector('[data-tile-cache="toggle"]')?.getAttribute('aria-checked'),
    text: document.querySelector('[data-tile-cache="toggle"]')?.textContent,
    optionsDisabled: document.querySelector('.layer-cache-options')?.classList.contains('is-disabled'),
    limitDisabled: [...document.querySelectorAll('[data-tile-cache-mb]')].every((node) => node.disabled),
    latest: window.__hostMessages.filter((message) => message.startsWith('settings\t')).at(-1) || '',
  }));
  check('toggling tile cache off disables options and sends tileCache=0',
    disabledState.checked === 'false'
      && disabledState.text === 'Off'
      && disabledState.optionsDisabled
      && disabledState.limitDisabled
      && disabledState.latest.includes('tileCache=0'),
    JSON.stringify(disabledState));

  await hostPage.locator('[data-tile-cache="toggle"]').click();
  await switchLanguage(hostPage, 'zh');
  await waitForLayout(hostPage);
  const zhText = await hostPage.evaluate(() => ({
    heading: document.querySelector('.layer-cache-heading')?.textContent,
    toggle: document.querySelector('[data-tile-cache="toggle"]')?.textContent,
    unlimitedTitle: document.querySelector('[data-tile-cache-mb="0"]')?.getAttribute('title'),
    forever: document.querySelector('[data-tile-cache-days="0"]')?.textContent,
    status: document.querySelector('.layer-cache-status')?.textContent,
  }));
  check('tile cache UI switches cleanly to Chinese in place',
    zhText.heading === '本地瓦片缓存'
      && zhText.toggle === '已开启'
      && zhText.unlimitedTitle === '不限容量'
      && zhText.forever === '永久'
      && zhText.status === '已用 128.0 MB \u00b7 2,410 张',
    JSON.stringify(zhText));

  await hostPage.locator('.layer-menu-toggle').click();
  await hostPage.locator('.layer-settings-button').click();
  await waitForLayout(hostPage);
  await hostPage.evaluate(() => window.__emitHostMessage('tileCacheStats\t134217728\t2410'));
  await hostPage.locator('[data-tile-cache="clear"]').click();
  const clearArmed = await hostPage.evaluate(() => ({
    confirmClass: document.querySelector('[data-tile-cache="clear"]')?.classList.contains('confirm'),
    label: document.querySelector('.layer-cache-clear-label')?.textContent,
    sentClear: window.__hostMessages.includes('tile-cache\tclear'),
  }));
  check('first click on Clear arms confirmation without clearing yet',
    clearArmed.confirmClass && clearArmed.label === '确认清空' && !clearArmed.sentClear,
    JSON.stringify(clearArmed));

  await hostPage.locator('[data-tile-cache="clear"]').click();
  check('second click on Clear dispatches tile-cache clear to host',
    await hostPage.evaluate(() => window.__hostMessages.includes('tile-cache\tclear')));

  await hostPage.evaluate(() => window.__emitHostMessage('tileCacheCleared\t0\t0'));
  const clearedState = await hostPage.evaluate(() => ({
    status: document.querySelector('.layer-cache-status')?.textContent,
    clearDisabled: document.querySelector('[data-tile-cache="clear"]')?.disabled,
    toast: document.querySelector('#toast')?.textContent,
  }));
  check('tileCacheCleared updates status to empty, disables clear and shows toast',
    clearedState.status === '暂无缓存'
      && clearedState.clearDisabled === true
      && clearedState.toast === '本地瓦片缓存已清空',
    JSON.stringify(clearedState));

  await hostPage.setViewportSize({ width: 360, height: 740 });
  await waitForLayout(hostPage);
  const narrowFit = await hostPage.evaluate(() => {
    const menu = document.getElementById('layer-source-menu');
    const cache = document.querySelector('.layer-cache-section');
    const menuRect = menu.getBoundingClientRect();
    const cacheRect = cache.getBoundingClientRect();
    return {
      overflow: menu.scrollWidth - menu.clientWidth,
      fitsHorizontally: cacheRect.left >= menuRect.left - 1 && cacheRect.right <= menuRect.right + 1,
    };
  });
  check('tile cache settings fit inside the 320 px panel at 360 px viewport',
    narrowFit.overflow <= 1 && narrowFit.fitsHorizontally,
    JSON.stringify(narrowFit));

  await hostPage.close();

  // 3. Reopening with maxMb=0 (∞) preserves 0 instead of resetting to 512.
  const unlimitedPage = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await unlimitedPage.route('https://**', (route) => route.abort());
  await unlimitedPage.addInitScript(() => {
    window.__TRAILVIEWER_RUNTIME_CONFIG__ = Object.freeze({
      tileCache: { enabled: true, maxMb: 0, maxAgeDays: 0 },
    });
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage: () => {},
      addEventListener: () => {},
    };
  });
  await unlimitedPage.goto(`${base}/viewer/index.html?src=../tests/fixtures/${fixture}&tileCache=1&tileCacheMaxMb=0&tileCacheDays=0`);
  await unlimitedPage.waitForFunction(() => document.body.classList.contains('loaded'));
  await waitForLayout(unlimitedPage);
  await unlimitedPage.locator('.layer-menu-toggle').click();
  await unlimitedPage.locator('.layer-settings-button').click();
  await waitForLayout(unlimitedPage);
  const unlimitedInit = await unlimitedPage.evaluate(() => ({
    selectedMb: document.querySelector('[data-tile-cache-mb].selected')?.dataset.tileCacheMb,
    selectedDays: document.querySelector('[data-tile-cache-days].selected')?.dataset.tileCacheDays,
  }));
  check('hosted maxMb=0 and maxAgeDays=0 initialize cleanly as ∞ and Forever',
    unlimitedInit.selectedMb === '0' && unlimitedInit.selectedDays === '0',
    JSON.stringify(unlimitedInit));
  await unlimitedPage.close();

  check('no page errors', pageErrors.length === 0, pageErrors[0]);
  check('no CSP violations', cspViolations.length === 0, cspViolations[0]);
  await artifacts.capture(page, failures, pageErrors);
  await browser.close();
  server.close();
  process.exit(finish());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
