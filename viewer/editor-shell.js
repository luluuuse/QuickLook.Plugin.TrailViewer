import { summariseRange } from './climb-analysis.js';
import { findGarminWaypointWarnings, serializeGpx } from './gpx-serializer.js';
import { iconElement } from './icons.js';
import {
  addWaypoint,
  cleanAnomalies,
  closeLoop,
  cropTrack,
  deleteTrackSegment,
  deleteWaypoint,
  detectAnomalyPoints,
  isTrackClosedLoop,
  makeOutAndBack,
  normalizedTracks,
  reverseTrack,
  splitTrackAt,
  trackTotalDistance,
  updateWaypoint,
} from './track-ops.js';

const RAIL_TOOLS = [
  { id: 'crop', icon: 'editor-crop', labelKey: 'editor.rail.crop' },
  { id: 'clean', icon: 'editor-clean', labelKey: 'editor.rail.clean' },
  { id: 'topology', icon: 'editor-reverse', labelKey: 'editor.rail.topology' },
  { id: 'waypoint', icon: 'editor-waypoint-add', labelKey: 'editor.rail.waypoint' },
];

const WAYPOINT_SYMS = ['pin', 'water', 'supply', 'camp', 'summit', 'danger', 'junction'];
const SPLIT_COLORS = ['#f97316', '#38bdf8', '#22c55e', '#eab308'];

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

  function renderCropDrawer() {
    const modeList = el('div', 'editor-mode-list');
    const cropModeBtn = el('button', `editor-mode-btn${activeSubMode === 'crop' ? ' is-active' : ''}`);
    cropModeBtn.type = 'button';
    cropModeBtn.textContent = t('editor.crop.mode');
    cropModeBtn.addEventListener('click', () => {
      activeSubMode = 'crop';
      overlay.setTool('crop', 'crop');
      mountCropOverlay();
      renderDrawer();
    });

    const splitModeBtn = el('button', `editor-mode-btn${activeSubMode === 'split' ? ' is-active' : ''}`);
    splitModeBtn.type = 'button';
    splitModeBtn.textContent = t('editor.split.mode');
    splitModeBtn.addEventListener('click', () => {
      activeSubMode = 'split';
      overlay.setTool('crop', 'split');
      mountCropOverlay();
      renderDrawer();
    });

    modeList.append(cropModeBtn, splitModeBtn);
    drawerBody.append(modeList);

    const current = store.getCurrent();
    cropRangeLabelEl = null;
    cropAscentLabelEl = null;
    if (activeSubMode === 'crop') {
      const statsBox = el('div', 'editor-stat-box');
      const rangeRow = el('div', 'editor-stat-row');
      cropRangeLabelEl = el('span', 'editor-stat-label', '');
      rangeRow.append(cropRangeLabelEl);
      const ascentRow = el('div', 'editor-stat-row');
      cropAscentLabelEl = el('span', 'editor-stat-label', '');
      ascentRow.append(cropAscentLabelEl);
      statsBox.append(rangeRow, ascentRow);
      updateCropStatTexts();

      const actions = el('div', 'editor-drawer-actions');
      const applyBtn = makeBtn('editor-btn editor-btn-success', null, t('editor.crop.apply'), () => {
        const next = cropTrack(store.getCurrent(), cropFromMeters, cropToMeters);
        store.apply('crop', next);
        const total = trackTotalDistance(next);
        cropFromMeters = 0;
        cropToMeters = total;
        overlay.setCropRange(0, total);
        mountCropOverlay();
      });
      const cancelBtn = makeBtn('editor-btn', null, t('editor.cancel'), () => {
        const total = trackTotalDistance(store.getCurrent());
        cropFromMeters = 0;
        cropToMeters = total;
        overlay.setCropRange(0, total);
        updateCropOverlayPositions();
        updateCropStatTexts();
      });
      actions.append(applyBtn, cancelBtn);
      drawerBody.append(statsBox, actions);
    } else {
      drawerBody.append(el('p', 'editor-drawer-hint', t('editor.split.hint')));
      const tracks = normalizedTracks(current);
      const segTitle = el('div', 'editor-stat-label', t('editor.split.segments', { count: tracks.length }));
      const segList = el('div', 'editor-seg-list');
      tracks.forEach((trk, idx) => {
        const row = el('div', 'editor-list-row');
        const swatch = el('span', 'editor-seg-swatch');
        swatch.style.background = SPLIT_COLORS[idx % SPLIT_COLORS.length];
        const label = trk.name || `#${idx + 1}`;
        const main = el('span', 'editor-list-row-main');
        main.append(swatch, document.createTextNode(label));
        row.append(main);
        if (tracks.length > 1) {
          const del = makeBtn('editor-btn editor-btn-danger', null, t('editor.split.deleteSeg'), () => {
            store.apply('delete-segment', deleteTrackSegment(store.getCurrent(), idx));
          });
          row.append(del);
        }
        segList.append(row);
      });
      drawerBody.append(segTitle, segList);
    }
  }

  function renderCleanDrawer() {
    const anomalies = detectAnomalyPoints(store.getCurrent());
    if (anomalies.length === 0) {
      drawerBody.append(el('p', 'editor-drawer-hint', t('editor.clean.none')));
      return;
    }
    drawerBody.append(el('p', 'editor-drawer-hint', t('editor.clean.found', { count: anomalies.length })));
    const applyBtn = makeBtn('editor-btn editor-btn-success', null, t('editor.clean.apply'), () => {
      const { track, removedCount } = cleanAnomalies(store.getCurrent());
      if (removedCount > 0) {
        store.apply('clean', track);
        notifyToast(t('editor.clean.done', { count: removedCount }));
      }
    });
    drawerBody.append(applyBtn);
  }

  function renderTopologyDrawer() {
    const list = el('div', 'editor-mode-list');
    const revBtn = makeBtn('editor-mode-btn', 'editor-reverse', t('editor.topology.reverse'), () => {
      const { track, clearedTimestamps } = reverseTrack(store.getCurrent());
      store.apply('reverse', track);
      if (clearedTimestamps) notifyToast(t('editor.topology.reverseCleared'));
    });
    const rtBtn = makeBtn('editor-mode-btn', 'editor-roundtrip', t('editor.topology.roundtrip'), () => {
      const { track } = makeOutAndBack(store.getCurrent());
      store.apply('roundtrip', track);
    });
    const loopBtn = makeBtn('editor-mode-btn', 'editor-loop-start', t('editor.topology.closeLoop'), () => {
      const { track, closureMeters } = closeLoop(store.getCurrent());
      if (closureMeters <= 0.5) return;
      store.apply('close-loop', track);
      notifyToast(t('editor.topology.closed', { dist: formatDistance(closureMeters) }));
    });
    loopBtn.disabled = isTrackClosedLoop(store.getCurrent());
    list.append(revBtn, rtBtn, loopBtn);
    drawerBody.append(list);
  }

  function renderWaypointDrawer() {
    const current = store.getCurrent();
    const wpts = current?.waypoints || [];
    if (selectedWptIndex < 0 && !pendingWptCoords && wpts.length > 0) {
      selectedWptIndex = 0;
      overlay.setSelectedWaypoint(0);
    }

    const editingWpt = selectedWptIndex >= 0 && selectedWptIndex < wpts.length ? wpts[selectedWptIndex] : null;
    const hasActiveForm = Boolean(editingWpt || pendingWptCoords);
    const form = el('div', 'editor-drawer-section editor-wpt-form');
    const topRow = el('div', 'editor-wpt-row');
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.placeholder = t('editor.wpt.name');
    nameInput.setAttribute('aria-label', t('editor.wpt.name'));
    nameInput.value = editingWpt?.name || (pendingWptCoords ? t('editor.wpt.defaultName', { index: wpts.length + 1 }) : '');
    nameInput.disabled = !hasActiveForm;

    const symSelect = el('select');
    symSelect.setAttribute('aria-label', t('editor.wpt.sym'));
    for (const sym of WAYPOINT_SYMS) {
      const opt = el('option', '', t(`editor.wpt.sym.${sym}`));
      opt.value = sym;
      if ((editingWpt?.icon || 'pin') === sym) opt.selected = true;
      symSelect.append(opt);
    }
    symSelect.disabled = !hasActiveForm;
    topRow.append(nameInput, symSelect);

    const noteBox = el('div', 'editor-field editor-wpt-note-box');
    noteBox.hidden = !wptNoteOpen;
    const descInput = el('input');
    descInput.type = 'text';
    descInput.placeholder = t('editor.wpt.desc');
    descInput.setAttribute('aria-label', t('editor.wpt.desc'));
    descInput.value = editingWpt?.description || '';
    descInput.disabled = !hasActiveForm;
    noteBox.append(descInput);

    const actions = el('div', 'editor-drawer-actions editor-wpt-actions');
    const noteToggle = el('button', 'editor-wpt-note-toggle', `${t('editor.wpt.noteToggle')} ${wptNoteOpen ? '\u25b4' : '\u25be'}`);
    noteToggle.type = 'button';
    noteToggle.setAttribute('aria-expanded', String(wptNoteOpen));
    noteToggle.addEventListener('click', () => {
      wptNoteOpen = !wptNoteOpen;
      noteBox.hidden = !wptNoteOpen;
      noteToggle.textContent = `${t('editor.wpt.noteToggle')} ${wptNoteOpen ? '\u25b4' : '\u25be'}`;
      noteToggle.setAttribute('aria-expanded', String(wptNoteOpen));
      if (wptNoteOpen && !descInput.disabled) descInput.focus();
    });
    actions.append(noteToggle);
    const spacer = el('span', 'editor-wpt-spacer');
    actions.append(spacer);

    if (editingWpt) {
      actions.append(makeBtn('editor-btn editor-btn-primary', null, t('editor.wpt.update'), () => {
        const next = updateWaypoint(store.getCurrent(), selectedWptIndex, {
          name: nameInput.value.trim(),
          icon: symSelect.value,
          description: descInput.value.trim(),
        });
        store.apply('update-waypoint', next);
      }));
      actions.append(makeBtn('editor-btn editor-btn-danger', null, t('editor.wpt.delete'), () => {
        const next = deleteWaypoint(store.getCurrent(), selectedWptIndex);
        selectedWptIndex = -1;
        overlay.setSelectedWaypoint(-1);
        store.apply('delete-waypoint', next);
      }));
    } else if (pendingWptCoords) {
      actions.append(makeBtn('editor-btn editor-btn-success', null, t('editor.wpt.add'), () => {
        const next = addWaypoint(store.getCurrent(), {
          lat: pendingWptCoords.lat,
          lon: pendingWptCoords.lon,
          ele: pendingWptCoords.ele,
          name: nameInput.value.trim() || t('editor.wpt.defaultName', { index: wpts.length + 1 }),
          icon: symSelect.value,
          description: descInput.value.trim(),
        });
        pendingWptCoords = null;
        selectedWptIndex = next.waypoints.length - 1;
        overlay.setSelectedWaypoint(selectedWptIndex);
        store.apply('add-waypoint', next);
      }));
      actions.append(makeBtn('editor-btn', null, t('editor.cancel'), () => {
        pendingWptCoords = null;
        renderDrawer();
      }));
    } else {
      const placeholderAdd = makeBtn('editor-btn editor-btn-primary', null, t('editor.wpt.add'), () => {});
      placeholderAdd.disabled = true;
      actions.append(placeholderAdd);
    }
    form.append(topRow, actions, noteBox);
    drawerBody.append(form);

    if (wpts.length > 0) {
      const list = el('div', 'editor-wpt-list');
      /** @type {HTMLElement | null} */
      let selectedRow = null;
      wpts.forEach((wpt, idx) => {
        const isSelected = idx === selectedWptIndex;
        const row = el('div', `editor-list-row${isSelected ? ' is-selected' : ''}`);
        const indexEl = el('span', 'editor-list-row-index', String(idx + 1));
        const label = el('span', 'editor-list-row-main', wpt.name || t('editor.wpt.defaultName', { index: idx + 1 }));
        row.addEventListener('click', () => {
          pendingWptCoords = null;
          selectedWptIndex = idx;
          overlay.setSelectedWaypoint(idx);
          overlay.focusWaypoint?.(idx);
          renderDrawer();
        });
        row.append(indexEl, label);
        row.append(makeBtn('editor-btn editor-btn-danger', 'close', null, (event) => {
          event?.stopPropagation?.();
          const next = deleteWaypoint(store.getCurrent(), idx);
          if (selectedWptIndex === idx) selectedWptIndex = -1;
          else if (selectedWptIndex > idx) selectedWptIndex -= 1;
          overlay.setSelectedWaypoint(selectedWptIndex);
          store.apply('delete-waypoint', next);
        }));
        if (isSelected) selectedRow = row;
        list.append(row);
      });
      drawerBody.append(list);
      if (selectedRow) {
        /** @type {HTMLElement} */ (selectedRow).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

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

    if (activeTool === 'crop') renderCropDrawer();
    else if (activeTool === 'clean') renderCleanDrawer();
    else if (activeTool === 'topology') renderTopologyDrawer();
    else if (activeTool === 'waypoint') renderWaypointDrawer();

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
      const target = document.querySelector('.layer-menu-toggle');
      if (target instanceof HTMLElement) target.click();
      syncTopbarMapControls();
    });
    layersBtn.title = t('layer.menuTitle');
    layersBtn.setAttribute('aria-label', t('layer.menuTitle'));
    layersBtn.dataset.editorControl = 'layers';
    pinsBtn = makeBtn('editor-btn editor-topbar-icon-btn', 'pin', null, () => {
      const target = document.querySelector('.pins-switch button');
      if (target instanceof HTMLElement) target.click();
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
          if (tool.id === 'crop') activeSubMode = 'crop';
          drawerOpen = true;
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
      const menu = document.getElementById('layer-source-menu');
      const openMenu = Boolean(menu && !menu.hidden);
      layersBtn.classList.toggle('is-active', openMenu);
      layersBtn.setAttribute('aria-expanded', String(openMenu));
    }
    if (pinsBtn) {
      const sourcePin = document.querySelector('.pins-switch button');
      const active = sourcePin?.getAttribute('aria-pressed') === 'true';
      pinsBtn.classList.toggle('is-active', active);
      pinsBtn.setAttribute('aria-pressed', String(active));
    }
  }

  function showContextMenu({ clientX, clientY, lat, lon, ele, splitMeters, waypointIndex = -1 }) {
    closeContextMenu();
    const targetWptIndex = Number.isInteger(waypointIndex) ? waypointIndex : -1;
    if (splitMeters == null && targetWptIndex < 0) return;
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
        drawerOpen = true;
        selectedWptIndex = -1;
        pendingWptCoords = { lat, lon, ele };
        overlay.setTool('waypoint', 'waypoint');
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
    activeSubMode = initialTool === 'crop' ? 'crop' : initialTool;
    drawerOpen = true;
    selectedWptIndex = -1;
    pendingWptCoords = null;
    wptNoteOpen = false;
    sessionOverwroteOriginal = false;

    document.body.classList.add('is-editing');
    root.hidden = false;
    hideExitGuard();
    closeSavePopover();
    closeContextMenu();

    overlay.mount(store.getCurrent());
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
        drawerOpen = true;
        overlay.setTool('waypoint', 'waypoint');
        mountCropOverlay();
        updateRail();
      }
      renderDrawer();
    },
  };
}
