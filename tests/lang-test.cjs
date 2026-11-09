// Test for the interface language: the page follows the system language, one button flips it, the choice is
// remembered, and everything that is already on screen is repainted in place (info box, cards, profile,
// the full-size photo bar) instead of being reloaded away.
//
//   NODE_PATH=<folder containing playwright-core> node tests/lang-test.cjs [screenshot.png]
//
// Set CHROMIUM to a Chromium/Chrome executable if Playwright's own browser is not installed.
const fs = require('fs');
const path = require('path');
const {
  launchBrowser,
  settlePopup,
  waitForLayout,
  waitForPhoto,
} = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { createArtifacts } = require('./support/artifacts.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const shot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const fixture = 'kml-photos.kml';
const { check, failures } = createChecker('lang');
const artifacts = createArtifacts('lang');

async function main() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  const remote = fs.readFileSync(path.join(root, 'tests/fixtures/photo2.png'));

  // Everything the switch has to touch, read straight off the page.
  const snapshot = (page) => page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent || '';
    const titles = (selector) => Array.from(document.querySelectorAll(selector)).map((n) => n.title);
    const labels = Array.from(document.querySelectorAll('#info dt')).map((n) => n.textContent);
    return {
      lang: document.documentElement.lang,
      title: document.title,
      labels,
      values: Array.from(document.querySelectorAll('#info dd')).map((n) => n.textContent),
      facts: Array.from(document.querySelectorAll('#info .facts dd')).map((n) => n.textContent),
      // The keys are named on the buttons now: one tooltip per control that has one.
      tips: ['.layer-switch button', '.pins-switch button', '.locate-switch button', '.export-switch button']
        .map((q) => document.querySelector(q)?.title || '').join(' | '),
      layers: Array.from(document.querySelectorAll('.layer-switch button')).map((n) => n.textContent),
      langButton: text('.lang-switch button'),
      langTitle: document.querySelector('.lang-switch button')?.title || '',
      profile: text('#profile .range'),
      axis: Array.from(document.querySelectorAll('#profile .axis')).map((n) => n.textContent),
      legend: text('#profile .legend .item'),
      readout: (() => {
        const node = document.querySelector('#profile .readout');
        return node ? `${node.querySelector('.ele').textContent}|${node.querySelector('.meta').textContent}` : '';
      })(),
      card: text('.leaflet-popup-content'),
      thumbs: titles('.photo-thumb'),
      photoClose: document.querySelector('.photo-close')?.title || '',
      photoArrows: titles('.photo-arrow'),
      photoMeta: text('.photo-meta'),
      selected: document.querySelector('.gpx-pin.selected')?.getAttribute('title') || '',
    };
  });

  const open = async (page, url) => {
    await page.goto(url);
    await page.waitForFunction(() => document.body.classList.contains('loaded'));
  };

  const options = { viewport: { width: 1200, height: 800 }, locale: 'zh-CN' };
  const context = await browser.newContext(options);
  await context.addInitScript(() => localStorage.setItem('gpxviewer.infoDetails', 'full'));
  const page = await context.newPage();
  await artifacts.start(page);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('https://example.test/**', (route) => route.fulfill({ body: remote, contentType: 'image/png' }));

  // 1. A Chinese system gets a Chinese page without anyone asking.
  await open(page, `${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
  let s = await snapshot(page);
  check('a Chinese system starts in Chinese', s.lang === 'zh-CN', s.lang);
  check('the document title is translated', s.title === '轨迹预览', s.title);
  check('the summary labels are translated',
    ['点数', '里程', '内容', '照片'].every((word) => s.labels.includes(word)), s.labels.join('/'));
  check('the contents line counts in Chinese', s.values.includes('1 条轨迹、5 个标记点'),
    s.values.join(' | ').slice(0, 120));
  check('the photo line is translated', s.values.some((v) => v.includes('张照片，分布在 3 个标记点')),
    s.values[s.values.length - 1]);
  check('the tooltips name the keys in Chinese',
    /Q \/ E 切换/.test(s.tips) && /（W）/.test(s.tips) && /（C）/.test(s.tips) && /（X）/.test(s.tips), s.tips);
  check('the layer buttons are translated', s.layers.join('/') === '地图/地形/卫星/无底图', s.layers.join('/'));
  check('the profile title is translated', s.profile === '海拔', s.profile);
  check('the profile axis is translated but keeps its unit', s.axis.length === 2 && s.axis.every((a) => /^-?\d+ m$/.test(a)), s.axis.join(' / '));
  check('the profile legend is translated', /^(陡坡|无陡坡)\s*.*·\s*最陡\s*\d+%$/.test(s.legend.replace(/\s+/g, ' ')), s.legend);
  check('the switch button shows the current language', s.langButton === '中', s.langButton);

  // 2. An open card and the profile are repainted, not closed.
  await page.locator('.gpx-pin[title="Album"]').click();
  await page.waitForSelector('.photo-popup .photo-thumb');
  s = await snapshot(page);
  check('the card hint is translated', s.card.includes('点击图片查看原图'), s.card.slice(-40));
  check('an album counts its photos in Chinese', s.card.includes('共 2 张'), s.card.slice(-40));
  check('a thumbnail names its place in Chinese', s.thumbs[1] === '打开第 2/2 张', s.thumbs.join(' | '));
  check('the elevation line is Chinese but the unit is not', s.card.includes('海拔 26 m'), s.card.slice(0, 40));

  await page.evaluate(() => window.gpxViewer.scrub.at(200));
  const zhReadout = (await snapshot(page)).readout;
  check('the scrubber readout keeps the international unit',
    /^(?:\d+ m)?\|\d+(?:\.\d+)? (?:m|km)(?: · \d{1,2}:\d{2}(?::\d{2})?)?$/.test(zhReadout), zhReadout);

  // 3. The switch repaints what is open and keeps the selection.
  await page.locator('.lang-switch button').click();
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await waitForLayout(page);
  s = await snapshot(page);
  check('the switch turns the page English', s.lang === 'en' && s.title === 'Track viewer', `${s.lang} ${s.title}`);
  check('the labels follow', s.labels.includes('Points') && s.labels.includes('Contents'), s.labels.join('/'));
  check('the contents line switches too', s.values.some((v) => v.startsWith('1 track, 5 waypoints')),
    s.values.join(' | ').slice(0, 120));
  check('the tooltips follow',
    /Q \/ E switch/.test(s.tips) && /\(W\)/.test(s.tips) && /\(C\)/.test(s.tips) && /\(X\)/.test(s.tips), s.tips);
  check('the layer buttons follow', s.layers.join('/') === 'Map/Terrain/Satellite/No map', s.layers.join('/'));
  check('the profile follows', s.profile === 'Elevation', s.profile);
  check('and so does its axis', s.axis.every((a) => /^-?\d+ m$/.test(a)), s.axis.join(' / '));
  check('and its legend', /^(Steep|No steep ground)\s*.*·\s*max\s*\d+%$/.test(s.legend.replace(/\s+/g, ' ')), s.legend);
  // The zoom buttons are pinned to the card's right edge, and the card is wider in one language than the other,
  // so they have to be re-measured rather than placed once.
  const pins = await page.evaluate(() => {
    const card = document.getElementById('info').getBoundingClientRect();
    const zoom = document.querySelector('.leaflet-control-zoom').getBoundingClientRect();
    return { right: Math.round(card.right), left: Math.round(zoom.left) };
  });
  check('the zoom buttons stay right of the card after a language switch', pins.left >= pins.right,
    `zoom ${pins.left} vs card ${pins.right}`);
  check('the scrubber readout follows while it is on screen', /^(?:\d+ m)?\|(?:\d+ m(?: · \d+ m)?)$/.test(s.readout), s.readout);
  check('the button now offers Chinese', s.langButton === 'EN' && s.langTitle === 'Switch to Chinese',
    `${s.langButton} / ${s.langTitle}`);
  check('the open card is rebuilt in English', s.card.includes('Click a photo to open it full size'),
    s.card.slice(-40));
  check('the album hint is rebuilt in English', s.card.includes('2 photos'), s.card.slice(-40));
  check('the thumbnails are rebuilt in English', s.thumbs[1] === 'Open photo 2 of 2', s.thumbs.join(' | '));
  check('the selection survives the switch', s.selected === 'Album', s.selected);
  check('the card is still open after the switch', (await page.locator('.leaflet-popup').count()) === 1);

  // 4. The choice is remembered across a reload, the system language no longer decides.
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('loaded'));
  s = await snapshot(page);
  check('a reload keeps the chosen language', s.lang === 'en' && s.langButton === 'EN', `${s.lang} ${s.langButton}`);
  check('nothing is selected after a reload', s.selected === '', s.selected);

  // 5. Photos carry the language into the full-size viewer.
  await page.locator('.lang-switch button').click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await page.locator('.gpx-pin[title="Album"]').click();
  await page.waitForSelector('.photo-popup .photo-thumb');
  await page.locator('.photo-popup .photo-thumb').nth(0).click();
  await waitForPhoto(page);
  await settlePopup(page, '.leaflet-popup', 0);
  s = await snapshot(page);
  check('the close button explains itself in Chinese', s.photoClose === '关闭（点击空白处亦可）', s.photoClose);
  check('the arrows are named in Chinese', s.photoArrows.join('/') === '上一张/下一张', s.photoArrows.join('/'));
  check('the photo meta keeps the international unit', /\d+ m\b/.test(s.photoMeta), s.photoMeta);
  check('the viewer keeps the placemark name', s.card === '', 'card closed behind the viewer');

  // 6. The keys and the map are untouched by any of this: Album has two photos, so the second press is the
  // one that crosses over to the next pin.
  await page.keyboard.press('ArrowRight');
  await waitForPhoto(page);
  await page.keyboard.press('ArrowRight');
  await waitForPhoto(page);
  await page.waitForFunction(() => document.querySelector('.photo-titles strong')?.textContent === 'Inline');
  s = await snapshot(page);
  check('the keys still walk the photos', s.selected === 'Inline', s.selected);
  await page.locator('.photo-close').click();

  if (shot) {
    await waitForLayout(page);
    await page.screenshot({ path: shot });
  }
  check('no page errors', pageErrors.length === 0, pageErrors.join('; '));

  // 7. An English system starts in English, and the switch goes the other way.
  const enContext = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'en-US' });
  await enContext.addInitScript(() => localStorage.setItem('gpxviewer.infoDetails', 'full'));
  const enPage = await enContext.newPage();
  await open(enPage, `${base}/viewer/index.html?src=../tests/fixtures/${fixture}`);
  s = await snapshot(enPage);
  check('an English system starts in English', s.lang === 'en' && s.langButton === 'EN', `${s.lang} ${s.langButton}`);
  check('the switch offers Chinese there', s.langTitle === 'Switch to Chinese', s.langTitle);
  await enPage.locator('.lang-switch button').click();
  await enPage.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  s = await snapshot(enPage);
  check('the switch turns an English page Chinese', s.lang === 'zh-CN' && s.langTitle === 'Switch to English',
    `${s.lang} / ${s.langTitle}`);

  // 8. Error pages are translated as well. The page above was switched to Chinese, so the same choice applies.
  await enPage.goto(`${base}/viewer/index.html?src=../tests/fixtures/truncated.gpx`);
  await enPage.waitForSelector('#message .detail');
  const errorPage = await enPage.evaluate(() => ({
    title: document.querySelector('#message h1')?.textContent || '',
    detail: document.querySelector('#message .detail')?.textContent || '',
  }));
  check('an unreadable file explains itself in Chinese', errorPage.title === '无法显示此文件', errorPage.title);
  check('the parse error is phrased in Chinese', errorPage.detail.startsWith('文件不是合法的 XML'), errorPage.detail);
  await enContext.close();

  await artifacts.capture(page, failures, pageErrors);
  await context.close();
  await browser.close();
  server.close();

  if (failures.length > 0) {
    console.log(`\n${failures.length} failed: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
