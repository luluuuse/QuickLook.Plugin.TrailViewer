import { formatDuration } from './format.js';
import { iconElement } from './icons.js';
import { parseGpx } from './gpx.js';
import { parseKml } from './kml.js';
import {
  addWaypoint,
  appendExternalTrack,
  applyDrawnPath,
  cleanAnomalies,
  closeLoop,
  cropTrack,
  dedupeWaypoints,
  deleteTrackSegment,
  deleteWaypoint,
  detectAnomalyPoints,
  generateMilestoneWaypoints,
  generateVirtualTimeline,
  isTrackClosedLoop,
  makeOutAndBack,
  mergeTrackSegments,
  normalizedTracks,
  reverseTrack,
  shiftTrackTimestamps,
  simplifyTrack,
  smoothTrackElevation,
  sortWaypointsAlongTrack,
  sortWaypointsByRoute,
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

function isDefaultWaypointName(name) {
  const trimmed = (name || '').trim();
  return !trimmed || /^(?:航点|Waypoint)\s*#?\d+$/i.test(trimmed);
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
    hasProfileChart,
    updateCropOverlayPositions,
    updateCropStatTexts,
    renderDrawer,
    setCropStatEls,
    onImportExternalTrack = null,
  } = ctx;

  let cachedWptOrderTrack = null;
  let cachedWptOrder = [];
  let listChunkFrame = 0;

  function getOrderedWaypoints(current) {
    if (cachedWptOrderTrack !== current) {
      cachedWptOrderTrack = current;
      cachedWptOrder = sortWaypointsByRoute(current);
    }
    return cachedWptOrder;
  }

  function renderCropDrawer() {
    const drawerBody = getDrawerBody();
    const activeSubMode = state.getSubMode();
    const modeList = el('div', 'editor-segmented-tabs is-two');
    const cropModeBtn = el('button', `editor-segmented-tab${activeSubMode === 'crop' ? ' is-active' : ''}`);
    cropModeBtn.type = 'button';
    cropModeBtn.textContent = t('editor.crop.mode');
    cropModeBtn.addEventListener('click', () => {
      state.setSubMode('crop');
      overlay.setTool('crop', 'crop');
      mountCropOverlay();
      renderDrawer();
    });

    const splitModeBtn = el('button', `editor-segmented-tab${activeSubMode === 'split' ? ' is-active' : ''}`);
    splitModeBtn.type = 'button';
    splitModeBtn.textContent = t('editor.split.mode');
    splitModeBtn.addEventListener('click', () => {
      state.setSubMode('split');
      overlay.setTool('crop', 'split');
      mountCropOverlay();
      renderDrawer();
    });

    modeList.append(cropModeBtn, splitModeBtn);
    drawerBody.append(modeList, el('div', 'editor-tab-divider'));

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

      if (!hasProfileChart?.()) {
        const totalDist = Math.max(0, trackTotalDistance(current));
        if (totalDist > 0) {
          const { from, to } = state.getCropRange();
          const minSpan = Math.min(totalDist * 0.02, 50);
          const sliderWrap = el('div', 'editor-crop-sliders');
          const startSlider = el('input');
          startSlider.type = 'range';
          startSlider.min = '0';
          startSlider.max = String(Math.round(totalDist));
          startSlider.step = '1';
          startSlider.value = String(Math.round(from));
          const endSlider = el('input');
          endSlider.type = 'range';
          endSlider.min = '0';
          endSlider.max = String(Math.round(totalDist));
          endSlider.step = '1';
          endSlider.value = String(Math.round(to));
          const syncSliders = (isStart) => {
            let nextFrom = Number(startSlider.value);
            let nextTo = Number(endSlider.value);
            if (isStart) {
              nextFrom = Math.min(nextFrom, nextTo - minSpan);
              startSlider.value = String(Math.round(nextFrom));
            } else {
              nextTo = Math.max(nextTo, nextFrom + minSpan);
              endSlider.value = String(Math.round(nextTo));
            }
            state.setCropRange(nextFrom, nextTo);
            overlay.setCropRange(nextFrom, nextTo);
            updateCropStatTexts();
          };
          startSlider.addEventListener('input', () => syncSliders(true));
          endSlider.addEventListener('input', () => syncSliders(false));
          sliderWrap.append(startSlider, endSlider);
          statsBox.append(sliderWrap);
        }
      }

      const actions = el('div', 'editor-drawer-actions');
      const applyBtn = makeBtn('editor-btn editor-btn-success', null, t('editor.crop.apply'), () => {
        const { from, to } = state.getCropRange();
        const curTrack = store.getCurrent();
        const curTotal = trackTotalDistance(curTrack);
        if (curTotal <= 0 || (from <= 0.5 && to >= curTotal - 0.5)) return;
        const next = cropTrack(curTrack, from, to);
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
    const modeList = el('div', 'editor-segmented-tabs');
    const subMode = state.getSubMode();
    const isBox = subMode === 'box-erase';
    const isSmooth = subMode === 'smooth-ele';
    const isAuto = !isBox && !isSmooth;
    const autoBtn = makeBtn(`editor-segmented-tab${isAuto ? ' is-active' : ''}`, null, t('editor.clean.autoMode'), () => {
      state.setSubMode('clean');
      overlay.setTool('clean', 'clean');
      renderDrawer();
    });
    const boxBtn = makeBtn(`editor-segmented-tab${isBox ? ' is-active' : ''}`, null, t('editor.clean.boxMode'), () => {
      state.setSubMode('box-erase');
      overlay.setTool('clean', 'box-erase');
      renderDrawer();
    });
    const smoothBtn = makeBtn(`editor-segmented-tab${isSmooth ? ' is-active' : ''}`, null, t('editor.clean.smoothTitle'), () => {
      state.setSubMode('smooth-ele');
      overlay.setTool('clean', 'smooth-ele');
      renderDrawer();
    });
    modeList.append(autoBtn, boxBtn, smoothBtn);
    drawerBody.append(modeList, el('div', 'editor-tab-divider'));

    if (isBox) {
      drawerBody.append(el('p', 'editor-drawer-hint', t('editor.clean.boxHint')));
      return;
    }

    const current = store.getCurrent();

    if (isSmooth) {
      const smoothBox = el('div', 'editor-stat-box');
      const windowSize = state.getSmoothWindow?.() || 5;
      const preview = smoothTrackElevation(current, { windowSize });
      const levelRow = el('div', 'editor-segmented-tabs');
      for (const [win, key] of [[3, 'editor.clean.smoothLight'], [5, 'editor.clean.smoothStandard'], [9, 'editor.clean.smoothStrong']]) {
        const btn = makeBtn(
          `editor-segmented-tab${windowSize === win ? ' is-active' : ''}`,
          null,
          t(key),
          () => {
            state.setSmoothWindow?.(win);
            renderDrawer();
          },
        );
        levelRow.append(btn);
      }
      const previewText = preview.adjustedCount > 0
        ? t('editor.clean.smoothPreview', { before: preview.beforeAscent, after: preview.afterAscent })
        : t('editor.clean.smoothNoChange');
      const smoothApplyBtn = makeBtn('editor-btn editor-btn-success', null, t('editor.clean.smoothApply'), () => {
        const res = smoothTrackElevation(store.getCurrent(), { windowSize: state.getSmoothWindow?.() || 5 });
        if (res.adjustedCount > 0) {
          store.apply('smooth-ele', res.track);
          notifyToast(t('editor.clean.smoothDone', { before: res.beforeAscent, after: res.afterAscent }));
        } else {
          notifyToast(t('editor.clean.smoothNoChange'));
        }
      });
      smoothApplyBtn.disabled = preview.adjustedCount === 0;
      smoothBox.append(
        levelRow,
        el('span', 'editor-drawer-hint', previewText),
        smoothApplyBtn,
      );
      drawerBody.append(smoothBox);
      return;
    }

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
    const subMode = state.getSubMode();
    const isSimplify = subMode === 'simplify';
    const isAppend = subMode === 'append';
    const isLoopStart = subMode === 'loop-start';
    const isMainTab = !isSimplify && !isAppend;

    const tabs = el('div', 'editor-segmented-tabs');
    const mainTabBtn = makeBtn(
      `editor-segmented-tab${isMainTab ? ' is-active' : ''}`,
      null,
      t('editor.topology.tabMain'),
      () => {
        state.setSubMode('topology');
        overlay.setTool('topology', 'topology');
        renderDrawer();
      },
    );
    const simplifyTabBtn = makeBtn(
      `editor-segmented-tab${isSimplify ? ' is-active' : ''}`,
      null,
      t('editor.topology.simplify'),
      () => {
        state.setSubMode('simplify');
        overlay.setTool('topology', 'simplify');
        renderDrawer();
      },
    );
    const appendTabBtn = makeBtn(
      `editor-segmented-tab${isAppend ? ' is-active' : ''}`,
      null,
      t('editor.topology.appendTitle'),
      () => {
        state.setSubMode('append');
        overlay.setTool('topology', 'append');
        renderDrawer();
      },
    );
    tabs.append(mainTabBtn, simplifyTabBtn, appendTabBtn);
    drawerBody.append(tabs, el('div', 'editor-tab-divider'));

    if (isSimplify) {
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
      simplifyBox.append(tolRow);
      drawerBody.append(simplifyBox);
      return;
    }

    if (isAppend) {
      const appendBox = el('div', 'editor-stat-box');
      const mergeRow = el('label', 'editor-list-row');
      const mergeChk = el('input');
      mergeChk.type = 'checkbox';
      mergeChk.checked = Boolean(state.getAppendMergeSingle?.());
      mergeChk.addEventListener('change', () => {
        state.setAppendMergeSingle?.(mergeChk.checked);
      });
      mergeRow.append(mergeChk, el('span', 'editor-list-row-main', t('editor.topology.appendMerge')));

      let fallbackFileInput = null;
      if (typeof onImportExternalTrack !== 'function') {
        fallbackFileInput = el('input');
        fallbackFileInput.type = 'file';
        fallbackFileInput.accept = '.gpx,.kml';
        fallbackFileInput.hidden = true;
        fallbackFileInput.addEventListener('change', () => {
          const file = fallbackFileInput.files?.[0];
          fallbackFileInput.value = '';
          if (file) void importExternalFile(file);
        });
      }

      const appendBtn = makeBtn('editor-btn editor-btn-primary', 'editor-merge', t('editor.topology.appendBtn'), () => {
        if (typeof onImportExternalTrack === 'function') {
          void importFromHost({ mode: 'dialog' });
        } else {
          fallbackFileInput?.click();
        }
      });
      appendBox.append(mergeRow, appendBtn);
      if (fallbackFileInput) appendBox.append(fallbackFileInput);

      const siblings = state.getSiblingTracks?.() || [];
      if (siblings.length > 0 && typeof onImportExternalTrack === 'function') {
        appendBox.append(el('span', 'editor-drawer-hint', t('editor.topology.appendSiblings')));
        const sibList = el('div', 'editor-seg-list editor-sibling-list');
        for (const item of siblings) {
          const row = el('div', 'editor-list-row');
          const label = el('span', 'editor-list-row-main', item.name);
          label.title = item.name;
          const joinBtn = makeBtn('editor-btn', null, t('editor.topology.appendOne'), () => {
            void importFromHost({ mode: 'sibling', name: item.name });
          });
          row.append(label, joinBtn);
          sibList.append(row);
        }
        appendBox.append(sibList);
      }
      drawerBody.append(appendBox);
      return;
    }

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
  }

  function importExternalPayload(name, text) {
    if (!store.isActive()) return false;
    const isKml = /\.kml$/i.test(String(name || ''));
    const isGpx = /\.gpx$/i.test(String(name || ''));
    if (!isGpx && !isKml) {
      notifyToast(t('editor.topology.appendUnsupported'), 3000);
      return false;
    }
    try {
      const incoming = isKml ? parseKml(text) : parseGpx(text);
      const mergeIntoSingle = Boolean(state.getAppendMergeSingle?.());
      const res = appendExternalTrack(store.getCurrent(), incoming, {
        mergeIntoSingle,
        mergeWaypoints: true,
      });
      if (res.addedSegments === 0 && res.addedWaypoints === 0) {
        notifyToast(t('editor.topology.appendEmpty'), 3000);
        return false;
      }
      store.apply('append-track', res.track);
      if (res.skippedMergeGapMeters > 0) {
        notifyToast(t('editor.topology.appendSkippedMerge', {
          gap: formatDistance(res.skippedMergeGapMeters),
        }), 3800);
      } else if (res.merged) {
        notifyToast(t(res.reversedIncoming ? 'editor.topology.appendMergedRev' : 'editor.topology.appendMerged'));
      } else {
        notifyToast(t('editor.topology.appendDone', {
          segs: res.addedSegments,
          wpts: res.addedWaypoints,
        }));
      }
      return true;
    } catch {
      notifyToast(t('editor.topology.appendFail'), 3200);
      return false;
    }
  }

  async function importFromHost(opts) {
    if (typeof onImportExternalTrack !== 'function') return false;
    const res = await onImportExternalTrack(opts);
    if (!res || res.cancelled) return false;
    if (!res.ok) {
      notifyToast(t('editor.topology.appendFail'), 3200);
      return false;
    }
    return importExternalPayload(res.name, res.text);
  }

  async function importExternalFile(file) {
    if (!file || !store.isActive()) return false;
    try {
      const text = await file.text();
      return importExternalPayload(file.name, text);
    } catch {
      notifyToast(t('editor.topology.appendFail'), 3200);
      return false;
    }
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
    const gradeRow = el('label', 'editor-list-row');
    const gradeChk = el('input');
    gradeChk.type = 'checkbox';
    gradeChk.checked = state.getGradeAdjusted ? state.getGradeAdjusted() : true;
    gradeChk.addEventListener('change', () => {
      state.setGradeAdjusted?.(gradeChk.checked);
    });
    gradeRow.append(gradeChk, el('span', 'editor-list-row-main', t('editor.time.gradeAdjusted')));

    const virtBtn = makeBtn('editor-btn editor-btn-success', null, t('editor.time.virtualApply'), () => {
      const kmh = Number(speedInput.value) || 4;
      const parsedStart = Date.parse(startInput.value);
      const startMs = Number.isFinite(parsedStart) ? parsedStart : Date.now();
      const { track, durationSeconds, pointCount } = generateVirtualTimeline(
        store.getCurrent(),
        startMs,
        (kmh * 1000) / 3600,
        { gradeAdjusted: gradeChk.checked },
      );
      if (pointCount > 0) {
        store.apply('virtual-time', track);
        notifyToast(t('editor.time.virtualDone', { duration: formatDuration(durationSeconds) }));
      }
    });
    virtRow.append(speedInput, virtBtn);
    virtBox.append(el('span', 'editor-stat-label', t('editor.time.virtualTitle')), startInput, gradeRow, virtRow);
    drawerBody.append(shiftBox, virtBox);
  }

  function commitDrawDraft() {
    const draft = overlay.getDrawDraft?.();
    if (!draft || draft.points.length < 2) return false;
    const res = applyDrawnPath(store.getCurrent(), draft.points, {
      startSnap: draft.startSnap,
      endSnap: draft.endSnap,
    });
    if (res.mode === 'noop') return false;
    overlay.clearDrawDraft?.();
    store.apply('draw', res.track);
    if (res.mode === 'close-loop') {
      notifyToast(t(res.timestampsCleared ? 'editor.draw.doneCloseLoopCleared' : 'editor.draw.doneCloseLoop'));
    } else if (res.mode === 'replace') {
      notifyToast(t(res.timestampsCleared ? 'editor.draw.doneReplaceCleared' : 'editor.draw.doneReplace'));
    } else if (res.mode === 'extend-start' || res.mode === 'extend-end') {
      notifyToast(t('editor.draw.doneExtend'));
    } else {
      notifyToast(t('editor.draw.doneBranch'));
    }
    return true;
  }

  function renderDrawDrawer() {
    const drawerBody = getDrawerBody();
    drawerBody.append(el('p', 'editor-drawer-hint', t('editor.draw.hint')));
    const draft = overlay.getDrawDraft?.() || { points: [], startSnap: null, endSnap: null, distanceMeters: 0 };
    const count = draft.points.length;

    const statBox = el('div', 'editor-stat-box');
    statBox.append(
      el('span', 'editor-stat-label', t('editor.draw.points', { count })),
      el('span', 'editor-stat-value', formatDistance(draft.distanceMeters)),
    );
    drawerBody.append(statBox);

    const actions = el('div', 'editor-action-grid');
    const applyBtn = makeBtn('editor-btn editor-btn-success', null, t('editor.draw.apply'), () => {
      commitDrawDraft();
    });
    applyBtn.disabled = count < 2;
    const undoBtn = makeBtn('editor-btn', 'undo', t('editor.draw.undoPoint'), () => {
      overlay.undoDrawPoint?.();
    });
    undoBtn.disabled = count < 1;
    const clearBtn = makeBtn('editor-btn', 'clear', t('editor.draw.clear'), () => {
      overlay.clearDrawDraft?.();
    });
    clearBtn.disabled = count < 1;
    actions.append(applyBtn, undoBtn, clearBtn);
    drawerBody.append(actions);
  }

  function renderWaypointDrawer() {
    const drawerBody = getDrawerBody();
    const current = store.getCurrent();
    const wpts = current?.waypoints || [];
    const batchOpen = Boolean(state.getWptBatchOpen?.());

    const tabs = el('div', 'editor-segmented-tabs is-two');
    const listTabBtn = makeBtn(
      `editor-segmented-tab${!batchOpen ? ' is-active' : ''}`,
      null,
      t('editor.wpt.listTab'),
      () => {
        state.setWptBatchOpen?.(false);
        renderDrawer();
      },
    );
    const batchTabBtn = makeBtn(
      `editor-segmented-tab${batchOpen ? ' is-active' : ''}`,
      null,
      t('editor.wpt.batchTitle'),
      () => {
        state.setWptBatchOpen?.(true);
        renderDrawer();
      },
    );
    tabs.append(listTabBtn, batchTabBtn);
    drawerBody.append(tabs, el('div', 'editor-tab-divider'));

    if (batchOpen) {
      const organizeBox = el('div', 'editor-stat-box');
      const quickRow = el('div', 'editor-wpt-batch-grid');
      const sortBtn = makeBtn('editor-btn editor-btn-outline', 'editor-reverse', t('editor.wpt.batchSort'), () => {
        const res = sortWaypointsAlongTrack(store.getCurrent());
        if (res.changed) {
          state.setSelectedWptIndex(-1);
          overlay.setSelectedWaypoint(-1);
          store.apply('sort-waypoints', res.track);
          notifyToast(t('editor.wpt.batchSortDone'));
        } else {
          notifyToast(t('editor.wpt.batchSortNone'));
        }
      });
      sortBtn.disabled = wpts.length < 2;
      const dedupeBtn = makeBtn('editor-btn editor-btn-outline', 'clear', t('editor.wpt.batchDedupe'), () => {
        const res = dedupeWaypoints(store.getCurrent(), { radiusMeters: 20 });
        if (res.removedCount > 0) {
          state.setSelectedWptIndex(-1);
          overlay.setSelectedWaypoint(-1);
          store.apply('dedupe-waypoints', res.track);
          notifyToast(t('editor.wpt.batchDedupeDone', { count: res.removedCount }));
        } else {
          notifyToast(t('editor.wpt.batchDedupeNone'));
        }
      });
      dedupeBtn.disabled = wpts.length < 2;
      quickRow.append(sortBtn, dedupeBtn);
      organizeBox.append(el('span', 'editor-stat-label', t('editor.wpt.batchOrganize')), quickRow);

      const mileBox = el('div', 'editor-stat-box');
      const mileRow = el('div', 'editor-wpt-mile-row');
      const kmSelect = el('select');
      const selectedKm = state.getMilestoneKm?.() || 5;
      for (const km of [1, 2, 5, 10]) {
        const opt = el('option', '', `${km} km`);
        opt.value = String(km);
        if (km === selectedKm) opt.selected = true;
        kmSelect.append(opt);
      }
      kmSelect.addEventListener('change', () => {
        state.setMilestoneKm?.(Number(kmSelect.value) || 5);
      });
      const summitLabel = el('label', 'editor-wpt-mile-check');
      const summitChk = el('input');
      summitChk.type = 'checkbox';
      summitChk.checked = state.getMilestoneSummit ? state.getMilestoneSummit() : true;
      summitChk.addEventListener('change', () => {
        state.setMilestoneSummit?.(summitChk.checked);
      });
      summitLabel.append(summitChk, el('span', null, t('editor.wpt.batchSummit')));
      mileRow.append(kmSelect, summitLabel);

      const genBtn = makeBtn('editor-btn editor-btn-primary', null, t('editor.wpt.batchGen'), () => {
        const res = generateMilestoneWaypoints(store.getCurrent(), {
          intervalKm: Number(kmSelect.value) || 5,
          includeSummit: summitChk.checked,
          minDistanceMeters: 50,
          formatKmLabel: (km) => `${km} km`,
          summitLabel: t('editor.wpt.summitName'),
        });
        if (res.addedCount > 0) {
          store.apply('milestone-waypoints', res.track);
          notifyToast(t('editor.wpt.batchGenDone', { count: res.addedCount }));
        } else {
          notifyToast(t('editor.wpt.batchGenNone'));
        }
      });
      mileBox.append(el('span', 'editor-stat-label', t('editor.wpt.batchMilestones')), mileRow, genBtn);
      drawerBody.append(organizeBox, mileBox);
      return;
    }

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
    let symDirty = false;
    symSelect.addEventListener('change', () => { symDirty = true; });
    const setSymDisplay = (value) => {
      symSelect.value = WAYPOINT_SYMS.includes(value) ? value : 'pin';
      symDirty = false;
    };
    for (const sym of WAYPOINT_SYMS) {
      const opt = el('option', '', t(`editor.wpt.sym.${sym}`));
      opt.value = sym;
      symSelect.append(opt);
    }
    setSymDisplay(editingWpt?.icon || 'pin');
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
        const activeIdx = state.getSelectedWptIndex();
        const existingWpt = store.getCurrent()?.waypoints?.[activeIdx];
        const nextIcon = (!symDirty && existingWpt?.icon && !WAYPOINT_SYMS.includes(existingWpt.icon))
          ? existingWpt.icon
          : symSelect.value;
        const next = updateWaypoint(store.getCurrent(), activeIdx, {
          name: nameInput.value.trim(),
          icon: nextIcon,
          description: descInput.value.trim(),
        });
        store.apply('update-waypoint', next);
      }));
      actions.append(makeBtn('editor-btn editor-btn-danger', null, t('editor.wpt.delete'), () => {
        const activeIdx = state.getSelectedWptIndex();
        const next = deleteWaypoint(store.getCurrent(), activeIdx);
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

    if (listChunkFrame) {
      cancelAnimationFrame(listChunkFrame);
      listChunkFrame = 0;
    }
    if (wpts.length > 0) {
      const list = el('div', 'editor-wpt-list');
      /** @type {HTMLElement | null} */
      let selectedRow = null;
      const ordered = getOrderedWaypoints(current);
      const buildRow = ({ wpt, index: idx }, displayIdx) => {
        const isSelected = idx === selectedWptIndex;
        const photoCount = Array.isArray(wpt.images) ? wpt.images.length : 0;
        const hasNote = Boolean(wpt.description && wpt.description.trim());
        const isCustom = !isDefaultWaypointName(wpt.name);
        const kindClass = photoCount > 0
          ? 'is-wpt-photo'
          : hasNote
            ? 'is-wpt-note'
            : isCustom
              ? 'is-wpt-custom'
              : 'is-wpt-default';
        const row = el('div', `editor-list-row ${kindClass}${isSelected ? ' is-selected' : ''}`);
        const left = el('span', 'editor-wpt-row-left');
        const indexEl = el('span', 'editor-list-row-index', String(displayIdx + 1));
        const label = el('span', 'editor-list-row-main', wpt.name || t('editor.wpt.defaultName', { index: displayIdx + 1 }));
        left.append(indexEl, label);
        row.addEventListener('click', () => {
          const hadPending = Boolean(state.getPendingWptCoords());
          state.setPendingWptCoords(null);
          state.setSelectedWptIndex(idx);
          overlay.setSelectedWaypoint(idx);
          overlay.focusWaypoint?.(idx);
          if (editingWpt && !hadPending) {
            if (selectedRow && selectedRow !== row) selectedRow.classList.remove('is-selected');
            row.classList.add('is-selected');
            selectedRow = row;
            nameInput.value = wpt.name || '';
            setSymDisplay(wpt.icon || 'pin');
            descInput.value = wpt.description || '';
          } else {
            renderDrawer({ preserveWptScroll: true });
          }
        });
        const right = el('span', 'editor-wpt-row-actions');
        if (photoCount > 0 || hasNote || isCustom) {
          const meta = el('span', 'editor-wpt-row-meta');
          if (photoCount > 0) {
            const photoTag = el('span', 'editor-wpt-meta-tag is-photo');
            photoTag.append(iconElement('photo-export', { size: 12 }), document.createTextNode(String(photoCount)));
            meta.append(photoTag);
          }
          if (hasNote) {
            const noteTag = el('span', 'editor-wpt-meta-tag is-note');
            noteTag.append(iconElement('edit', { size: 11 }));
            meta.append(noteTag);
          }
          if (isCustom) {
            const customTag = el('span', 'editor-wpt-meta-tag is-custom');
            customTag.append(iconElement('text-title', { size: 11 }));
            meta.append(customTag);
          }
          right.append(meta);
        }
        right.append(makeBtn('editor-btn editor-btn-danger', 'close', null, (event) => {
          event?.stopPropagation?.();
          const curSel = state.getSelectedWptIndex();
          const next = deleteWaypoint(store.getCurrent(), idx);
          if (curSel === idx) state.setSelectedWptIndex(-1);
          else if (curSel > idx) state.setSelectedWptIndex(curSel - 1);
          overlay.setSelectedWaypoint(state.getSelectedWptIndex());
          store.apply('delete-waypoint', next);
        }));
        row.append(left, right);
        if (isSelected) selectedRow = row;
        return row;
      };

      const selectedDisplayIdx = ordered.findIndex((item) => item.index === selectedWptIndex);
      const initialLimit = Math.min(ordered.length, Math.max(30, selectedDisplayIdx >= 0 ? selectedDisplayIdx + 8 : 30));
      const initialFrag = document.createDocumentFragment();
      for (let i = 0; i < initialLimit; i += 1) {
        initialFrag.append(buildRow(ordered[i], i));
      }
      list.append(initialFrag);
      drawerBody.append(list);
      let pendingScrollTop = state.getWptScrollTop();
      if (pendingScrollTop > 0) {
        list.scrollTop = pendingScrollTop;
        if (list.scrollTop >= pendingScrollTop - 1) pendingScrollTop = 0;
      }
      if (selectedRow && state.consumeScrollWptIntoView()) {
        pendingScrollTop = 0;
        requestAnimationFrame(() => selectedRow?.scrollIntoView({ block: 'nearest' }));
      }

      if (initialLimit < ordered.length) {
        let cursor = initialLimit;
        const appendNextChunk = () => {
          listChunkFrame = 0;
          if (!list.isConnected) return;
          const end = Math.min(ordered.length, cursor + 45);
          const frag = document.createDocumentFragment();
          for (let i = cursor; i < end; i += 1) {
            frag.append(buildRow(ordered[i], i));
          }
          list.append(frag);
          if (pendingScrollTop > 0) {
            list.scrollTop = pendingScrollTop;
            if (list.scrollTop >= pendingScrollTop - 1) pendingScrollTop = 0;
          }
          cursor = end;
          if (cursor < ordered.length) {
            listChunkFrame = requestAnimationFrame(appendNextChunk);
          }
        };
        listChunkFrame = requestAnimationFrame(appendNextChunk);
      }
    }
  }

  return {
    renderCropDrawer,
    renderCleanDrawer,
    renderTopologyDrawer,
    renderVertexDrawer,
    renderDrawDrawer,
    commitDrawDraft,
    importExternalFile,
    renderTimeDrawer,
    renderWaypointDrawer,
  };
}
