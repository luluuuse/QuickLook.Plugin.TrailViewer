import { summariseRange } from './climb-analysis.js';
import { createEditorDrawers } from './editor-drawers.js';
import { findGarminWaypointWarnings } from './gpx-serializer.js';
import { iconElement } from './icons.js';
import { EXPORT_FORMATS, hasTrackTimestamps, serializeTrack } from './track-serializers.js';
import {
  cloneParsedTrack,
  createSegmentColorResolver,
  deleteTrackVertex,
  deleteWaypoint,
  normalizedTracks,
  sortWaypointsByRoute,
  splitTrackAt,
  trackTotalDistance,
} from './track-ops.js';

const RAIL_TOOLS = [
  { id: 'crop', icon: 'editor-crop', labelKey: 'editor.rail.crop', group: 'geometry', defaultSubMode: 'crop' },
  { id: 'draw', icon: 'edit', labelKey: 'editor.rail.draw', group: 'geometry', defaultSubMode: 'draw' },
  { id: 'topology', icon: 'editor-reverse', labelKey: 'editor.rail.topology', group: 'geometry', defaultSubMode: 'topology' },
  { id: 'clean', icon: 'editor-clean', labelKey: 'editor.rail.clean', group: 'data', defaultSubMode: 'clean' },
  { id: 'waypoint', icon: 'editor-waypoint-add', labelKey: 'editor.rail.waypoint', group: 'data', defaultSubMode: '' },
  { id: 'time', icon: 'editor-time', labelKey: 'editor.rail.time', group: 'data', defaultSubMode: '' },
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
 *   getSourceFormat?: (() => string) | null,
 *   isGpxSource?: () => boolean,
 *   onSaveTrack: (opts: { id: string, fileName: string, xml: string, content?: string, format?: string, overwrite: boolean, packRemoteImages?: boolean, onProgress?: (info: { completed: number, total: number, failed: number }) => void }) => Promise<any>,
 *   onListSiblingTracks?: (() => Promise<Array<{ name: string, size: number }>>) | null,
 *   onImportExternalTrack?: ((opts: { mode?: string, name?: string }) => Promise<any>) | null,
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
  getSourceFormat = null,
  isGpxSource = () => true,
  onSaveTrack,
  onListSiblingTracks = null,
  onImportExternalTrack = null,
  onExit,
  onToggleLayers = () => {},
  isLayersOpen = () => false,
  onTogglePins = () => {},
  onShowPins = () => {},
  isPinsVisible = () => true,
  onLayoutChange = () => {},
  showToast = () => {},
}) {
  /** @returns {string} */
  const resolveSourceFormat = () => {
    if (typeof getSourceFormat === 'function') {
      const explicit = String(getSourceFormat() || '').trim().toLowerCase();
      if (explicit === 'gpx' || explicit === 'kml' || explicit === 'kmz') return explicit;
      return '';
    }
    const clean = String(getTrackName?.() || '').split(/[?#]/)[0];
    const match = clean.match(/\.(gpx|kml|kmz)$/i);
    if (match) return match[1].toLowerCase();
    return isGpxSource() ? 'gpx' : '';
  };
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
  let saveProgress = null;
  let saveProgressText = null;
  let saveProgressFill = null;
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
  let splitOverlay = null;
  let splitBandsLayer = null;
  let splitHoverLine = null;
  let splitHoverPill = null;

  const railButtons = new Map();
  let activeTool = 'crop';
  let activeSubMode = 'crop';
  let drawerOpen = true;
  let cropFromMeters = 0;
  let cropToMeters = 0;
  let selectedSegIndex = -1;
  let hoveredSegIndex = -1;
  const segmentColorResolver = createSegmentColorResolver();
  let splitFocusLine = null;
  let selectedWptIndex = -1;
  let pendingWptCoords = null;
  let watchFriendly = true;
  let exportFormat = 'gpx';
  let packRemoteImages = false;
  let overwriteOriginal = false;
  let sessionOverwroteOriginal = false;
  let lastOverwrittenTrack = null;
  let isSaving = false;
  let saveSequence = 0;
  let sessionId = 0;
  let shellLifecycle = null;
  let cachedTotalMeters = 0;
  let cropRangeLabelEl = null;
  let cropAscentLabelEl = null;
  let excludedAnomalyKeys = new Set();
  let excludedAnomalyTrackRef = null;
  let smoothWindow = 5;
  let gradeAdjusted = true;
  let appendMergeSingle = false;
  let wptBatchOpen = false;
  let milestoneKm = 5;
  let milestoneSummit = true;
  let siblingTracks = [];
  let wptListScrollTop = 0;
  let scrollWptIntoView = false;

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

  function updateSplitHoverDisplay(alongMeters) {
    if (!splitOverlay || !splitHoverLine || !splitHoverPill) return;
    if (alongMeters == null || !Number.isFinite(alongMeters) || !store.isActive()
      || activeTool !== 'crop' || activeSubMode !== 'split') {
      splitHoverLine.hidden = true;
      splitHoverPill.hidden = true;
      return;
    }
    const total = Math.max(1, trackTotalDistance(store.getCurrent()));
    const width = splitOverlay.clientWidth;
    if (width <= 0) {
      splitHoverLine.hidden = true;
      splitHoverPill.hidden = true;
      return;
    }
    const ratio = Math.max(0, Math.min(1, alongMeters / total));
    const px = ratio * width;
    splitHoverLine.style.transform = `translate3d(${px.toFixed(1)}px, 0, 0)`;
    splitHoverLine.hidden = false;
    splitHoverPill.textContent = formatDistance(alongMeters);
    const pillClamped = Math.max(36, Math.min(width - 36, px));
    splitHoverPill.style.transform = `translate3d(${pillClamped.toFixed(1)}px, 0, 0) translateX(-50%)`;
    splitHoverPill.hidden = false;
  }

  function getSplitBoundaryMeters(parsed) {
    const tracks = normalizedTracks(parsed);
    if (tracks.length <= 1) return [];
    const boundaries = [];
    let acc = 0;
    for (let i = 0; i < tracks.length - 1; i += 1) {
      acc += trackTotalDistance({ name: '', tracks: [tracks[i]], routes: [], waypoints: [] });
      boundaries.push(acc);
    }
    return boundaries;
  }

  function highlightSnappedDivider(snappedMeters) {
    if (!splitBandsLayer) return;
    for (const node of splitBandsLayer.querySelectorAll('.editor-split-divider')) {
      const m = Number(node.dataset.meters);
      const hit = snappedMeters != null && Math.abs(m - snappedMeters) < 0.5;
      node.classList.toggle('is-snapped', hit);
    }
  }

  function updateSplitProfileHighlight(activeIdx) {
    if (!splitBandsLayer) return;
    const hasActive = activeIdx >= 0;
    let activeBand = null;
    for (const node of splitBandsLayer.querySelectorAll('.editor-split-band')) {
      const idx = Number(node.dataset.segIndex);
      const isHit = hasActive && idx === activeIdx;
      node.classList.toggle('is-highlighted', isHit);
      node.classList.toggle('is-dimmed', hasActive && !isHit);
      if (isHit) activeBand = node;
    }
    if (splitFocusLine) {
      if (activeBand) {
        splitFocusLine.style.left = `${activeBand.dataset.midPx || '0'}px`;
        splitFocusLine.style.setProperty('--split-color', activeBand.dataset.color || '#f97316');
        splitFocusLine.hidden = false;
      } else {
        splitFocusLine.hidden = true;
      }
    }
  }

  function syncSegmentHighlight() {
    const activeIdx = hoveredSegIndex >= 0 ? hoveredSegIndex : selectedSegIndex;
    overlay.setHighlightedSegment?.(activeIdx);
    updateSplitProfileHighlight(activeIdx);
  }

  function renderSplitProfileMarkers() {
    if (!splitOverlay || !splitBandsLayer || splitOverlay.hidden) return;
    splitBandsLayer.textContent = '';
    splitFocusLine = null;
    const current = store.getCurrent();
    const tracks = normalizedTracks(current);
    if (tracks.length <= 1) return;
    const total = trackTotalDistance(current);
    const width = splitOverlay.clientWidth;
    if (!(total > 0) || width <= 0) return;

    const colors = segmentColorResolver.resolve(tracks);
    let acc = 0;
    tracks.forEach((trk, idx) => {
      const len = trackTotalDistance({ name: '', tracks: [trk], routes: [], waypoints: [] });
      const startPx = (acc / total) * width;
      const endPx = ((acc + len) / total) * width;
      const color = colors[idx];
      const bandWidth = Math.max(4, endPx - startPx);
      const bandLeft = Math.min(startPx, Math.max(0, width - bandWidth));
      const midPx = Math.max(2, Math.min(width - 2, (startPx + endPx) * 0.5));

      const band = el('div', 'editor-split-band');
      band.style.left = `${bandLeft.toFixed(1)}px`;
      band.style.width = `${bandWidth.toFixed(1)}px`;
      band.style.setProperty('--split-color', color);
      band.dataset.segIndex = String(idx);
      band.dataset.midPx = midPx.toFixed(1);
      band.dataset.color = color;
      splitBandsLayer.append(band);

      if (idx > 0) {
        const divider = el('div', 'editor-split-divider');
        divider.style.left = `${startPx.toFixed(1)}px`;
        divider.dataset.meters = String(acc);
        const tag = el('span', 'editor-split-divider-tag', formatDistance(acc));
        divider.append(tag);
        splitBandsLayer.append(divider);
      }
      acc += len;
    });

    splitFocusLine = el('div', 'editor-split-focus-line');
    splitFocusLine.hidden = true;
    splitBandsLayer.append(splitFocusLine);
    const activeIdx = hoveredSegIndex >= 0 ? hoveredSegIndex : selectedSegIndex;
    updateSplitProfileHighlight(activeIdx);
  }

  function mountSplitOverlay(plot) {
    if (!plot) return;
    if (!splitOverlay || splitOverlay.parentElement !== plot) {
      splitOverlay = el('div', 'editor-split-overlay');
      splitOverlay.hidden = true;
      splitBandsLayer = el('div', 'editor-split-bands');
      splitHoverLine = el('div', 'editor-split-hover-line');
      splitHoverLine.hidden = true;
      splitHoverPill = el('span', 'editor-split-hover-pill');
      splitHoverPill.hidden = true;
      splitOverlay.append(splitBandsLayer, splitHoverLine, splitHoverPill);

      const metersAtEvent = (event) => {
        const rect = splitOverlay.getBoundingClientRect();
        const total = trackTotalDistance(store.getCurrent());
        if (rect.width <= 0 || !(total > 0)) return null;
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        return ratio * total;
      };
      splitOverlay.addEventListener('pointermove', (event) => {
        if (!store.isActive() || activeTool !== 'crop' || activeSubMode !== 'split') return;
        const meters = metersAtEvent(event);
        if (meters == null) return;
        updateSplitHoverDisplay(meters);
        overlay.showSplitPreviewAt?.(meters);
      });
      splitOverlay.addEventListener('pointerleave', () => {
        updateSplitHoverDisplay(null);
        overlay.showSplitPreviewAt?.(null);
      });
      splitOverlay.addEventListener('click', (event) => {
        if (!store.isActive() || activeTool !== 'crop' || activeSubMode !== 'split') return;
        event.preventDefault();
        event.stopPropagation();
        const meters = metersAtEvent(event);
        if (meters == null) return;
        const current = store.getCurrent();
        const total = trackTotalDistance(current);
        if (!(meters > 0 && meters < total)) return;
        updateSplitHoverDisplay(null);
        overlay.showSplitPreviewAt?.(null);
        store.apply('split', splitTrackAt(current, meters));
      });
      plot.append(splitOverlay);
    }
    const isSplitInteractive = store.isActive() && activeTool === 'crop' && activeSubMode === 'split';
    const hasMultipleTracks = store.isActive() && normalizedTracks(store.getCurrent()).length > 1;
    splitOverlay.classList.toggle('is-interactive', isSplitInteractive);
    splitOverlay.hidden = !(isSplitInteractive || hasMultipleTracks);
    if (!isSplitInteractive) updateSplitHoverDisplay(null);
    if (!splitOverlay.hidden) renderSplitProfileMarkers();
  }

  let cropResizeObserver = null;

  function mountCropOverlay() {
    const pState = getProfileState?.();
    const plot = pState?.chart || pState?.plot;
    if (!plot) return;
    if (!cropOverlay || cropOverlay.parentElement !== plot) {
      cropResizeObserver?.disconnect();
      cropResizeObserver = null;
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
          const current = store.getCurrent();
          cachedTotalMeters = trackTotalDistance(current);
          const snapNodes = getSplitBoundaryMeters(current);
          let dragFrame = 0;
          let latestClientX = event.clientX;
          let latestAltKey = event.altKey;
          const flushDrag = () => {
            dragFrame = 0;
            const rect = cropOverlay.getBoundingClientRect();
            if (rect.width <= 0 || cachedTotalMeters <= 0) return;
            const ratio = Math.max(0, Math.min(1, (latestClientX - rect.left) / rect.width));
            let meters = ratio * cachedTotalMeters;
            const minSpan = Math.min(cachedTotalMeters * 0.02, 50);
            let snappedNode = null;
            if (!latestAltKey && snapNodes.length > 0) {
              const snapRadiusMeters = (10 / rect.width) * cachedTotalMeters;
              let bestDist = snapRadiusMeters;
              for (const node of snapNodes) {
                const valid = isLeft
                  ? node <= cropToMeters - minSpan
                  : node >= cropFromMeters + minSpan;
                if (!valid) continue;
                const d = Math.abs(node - meters);
                if (d <= bestDist) {
                  bestDist = d;
                  snappedNode = node;
                }
              }
              if (snappedNode != null) meters = snappedNode;
            }
            handle.classList.toggle('is-snapped', snappedNode != null);
            highlightSnappedDivider(snappedNode);
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
            latestAltKey = moveEvent.altKey;
            if (!dragFrame) dragFrame = requestAnimationFrame(flushDrag);
          };
          const onUp = () => {
            if (dragFrame) {
              cancelAnimationFrame(dragFrame);
              flushDrag();
            }
            handle.classList.remove('is-snapped');
            highlightSnappedDivider(null);
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
      if (typeof ResizeObserver === 'function') {
        cropResizeObserver = new ResizeObserver(() => {
          updateCropOverlayPositions();
          renderSplitProfileMarkers();
        });
        cropResizeObserver.observe(plot);
      }
    }
    const showHandles = store.isActive() && activeTool === 'crop' && activeSubMode === 'crop';
    cropOverlay.hidden = !showHandles;
    if (showHandles) updateCropOverlayPositions();
    mountSplitOverlay(plot);
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
    const ordered = sortWaypointsByRoute(store.getCurrent());
    if (ordered.length > 0) {
      selectedWptIndex = ordered[0].index;
      overlay.setSelectedWaypoint(selectedWptIndex);
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
    renderDrawer: (opts) => renderDrawer(opts),
    hasProfileChart: () => Boolean(getProfileState?.()?.chart || getProfileState?.()?.plot),
    setCropStatEls: (rangeEl, ascentEl) => {
      cropRangeLabelEl = rangeEl;
      cropAscentLabelEl = ascentEl;
    },
    state: {
      getSubMode: () => activeSubMode,
      setSubMode: (mode) => {
        activeSubMode = mode;
        if (mode !== 'split') {
          selectedSegIndex = -1;
          hoveredSegIndex = -1;
          syncSegmentHighlight();
        }
      },
      getSegmentColors: (tracks) => segmentColorResolver.resolve(tracks),
      getSelectedSegIndex: () => selectedSegIndex,
      setSelectedSegIndex: (idx) => {
        selectedSegIndex = Number.isInteger(idx) ? idx : -1;
        syncSegmentHighlight();
      },
      setHoveredSegIndex: (idx) => {
        hoveredSegIndex = Number.isInteger(idx) ? idx : -1;
        syncSegmentHighlight();
      },
      getCropRange: () => ({ from: cropFromMeters, to: cropToMeters }),
      setCropRange: (from, to) => { cropFromMeters = from; cropToMeters = to; },
      getSelectedWptIndex: () => selectedWptIndex,
      setSelectedWptIndex: (idx) => { selectedWptIndex = idx; },
      getPendingWptCoords: () => pendingWptCoords,
      setPendingWptCoords: (coords) => { pendingWptCoords = coords; },
      getWptNoteOpen: () => wptNoteOpen,
      setWptNoteOpen: (openVal) => { wptNoteOpen = openVal; },
      getWptScrollTop: () => wptListScrollTop,
      consumeScrollWptIntoView: () => {
        const val = scrollWptIntoView;
        scrollWptIntoView = false;
        return val;
      },
      getExcludedAnomalyKeys: () => excludedAnomalyKeys,
      getSmoothWindow: () => smoothWindow,
      setSmoothWindow: (win) => { smoothWindow = win; },
      getGradeAdjusted: () => gradeAdjusted,
      setGradeAdjusted: (val) => { gradeAdjusted = Boolean(val); },
      getAppendMergeSingle: () => appendMergeSingle,
      setAppendMergeSingle: (val) => { appendMergeSingle = Boolean(val); },
      getWptBatchOpen: () => wptBatchOpen,
      setWptBatchOpen: (val) => { wptBatchOpen = Boolean(val); },
      getMilestoneKm: () => milestoneKm,
      setMilestoneKm: (val) => { milestoneKm = Number(val) || 5; },
      getMilestoneSummit: () => milestoneSummit,
      setMilestoneSummit: (val) => { milestoneSummit = Boolean(val); },
      getSiblingTracks: () => siblingTracks,
    },
    onImportExternalTrack,
  });

  function closeSavePopover() {
    if (savePopover) savePopover.hidden = true;
    saveOptsBtn?.setAttribute('aria-expanded', 'false');
  }

  function buildSavePopoverContent() {
    if (!savePopover) return;
    savePopover.textContent = '';

    const fmtRow = el('label', 'editor-save-format-row');
    const fmtLabel = el('span', 'editor-save-format-label', t('editor.save.format'));
    const fmtSelect = el('select', 'editor-save-format-select');
    for (const item of EXPORT_FORMATS) {
      const opt = el('option', '', item.label);
      opt.value = item.id;
      if (item.id === exportFormat) opt.selected = true;
      fmtSelect.append(opt);
    }
    fmtRow.append(fmtLabel, fmtSelect);

    const wfRow = el('label', 'editor-check-row');
    const wfCheck = el('input');
    wfCheck.type = 'checkbox';
    wfCheck.checked = watchFriendly;
    wfCheck.addEventListener('change', () => { watchFriendly = wfCheck.checked; });
    wfRow.append(wfCheck, el('span', '', t('editor.save.watchFriendly')));

    const owRow = el('label', 'editor-check-row');
    const owCheck = el('input');
    owCheck.type = 'checkbox';
    const owLabel = el('span', '');
    owRow.append(owCheck, owLabel);

    const owNote = el('div', 'editor-save-note', t('editor.save.overwriteKmlNote'));
    owNote.dataset.saveOption = 'overwrite-kml-note';
    owNote.hidden = true;

    const kmzRemoteRow = el('label', 'editor-check-row');
    kmzRemoteRow.dataset.saveOption = 'kmz-remote';
    const kmzRemoteCheck = el('input');
    kmzRemoteCheck.type = 'checkbox';
    kmzRemoteCheck.checked = packRemoteImages;
    kmzRemoteCheck.addEventListener('change', () => { packRemoteImages = kmzRemoteCheck.checked; });
    kmzRemoteRow.append(kmzRemoteCheck, el('span', '', t('editor.save.kmzPackRemote')));

    const syncSavePopoverState = () => {
      const isGpxFmt = exportFormat === 'gpx';
      const isKmzFmt = exportFormat === 'kmz';
      const srcFmt = resolveSourceFormat();
      const isOverwritableSource = srcFmt === 'gpx' || srcFmt === 'kml' || srcFmt === 'kmz';
      wfCheck.disabled = !isGpxFmt;
      wfRow.classList.toggle('is-disabled', !isGpxFmt);

      const allowOverwrite = isOverwritableSource && exportFormat === srcFmt;
      if (!allowOverwrite) overwriteOriginal = false;
      owCheck.checked = allowOverwrite && overwriteOriginal;
      owCheck.disabled = !allowOverwrite;
      owRow.classList.toggle('is-disabled', !allowOverwrite);
      owLabel.textContent = t(allowOverwrite
        ? 'editor.save.overwrite'
        : (isOverwritableSource ? 'editor.save.overwriteSameFormatOnly' : 'editor.save.overwriteUnsupported'));

      const showKmlNote = allowOverwrite && overwriteOriginal && (exportFormat === 'kml' || exportFormat === 'kmz');
      owNote.hidden = !showKmlNote;

      kmzRemoteRow.hidden = !isKmzFmt;
      kmzRemoteCheck.checked = packRemoteImages;
    };

    owCheck.addEventListener('change', () => {
      overwriteOriginal = owCheck.checked;
      syncSavePopoverState();
    });

    fmtSelect.addEventListener('change', () => {
      exportFormat = fmtSelect.value || 'gpx';
      syncSavePopoverState();
    });
    syncSavePopoverState();

    savePopover.append(fmtRow, wfRow, owRow, owNote, kmzRemoteRow);
  }

  function renderDrawer({ preserveWptScroll = false } = {}) {
    if (!drawerBody || !store.isActive()) return;
    const prevList = drawerBody.querySelector('.editor-wpt-list');
    if (prevList) wptListScrollTop = prevList.scrollTop;
    else if (activeTool !== 'waypoint' || !preserveWptScroll) wptListScrollTop = 0;
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
    else if (activeTool === 'draw') drawers.renderDrawDrawer();
    else if (activeTool === 'waypoint') drawers.renderWaypointDrawer();
    else if (activeTool === 'time') drawers.renderTimeDrawer();

    handleLayoutChange();
  }

  function setSaveProgressUi(info) {
    if (!saveProgress || !saveProgressText || !saveProgressFill) return;
    if (!info || !(info.total > 0)) {
      saveProgress.hidden = true;
      saveProgressFill.style.width = '0%';
      return;
    }
    const { completed, total, failed } = info;
    const pct = Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
    saveProgress.hidden = false;
    saveProgressFill.style.width = `${pct}%`;
    if (completed >= total) {
      saveProgressText.textContent = t('editor.save.kmzWriting');
    } else if (failed > 0) {
      saveProgressText.textContent = t('editor.save.kmzProgressWithFail', { completed, total, failed });
    } else {
      saveProgressText.textContent = t('editor.save.kmzProgress', { completed, total });
    }
  }

  async function triggerSave() {
    if (isSaving) return false;
    const current = store.getCurrent();
    if (!current) return false;
    const mySession = sessionId;
    isSaving = true;
    if (saveBtn) saveBtn.disabled = true;
    let lastProgress = { completed: 0, total: 0, failed: 0 };
    try {
      const fmtMeta = EXPORT_FORMATS.find((item) => item.id === exportFormat) || EXPORT_FORMATS[0];
      const fmt = fmtMeta.id;
      if (fmt === 'gpx' && watchFriendly) {
        const warn = findGarminWaypointWarnings(current.waypoints);
        if (warn.tooLongCount > 0) {
          notifyToast(t('editor.save.garminWarn', { count: warn.tooLongCount }), 3200);
        }
      } else if (fmt === 'tcx' && !hasTrackTimestamps(current)) {
        notifyToast(t('editor.save.tcxNoTime'), 3500);
      }
      const content = serializeTrack(current, fmt, { watchFriendly });
      saveSequence += 1;
      const id = `save-${saveSequence}`;
      const baseName = (getTrackName() || 'track').replace(/\.[^.]+$/, '');
      const fileName = `${baseName}-edited${fmtMeta.ext}`;
      const srcFmt = resolveSourceFormat();
      const allowOverwrite = (srcFmt === 'gpx' || srcFmt === 'kml' || srcFmt === 'kmz') && fmt === srcFmt;
      const didOverwrite = allowOverwrite && overwriteOriginal;
      const savingVersion = store.getVersion();
      const result = await onSaveTrack({
        id,
        fileName,
        xml: content,
        content,
        format: fmt,
        overwrite: didOverwrite,
        packRemoteImages: fmt === 'kmz' && packRemoteImages,
        onProgress: (info) => {
          if (mySession !== sessionId || !store.isActive()) return;
          lastProgress = info;
          setSaveProgressUi(info);
        },
      });
      if (mySession !== sessionId || !store.isActive()) return false;
      if (result?.ok) {
        if (allowOverwrite && (didOverwrite || result?.overwrote)) {
          sessionOverwroteOriginal = true;
          lastOverwrittenTrack = cloneParsedTrack(current);
        }
        store.markSaved(savingVersion);
        updateTopbar();
        const savedPath = result.path || fileName;
        if (lastProgress.total > 0) {
          const packed = Math.max(0, lastProgress.total - lastProgress.failed);
          notifyToast(
            lastProgress.failed > 0
              ? t('editor.save.okWithRemotePartial', {
                path: savedPath,
                packed,
                total: lastProgress.total,
                failed: lastProgress.failed,
              })
              : t('editor.save.okWithRemote', { path: savedPath, packed }),
            3200,
          );
        } else {
          notifyToast(t('editor.save.ok', { path: savedPath }));
        }
        return true;
      }
      if (result?.cancelled) return false;
      notifyToast(t('editor.save.fail', { detail: result?.detail || 'error' }), 3500);
      return false;
    } finally {
      if (mySession === sessionId) {
        isSaving = false;
        setSaveProgressUi(null);
        if (saveBtn) saveBtn.disabled = false;
      }
    }
  }

  function requestExit() {
    if (!store.isActive() || isSaving) return;
    closeSavePopover();
    setSaveProgressUi(null);
    closeContextMenu();
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

    saveProgress = el('div', 'editor-save-progress');
    saveProgress.hidden = true;
    saveProgressText = el('span', 'editor-save-progress-text', '');
    const progressBar = el('div', 'editor-save-progress-bar');
    saveProgressFill = el('div', 'editor-save-progress-fill');
    progressBar.append(saveProgressFill);
    saveProgress.append(saveProgressText, progressBar);

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
    let lastGroup = null;
    for (const tool of RAIL_TOOLS) {
      if (lastGroup && tool.group !== lastGroup) {
        const sep = el('div', 'editor-rail-sep');
        sep.setAttribute('role', 'separator');
        rail.append(sep);
      }
      lastGroup = tool.group;
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
          overlay.setTool(activeTool, activeSubMode);
        } else {
          activeTool = tool.id;
          activeSubMode = tool.defaultSubMode ?? '';
          drawerOpen = true;
          ensureWaypointSelection();
          overlay.setTool(activeTool, activeSubMode);
          ensureWaypointVisibility();
        }
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

    root.append(topbar, savePopover, saveProgress, exitGuard, rail, drawer, drawerTooltip, contextMenu);
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
        const before = store.getCurrent();
        const beforePts = before?.tracks?.reduce((n, trk) => n + (trk.segments || []).reduce((m, s) => m + s.length, 0), 0) || 0;
        const next = deleteTrackVertex(before, vertexTarget.flatSegIndex, vertexTarget.ptIndex);
        const afterPts = next?.tracks?.reduce((n, trk) => n + (trk.segments || []).reduce((m, s) => m + s.length, 0), 0) || 0;
        if (afterPts !== beforePts) {
          store.apply('delete-vertex', next);
        }
      });
      contextMenu.append(delVertexItem);
    }
    contextMenu.style.left = `${Math.min(innerWidth - 180, Math.max(8, clientX))}px`;
    contextMenu.style.top = `${Math.min(innerHeight - 130, Math.max(8, clientY))}px`;
    contextMenu.hidden = false;
  }

  function relabelStaticDom() {
    const setBtnLabel = (btn, label) => {
      const span = btn?.querySelector('span');
      if (span) span.textContent = label;
    };
    setBtnLabel(undoBtn, t('editor.undo'));
    setBtnLabel(redoBtn, t('editor.redo'));
    setBtnLabel(resetBtn, t('editor.reset'));
    setBtnLabel(saveBtn, t('editor.save'));
    setBtnLabel(exitBtn, t('editor.exit'));
    if (layersBtn) {
      layersBtn.title = t('layer.menuTitle');
      layersBtn.setAttribute('aria-label', t('layer.menuTitle'));
    }
    if (pinsBtn) {
      pinsBtn.title = t('pins.label');
      pinsBtn.setAttribute('aria-label', t('pins.label'));
    }
    for (const tool of RAIL_TOOLS) {
      const btn = railButtons.get(tool.id);
      if (btn) {
        btn.title = t(tool.labelKey);
        btn.setAttribute('aria-label', t(tool.labelKey));
      }
    }
    if (exitGuard) {
      const guardSpan = exitGuard.querySelector(':scope > span');
      if (guardSpan) guardSpan.textContent = t('editor.exitGuard');
      const guardBtns = exitGuard.querySelectorAll('button');
      if (guardBtns[0]) setBtnLabel(guardBtns[0], t('editor.discard'));
      if (guardBtns[1]) setBtnLabel(guardBtns[1], t('editor.saveAndExit'));
      if (guardBtns[2]) setBtnLabel(guardBtns[2], t('editor.keepEditing'));
    }
  }

  /** @param {{ parsed: any, initialTool?: string, cropRange?: [number, number] | null }} opts */
  function open({ parsed, initialTool = 'crop', cropRange = null }) {
    buildDom();
    relabelStaticDom();
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
    const initialMeta = RAIL_TOOLS.find((item) => item.id === initialTool) || RAIL_TOOLS[0];
    activeTool = initialMeta.id;
    activeSubMode = initialMeta.defaultSubMode ?? '';
    drawerOpen = true;
    selectedSegIndex = -1;
    hoveredSegIndex = -1;
    segmentColorResolver.reset();
    overlay.setSegmentColorResolver?.((tracks) => segmentColorResolver.resolve(tracks));
    selectedWptIndex = -1;
    pendingWptCoords = null;
    wptNoteOpen = false;
    sessionId += 1;
    isSaving = false;
    if (saveBtn) saveBtn.disabled = false;
    exportFormat = resolveSourceFormat() || 'gpx';
    overwriteOriginal = false;
    packRemoteImages = false;
    sessionOverwroteOriginal = false;
    lastOverwrittenTrack = null;
    excludedAnomalyKeys = new Set();
    excludedAnomalyTrackRef = store.getCurrent();

    document.body.classList.add('is-editing');
    root.hidden = false;
    hideExitGuard();
    closeSavePopover();
    setSaveProgressUi(null);
    closeContextMenu();

    overlay.mount(store.getCurrent());
    ensureWaypointSelection();
    overlay.setTool(activeTool, activeSubMode);
    ensureWaypointVisibility();
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
      renderSplitProfileMarkers();
    }, { signal });
    siblingTracks = [];
    if (typeof onListSiblingTracks === 'function') {
      void Promise.resolve(onListSiblingTracks()).then((items) => {
        if (signal.aborted || !store.isActive()) return;
        siblingTracks = Array.isArray(items) ? items : [];
        if (activeTool === 'crop' && activeSubMode === 'append' && drawerOpen) renderDrawer();
      });
    }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function close() {
    sessionId += 1;
    isSaving = false;
    if (saveBtn) saveBtn.disabled = false;
    if (shellLifecycle) {
      shellLifecycle.abort();
      shellLifecycle = null;
    }
    cropResizeObserver?.disconnect();
    cropResizeObserver = null;
    closeSavePopover();
    setSaveProgressUi(null);
    closeContextMenu();
    if (cropOverlay) cropOverlay.hidden = true;
    if (splitOverlay) {
      updateSplitHoverDisplay(null);
      splitOverlay.hidden = true;
    }
    if (root) root.hidden = true;
    document.body.classList.remove('is-editing');
    const committed = sessionOverwroteOriginal ? lastOverwrittenTrack : null;
    lastOverwrittenTrack = null;
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
      closeContextMenu();
      const current = store.getCurrent();
      const total = trackTotalDistance(current);
      cachedTotalMeters = total;
      cropFromMeters = 0;
      cropToMeters = total;
      selectedSegIndex = -1;
      hoveredSegIndex = -1;
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
      wptBatchOpen = false;
      overlay.setSelectedWaypoint(-1);
      renderDrawer();
    },
    selectWaypoint(index) {
      pendingWptCoords = null;
      selectedWptIndex = index;
      wptBatchOpen = false;
      scrollWptIntoView = true;
      if (activeTool !== 'waypoint' || !drawerOpen) {
        activeTool = 'waypoint';
        activeSubMode = '';
        drawerOpen = true;
        overlay.setTool('waypoint', '');
        ensureWaypointVisibility();
        mountCropOverlay();
        updateRail();
      }
      renderDrawer();
    },
    refreshVertexStatus() {
      if (activeTool === 'draw' && activeSubMode === 'vertex' && drawerOpen) renderDrawer();
    },
    refreshDrawStatus() {
      if (activeTool === 'draw' && (activeSubMode === 'draw' || activeSubMode === '') && drawerOpen) renderDrawer();
    },
    handleKeyDown(event) {
      if (!store.isActive() || activeTool !== 'draw' || (activeSubMode !== 'draw' && activeSubMode !== '')) {
        return false;
      }
      const draft = overlay.getDrawDraft?.();
      const count = draft?.points?.length || 0;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if ((event.key === 'Backspace' || (mod && key === 'z' && !event.shiftKey)) && count > 0) {
        event.preventDefault();
        overlay.undoDrawPoint?.();
        return true;
      }
      return false;
    },
    setSplitHover(alongMeters) {
      updateSplitHoverDisplay(alongMeters);
    },
  };
}
