import { formatDuration } from './format.js';
import {
  addWaypoint,
  cleanAnomalies,
  closeLoop,
  cropTrack,
  deleteTrackSegment,
  deleteWaypoint,
  detectAnomalyPoints,
  generateVirtualTimeline,
  isTrackClosedLoop,
  makeOutAndBack,
  mergeTrackSegments,
  normalizedTracks,
  reverseTrack,
  shiftTrackTimestamps,
  simplifyTrack,
  trackTotalDistance,
  updateWaypoint,
} from './track-ops.js';

const SPLIT_COLORS = ['#f97316', '#38bdf8', '#22c55e', '#eab308'];
const WAYPOINT_SYMS = ['pin', 'water', 'supply', 'camp', 'summit', 'danger', 'junction'];

function formatLocalDatetimeInput(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Creates pure drawer body renderers for the track editor shell.
 * @param {any} ctx
 */
export function createEditorDrawers(ctx) {
  const {
    el,
    t,
    formatDistance,
    makeBtn,
    store,
    overlay,
    notifyToast,
    getDrawerBody,
    state,
    mountCropOverlay,
    updateCropOverlayPositions,
    updateCropStatTexts,
    renderDrawer,
    setCropStatEls,
  } = ctx;

  function renderCropDrawer() {
    const drawerBody = getDrawerBody();
    const activeSubMode = state.getSubMode();
    const modeList = el('div', 'editor-mode-list');
    const cropModeBtn = el('button', `editor-mode-btn${activeSubMode === 'crop' ? ' is-active' : ''}`);
    cropModeBtn.type = 'button';
    cropModeBtn.textContent = t('editor.crop.mode');
    cropModeBtn.addEventListener('click', () => {
      state.setSubMode('crop');
      overlay.setTool('crop', 'crop');
      mountCropOverlay();
      renderDrawer();
    });

    const splitModeBtn = el('button', `editor-mode-btn${activeSubMode === 'split' ? ' is-active' : ''}`);
    splitModeBtn.type = 'button';
    splitModeBtn.textContent = t('editor.split.mode');
    splitModeBtn.addEventListener('click', () => {
      state.setSubMode('split');
      overlay.setTool('crop', 'split');
      mountCropOverlay();
      renderDrawer();
    });

    modeList.append(cropModeBtn, splitModeBtn);
    drawerBody.append(modeList);

    const current = store.getCurrent();
    setCropStatEls(null, null);
    if (activeSubMode === 'crop') {
      const statsBox = el('div', 'editor-stat-box');
      const rangeRow = el('div', 'editor-stat-row');
      const rangeLabelEl = el('span', 'editor-stat-label', '');
      rangeRow.append(rangeLabelEl);
      const ascentRow = el('div', 'editor-stat-row');
      const ascentLabelEl = el('span', 'editor-stat-label', '');
      ascentRow.append(ascentLabelEl);
      statsBox.append(rangeRow, ascentRow);
      setCropStatEls(rangeLabelEl, ascentLabelEl);
      updateCropStatTexts();

      const actions = el('div', 'editor-drawer-actions');
      const applyBtn = makeBtn('editor-btn editor-btn-success', null, t('editor.crop.apply'), () => {
        const { from, to } = state.getCropRange();
        const next = cropTrack(store.getCurrent(), from, to);
        store.apply('crop', next);
        const total = trackTotalDistance(next);
        state.setCropRange(0, total);
        overlay.setCropRange(0, total);
        mountCropOverlay();
      });
      const cancelBtn = makeBtn('editor-btn', null, t('editor.cancel'), () => {
        const total = trackTotalDistance(store.getCurrent());
        state.setCropRange(0, total);
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
      const totalSegments = tracks.reduce((n, trk) => n + (trk.segments?.length || 0), 0);
      if (totalSegments > 1) {
        const mergeBtn = makeBtn('editor-btn editor-btn-primary', 'editor-merge', t('editor.split.merge'), () => {
          const { track, reorderedByTime, timestampsCleared, maxGapMeters } = mergeTrackSegments(store.getCurrent());
          store.apply('merge', track);
          if (maxGapMeters > 500) {
            notifyToast(t('editor.split.mergeGap', { dist: formatDistance(maxGapMeters) }));
          } else if (timestampsCleared) {
            notifyToast(t('editor.split.mergeCleared'));
          } else if (reorderedByTime) {
            notifyToast(t('editor.split.mergeReordered'));
          }
        });
        drawerBody.append(mergeBtn);
      }
    }
  }

  function renderCleanDrawer() {
    const drawerBody = getDrawerBody();
    const modeList = el('div', 'editor-mode-list');
    const isBox = state.getSubMode() === 'box-erase';
    const autoBtn = makeBtn(`editor-mode-btn${!isBox ? ' is-active' : ''}`, 'editor-clean', t('editor.clean.autoMode'), () => {
      state.setSubMode('clean');
      overlay.setTool('clean', 'clean');
      renderDrawer();
    });
    const boxBtn = makeBtn(`editor-mode-btn${isBox ? ' is-active' : ''}`, 'editor-box-erase', t('editor.clean.boxMode'), () => {
      state.setSubMode('box-erase');
      overlay.setTool('clean', 'box-erase');
      renderDrawer();
    });
    modeList.append(autoBtn, boxBtn);
    drawerBody.append(modeList);

    if (isBox) {
      drawerBody.append(el('p', 'editor-drawer-hint', t('editor.clean.boxHint')));
      return;
    }

    const current = store.getCurrent();
    const excludedKeys = state.getExcludedAnomalyKeys();
    const anomalies = detectAnomalyPoints(current);
    if (anomalies.length === 0) {
      drawerBody.append(el('p', 'editor-drawer-hint', t('editor.clean.none')));
      return;
    }
    drawerBody.append(el('p', 'editor-drawer-hint', t('editor.clean.found', { count: anomalies.length })));
    const list = el('div', 'editor-seg-list');
    const applyBtn = makeBtn('editor-btn editor-btn-success', null, t('editor.clean.apply'), () => {
      const { track, removedCount } = cleanAnomalies(store.getCurrent(), excludedKeys);
      if (removedCount > 0) {
        store.apply('clean', track);
        notifyToast(t('editor.clean.done', { count: removedCount }));
      }
    });
    applyBtn.disabled = excludedKeys.size >= anomalies.length;
    anomalies.forEach((item, idx) => {
      const row = el('div', 'editor-list-row');
      const chk = el('input');
      chk.type = 'checkbox';
      chk.checked = !excludedKeys.has(item.key);
      chk.addEventListener('change', () => {
        if (chk.checked) excludedKeys.delete(item.key);
        else excludedKeys.add(item.key);
        applyBtn.disabled = excludedKeys.size >= anomalies.length;
        overlay.setExcludedAnomalyKeys?.(excludedKeys);
      });
      const speedText = item.speedMps ? ` · ${(item.speedMps * 3.6).toFixed(0)} km/h` : '';
      const label = el('span', 'editor-list-row-main', `#${idx + 1} · ${formatDistance(item.distanceMeters)}${speedText}`);
      label.addEventListener('click', () => overlay.focusLatLon?.(item.lat, item.lon));
      row.append(chk, label);
      list.append(row);
    });
    drawerBody.append(list, applyBtn);
  }

  function renderTopologyDrawer() {
    const drawerBody = getDrawerBody();
    const current = store.getCurrent();
    const strictlyClosed = isTrackClosedLoop(current, 0.5);
    const loopReady = isTrackClosedLoop(current, 50);
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
    loopBtn.disabled = strictlyClosed;

    const isLoopStart = state.getSubMode() === 'loop-start';
    const loopStartBtn = makeBtn(
      `editor-mode-btn${isLoopStart ? ' is-active' : ''}`,
      'editor-loop-start',
      t('editor.topology.loopStart'),
      () => {
        const nextSub = isLoopStart ? 'topology' : 'loop-start';
        state.setSubMode(nextSub);
        overlay.setTool('topology', nextSub);
        renderDrawer();
      },
    );
    loopStartBtn.disabled = !loopReady;
    list.append(revBtn, rtBtn, loopBtn, loopStartBtn);
    drawerBody.append(list);

    if (isLoopStart && loopReady) {
      drawerBody.append(el('p', 'editor-drawer-hint', t('editor.topology.loopStartHint')));
    }

    const simplifyBox = el('div', 'editor-stat-box');
    const tolRow = el('div', 'editor-wpt-row');
    const tolSelect = el('select');
    for (const meters of [3, 5, 10, 20]) {
      const opt = el('option', '', `${meters} m`);
      opt.value = String(meters);
      if (meters === 5) opt.selected = true;
      tolSelect.append(opt);
    }
    const simBtn = makeBtn('editor-btn editor-btn-primary', 'editor-simplify', t('editor.topology.simplifyApply'), () => {
      const tol = Number(tolSelect.value) || 5;
      const { track, beforeCount, afterCount } = simplifyTrack(store.getCurrent(), tol);
      if (afterCount < beforeCount) {
        store.apply('simplify', track);
        notifyToast(t('editor.topology.simplifyDone', { before: beforeCount, after: afterCount }));
      } else {
        notifyToast(t('editor.topology.simplifyNone'));
      }
    });
    tolRow.append(tolSelect, simBtn);
    simplifyBox.append(el('span', 'editor-stat-label', t('editor.topology.simplify')), tolRow);
    drawerBody.append(simplifyBox);
  }

  function renderVertexDrawer() {
    const drawerBody = getDrawerBody();
    const status = overlay.getVertexStatus?.() || { zoom: 0, visibleCount: 0, hiddenMidpoints: false };
    if (status.zoom < 15) {
      drawerBody.append(el('p', 'editor-drawer-hint', t('editor.vertex.zoomNeeded', { zoom: Math.round(status.zoom) })));
    } else {
      drawerBody.append(el('p', 'editor-drawer-hint', t('editor.vertex.hint')));
      drawerBody.append(el('div', 'editor-stat-box', t('editor.vertex.visible', { count: status.visibleCount })));
      if (status.hiddenMidpoints) {
        drawerBody.append(el('p', 'editor-drawer-hint', t('editor.vertex.zoomForInsert')));
      }
    }
  }

  function renderTimeDrawer() {
    const drawerBody = getDrawerBody();
    drawerBody.append(el('p', 'editor-drawer-hint', t('editor.time.hint')));
    const shiftBox = el('div', 'editor-stat-box');
    const shiftRow = el('div', 'editor-wpt-row');
    const shiftInput = el('input');
    shiftInput.type = 'number';
    shiftInput.value = '0';
    shiftInput.step = '5';
    const shiftBtn = makeBtn('editor-btn editor-btn-primary', null, t('editor.time.shiftApply'), () => {
      const mins = Number(shiftInput.value) || 0;
      const { track, shiftedCount } = shiftTrackTimestamps(store.getCurrent(), mins * 60);
      if (shiftedCount > 0) {
        store.apply('shift-time', track);
        notifyToast(t('editor.time.shiftDone', { count: shiftedCount }));
      } else {
        notifyToast(t('editor.time.shiftNone'));
      }
    });
    shiftRow.append(shiftInput, shiftBtn);
    shiftBox.append(el('span', 'editor-stat-label', t('editor.time.shiftTitle')), shiftRow);

    const virtBox = el('div', 'editor-stat-box');
    const startInput = el('input');
    startInput.type = 'datetime-local';
    startInput.value = formatLocalDatetimeInput(Date.now());
    const virtRow = el('div', 'editor-wpt-row');
    const speedInput = el('input');
    speedInput.type = 'number';
    speedInput.value = '4.0';
    speedInput.min = '0.5';
    speedInput.max = '40';
    speedInput.step = '0.5';
    const virtBtn = makeBtn('editor-btn editor-btn-success', null, t('editor.time.virtualApply'), () => {
      const kmh = Number(speedInput.value) || 4;
      const parsedStart = Date.parse(startInput.value);
      const startMs = Number.isFinite(parsedStart) ? parsedStart : Date.now();
      const { track, durationSeconds, pointCount } = generateVirtualTimeline(
        store.getCurrent(),
        startMs,
        (kmh * 1000) / 3600,
      );
      if (pointCount > 0) {
        store.apply('virtual-time', track);
        notifyToast(t('editor.time.virtualDone', { duration: formatDuration(durationSeconds) }));
      }
    });
    virtRow.append(speedInput, virtBtn);
    virtBox.append(el('span', 'editor-stat-label', t('editor.time.virtualTitle')), startInput, virtRow);
    drawerBody.append(shiftBox, virtBox);
  }

  function renderWaypointDrawer() {
    const drawerBody = getDrawerBody();
    const current = store.getCurrent();
    const wpts = current?.waypoints || [];
    const selectedWptIndex = state.getSelectedWptIndex();
    const pendingWptCoords = state.getPendingWptCoords();
    const wptNoteOpen = state.getWptNoteOpen();

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
      const nextOpen = !state.getWptNoteOpen();
      state.setWptNoteOpen(nextOpen);
      noteBox.hidden = !nextOpen;
      noteToggle.textContent = `${t('editor.wpt.noteToggle')} ${nextOpen ? '\u25b4' : '\u25be'}`;
      noteToggle.setAttribute('aria-expanded', String(nextOpen));
      if (nextOpen && !descInput.disabled) descInput.focus();
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
        state.setSelectedWptIndex(-1);
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
        state.setPendingWptCoords(null);
        const addedIndex = next.waypoints.length - 1;
        state.setSelectedWptIndex(addedIndex);
        overlay.setSelectedWaypoint(addedIndex);
        store.apply('add-waypoint', next);
      }));
      actions.append(makeBtn('editor-btn', null, t('editor.cancel'), () => {
        state.setPendingWptCoords(null);
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
          state.setPendingWptCoords(null);
          state.setSelectedWptIndex(idx);
          overlay.setSelectedWaypoint(idx);
          overlay.focusWaypoint?.(idx);
          renderDrawer();
        });
        row.append(indexEl, label);
        row.append(makeBtn('editor-btn editor-btn-danger', 'close', null, (event) => {
          event?.stopPropagation?.();
          const next = deleteWaypoint(store.getCurrent(), idx);
          if (selectedWptIndex === idx) state.setSelectedWptIndex(-1);
          else if (selectedWptIndex > idx) state.setSelectedWptIndex(selectedWptIndex - 1);
          overlay.setSelectedWaypoint(state.getSelectedWptIndex());
          store.apply('delete-waypoint', next);
        }));
        if (isSelected) selectedRow = row;
        list.append(row);
      });
      drawerBody.append(list);
      if (selectedRow) {
        requestAnimationFrame(() => selectedRow?.scrollIntoView({ block: 'nearest' }));
      }
    }
  }

  return {
    renderCropDrawer,
    renderCleanDrawer,
    renderTopologyDrawer,
    renderVertexDrawer,
    renderTimeDrawer,
    renderWaypointDrawer,
  };
}
