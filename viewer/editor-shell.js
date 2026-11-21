import { summariseRange } from './climb-analysis.js';
import { createEditorDrawers } from './editor-drawers.js';
import { findGarminWaypointWarnings, serializeGpx } from './gpx-serializer.js';
import { iconElement } from './icons.js';
import {
  deleteTrackVertex,
  deleteWaypoint,
  splitTrackAt,
  trackTotalDistance,
} from './track-ops.js';

const RAIL_TOOLS = [
  { id: 'crop', icon: 'editor-crop', labelKey: 'editor.rail.crop' },
  { id: 'clean', icon: 'editor-clean', labelKey: 'editor.rail.clean' },
  { id: 'topology', icon: 'editor-reverse', labelKey: 'editor.rail.topology' },
  { id: 'vertex', icon: 'editor-vertex', labelKey: 'editor.rail.vertex' },
  { id: 'waypoint', icon: 'editor-waypoint-add', labelKey: 'editor.rail.waypoint' },
  { id: 'time', icon: 'editor-time', labelKey: 'editor.rail.time' },
];

/**
 * Four-zone editor workbench UI (Topbar + Left Rail + Contextual Drawer + Profile Crop Overlay + Context Menu).
 * @param {{
 *   el: Function,
 *   t: Function,
 *   formatDistance: (meters: number) => string,
 *   store: any,
 *   overlay: any,
 *   getTrackName: () => string,
 *   getProfileState: () => any,
 *   isGpxSource?: () => boolean,
 *   onSaveTrack: (opts: { id: string, fileName: string, xml: string, overwrite: boolean }) => Promise<any>,
 *   onExit: (info?: { overwroteOriginal?: boolean, committed?: any }) => void,
 *   onToggleLayers?: () => void,
 *   isLayersOpen?: () => boolean,
 *   onTogglePins?: () => void,
 *   onShowPins?: () => void,
 *   isPinsVisible?: () => boolean,
 *   onLayoutChange?: () => void,
 *   showToast?: (msg: string, ms?: number) => void,
 * }} opts
 */
