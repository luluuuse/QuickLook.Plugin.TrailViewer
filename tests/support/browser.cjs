const { chromium } = require('playwright-core');

async function launchBrowser() {
  return chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
}

async function openViewer(page, base, fixture = 'track-time-ele.gpx', params = {}) {
  const query = new URLSearchParams({
    src: `../tests/fixtures/${fixture}`,
    ...params,
  });
  await page.goto(`${base}/viewer/index.html?${query}`);
  await page.waitForFunction(() => document.body.classList.contains('loaded')
    || document.body.classList.contains('failed'));
}

async function waitForPhoto(page) {
  await page.waitForFunction(() => {
    const image = document.querySelector('.photo-image');
    return Boolean(image) && !image.hidden && image.complete && image.naturalWidth > 0;
  });
}

async function waitForPanel(page, selector, hidden = false) {
  await page.waitForFunction(({ selector: target, hidden: wanted }) => {
    const node = document.querySelector(target);
    return Boolean(node) && (wanted ? node.hidden : !node.hidden);
  }, { selector, hidden });
}

async function waitForLayout(page) {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function waitForFocus(page, selector) {
  await page.waitForFunction((target) => document.activeElement?.matches(target), selector);
}

/**
 * Wait for the popup transition itself rather than a fixed duration. Leaflet fades a closed popup out and
 * leaves it in the DOM until that animation finishes, which made "opened and immediately toggled shut" hard
 * to distinguish from "open" in older tests.
 */
async function settlePopup(page, selector = '.leaflet-popup', count = 1) {
  await page.waitForFunction(({ selector: target, count: wanted }) => {
    const nodes = [...document.querySelectorAll(target)];
    if (nodes.length !== wanted) return false;
    return nodes.every((node) => node.getAnimations({ subtree: true })
      .every((animation) => animation.playState !== 'running'));
  }, { selector, count });
}

/**
 * Wait for Leaflet to finish any zoom, pan or fly animation. Tests that need a particular operation should
 * also wait for its resulting value, because the wheel handler schedules its work briefly after the event.
 */
async function waitForMapIdle(page) {
  await page.waitForFunction(() => {
    const map = window.trailViewer?.map;
    if (!map) return false;
    if (map._animatingZoom || map._panAnim?._inProgress) return false;
    const pane = map.getPanes().mapPane;
    return pane.getAnimations({ subtree: true })
      .every((animation) => animation.playState !== 'running');
  });
}

async function waitForZoom(page, wanted, tolerance = 1e-9) {
  await page.waitForFunction(({ wanted: target, tolerance: allowed }) => {
    const map = window.trailViewer?.map;
    return Boolean(map) && Math.abs(map.getZoom() - target) <= allowed;
  }, { wanted, tolerance });
  await waitForMapIdle(page);
}

async function waitForTiles(page, fragment = '', minimum = 1) {
  await page.waitForFunction(({ fragment: wanted, minimum: count }) => {
    const images = [...document.querySelectorAll('.leaflet-tile-pane img')]
      .filter((node) => node.src.includes(wanted));
    return images.length >= count && images.every((image) => image.complete);
  }, { fragment, minimum }, { timeout: 15000 });
}

module.exports = {
  launchBrowser,
  openViewer,
  settlePopup,
  waitForFocus,
  waitForLayout,
  waitForMapIdle,
  waitForPanel,
  waitForPhoto,
  waitForTiles,
  waitForZoom,
};
