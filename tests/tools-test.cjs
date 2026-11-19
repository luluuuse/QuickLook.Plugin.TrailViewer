// Summary clipboard, point coordinates, grouped toolbox and attachment export protocol.
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
const { check, failures, finish } = createChecker('tools');
const artifacts = createArtifacts('tools');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await page.addInitScript(() => {
    const listeners = [];
    window.__hostMessages = [];
    window.__clipboardText = '';
    window.__openedLinks = [];
    window.__completedAttachments = new Set();
    const openLink = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      if (this.target === '_blank') {
        window.__openedLinks.push(this.href);
        return;
      }
      openLink.call(this);
    };
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      addEventListener(type, listener) {
        if (type === 'message') listeners.push(listener);
      },
      postMessage(message) {
        window.__hostMessages.push(message);
        const send = (value) => setTimeout(() => listeners.forEach((listener) => listener({ data: value })), 0);
        if (message.startsWith('clipboard\t')) {
          const parts = message.split('\t');
          const ok = window.__clipboardFailure ? '0' : '1';
          if (!window.__clipboardFailure) window.__clipboardText = decodeURIComponent(parts[2] || '');
          setTimeout(() =>
            send(`clipboardResult\t${parts[1]}\t${ok}\t${ok === '1' ? '' : 'denied%20by%20test'}`),
          window.__clipboardDelay || 0);
        } else if (message.startsWith('attachmentresume\t')) {
          const parts = message.split('\t');
          const completed = String(parts[2] || '').split(',')
            .filter((index) => window.__completedAttachments.has(Number(index)));
          send(`attachmentResume\t${parts[1]}\t${completed.join(',')}\t%2Ftmp%2Fphoto-pins-photos`);
        } else if (message.startsWith('attachmentdone\t')) {
          const parts = message.split('\t');
          window.__completedAttachments.add(Number(parts[2]));
          send(`attachmentResult\t${parts[1]}\t${parts[2]}\t1\t%2Ftmp%2Fphoto-pins-photos\t`);
        } else if (message.startsWith('attachmentlocal\t')) {
          const parts = message.split('\t');
          window.__completedAttachments.add(Number(parts[2]));
          send(`attachmentResult\t${parts[1]}\t${parts[2]}\t1\t%2Ftmp%2Fphoto-pins-photos\t`);
        } else if (message.startsWith('attachmentlink\t')) {
          const parts = message.split('\t');
          window.__completedAttachments.add(Number(parts[2]));
          send(`attachmentResult\t${parts[1]}\t${parts[2]}\t1\t%2Ftmp%2Fphoto-pins-photos\t`);
        }
      },
    };
  });
  await artifacts.start(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await openViewer(page, base, 'kml-photos.kml');
  await waitForLayout(page);

  const summaryButton = page.locator('#info .info-copy');
  check('the summary box exposes a dedicated copy button',
    await summaryButton.getAttribute('aria-label') === 'Copy track summary'
      && await summaryButton.locator('svg[data-icon="copy"]').count() === 1);
  await summaryButton.click();
  await page.waitForFunction(() => window.__clipboardText.includes('Photo pins'));
  const summaryText = await page.evaluate(() => window.__clipboardText);
  check('the copied summary contains the useful route facts',
    /Distance:/.test(summaryText) && /Ascent:/.test(summaryText)
      && /Peak elevation:/.test(summaryText) && /Points: 3/.test(summaryText), summaryText);

  await page.click('.toolbox-switch > button');
  const menu = await page.evaluate(() => {
    const grid = document.querySelector('.toolbox-quick-grid');
    const cards = [...grid.querySelectorAll('.toolbox-quick-action')].map((node) => {
      const box = node.getBoundingClientRect();
      return { tool: node.dataset.tool, top: Math.round(box.top), left: box.left, right: box.right };
    });
    const weather = document.querySelector('.toolbox-weather-card').getBoundingClientRect();
    const gridBox = grid.getBoundingClientRect();
    return {
      note: document.querySelector('.toolbox-head-note')?.textContent,
      aria: grid.getAttribute('aria-label'),
      cards,
      groupHeadings: document.querySelectorAll('.toolbox-group-title').length,
      gridLeft: gridBox.left,
      gridRight: gridBox.right,
      gridBottom: gridBox.bottom,
      weatherTop: weather.top,
    };
  });
  check('the toolbox uses a compact 2 by 2 quick-tool grid',
    menu.note === 'Quick launch' && menu.aria === 'Quick tools'
      && menu.groupHeadings === 0
      && menu.cards.map((item) => item.tool).join('|') === 'measure|coordinates|export|attachments'
      && menu.cards[0].top === menu.cards[1].top
      && menu.cards[2].top === menu.cards[3].top
      && menu.cards[0].top < menu.cards[2].top
      && menu.cards.every((item) => item.left >= menu.gridLeft && item.right <= menu.gridRight),
    JSON.stringify(menu));
  check('the weather card remains a full-width action below the grid',
    menu.weatherTop >= menu.gridBottom,
    `${menu.weatherTop} >= ${menu.gridBottom}`);
  const callbacks = await page.evaluate(() => ({
    clipboard: typeof window.trailViewer.clipboardResult,
    attachment: typeof window.trailViewer.attachmentResult,
  }));
  check('the host clipboard and attachment acknowledgements are callable',
    callbacks.clipboard === 'function' && callbacks.attachment === 'function',
    JSON.stringify(callbacks));
  const failedClipboard = await page.evaluate(async () => {
    window.__clipboardFailure = true;
    try {
      await window.trailViewer.coordinates.copy('30.000000, 114.000000');
      return 'resolved';
    } catch (error) {
      return error.message;
    } finally {
      window.__clipboardFailure = false;
    }
  });
  check('the explicit false flag rejects a failed clipboard write',
    failedClipboard === 'denied by test', failedClipboard);
  const burstClipboard = await page.evaluate(async () => {
    window.__clipboardDelay = 80;
    const before = window.__hostMessages.filter((message) => message.startsWith('clipboard\t')).length;
    const first = window.trailViewer.coordinates.copy('first');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = window.trailViewer.coordinates.copy('second');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const third = window.trailViewer.coordinates.copy('third');
    await Promise.all([first, second, third]);
    window.__clipboardDelay = 0;
    return {
      messages: window.__hostMessages.filter((message) => message.startsWith('clipboard\t')).length - before,
      text: window.__clipboardText,
    };
  });
  check('concurrent clipboard copies keep one write in flight and prefer the latest value',
    burstClipboard.messages === 2 && burstClipboard.text === 'third',
    JSON.stringify(burstClipboard));
  const attachmentTitle = await page.locator('.toolbox-action[data-tool="attachments"]').getAttribute('title');
  check('attachment inventory counts embedded and external photos',
    attachmentTitle === '4 photos \u00b7 3 embedded \u00b7 1 external', attachmentTitle);

  await page.click('.toolbox-action[data-tool="coordinates"]');
  const coordinateLabels = await page.$$eval('.toolbox-coordinate-button span',
    (nodes) => nodes.map((node) => node.textContent));
  const coordinateRow = await page.$$eval('.toolbox-coordinate-button', (nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { top: Math.round(rect.top), left: rect.left, right: rect.right };
  }));
  const coordinateGrid = await page.locator('.toolbox-coordinate-grid').boundingBox();
  check('the four remaining coordinate modules stay on one row',
    coordinateLabels.join('|') === 'Start|End|Peak|Centre'
      && coordinateRow.length === 4
      && coordinateRow.every((item) => item.top === coordinateRow[0].top)
      && coordinateRow.every((item) => item.left >= coordinateGrid.x
        && item.right <= coordinateGrid.x + coordinateGrid.width),
    coordinateLabels.join('|'));
  check('the centre module uses its short label and hover explanation',
    await page.locator('[data-coordinate="center"]').getAttribute('title')
      === 'Copy the current map centre coordinate');

  const albumAt = await page.evaluate(() => {
    const point = window.trailViewer.gpx.waypoints[1];
    const projected = window.trailViewer.map.latLngToContainerPoint([point.lat, point.lon]);
    return { x: projected.x, y: projected.y };
  });
  await settlePopup(page, '.leaflet-popup', 0);
  check('opening the coordinate tool starts arbitrary-point picking immediately',
    await page.locator('#toolbox-panel').isVisible()
      && await page.locator('#toolbox-panel').evaluate((node) => node.classList.contains('is-picking'))
      && await page.locator('#map').evaluate((node) => node.classList.contains('is-coordinate-picking'))
      && await page.locator('.toolbox-coordinate-button[data-coordinate="any"]').count() === 0);
  check('the coordinate panel declares WGS-84 without an Esc-cancel instruction',
    await page.locator('.toolbox-coordinate-type').textContent() === 'Coordinate type: WGS-84'
      && !/Esc/i.test(await page.locator('.coordinate-pick-hint').textContent()));
  await page.mouse.click(albumAt.x + 13, albumAt.y);
  await page.waitForFunction(() => window.__clipboardText.includes('30.581000'));
  check('a click near a marker snaps to its exact coordinate',
    await page.evaluate(() => window.__clipboardText) === '30.581000, 114.301000'
      && /Snapped to marker/.test(await page.locator('.coordinate-focus-details').textContent())
      && await page.locator('.coordinate-focus-label strong').textContent() === 'Picked point',
    await page.evaluate(() => window.__clipboardText));
  check('the point popup and latest-coordinate card note the marker elevation',
    await page.locator('.coordinate-focus-elevation').textContent() === 'Elevation: 26 m'
      && await page.locator('.toolbox-coordinate-elevation').textContent() === 'Elevation: 26 m');
  const coordinateLabel = await page.locator('.coordinate-focus-label').evaluate((node) => {
    const text = node.querySelector('small');
    return {
      background: getComputedStyle(node).backgroundColor,
      fits: text.scrollWidth <= text.clientWidth + 1
        && node.scrollWidth <= node.clientWidth + 1,
    };
  });
  check('the coordinate label is more transparent and fits its text',
    coordinateLabel.background === 'rgba(24, 24, 24, 0.68)' && coordinateLabel.fits,
    JSON.stringify(coordinateLabel));
  check('the snapped point keeps continuous map picking active',
    await page.locator('#toolbox-panel').isVisible()
      && await page.locator('.toolbox-coordinate-result').isVisible()
      && await page.locator('#map').evaluate((node) => node.classList.contains('is-coordinate-picking')));

  const snappedCoordinate = await page.evaluate(() => window.__clipboardText);
  await page.mouse.click(700, 500);
  await page.waitForFunction((previous) => window.__clipboardText !== previous, snappedCoordinate);
  check('a click away from markers remains a free arbitrary point',
    !/Snapped to marker/.test(await page.locator('.coordinate-focus-details').textContent()));
  check('a free map point explains that elevation is unavailable',
    await page.locator('.coordinate-focus-elevation').textContent() === 'Elevation: unavailable'
      && await page.locator('.toolbox-coordinate-elevation').textContent() === 'Elevation: unavailable');
  await page.waitForTimeout(200);
  const clipboardMessagesBeforeRapidPicks = await page.evaluate(() =>
    window.__hostMessages.filter((message) => message.startsWith('clipboard\t')).length);
  await page.mouse.click(690, 500);
  await page.mouse.click(700, 510);
  await page.mouse.click(710, 520);
  await page.waitForFunction((previous) =>
    window.__hostMessages.filter((message) => message.startsWith('clipboard\t')).length > previous,
  clipboardMessagesBeforeRapidPicks);
  const rapidPickCopy = await page.evaluate(() => ({
    clipboard: window.__clipboardText,
    displayed: document.querySelector('.toolbox-coordinate-result code').textContent,
    messages: window.__hostMessages.filter((message) => message.startsWith('clipboard\t')).length,
  }));
  check('rapid point picks write only the final coordinate',
    rapidPickCopy.messages === clipboardMessagesBeforeRapidPicks + 1
      && rapidPickCopy.clipboard === rapidPickCopy.displayed,
    JSON.stringify(rapidPickCopy));
  await page.waitForTimeout(1900);
  check('transient pick feedback disappears while picking remains active',
    await page.locator('.coordinate-pick-hint').isHidden()
      && await page.locator('.coordinate-focus-halo').count() === 0
      && await page.locator('#map').evaluate((node) => node.classList.contains('is-coordinate-picking')));

  await page.evaluate(() => window.trailViewer.map.setView([0, 0], 5, { animate: false }));
  await page.click('.toolbox-coordinate-button[data-coordinate="start"]');
  await page.waitForFunction(() => {
    const map = window.trailViewer.map;
    return map.getZoom() >= 14 && map.getBounds().contains([30.58, 114.3]);
  });
  await page.waitForFunction(() => window.__clipboardText === '30.580000, 114.300000');
  check('a fixed coordinate focuses the map and shows a strong point marker',
    await page.locator('.coordinate-focus-halo').count() === 1
      && await page.locator('.coordinate-focus-label strong').textContent() === 'Start'
      && await page.locator('.coordinate-focus-elevation').textContent() === 'Elevation: 20 m'
      && await page.locator('.toolbox-coordinate-elevation').textContent() === 'Elevation: 20 m'
      && await page.locator('#map').evaluate((node) => node.classList.contains('is-coordinate-picking'))
      && await page.evaluate(() => window.__clipboardText) === '30.580000, 114.300000');
  await page.waitForTimeout(1900);
  check('a fixed-point marker remains while arbitrary picking stays available',
    await page.locator('.coordinate-focus-halo').count() === 1
      && await page.locator('#map').evaluate((node) => node.classList.contains('is-coordinate-picking')));
  check('the latest copied coordinate exposes the matching weather action',
    await page.locator('.toolbox-coordinate-weather').isVisible()
      && await page.locator('.toolbox-coordinate-weather').getAttribute('title')
        === 'Open this copied coordinate in Windy');
  await page.click('.toolbox-coordinate-weather');
  await page.waitForFunction(() => window.__openedLinks.length === 1);
  const weatherUrl = await page.evaluate(() => window.__openedLinks[0]);
  check('route weather opens the latest copied coordinate',
    /windy\.com\/30\.5800\/114\.3000\?/.test(weatherUrl), weatherUrl);

  await page.click('.toolbox-switch > button');
  await page.click('.toolbox-action[data-tool="attachments"]');
  const attachmentActions = await page.evaluate(() => ({
    all: document.querySelector('.toolbox-attachment-export.all')?.textContent,
    local: document.querySelector('.toolbox-attachment-export.local')?.textContent,
    allIcon: document.querySelector('.toolbox-attachment-export.all svg')?.dataset.icon,
    localIcon: document.querySelector('.toolbox-attachment-export.local svg')?.dataset.icon,
  }));
  check('the attachment page shows the same source totals',
    await page.locator('.toolbox-attachment-meta').textContent()
      === '4 photos \u00b7 3 embedded \u00b7 1 external');
  check('the attachment page offers separate all and embedded exports',
    attachmentActions.all === 'Export all photos'
      && attachmentActions.local === 'Export embedded photos'
      && attachmentActions.allIcon === 'image-export-all'
      && attachmentActions.localIcon === 'image-export-local',
    JSON.stringify(attachmentActions));
  await page.click('.toolbox-attachment-export.all');
  await page.waitForFunction(() => document.querySelector('.toolbox-attachment-result')?.hidden === false);
  const exportState = await page.evaluate(() => ({
    messages: window.__hostMessages,
    result: document.querySelector('.toolbox-attachment-result')?.textContent,
  }));
  check('embedded, inline and external photos follow their host export paths',
    exportState.messages.filter((message) => message.startsWith('attachmentlocal\t')).length === 2
      && exportState.messages.filter((message) => message.startsWith('attachmentbegin\t')).length === 1
      && exportState.messages.filter((message) => message.startsWith('attachmentlink\t')).length === 1,
    JSON.stringify(exportState.messages.map((message) => message.split('\t')[0])));
  check('the export reports its destination folder',
    exportState.result === 'Saved in photo-pins-photos', exportState.result);
  const localOnlyBefore = await page.evaluate(() => ({
    locals: window.__hostMessages.filter((message) => message.startsWith('attachmentlocal\t')).length,
    links: window.__hostMessages.filter((message) => message.startsWith('attachmentlink\t')).length,
  }));
  await page.click('.toolbox-attachment-export.local');
  await page.waitForFunction(() => /already completed/.test(document.getElementById('toast').textContent));
  check('a repeated embedded export resumes without copying or linking again',
    await page.evaluate(() => window.__hostMessages
      .filter((message) => message.startsWith('attachmentlink\t')).length) === localOnlyBefore.links
      && await page.evaluate(() => window.__hostMessages
        .filter((message) => message.startsWith('attachmentlocal\t')).length) === localOnlyBefore.locals
      && /3 already completed/.test(await page.locator('#toast').textContent()));

  await page.click('.lang-switch button');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  check('summary and coordinate controls follow the interface language',
    await page.locator('.info-copy').getAttribute('title') === '复制轨迹摘要'
      && await page.locator('.toolbox-head-note').textContent() === '快速启动'
      && await page.locator('.toolbox-quick-grid').getAttribute('aria-label') === '快捷工具');
  await page.click('.toolbox-attachments .toolbox-back');
  await page.click('.toolbox-action[data-tool="coordinates"]');
  check('the short centre label and copied-point weather action follow Chinese',
    await page.locator('[data-coordinate="center"] span').textContent() === '中心'
      && await page.locator('[data-coordinate="center"]').getAttribute('title') === '复制当前地图中心的坐标'
      && await page.locator('.toolbox-coordinate-type').textContent() === '坐标类型：WGS-84'
      && await page.locator('.toolbox-coordinate-weather span').textContent() === '该点天气');
  await page.click('.toolbox-coordinate-button[data-coordinate="start"]');
  await page.waitForFunction(() => window.__clipboardText === '30.580000, 114.300000');
  check('the elevation note follows the interface language',
    await page.locator('.coordinate-focus-elevation').textContent() === '海拔：20 m'
      && await page.locator('.toolbox-coordinate-elevation').textContent() === '海拔：20 m');

  await page.setViewportSize({ width: 360, height: 740 });
  await waitForLayout(page);
  const narrow = await page.evaluate(() => {
    const panel = document.getElementById('toolbox-panel').getBoundingClientRect();
    const info = document.getElementById('info').getBoundingClientRect();
    return {
      panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom },
      info: { right: info.right, left: info.left },
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  check('the quick-grid tools and summary copy fit a 360 px preview',
    narrow.panel.left >= 0 && narrow.panel.right <= 360
      && narrow.panel.top >= 0 && narrow.panel.bottom <= 740
      && narrow.info.left >= 0 && narrow.info.right <= 360 && narrow.overflow === false,
    JSON.stringify(narrow));

  await openViewer(page, base, 'track-time-ele.gpx');
  await page.click('.toolbox-switch > button');
  const emptyAttachment = page.locator('.toolbox-action[data-tool="attachments"]');
  check('a file without photos disables the attachment export entry',
    await emptyAttachment.isDisabled()
      && await emptyAttachment.getAttribute('title') === '这个文件没有可导出的附件图片。',
    await emptyAttachment.getAttribute('title'));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await artifacts.capture(page, failures, errors);
  await browser.close();
  server.close();
  process.exit(finish('tools OK'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