export function createEditorShell({
  el,
  t,
  formatDistance,
  store,
  overlay,
  getTrackName,
  getProfileState,
  isGpxSource = () => true,
  onSaveTrack,
  onExit,
  onToggleLayers = () => {},
  isLayersOpen = () => false,
  onTogglePins = () => {},
  onShowPins = () => {},
  isPinsVisible = () => true,
  onLayoutChange = () => {},
  showToast = () => {},
}) {
  /** @type {() => boolean} */
  const canOverwriteSource = isGpxSource;
  /** @type {() => void} */
  const handleLayoutChange = onLayoutChange;
  /** @type {(msg: string, ms?: number) => void} */
  const notifyToast = showToast;
  let root = null;
  let topbar = null;
  let nameEl = null;
  let diffEl = null;
  let undoBtn = null;
  let redoBtn = null;
  let resetBtn = null;
  let layersBtn = null;
  let pinsBtn = null;
  let saveBtn = null;
  let saveOptsBtn = null;
  let savePopover = null;
  let exitBtn = null;
  let exitGuard = null;
  let rail = null;
  let drawer = null;
  let drawerTitle = null;
  let drawerHelp = null;
  let drawerTooltip = null;
  let drawerBody = null;
  let wptNoteOpen = false;
  let contextMenu = null;
  let cropOverlay = null;
  let cropDimLeft = null;
  let cropDimRight = null;
  let cropHandleLeft = null;
  let cropHandleRight = null;

  const railButtons = new Map();
  let activeTool = 'crop';
  let activeSubMode = 'crop';
  let drawerOpen = true;
  let cropFromMeters = 0;
  let cropToMeters = 0;
  let selectedWptIndex = -1;
  let pendingWptCoords = null;
  let watchFriendly = true;
  let overwriteOriginal = false;
  let sessionOverwroteOriginal = false;
  let isSaving = false;
  let saveSequence = 0;
  let shellLifecycle = null;
  let cachedTotalMeters = 0;
  let cropRangeLabelEl = null;
  let cropAscentLabelEl = null;
  let excludedAnomalyKeys = new Set();
  let excludedAnomalyTrackRef = null;

  function updateCropStatTexts() {
    if (!cropRangeLabelEl || !cropAscentLabelEl) return;
    const pState = getProfileState?.();
    const summary = pState
      ? summariseRange(pState.points, pState.samples, cropFromMeters, cropToMeters)
      : null;
    cropRangeLabelEl.textContent = t('editor.crop.range', {
      from: formatDistance(cropFromMeters),
      to: formatDistance(cropToMeters),
    });
    const ascentVal = summary?.ascent != null ? `+${summary.ascent} ${t('unit.m')}` : '—';
    cropAscentLabelEl.textContent = t('editor.crop.ascent', { ascent: ascentVal });
  }

  function makeBtn(className, iconName, labelText, onClick) {
    const btn = el('button', className);
    btn.type = 'button';
    if (iconName) btn.append(iconElement(iconName, { size: 15 }));
    if (labelText) {
      const span = el('span', 'editor-btn-label', labelText);
      btn.append(span);
    }
    btn.addEventListener('click', onClick);
    return btn;
  }

  function closeContextMenu() {
    if (contextMenu) contextMenu.hidden = true;
  }

  function hideExitGuard() {
    if (exitGuard) exitGuard.hidden = true;
  }

  function updateCropOverlayPositions() {
    if (!cropOverlay || cropOverlay.hidden) return;
    const current = store.getCurrent();
    const total = Math.max(1, trackTotalDistance(current));
    const width = cropOverlay.clientWidth;
    if (width <= 0) return;

    const leftRatio = Math.max(0, Math.min(1, cropFromMeters / total));
    const rightRatio = Math.max(leftRatio, Math.min(1, cropToMeters / total));
    const leftPx = leftRatio * width;
    const rightPx = rightRatio * width;

    cropDimLeft.style.width = `${leftPx.toFixed(1)}px`;
    cropDimRight.style.width = `${Math.max(0, width - rightPx).toFixed(1)}px`;
    cropHandleLeft.style.transform = `translate3d(${leftPx.toFixed(1)}px, 0, 0)`;
    cropHandleRight.style.transform = `translate3d(${rightPx.toFixed(1)}px, 0, 0)`;
  }

  function mountCropOverlay() {
    const pState = getProfileState?.();
    const plot = pState?.chart || pState?.plot;
    if (!plot) return;
    if (!cropOverlay || cropOverlay.parentElement !== plot) {
      cropOverlay = el('div', 'editor-crop-overlay');
      cropOverlay.hidden = true;
      cropDimLeft = el('div', 'editor-crop-dim editor-crop-dim-left');
      cropDimRight = el('div', 'editor-crop-dim editor-crop-dim-right');
      cropHandleLeft = el('div', 'editor-crop-handle');
      cropHandleLeft.append(el('span', 'editor-crop-handle-pill'));
      cropHandleRight = el('div', 'editor-crop-handle');
      cropHandleRight.append(el('span', 'editor-crop-handle-pill'));
      cropOverlay.append(cropDimLeft, cropDimRight, cropHandleLeft, cropHandleRight);

      const bindDrag = (handle, isLeft) => {
        handle.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          handle.setPointerCapture?.(event.pointerId);
          cachedTotalMeters = trackTotalDistance(store.getCurrent());
          let dragFrame = 0;
          let latestClientX = event.clientX;
          const flushDrag = () => {
            dragFrame = 0;
            const rect = cropOverlay.getBoundingClientRect();
            if (rect.width <= 0 || cachedTotalMeters <= 0) return;
            const ratio = Math.max(0, Math.min(1, (latestClientX - rect.left) / rect.width));
            const meters = ratio * cachedTotalMeters;
            const minSpan = Math.min(cachedTotalMeters * 0.02, 50);
            if (isLeft) {
              cropFromMeters = Math.min(meters, cropToMeters - minSpan);
            } else {
              cropToMeters = Math.max(meters, cropFromMeters + minSpan);
            }
            overlay.setCropRange(cropFromMeters, cropToMeters);
            updateCropOverlayPositions();
            updateCropStatTexts();
          };
          const onMove = (moveEvent) => {
            latestClientX = moveEvent.clientX;
            if (!dragFrame) dragFrame = requestAnimationFrame(flushDrag);
          };
          const onUp = () => {
            if (dragFrame) {
              cancelAnimationFrame(dragFrame);
              flushDrag();
            }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
          };
          const dragSignal = shellLifecycle?.signal;
          window.addEventListener('pointermove', onMove, { signal: dragSignal });
          window.addEventListener('pointerup', onUp, { signal: dragSignal });
          window.addEventListener('pointercancel', onUp, { signal: dragSignal });
        });
      };
      bindDrag(cropHandleLeft, true);
      bindDrag(cropHandleRight, false);
      plot.append(cropOverlay);
    }
    const showHandles = store.isActive() && activeTool === 'crop' && activeSubMode === 'crop';
    cropOverlay.hidden = !showHandles;
    if (showHandles) updateCropOverlayPositions();
  }

  function updateTopbar() {
    if (!topbar || !store.isActive()) return;
    const snap = store.snapshot();
    topbar.classList.toggle('is-dirty', snap.dirty);
    nameEl.textContent = getTrackName() || t('file.untitled');
    undoBtn.disabled = !snap.canUndo;
    redoBtn.disabled = !snap.canRedo;
    resetBtn.disabled = !snap.dirty && !snap.canUndo;

    const diff = store.diffSummary();
    if (diff) {
      const dist = formatDistance(diff.currentDistanceMeters);
      const delta = diff.distanceDeltaMeters;
      const deltaText = Math.abs(delta) >= 10
        ? ` (${delta > 0 ? '+' : '-'}${formatDistance(Math.abs(delta))})`
        : '';
      diffEl.textContent = `${dist}${deltaText}`;
    }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function updateRail() {
    for (const [id, btn] of railButtons.entries()) {
      const pressed = id === activeTool && drawerOpen;
      btn.setAttribute('aria-pressed', String(pressed));
    }
    if (drawer) drawer.hidden = !drawerOpen;
    handleLayoutChange();
  }

  function ensureWaypointVisibility() {
    if (activeTool !== 'waypoint') return;
    if (!isPinsVisible()) {
      onShowPins();
      overlay.setWaypointsVisible?.(true);
      syncTopbarMapControls();
    }
  }

  function ensureWaypointSelection() {
    if (activeTool !== 'waypoint' || selectedWptIndex >= 0 || pendingWptCoords) return;
    const wpts = store.getCurrent()?.waypoints || [];
    if (wpts.length > 0) {
      selectedWptIndex = 0;
      overlay.setSelectedWaypoint(0);
    }
  }

  const drawers = createEditorDrawers({
    el,
    t,
    formatDistance,
    makeBtn,
    store,
    overlay,
    notifyToast,
    getDrawerBody: () => drawerBody,
    mountCropOverlay,
    updateCropOverlayPositions,
    updateCropStatTexts,
    renderDrawer: () => renderDrawer(),
    setCropStatEls: (rangeEl, ascentEl) => {
      cropRangeLabelEl = rangeEl;
      cropAscentLabelEl = ascentEl;
    },
    state: {
      getSubMode: () => activeSubMode,
      setSubMode: (mode) => { activeSubMode = mode; },
      getCropRange: () => ({ from: cropFromMeters, to: cropToMeters }),
      setCropRange: (from, to) => { cropFromMeters = from; cropToMeters = to; },
      getSelectedWptIndex: () => selectedWptIndex,
      setSelectedWptIndex: (idx) => { selectedWptIndex = idx; },
      getPendingWptCoords: () => pendingWptCoords,
      setPendingWptCoords: (coords) => { pendingWptCoords = coords; },
      getWptNoteOpen: () => wptNoteOpen,
      setWptNoteOpen: (openVal) => { wptNoteOpen = openVal; },
      getExcludedAnomalyKeys: () => excludedAnomalyKeys,
    },
  });

  function closeSavePopover() {
    if (savePopover) savePopover.hidden = true;
    saveOptsBtn?.setAttribute('aria-expanded', 'false');
  }

  function buildSavePopoverContent() {
    if (!savePopover) return;
    savePopover.textContent = '';
    const wfRow = el('label', 'editor-check-row');
    const wfCheck = el('input');
    wfCheck.type = 'checkbox';
    wfCheck.checked = watchFriendly;
    wfCheck.addEventListener('change', () => { watchFriendly = wfCheck.checked; });
    wfRow.append(wfCheck, el('span', '', t('editor.save.watchFriendly')));

    const owRow = el('label', 'editor-check-row');
    const owCheck = el('input');
    owCheck.type = 'checkbox';
    const allowOverwrite = canOverwriteSource();
    if (!allowOverwrite) overwriteOriginal = false;
    owCheck.checked = allowOverwrite && overwriteOriginal;
    owCheck.disabled = !allowOverwrite;
    owCheck.addEventListener('change', () => { overwriteOriginal = owCheck.checked; });
    owRow.append(owCheck, el('span', '', t('editor.save.overwrite')));

    savePopover.append(wfRow, owRow);
  }

  function renderDrawer() {
    if (!drawerBody || !store.isActive()) return;
    drawerBody.textContent = '';
    const toolMeta = RAIL_TOOLS.find((item) => item.id === activeTool) || RAIL_TOOLS[0];
    drawerTitle.textContent = t(toolMeta.labelKey);
    if (drawerHelp) {
      drawerHelp.hidden = activeTool !== 'waypoint';
      const hint = t('editor.wpt.clickHint');
      drawerHelp.dataset.hint = hint;
      drawerHelp.setAttribute('aria-label', hint);
      if (drawerHelp.hidden && drawerTooltip) drawerTooltip.hidden = true;
    }

    if (activeTool === 'crop') drawers.renderCropDrawer();
    else if (activeTool === 'clean') drawers.renderCleanDrawer();
    else if (activeTool === 'topology') drawers.renderTopologyDrawer();
    else if (activeTool === 'vertex') drawers.renderVertexDrawer();
    else if (activeTool === 'waypoint') drawers.renderWaypointDrawer();
    else if (activeTool === 'time') drawers.renderTimeDrawer();

    handleLayoutChange();
  }

  async function triggerSave() {
    if (isSaving) return false;
    const current = store.getCurrent();
    if (!current) return false;
    isSaving = true;
    if (saveBtn) saveBtn.disabled = true;
    try {
      if (watchFriendly) {
        const warn = findGarminWaypointWarnings(current.waypoints);
        if (warn.tooLongCount > 0) {
          notifyToast(t('editor.save.garminWarn', { count: warn.tooLongCount }), 3200);
        }
      }
      const xml = serializeGpx(current, { watchFriendly });
      saveSequence += 1;
      const id = `save-${saveSequence}`;
      const baseName = (getTrackName() || 'track').replace(/\.[^.]+$/, '');
      const fileName = `${baseName}-edited.gpx`;
      const allowOverwrite = canOverwriteSource();
      const result = await onSaveTrack({
        id,
        fileName,
        xml,
        overwrite: allowOverwrite && overwriteOriginal,
      });
      if (result?.ok) {
        if (allowOverwrite && overwriteOriginal) sessionOverwroteOriginal = true;
        store.markSaved();
        updateTopbar();
        notifyToast(t('editor.save.ok', { path: result.path || fileName }));
        return true;
      }
      if (result?.cancelled) return false;
      notifyToast(t('editor.save.fail', { detail: result?.detail || 'error' }), 3500);
      return false;
    } finally {
      isSaving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function requestExit() {
    if (!store.isActive()) return;
    if (!store.isDirty()) {
      close();
      return;
    }
    exitGuard.hidden = false;
  }

  function buildDom() {
    if (root) return;
    root = el('div', 'editor-shell');
    root.hidden = true;

    topbar = el('div', 'editor-topbar');
    topbar.id = 'editor-topbar';
    const titleWrap = el('div', 'editor-topbar-title');
    titleWrap.append(el('span', 'editor-dirty-dot'));
    nameEl = el('span', 'editor-topbar-name');
    titleWrap.append(nameEl);

    diffEl = el('span', 'editor-diff-pill');
    undoBtn = makeBtn('editor-btn', 'undo', t('editor.undo'), () => store.undo());
    redoBtn = makeBtn('editor-btn', 'redo', t('editor.redo'), () => store.redo());
    resetBtn = makeBtn('editor-btn', 'reset', t('editor.reset'), () => store.reset());
    layersBtn = makeBtn('editor-btn editor-topbar-icon-btn', 'layers', null, () => {
      onToggleLayers();
      syncTopbarMapControls();
    });
    layersBtn.title = t('layer.menuTitle');
    layersBtn.setAttribute('aria-label', t('layer.menuTitle'));
    layersBtn.dataset.editorControl = 'layers';
    pinsBtn = makeBtn('editor-btn editor-topbar-icon-btn', 'pin', null, () => {
      onTogglePins();
      syncTopbarMapControls();
    });
    pinsBtn.title = t('pins.label');
    pinsBtn.setAttribute('aria-label', t('pins.label'));
    pinsBtn.dataset.editorControl = 'pins';
    saveBtn = makeBtn('editor-btn editor-btn-primary', 'editor-save', t('editor.save'), () => { triggerSave(); });
    saveOptsBtn = makeBtn('editor-btn editor-save-opts-btn', 'settings', null, () => {
      if (!savePopover) return;
      const nextOpen = savePopover.hidden;
      if (nextOpen) {
        buildSavePopoverContent();
        const rect = saveOptsBtn.getBoundingClientRect();
        savePopover.style.left = `${Math.min(innerWidth - 280, Math.max(8, rect.right - 260))}px`;
        savePopover.style.transform = 'none';
      }
      savePopover.hidden = !nextOpen;
      saveOptsBtn.setAttribute('aria-expanded', String(nextOpen));
    });
    saveOptsBtn.setAttribute('aria-expanded', 'false');
    exitBtn = makeBtn('editor-btn', 'close', t('editor.exit'), requestExit);

    topbar.append(
      titleWrap,
      diffEl,
      el('span', 'editor-topbar-sep'),
      undoBtn,
      redoBtn,
      resetBtn,
      el('span', 'editor-topbar-sep'),
      layersBtn,
      pinsBtn,
      el('span', 'editor-topbar-sep'),
      saveBtn,
      saveOptsBtn,
      exitBtn,
    );

    savePopover = el('div', 'editor-save-popover');
    savePopover.hidden = true;

    exitGuard = el('div', 'editor-exit-guard');
    exitGuard.hidden = true;
    exitGuard.append(el('span', '', t('editor.exitGuard')));
    exitGuard.append(makeBtn('editor-btn editor-btn-danger', null, t('editor.discard'), () => {
      hideExitGuard();
      close();
    }));
    exitGuard.append(makeBtn('editor-btn editor-btn-primary', null, t('editor.saveAndExit'), async () => {
      const ok = await triggerSave();
      if (ok) {
        hideExitGuard();
        close();
      }
    }));
    exitGuard.append(makeBtn('editor-btn', null, t('editor.keepEditing'), hideExitGuard));

    rail = el('div', 'editor-rail');
    rail.id = 'editor-rail';
    rail.setAttribute('role', 'toolbar');
    for (const tool of RAIL_TOOLS) {
      const btn = el('button', 'editor-rail-btn');
      btn.type = 'button';
      btn.dataset.editorTool = tool.id;
      btn.title = t(tool.labelKey);
      btn.setAttribute('aria-label', t(tool.labelKey));
      btn.setAttribute('aria-pressed', 'false');
      btn.append(iconElement(tool.icon, { size: 16 }));
      btn.addEventListener('click', () => {
        if (activeTool === tool.id) {
          drawerOpen = !drawerOpen;
        } else {
          activeTool = tool.id;
          activeSubMode = tool.id === 'crop' ? 'crop' : '';
          drawerOpen = true;
          ensureWaypointVisibility();
          ensureWaypointSelection();
        }
        overlay.setTool(activeTool, activeSubMode);
        mountCropOverlay();
        updateRail();
        renderDrawer();
      });
      railButtons.set(tool.id, btn);
      rail.append(btn);
    }

    drawer = el('aside', 'editor-drawer');
    drawer.id = 'editor-drawer';
    const head = el('div', 'editor-drawer-head');
    drawerTitle = el('h2', 'editor-drawer-title');
    const headActions = el('div', 'editor-drawer-head-actions');
    drawerHelp = el('button', 'editor-drawer-help', '?');
    drawerHelp.type = 'button';
    drawerHelp.hidden = true;
    drawerTooltip = el('div', 'editor-drawer-tooltip');
    drawerTooltip.hidden = true;
    const showHelpTip = () => {
      if (!drawerHelp || !drawerTooltip || drawerHelp.hidden) return;
      drawerTooltip.textContent = drawerHelp.dataset.hint || '';
      if (!drawerTooltip.textContent) return;
      const rect = drawerHelp.getBoundingClientRect();
      const drawerRect = drawer?.getBoundingClientRect();
      drawerTooltip.hidden = false;
      const tipWidth = drawerTooltip.offsetWidth || 210;
      const anchorRight = drawerRect ? drawerRect.right + 8 : rect.right + 10;
      const left = Math.min(innerWidth - tipWidth - 10, anchorRight);
      const top = Math.max(10, Math.min(innerHeight - 90, rect.top - 4));
      drawerTooltip.style.left = `${Math.round(left)}px`;
      drawerTooltip.style.top = `${Math.round(top)}px`;
    };
    const hideHelpTip = () => {
      if (drawerTooltip) drawerTooltip.hidden = true;
    };
    drawerHelp.addEventListener('mouseenter', showHelpTip);
    drawerHelp.addEventListener('focus', showHelpTip);
    drawerHelp.addEventListener('mouseleave', hideHelpTip);
    drawerHelp.addEventListener('blur', hideHelpTip);
    const collapseBtn = makeBtn('editor-btn', 'chevron-left', null, () => {
      hideHelpTip();
      drawerOpen = false;
      updateRail();
    });
    headActions.append(drawerHelp, collapseBtn);
    head.append(drawerTitle, headActions);
    drawerBody = el('div', 'editor-drawer-section');
    drawer.append(head, drawerBody);

    contextMenu = el('div', 'editor-context-menu');
    contextMenu.hidden = true;

    root.append(topbar, savePopover, exitGuard, rail, drawer, drawerTooltip, contextMenu);
    document.body.append(root);
  }

  function syncTopbarMapControls() {
    if (layersBtn) {
      const openMenu = Boolean(isLayersOpen());
      layersBtn.classList.toggle('is-active', openMenu);
      layersBtn.setAttribute('aria-expanded', String(openMenu));
    }
    if (pinsBtn) {
      const active = Boolean(isPinsVisible());
      pinsBtn.classList.toggle('is-active', active);
      pinsBtn.setAttribute('aria-pressed', String(active));
    }
  }

  function showContextMenu({ clientX, clientY, lat, lon, ele, splitMeters, waypointIndex = -1, vertexTarget = null }) {
    closeContextMenu();
    const targetWptIndex = Number.isInteger(waypointIndex) ? waypointIndex : -1;
    if (splitMeters == null && targetWptIndex < 0 && !vertexTarget) return;
    contextMenu.textContent = '';
    if (splitMeters != null) {
      const splitItem = makeBtn('editor-context-item', 'editor-split', t('editor.ctx.splitHere'), () => {
        closeContextMenu();
        activeTool = 'crop';
        activeSubMode = 'split';
        drawerOpen = true;
        overlay.setTool('crop', 'split');
        mountCropOverlay();
        updateRail();
        store.apply('split', splitTrackAt(store.getCurrent(), splitMeters));
      });
      contextMenu.append(splitItem);
      const addWptItem = makeBtn('editor-context-item', 'editor-waypoint-add', t('editor.ctx.addWaypoint'), () => {
        closeContextMenu();
        activeTool = 'waypoint';
        activeSubMode = '';
        drawerOpen = true;
        selectedWptIndex = -1;
        pendingWptCoords = { lat, lon, ele };
        ensureWaypointVisibility();
        overlay.setTool('waypoint', '');
        mountCropOverlay();
        updateRail();
        renderDrawer();
      });
      contextMenu.append(addWptItem);
    }
    if (targetWptIndex >= 0) {
      const delItem = makeBtn('editor-context-item is-danger', 'clear', t('editor.ctx.deleteWaypoint'), () => {
        closeContextMenu();
        const next = deleteWaypoint(store.getCurrent(), targetWptIndex);
        selectedWptIndex = -1;
        overlay.setSelectedWaypoint(-1);
        store.apply('delete-waypoint', next);
      });
      contextMenu.append(delItem);
    }
    if (vertexTarget) {
      const delVertexItem = makeBtn('editor-context-item is-danger', 'clear', t('editor.ctx.deleteVertex'), () => {
        closeContextMenu();
        const next = deleteTrackVertex(store.getCurrent(), vertexTarget.flatSegIndex, vertexTarget.ptIndex);
        store.apply('delete-vertex', next);
      });
      contextMenu.append(delVertexItem);
    }
    contextMenu.style.left = `${Math.min(innerWidth - 180, Math.max(8, clientX))}px`;
    contextMenu.style.top = `${Math.min(innerHeight - 130, Math.max(8, clientY))}px`;
    contextMenu.hidden = false;
  }

  /** @param {{ parsed: any, initialTool?: string, cropRange?: [number, number] | null }} opts */
  function open({ parsed, initialTool = 'crop', cropRange = null }) {
    buildDom();
    if (shellLifecycle) shellLifecycle.abort();
    shellLifecycle = new AbortController();
    const signal = shellLifecycle.signal;

    store.enter(parsed);
    const total = trackTotalDistance(parsed);
    cropFromMeters = cropRange ? Math.max(0, cropRange[0]) : 0;
    cropToMeters = cropRange ? Math.min(total, cropRange[1]) : total;
    if (!(cropToMeters > cropFromMeters)) {
      cropFromMeters = 0;
      cropToMeters = total;
    }
    activeTool = initialTool;
    activeSubMode = initialTool === 'crop' ? 'crop' : '';
    drawerOpen = true;
    selectedWptIndex = -1;
    pendingWptCoords = null;
    wptNoteOpen = false;
    sessionOverwroteOriginal = false;
    excludedAnomalyKeys = new Set();
    excludedAnomalyTrackRef = store.getCurrent();

    document.body.classList.add('is-editing');
    root.hidden = false;
    hideExitGuard();
    closeSavePopover();
    closeContextMenu();

    overlay.mount(store.getCurrent());
    ensureWaypointVisibility();
    ensureWaypointSelection();
    overlay.setTool(activeTool, activeSubMode);
    overlay.setCropRange(cropFromMeters, cropToMeters);

    mountCropOverlay();
    updateTopbar();
    syncTopbarMapControls();
    updateRail();
    renderDrawer();

    document.addEventListener('pointerdown', (event) => {
      if (contextMenu && !contextMenu.hidden && event.target instanceof Node && !contextMenu.contains(event.target)) {
        closeContextMenu();
      }
      if (savePopover && !savePopover.hidden && event.target instanceof Node
        && !savePopover.contains(event.target) && !saveOptsBtn?.contains(event.target)) {
        closeSavePopover();
      }
      requestAnimationFrame(syncTopbarMapControls);
    }, { signal, capture: true });

    window.addEventListener('resize', () => {
      updateCropOverlayPositions();
    }, { signal });
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function close() {
    if (shellLifecycle) {
      shellLifecycle.abort();
      shellLifecycle = null;
    }
    closeSavePopover();
    closeContextMenu();
    if (cropOverlay) cropOverlay.hidden = true;
    if (root) root.hidden = true;
    document.body.classList.remove('is-editing');
    const committed = sessionOverwroteOriginal ? store.getCurrent() : null;
    overlay.unmount();
    store.exit();
    onExit({ overwroteOriginal: sessionOverwroteOriginal, committed });
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  return {
    open,
    close,
    requestExit,
    triggerSave,
    refresh() {
      if (!store.isActive()) return;
      const current = store.getCurrent();
      const total = trackTotalDistance(current);
      cachedTotalMeters = total;
      cropFromMeters = 0;
      cropToMeters = total;
      const wptCount = current?.waypoints?.length || 0;
      if (selectedWptIndex >= wptCount) {
        selectedWptIndex = -1;
        overlay.setSelectedWaypoint(-1);
      }
      if (excludedAnomalyTrackRef !== current) {
        excludedAnomalyKeys = new Set();
        excludedAnomalyTrackRef = current;
        overlay.setExcludedAnomalyKeys?.(excludedAnomalyKeys, { render: false });
      }
      ensureWaypointSelection();
      overlay.setTrack(current);
      overlay.setCropRange(0, total);
      mountCropOverlay();
      updateTopbar();
      renderDrawer();
    },
    showContextMenu,
    pickWaypointLocation(loc) {
      pendingWptCoords = loc;
      selectedWptIndex = -1;
      overlay.setSelectedWaypoint(-1);
      renderDrawer();
    },
    selectWaypoint(index) {
      pendingWptCoords = null;
      selectedWptIndex = index;
      if (activeTool !== 'waypoint' || !drawerOpen) {
        activeTool = 'waypoint';
        activeSubMode = '';
        drawerOpen = true;
        ensureWaypointVisibility();
        overlay.setTool('waypoint', '');
        mountCropOverlay();
        updateRail();
      }
      renderDrawer();
    },
    refreshVertexStatus() {
      if (activeTool === 'vertex' && drawerOpen) renderDrawer();
    },
  };
}
