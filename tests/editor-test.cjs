// Track editor E2E: entry/exit, 4-zone layout, crop/topology/waypoint, undo/redo, dirty guard & Brush-to-Crop.
const path = require('path');
const { launchBrowser, openViewer, waitForLayout } = require('./support/browser.cjs');
const { createChecker } = require('./support/assertions.cjs');
const { startStaticServer } = require('./support/server.cjs');

const root = path.resolve(__dirname, '..');
const { check, failures } = createChecker('editor');

async function run() {
  const { server, base } = await startStaticServer(root);
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    await openViewer(page, base, 'track-time-ele.gpx');
    await waitForLayout(page);

    // Switch colorMode to elevation first so we verify exit restores it
    await page.keyboard.press('l');
    const colorBefore = await page.evaluate(() => document.querySelector('.track-color-switch button')?.dataset.trackColor);

    // 1. Open toolbox and enter editor
    await page.click('.toolbox-switch button');
    await page.click('[data-tool="edit"]');
    await page.waitForSelector('body.is-editing #editor-topbar:not([hidden])');

    const mounted = await page.evaluate(() => {
      const rail = document.getElementById('editor-rail')?.getBoundingClientRect();
      const zoom = document.querySelector('.leaflet-control-zoom')?.getBoundingClientRect();
      const locate = document.querySelector('.locate-switch')?.getBoundingClientRect();
      return {
        editing: document.body.classList.contains('is-editing'),
        infoHidden: getComputedStyle(document.getElementById('info')).display === 'none',
        colorHidden: getComputedStyle(document.querySelector('.track-color-switch')).display === 'none',
        railCount: document.querySelectorAll('#editor-rail .editor-rail-btn').length,
        drawerVisible: !document.getElementById('editor-drawer').hidden,
        cropHandles: document.querySelectorAll('.editor-crop-overlay .editor-crop-handle').length,
        baseTrackCount: document.querySelectorAll('.gpx-track').length,
        readOnlyPinCount: document.querySelectorAll('.gpx-pin').length,
        railClearOfZoom: Boolean(rail && zoom && rail.top >= zoom.bottom),
        railClearOfLocate: Boolean(rail && (!locate || rail.top >= locate.bottom)),
      };
    });
    check('enters editing mode and hides read-only chrome', mounted.editing && mounted.infoHidden && mounted.colorHidden);
    check('renders 6 active rail tools, drawer and 2 profile crop handles',
      mounted.railCount === 6 && mounted.drawerVisible && mounted.cropHandles === 2);
    check('left rail does not overlap zoom or locate controls',
      mounted.railClearOfZoom && mounted.railClearOfLocate);
    check('left rail is vertically centered on screen', await page.evaluate(() => {
      const rail = document.getElementById('editor-rail')?.getBoundingClientRect();
      return Boolean(rail && Math.abs((rail.top + rail.bottom) / 2 - window.innerHeight / 2) < 20);
    }));
    check('hides read-only base track and pins during editing',
      mounted.baseTrackCount === 0 && mounted.readOnlyPinCount === 0);

    // 1b. Pressing L while editing must not cycle track color or re-show deleted track
    await page.keyboard.press('l');
    check('pressing L during editing keeps base track hidden',
      await page.evaluate(() => document.querySelectorAll('.gpx-track').length === 0));

    // 2. Drag left crop handle slightly and apply crop
    const handleRect = await page.locator('.editor-crop-overlay .editor-crop-handle').first().boundingBox();
    await page.mouse.move(handleRect.x + handleRect.width / 2, handleRect.y + handleRect.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleRect.x + 120, handleRect.y + handleRect.height / 2);
    await page.mouse.up();

    await page.click('#editor-drawer .editor-btn-success');
    const afterCrop = await page.evaluate(() => ({
      dirty: document.getElementById('editor-topbar').classList.contains('is-dirty'),
      diffText: document.querySelector('.editor-diff-pill')?.textContent || '',
    }));
    check('crop marks editor dirty and updates diff pill', afterCrop.dirty && afterCrop.diffText.includes('-'));

    // 3. Undo & Redo via keyboard
    await page.keyboard.press('Control+z');
    const afterUndo = await page.evaluate(() => document.getElementById('editor-topbar').classList.contains('is-dirty'));
    check('Ctrl+Z undoes crop back to clean', !afterUndo);
    await page.keyboard.press('Control+Shift+Z');
    const afterRedo = await page.evaluate(() => document.getElementById('editor-topbar').classList.contains('is-dirty'));
    check('Ctrl+Shift+Z redoes crop', afterRedo);

    // 4. Topology reverse & closeLoop
    const dirBefore = await page.evaluate(() =>
      [...document.querySelectorAll('.gpx-distance .gpx-direction')].map((n) => n.style.getPropertyValue('--bearing')).join(','));
    await page.click('[data-editor-tool="topology"]');
    await page.click('#editor-drawer .editor-mode-btn');
    const dirAfter = await page.evaluate(() =>
      [...document.querySelectorAll('.gpx-distance .gpx-direction')].map((n) => n.style.getPropertyValue('--bearing')).join(','));
    check('topology reverse keeps dirty state', await page.evaluate(() => document.getElementById('editor-topbar').classList.contains('is-dirty')));
    check('topology reverse updates per-km direction markers', dirBefore !== dirAfter);

    const loopBtn = page.locator('#editor-drawer .editor-mode-btn').nth(2);
    await loopBtn.click();
    check('close loop disables itself after closing', await loopBtn.isDisabled());

    // 4b. Waypoint tool: plain off-track click does nothing, Alt+Click opens free-placement add form, hover tooltip & auto-select
    await page.click('[data-editor-tool="waypoint"]');
    const wptCompact = await page.evaluate(() => ({
      helpVisible: !document.querySelector('.editor-drawer-help')?.hidden,
      hintLen: (document.querySelector('.editor-drawer-help')?.getAttribute('data-hint') || '').length,
      noteHiddenByDefault: document.querySelector('.editor-wpt-note-box')?.hidden === true,
      noInlineHintParagraph: document.querySelectorAll('#editor-drawer .editor-drawer-hint').length === 0,
    }));
    check('waypoint drawer moves hint to header ? icon and collapses note by default',
      wptCompact.helpVisible && wptCompact.hintLen > 0 && wptCompact.noteHiddenByDefault && wptCompact.noInlineHintParagraph,
      JSON.stringify(wptCompact));
    await page.hover('.editor-drawer-help');
    const helpTip = await page.evaluate(() => {
      const tip = document.querySelector('.editor-drawer-tooltip')?.getBoundingClientRect();
      const drawer = document.getElementById('editor-drawer')?.getBoundingClientRect();
      return {
        visible: Boolean(tip && tip.width > 40),
        outsideDrawer: Boolean(tip && drawer && tip.left >= drawer.right - 2),
      };
    });
    check('hovering ? help icon shows unclipped floating tooltip beside drawer',
      helpTip.visible && helpTip.outsideDrawer, JSON.stringify(helpTip));
    await page.click('.editor-wpt-note-toggle');
    check('clicking note toggle expands waypoint note input',
      await page.evaluate(() => document.querySelector('.editor-wpt-note-box')?.hidden === false));
    const wptListInfo = await page.evaluate(() => {
      const list = document.querySelector('.editor-wpt-list');
      const idx = document.querySelector('.editor-list-row-index')?.textContent || '';
      return {
        firstIndex: idx,
        maxHeight: list ? getComputedStyle(list).maxHeight : '',
      };
    });
    if (wptListInfo.firstIndex) {
      check('waypoint list renders index column and compact max-height',
        wptListInfo.firstIndex === '1' && parseInt(wptListInfo.maxHeight, 10) <= 120,
        JSON.stringify(wptListInfo));
    }
    await page.mouse.click(1200, 120);
    const plainOffTrackForm = await page.locator('#editor-drawer .editor-btn-success').count();
    check('plain off-track click in waypoint mode does not open add form', plainOffTrackForm === 0);
    await page.keyboard.down('Alt');
    await page.mouse.click(1200, 120);
    await page.keyboard.up('Alt');
    const altOffTrackForm = await page.locator('#editor-drawer .editor-btn-success').count();
    check('Alt+Click off-track in waypoint mode opens free-placement add form', altOffTrackForm === 1);
    await page.click('#editor-drawer .editor-drawer-actions .editor-btn:not(.editor-btn-success)');

    const firstPin = page.locator('.editor-wpt-pin').first();
    if (await firstPin.count() > 0) {
      const pinBox = await firstPin.boundingBox();
      await page.mouse.move(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2);
      await page.waitForSelector('.editor-wpt-tooltip');
      check('hovering waypoint shows dynamic tooltip', await page.locator('.editor-wpt-tooltip').isVisible());
      await firstPin.click();
      check('clicking waypoint selects pin and highlights list row', await page.evaluate(() =>
        document.querySelectorAll('.editor-wpt-pin.is-selected').length === 1
        && document.querySelectorAll('.editor-wpt-list .editor-list-row.is-selected').length === 1));
    }

    // 5. Dirty exit guard & discard
    await page.keyboard.press('Escape');
    await page.waitForSelector('.editor-exit-guard:not([hidden])');
    await page.click('.editor-exit-guard .editor-btn-danger');
    await page.waitForSelector('body:not(.is-editing)');

    const colorAfter = await page.evaluate(() => document.querySelector('.track-color-switch button')?.dataset.trackColor);
    check('exiting restores original track colorMode', colorAfter === colorBefore);

    // 6. Profile Brush -> Crop this span
    const plotBox = await page.locator('#profile .plot').boundingBox();
    await page.mouse.move(plotBox.x + plotBox.width * 0.2, plotBox.y + plotBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
    await page.mouse.up();
    await page.waitForSelector('.brush-stats-crop:not([hidden])');
    await page.click('.brush-stats-crop');
    await page.waitForSelector('body.is-editing #editor-topbar:not([hidden])');
    const prefilled = await page.evaluate(() => document.querySelector('.editor-crop-overlay .editor-crop-dim-left')?.style.width || '0px');
    check('Brush "Crop this span" opens editor in crop mode with prefilled span', parseFloat(prefilled) > 10);

    // 7. Exit and re-enter editor cleanly without duplicating listeners
    await page.keyboard.press('Escape');
    await page.waitForSelector('body:not(.is-editing)');
    await page.click('.toolbox-switch button');
    await page.click('[data-tool="edit"]');
    await page.waitForSelector('body.is-editing #editor-topbar:not([hidden])');
    check('re-entering editor mounts cleanly', await page.locator('#editor-rail .editor-rail-btn').count() === 6);

    // 7b. Right-click context menu hides on click and splits track into 2 segments
    const ctxInitialHidden = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.editor-context-menu')).display === 'none');
    check('context menu starts hidden', ctxInitialHidden);
    const trackPt = await page.evaluate(() => {
      const pts = window.trailViewer.gpx.tracks[0].segments[0];
      const mid = pts[Math.floor(pts.length / 2)];
      const p = window.trailViewer.map.latLngToContainerPoint([mid.lat, mid.lon]);
      return { x: p.x, y: p.y };
    });
    await page.mouse.click(trackPt.x, trackPt.y, { button: 'right' });
    await page.waitForSelector('.editor-context-menu:not([hidden])');
    await page.click('.editor-context-menu .editor-context-item');
    const afterCtxSplit = await page.evaluate(() => ({
      menuHidden: getComputedStyle(document.querySelector('.editor-context-menu')).display === 'none',
      segCount: document.querySelectorAll('.editor-seg-list .editor-list-row').length,
    }));
    check('context menu split switches to split list and hides menu',
      afterCtxSplit.menuHidden && afterCtxSplit.segCount === 2);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.editor-exit-guard:not([hidden])');
    await page.click('.editor-exit-guard .editor-btn-danger');
    await page.waitForSelector('body:not(.is-editing)');

    // 8. Overwrite-save + exit refreshes preview state (summary, splits, controls) instead of rolling back
    await page.click('.toolbox-switch button');
    await page.click('[data-tool="edit"]');
    await page.waitForSelector('body.is-editing #editor-topbar:not([hidden])');
    const distBeforeOverwrite = await page.evaluate(() => document.querySelector('#info')?.textContent || '');
    const cropHandle = await page.locator('.editor-crop-overlay .editor-crop-handle').first().boundingBox();
    await page.mouse.move(cropHandle.x + cropHandle.width / 2, cropHandle.y + cropHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(cropHandle.x + 120, cropHandle.y + cropHandle.height / 2);
    await page.mouse.up();
    await page.click('#editor-drawer .editor-btn-success'); // Apply crop (preserves timestamps)
    await page.click('.editor-save-opts-btn');
    await page.locator('.editor-save-popover input[type="checkbox"]').nth(1).check();
    await page.click('#editor-topbar .editor-btn-primary');
    await page.waitForSelector('#editor-topbar:not(.is-dirty)');
    await page.keyboard.press('Escape');
    await page.waitForSelector('body:not(.is-editing)');
    const distAfterOverwrite = await page.evaluate(() => document.querySelector('#info')?.textContent || '');
    check('overwrite-save updates preview summary on exit', distAfterOverwrite !== distBeforeOverwrite);
    const controlCountsAfterOverwrite = await page.evaluate(() => ({
      pins: document.querySelectorAll('.pins-switch').length,
      overview: document.querySelectorAll('.waypoint-overview-switch').length,
    }));
    check('overwrite-save exit does not duplicate waypoint/list controls',
      controlCountsAfterOverwrite.pins <= 1 && controlCountsAfterOverwrite.overview <= 1,
      JSON.stringify(controlCountsAfterOverwrite));
    await page.click('.split-toggle');
    await page.waitForFunction(() => document.querySelectorAll('#splits tbody tr').length > 0);
    const splitCountAfter = await page.evaluate(() => document.querySelectorAll('#splits tbody tr').length);
    check('overwrite-save refreshes splits table with updated distance', splitCountAfter > 0 && splitCountAfter < 16);
    await page.click('.split-toggle');

    // 9. Non-GPX source disables overwrite original option in save popover
    await openViewer(page, base, 'kml-photos.kml');
    await waitForLayout(page);
    await page.click('.toolbox-switch button');
    await page.click('[data-tool="edit"]');
    await page.waitForSelector('body.is-editing #editor-topbar:not([hidden])');
    await page.click('.editor-save-opts-btn');
    const overwriteDisabled = await page.locator('.editor-save-popover input[type="checkbox"]').nth(1).isDisabled();
    check('non-GPX source disables overwrite original checkbox', overwriteDisabled);

    // 10. Narrow window edit topbar avoids overlapping top-right tools and zoom controls
    for (const width of [780, 420]) {
      await page.setViewportSize({ width, height: 720 });
      await page.waitForTimeout(120);
      await waitForLayout(page);
      const boxes = await page.evaluate(() => {
        const topbar = document.getElementById('editor-topbar')?.getBoundingClientRect();
        const zoom = document.querySelector('#map .leaflet-top.leaflet-left')?.getBoundingClientRect();
        const pinsVisible = getComputedStyle(document.querySelector('.pins-switch')).display !== 'none';
        const layerToggleVisible = getComputedStyle(document.querySelector('.layer-menu-toggle')).display !== 'none';
        const hasLayerIcon = Boolean(document.querySelector('#editor-topbar [data-editor-control="layers"]'));
        const hasPinsIcon = Boolean(document.querySelector('#editor-topbar [data-editor-control="pins"]'));
        const zoomBtn = document.querySelector('.leaflet-control-zoom-in')?.getBoundingClientRect();
        const overlap = (a, b) => Boolean(a && b
          && a.left < b.right && a.right > b.left
          && a.top < b.bottom && a.bottom > b.top);
        return {
          topbar: topbar ? { l: Math.round(topbar.left), r: Math.round(topbar.right), t: Math.round(topbar.top), b: Math.round(topbar.bottom) } : null,
          zoomOverlap: overlap(topbar, zoom),
          zoomCompact: Boolean(zoomBtn && Math.round(zoomBtn.width) === 26),
          pinsVisible,
          layerToggleVisible,
          hasLayerIcon,
          hasPinsIcon,
        };
      });
      check(`narrow ${width}px edit topbar merges layers/pins icons and avoids zoom`,
        Boolean(boxes.topbar && !boxes.zoomOverlap && boxes.zoomCompact && !boxes.pinsVisible && !boxes.layerToggleVisible
          && boxes.hasLayerIcon && boxes.hasPinsIcon),
        JSON.stringify(boxes));
    }

    // 11. Right-clicking empty map does not show delete-waypoint menu even when a waypoint is selected
    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForLayout(page);
    await page.click('[data-editor-tool="waypoint"]');
    await page.mouse.click(260, 180, { button: 'right' });
    const ctxHiddenOnEmptyMap = await page.evaluate(() =>
      document.querySelector('.editor-context-menu')?.hidden === true);
    check('right-clicking empty map keeps context menu hidden', ctxHiddenOnEmptyMap);

    // 12. P2/P3 tools: clean auto/box modes, topology simplify, vertex refine zoom guard, timeline generation
    await page.click('[data-editor-tool="clean"]');
    const hasCleanModes = await page.locator('#editor-drawer .editor-mode-btn').count();
    check('clean tool exposes auto-detect and box-erase mode buttons', hasCleanModes === 2);

    await page.click('[data-editor-tool="topology"]');
    const topoCount = await page.locator('#editor-drawer .editor-mode-btn').count();
    check('topology tool includes reverse, roundtrip, close-loop and loop-start buttons', topoCount === 4);

    await page.click('[data-editor-tool="vertex"]');
    const vertexHintVisible = await page.locator('#editor-drawer .editor-drawer-hint').isVisible();
    check('vertex tool displays zoom/edit hint', vertexHintVisible);

    await page.click('[data-editor-tool="time"]');
    await page.click('#editor-drawer .editor-btn-success');
    const timeDirty = await page.evaluate(() => document.getElementById('editor-topbar')?.classList.contains('is-dirty'));
    check('timeline generator marks track dirty after generating virtual timestamps', Boolean(timeDirty));
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`\neditor: ${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\neditor: all checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
