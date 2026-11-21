import {
  profileSamples,
  seriesSamples,
  sliceCurveByDistance,
  SLOPE_FULL,
  slopeColor,
  slopeScale,
} from './profile.js';
import { createPointIndex } from './spatial.js';
import { iconElement } from './icons.js';

function formatKmMark(meters) {
  const km = meters / 1000;
  const rounded = Math.round(km);
  if (Math.abs(km - rounded) < 0.005) return String(rounded);
  return km.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Builds the SVG elevation panel. Map dragging remains in app.js; this module owns only the chart and its
 * language-aware labels.
 */
export function createProfileChart({
  el,
  localized,
  t,
  formatDistance,
  photosOf,
  getPinsShown,
  setPins,
  onLayoutChange,
}) {
  function gradeLegend(steep) {
    const row = el('div', 'legend');
    const item = el('span', 'item');
    if (steep.metres >= 20) {
      const distance = () => (steep.metres >= 1000
        ? `${(steep.metres / 1000).toFixed(1)} ${t('unit.km')}`
        : `${Math.round(steep.metres / 10) * 10} ${t('unit.m')}`);
      item.append(
        localized(el('span', 'key'), () => t('grade.steep')),
        localized(el('span', 'value'), distance),
      );
    } else {
      item.append(localized(el('span', 'key'), () => t('grade.noSteep')));
    }
    item.append(el('span', 'sep', '\u00b7'));
    item.append(
      localized(el('span', 'key'), () => t('grade.steepest')),
      el('span', 'value', `${Math.round(steep.maxSlope * 100)}%`),
    );
    localized(item, () => t('grade.steepHint'), 'title');
    row.append(item);

    const strip = el('span', 'scale');
    const bar = el('span', 'scale-bar');
    bar.style.background = `linear-gradient(to right, ${slopeScale()
      .map(([offset, colour]) => `${colour} ${(offset * 100).toFixed(1)}%`).join(', ')})`;
    strip.append(el('span', 'scale-end', '0'), bar, el('span', 'scale-end', '25%'));
    localized(strip, () => t('profile.scaleHint'), 'title');
    row.append(strip);
    return row;
  }

  /** @param {import('./types.js').ParsedTrack} gpx @param {import('./types.js').ProfileData} data */
  return function renderProfile(gpx, data) {
    const { points, samples, min, max, total, cells, steep, heartRate } = data;
    const climbs = data.climbs || [];
    const width = 600;
    const height = 100;
    const curve = profileSamples(samples, width);
    const sampleIndex = createPointIndex(samples);
    const span = max - min || 1;
    const at = (distance) => (distance / Math.max(total, 1)) * width;
    const yOf = (elevation) => height - ((elevation - min) / span) * (height - 8) - 4;
    const heartSpan = heartRate ? Math.max(1, heartRate.max - heartRate.min) : 1;
    const heartYOf = heartRate
      ? (rate) => height - ((rate - heartRate.min) / heartSpan) * (height - 8) - 4
      : null;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const BUCKETS = 24;
    const bucketOf = (slope) => Math.round(
      Math.max(0, Math.min(SLOPE_FULL, Math.abs(slope))) / (SLOPE_FULL / BUCKETS),
    );
    const defs = document.createElementNS(ns, 'defs');
    svg.append(defs);
    const fillRuns = [];
    for (const cell of cells) {
      const bucket = bucketOf(cell.slope);
      const previous = fillRuns[fillRuns.length - 1];
      if (previous && previous.bucket === bucket) previous.to = cell.to;
      else fillRuns.push({ bucket, from: cell.from, to: cell.to });
    }
    const fillGradient = document.createElementNS(ns, 'linearGradient');
    fillGradient.setAttribute('id', 'slope-fill');
    fillGradient.setAttribute('gradientUnits', 'userSpaceOnUse');
    fillGradient.setAttribute('x1', '0');
    fillGradient.setAttribute('x2', String(width));
    fillGradient.setAttribute('y1', '0');
    fillGradient.setAttribute('y2', '0');
    let previousColour = null;
    const addStop = (x, colour) => {
      const stop = document.createElementNS(ns, 'stop');
      stop.setAttribute('offset', String(Math.min(1, Math.max(0, x / width))));
      stop.setAttribute('stop-color', colour);
      fillGradient.append(stop);
    };
    for (const run of fillRuns) {
      const left = at(run.from);
      const right = at(run.to);
      const colour = slopeColor((run.bucket * SLOPE_FULL) / BUCKETS);
      if (previousColour) addStop(left, previousColour);
      else addStop(0, colour);
      addStop(right, colour);
      previousColour = colour;
    }
    if (fillRuns.length === 0) addStop(0, slopeColor(0));
    defs.append(fillGradient);

    const area = document.createElementNS(ns, 'path');
    area.setAttribute('class', 'area');
    area.setAttribute('fill', 'url(#slope-fill)');
    area.setAttribute('d', `M0,${height} L`
      + curve.map((point) => `${at(point.along).toFixed(1)},${yOf(point.ele).toFixed(1)}`).join(' L')
      + ` L${width},${height} Z`);
    svg.append(area);

    const gridGroup = document.createElementNS(ns, 'g');
    gridGroup.setAttribute('class', 'distance-grid');
    for (const fraction of [0.25, 0.5, 0.75]) {
      const tickLine = document.createElementNS(ns, 'line');
      tickLine.setAttribute('class', 'distance-grid-line');
      tickLine.setAttribute('x1', (width * fraction).toFixed(1));
      tickLine.setAttribute('x2', (width * fraction).toFixed(1));
      tickLine.setAttribute('y1', '0');
      tickLine.setAttribute('y2', String(height));
      gridGroup.append(tickLine);
    }
    svg.append(gridGroup);

    const line = document.createElementNS(ns, 'path');
    line.setAttribute('class', 'line');
    line.setAttribute('d', `M${curve.map((point) => `${at(point.along).toFixed(1)},${yOf(point.ele).toFixed(1)}`).join(' L')}`);
    svg.append(line);

    const splitFocusCasing = document.createElementNS(ns, 'path');
    splitFocusCasing.setAttribute('class', 'split-focus-casing');
    splitFocusCasing.style.display = 'none';
    const splitFocusLine = document.createElementNS(ns, 'path');
    splitFocusLine.setAttribute('class', 'split-focus-line');
    splitFocusLine.style.display = 'none';
    svg.append(splitFocusCasing, splitFocusLine);

    let heartGroup = null;
    if (heartRate) {
      heartGroup = document.createElementNS(ns, 'g');
      heartGroup.setAttribute('class', 'heart-rate-layer');
      for (const segment of heartRate.segments) {
        const values = seriesSamples(segment, width, (point) => point.heartRate);
        if (values.length < 2) continue;
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('class', 'heart-line');
        path.setAttribute('d', values.map((point, index) => `${index === 0 ? 'M' : 'L'}`
          + `${at(point.along).toFixed(1)},${heartYOf(point.heartRate).toFixed(1)}`).join(' '));
        heartGroup.append(path);
      }
      const averageLine = document.createElementNS(ns, 'line');
      averageLine.setAttribute('class', 'heart-average-line');
      averageLine.setAttribute('x1', '0');
      averageLine.setAttribute('x2', String(width));
      averageLine.setAttribute('y1', heartYOf(heartRate.average).toFixed(1));
      averageLine.setAttribute('y2', heartYOf(heartRate.average).toFixed(1));
      heartGroup.append(averageLine);
      heartGroup.style.display = 'none';
      svg.append(heartGroup);
    }

    const guide = el('div', 'guide');
    const dot = el('div', 'dot');
    const heartDot = el('div', 'heart-dot');
    guide.hidden = true;
    dot.hidden = true;
    heartDot.hidden = true;
    const chart = el('div', 'chart');
    let splitFocusData = null;
    const splitFocus = el('div', 'split-focus');
    splitFocus.hidden = true;
    const splitDimLeft = el('div', 'split-focus-dim left');
    const splitDimRight = el('div', 'split-focus-dim right');
    const splitBand = el('div', 'split-focus-band');
    splitFocus.append(splitDimLeft, splitDimRight, splitBand);
    const brushStats = el('div', 'brush-stats');
    brushStats.hidden = true;
    const brushStatsText = el('span', 'brush-stats-text');
    let brushCropHandler = null;
    const brushStatsCrop = el('button', 'brush-stats-crop');
    brushStatsCrop.type = 'button';
    brushStatsCrop.hidden = true;
    brushStatsCrop.append(iconElement('editor-crop', { size: 12 }));
    localized(brushStatsCrop, () => t('profile.cropSelection'), 'title');
    localized(brushStatsCrop, () => t('profile.cropSelection'), 'aria-label');
    brushStatsCrop.addEventListener('click', (event) => {
      event.stopPropagation();
      if (splitFocusData) brushCropHandler?.(splitFocusData.from, splitFocusData.to);
    });
    const brushStatsClose = el('button', 'brush-stats-close');
    brushStatsClose.type = 'button';
    brushStatsClose.append(iconElement('close', { size: 11 }));
    localized(brushStatsClose, () => t('profile.brushClear'), 'title');
    localized(brushStatsClose, () => t('profile.brushClear'), 'aria-label');
    brushStats.append(brushStatsText, brushStatsCrop, brushStatsClose);
    brushStats.addEventListener('pointerdown', (event) => event.stopPropagation());
    let brushClearHandler = null;
    brushStatsClose.addEventListener('click', (event) => {
      event.stopPropagation();
      brushClearHandler?.();
    });
    chart.append(svg, splitFocus, heartDot);

    let heartAxis = null;
    let heartAverage = null;
    if (heartRate) {
      heartAxis = el('div', 'heart-axis');
      heartAxis.append(
        localized(el('span', 'top'), () => `${heartRate.max} bpm`),
        localized(el('span', 'bottom'), () => `${heartRate.min} bpm`),
      );
      heartAxis.hidden = true;
      chart.append(heartAxis);
      heartAverage = localized(el('span', 'heart-average'), () =>
        t('profile.heartRateAverage', { rate: Math.round(heartRate.average) }));
      heartAverage.style.top = `${(heartYOf(heartRate.average) / height) * 100}%`;
      heartAverage.hidden = true;
      chart.append(heartAverage);
    }

    const gutter = el('div', 'gutter');
    gutter.append(
      localized(el('span', 'axis top'), () => `${Math.round(max)} ${t('unit.m')}`),
      localized(el('span', 'axis bottom'), () => `${Math.round(min)} ${t('unit.m')}`),
    );
    const plot = el('div', 'plot');
    plot.append(gutter, chart);

    const pins = [];
    const placedPins = [];
    const denseWaypoints = (gpx.waypoints?.length || 0) > 100;
    for (const waypoint of gpx.waypoints || []) {
      const near = sampleIndex.nearest(waypoint);
      const hasPhoto = photosOf(waypoint).length > 0;
      const across = near.along / Math.max(total, 1);
      const x = across * width;
      const y = yOf(near.ele);
      if (denseWaypoints && !hasPhoto
        && placedPins.some((other) => Math.hypot(other.x - x, other.y - y) < 4)) continue;
      placedPins.push({ x, y });
      const pin = el('span', hasPhoto ? 'pin photo' : 'pin');
      pin.style.left = `${across * 100}%`;
      pin.style.top = `${(yOf(near.ele) / height) * 100}%`;
      pin.hidden = !getPinsShown();
      localized(pin, () => waypoint.name || t('label.waypoint'), 'title');
      pins.push({ node: pin, point: waypoint });
      chart.append(pin);
    }
    setPins(pins);

    const highest = samples.reduce((best, sample) => (sample.ele > best.ele ? sample : best), samples[0]);
    const lowest = samples.reduce((best, sample) => (sample.ele < best.ele ? sample : best), samples[0]);
    /** @type {Array<[import('./types.js').ElevationSample, 'high' | 'low']>} */
    const extrema = [[highest, 'high'], [lowest, 'low']];
    for (const [sample, kind] of extrema) {
      const tag = localized(el('span', `extremum ${kind}`),
        () => t(kind === 'high' ? 'profile.high' : 'profile.low'), 'title');
      tag.append(el('b', '', `${Math.round(sample.ele)} ${t('unit.m')}`));
      const across = sample.along / Math.max(total, 1);
      const down = yOf(sample.ele) / height;
      tag.style.left = `${(across * 100).toFixed(2)}%`;
      if (across < 0.05) tag.classList.add('left');
      else if (across > 0.95) tag.classList.add('right');
      if (kind === 'high' && down < 0.2) tag.classList.add('below');
      else if (kind === 'low' && down > 0.82) tag.classList.add('above');
      tag.style.top = `${(down * 100).toFixed(2)}%`;
      chart.append(tag);
    }

    chart.append(guide, dot);
    const value = el('b', 'ele');
    const heartRateValue = el('b', 'heart');
    const meta = el('span', 'meta');
    const readout = el('span', 'readout');
    heartRateValue.hidden = true;
    readout.append(value, heartRateValue, meta);
    readout.hidden = true;
    chart.append(readout);

    const label = el('div', 'label');
    label.append(localized(el('span', 'range'), () => t('profile.title')));
    let heartEnabled = false;
    let heartToggle = null;
    if (heartRate) {
      heartToggle = el('button', 'profile-heart-toggle');
      heartToggle.type = 'button';
      heartToggle.dataset.profileHeart = 'toggle';
      heartToggle.setAttribute('aria-pressed', 'false');
      const title = () => t(heartEnabled ? 'profile.heartRateHide' : 'profile.heartRateShow');
      localized(heartToggle, title, 'title');
      localized(heartToggle, title, 'aria-label');
      heartToggle.append(
        iconElement('heart', { size: 12, className: 'profile-heart-icon' }),
        localized(el('span'), () => t('profile.heartRate')),
      );
      label.append(heartToggle);
    }
    function focusBadgeText() {
      if (!splitFocusData) return '';
      const range = `${formatKmMark(splitFocusData.from)}\u2013${formatKmMark(splitFocusData.to)} ${t('unit.km')}`;
      if (splitFocusData.kind === 'climb') {
        return t('profile.climbLabel', { index: splitFocusData.index, range });
      }
      if (splitFocusData.kind === 'brush') return range;
      return t('profile.splitFocus', { index: splitFocusData.index, range });
    }
    const splitBadge = localized(el('span', 'split-focus-badge'), focusBadgeText);
    splitBadge.hidden = true;
    label.append(splitBadge);

    let climbsOpen = false;
    let activeClimbIndex = null;
    let climbSelectHandler = null;
    let climbToggle = null;
    let climbDrawer = null;
    const climbChips = new Map();
    if (climbs.length > 0) {
      climbToggle = el('button', 'profile-climbs-toggle');
      climbToggle.type = 'button';
      climbToggle.dataset.profileClimbs = 'toggle';
      climbToggle.setAttribute('aria-expanded', 'false');
      localized(climbToggle, () => t('profile.climbsTitle'), 'title');
      localized(climbToggle, () => t('profile.climbsTitle'), 'aria-label');
      climbToggle.append(
        iconElement('route', { size: 12 }),
        localized(el('span'), () => t('profile.climbs', { count: climbs.length })),
      );
      label.append(climbToggle);
    }

    let noteOff = false;
    let noteVe = 3;
    const scaleNote = localized(el('span', 'scale'), () => (noteOff
      ? t('profile.scale', { n: noteVe >= 10 ? String(Math.round(noteVe)) : noteVe.toFixed(1) })
      : ''));
    scaleNote.hidden = true;
    let collapsed = false;
    const collapseButton = el('button', 'profile-collapse-toggle');
    collapseButton.type = 'button';
    collapseButton.dataset.profileCollapse = 'toggle';
    collapseButton.setAttribute('aria-expanded', 'true');
    const collapseTitle = () => t(collapsed ? 'profile.expandTitle' : 'profile.collapseTitle');
    localized(collapseButton, collapseTitle, 'title');
    localized(collapseButton, collapseTitle, 'aria-label');
    collapseButton.append(iconElement('chevron-down', { size: 12, className: 'profile-collapse-icon' }));
    label.append(scaleNote, collapseButton);

    function setHeartEnabled(enabled) {
      if (!heartRate || !heartGroup || !heartAxis || !heartToggle) return;
      heartEnabled = enabled;
      heartGroup.style.display = enabled ? '' : 'none';
      heartAxis.hidden = !enabled;
      heartAverage.hidden = !enabled;
      heartDot.hidden = true;
      heartRateValue.hidden = true;
      heartToggle.classList.toggle('active', enabled);
      heartToggle.setAttribute('aria-pressed', String(enabled));
      const title = t(enabled ? 'profile.heartRateHide' : 'profile.heartRateShow');
      heartToggle.title = title;
      heartToggle.setAttribute('aria-label', title);
    }

    if (heartToggle) {
      heartToggle.addEventListener('click', () => setHeartEnabled(!heartEnabled));
    }

    const formatQuarterDistance = (meters) => {
      if (meters < 1000) return `${Math.round(meters)} ${t('unit.m')}`;
      const km = meters / 1000;
      return `${km >= 100 ? Math.round(km) : km.toFixed(1)} ${t('unit.km')}`;
    };
    const distanceAxis = el('div', 'distance-axis');
    distanceAxis.setAttribute('aria-hidden', 'true');
    for (const fraction of [0.25, 0.5, 0.75]) {
      const tick = localized(el('span', 'distance-tick'), () => formatQuarterDistance(total * fraction));
      tick.style.left = `${fraction * 100}%`;
      distanceAxis.append(tick);
    }

    const box = document.getElementById('profile');
    if (climbs.length > 0) {
      climbDrawer = el('div', 'climb-drawer');
      climbDrawer.hidden = true;
      climbDrawer.addEventListener('wheel', (event) => {
        if (climbDrawer.scrollWidth <= climbDrawer.clientWidth) return;
        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        climbDrawer.scrollLeft += delta;
      }, { passive: false });
      let dragPointerId = null;
      let dragStartX = 0;
      let dragStartScroll = 0;
      let dragged = false;
      let suppressClick = false;
      climbDrawer.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.pointerType === 'touch') return;
        event.stopPropagation();
        dragPointerId = event.pointerId;
        dragStartX = event.clientX;
        dragStartScroll = climbDrawer.scrollLeft;
        dragged = false;
        suppressClick = false;
      });
      window.addEventListener('pointermove', (event) => {
        if (event.pointerId !== dragPointerId) return;
        const dx = event.clientX - dragStartX;
        if (!dragged && Math.abs(dx) < 4) return;
        if (!dragged) {
          dragged = true;
          climbDrawer.classList.add('dragging');
        }
        climbDrawer.scrollLeft = dragStartScroll - dx;
      });
      const finishDrawerDrag = (event) => {
        if (event.pointerId !== dragPointerId) return;
        dragPointerId = null;
        climbDrawer.classList.remove('dragging');
        if (dragged) {
          suppressClick = true;
          dragged = false;
          setTimeout(() => { suppressClick = false; }, 0);
        }
      };
      window.addEventListener('pointerup', finishDrawerDrag);
      window.addEventListener('pointercancel', finishDrawerDrag);
      climbDrawer.addEventListener('click', (event) => {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      }, true);
      for (const climb of climbs) {
        const chip = el('button', 'climb-chip');
        chip.type = 'button';
        chip.dataset.climbIndex = String(climb.index);
        chip.setAttribute('aria-pressed', 'false');
        const chipParams = () => ({
          index: climb.index,
          length: formatDistance(climb.lengthMeters),
          ascent: Math.round(climb.ascent),
          avg: (climb.avgGrade * 100).toFixed(1),
          max: Math.round(climb.maxGrade * 100),
        });
        localized(chip, () => t('profile.climbTooltip', chipParams()), 'title');
        localized(chip, () => t('profile.climbTooltip', chipParams()), 'aria-label');
        chip.append(
          el('span', 'climb-chip-index', `#${climb.index}`),
          localized(el('span', 'climb-chip-meta'), () => t('profile.climbMeta', chipParams())),
        );
        chip.addEventListener('click', () => {
          const next = activeClimbIndex === climb.index ? null : climb;
          climbSelectHandler?.(next);
        });
        climbChips.set(climb.index, chip);
        climbDrawer.append(chip);
      }
      climbToggle.addEventListener('click', () => {
        climbsOpen = !climbsOpen;
        climbDrawer.hidden = !climbsOpen;
        climbToggle.classList.toggle('active', climbsOpen);
        climbToggle.setAttribute('aria-expanded', String(climbsOpen));
        document.documentElement.style.setProperty('--profile-height', `${box.offsetHeight}px`);
        onLayoutChange?.();
      });
      box.append(label, climbDrawer, gradeLegend(steep), plot, distanceAxis);
    } else {
      box.append(label, gradeLegend(steep), plot, distanceAxis);
    }
    box.append(brushStats);
    box.classList.remove('collapsed');
    box.hidden = false;
    document.body.classList.add('with-profile');

    function setCollapsed(next) {
      collapsed = Boolean(next);
      box.classList.toggle('collapsed', collapsed);
      collapseButton.setAttribute('aria-expanded', String(!collapsed));
      const title = collapseTitle();
      collapseButton.title = title;
      collapseButton.setAttribute('aria-label', title);
      if (collapsed) brushStats.hidden = true;
      document.documentElement.style.setProperty('--profile-height', `${box.offsetHeight}px`);
      if (!collapsed) fit();
      onLayoutChange?.();
    }
    collapseButton.addEventListener('click', () => setCollapsed(!collapsed));

    const MIN_PLOT = 56;
    const MAX_PLOT = 128;
    const TARGET_VE = 3;
    const MIN_SPLIT_BAND_PX = 8;

    function setActiveClimb(index) {
      activeClimbIndex = index ?? null;
      for (const [candidate, chip] of climbChips.entries()) {
        const active = candidate === activeClimbIndex;
        chip.classList.toggle('active', active);
        chip.setAttribute('aria-pressed', String(active));
      }
    }

    function positionSplitFocus() {
      if (!splitFocusData) return;
      const { from, to } = splitFocusData;
      const chartWidth = chart.getBoundingClientRect().width;
      const startRatio = Math.min(1, Math.max(0, from / Math.max(total, 1)));
      const endRatio = Math.min(1, Math.max(0, to / Math.max(total, 1)));
      if (chartWidth > 0) {
        const rawLeft = startRatio * chartWidth;
        const rawRight = endRatio * chartWidth;
        const bandWidth = Math.min(chartWidth, Math.max(rawRight - rawLeft, MIN_SPLIT_BAND_PX));
        const center = (rawLeft + rawRight) / 2;
        const bandLeft = Math.max(0, Math.min(chartWidth - bandWidth, center - bandWidth / 2));
        const bandRight = bandLeft + bandWidth;
        splitDimLeft.style.width = `${bandLeft.toFixed(2)}px`;
        splitDimRight.style.left = `${bandRight.toFixed(2)}px`;
        splitBand.style.left = `${bandLeft.toFixed(2)}px`;
        splitBand.style.width = `${bandWidth.toFixed(2)}px`;
        if (!brushStats.hidden) {
          const boxRect = box.getBoundingClientRect();
          const chartRect = chart.getBoundingClientRect();
          const statsWidth = brushStats.offsetWidth;
          const localX = Math.max(4, Math.min(chartWidth - statsWidth - 4, center - statsWidth / 2));
          const x = (chartRect.left - boxRect.left) + localX;
          const y = (chartRect.top - boxRect.top) + 4;
          brushStats.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        }
      } else {
        splitDimLeft.style.width = `${(startRatio * 100).toFixed(4)}%`;
        splitDimRight.style.left = `${(endRatio * 100).toFixed(4)}%`;
        splitBand.style.left = `${(startRatio * 100).toFixed(4)}%`;
        splitBand.style.width = `${((endRatio - startRatio) * 100).toFixed(4)}%`;
      }
    }

    function clearBrushStats() {
      brushStats.hidden = true;
      brushStatsText.textContent = '';
      brushClearHandler = null;
    }

    function clearSplitFocus() {
      splitFocusData = null;
      splitFocus.hidden = true;
      splitBadge.hidden = true;
      splitBadge.textContent = '';
      splitFocusCasing.style.display = 'none';
      splitFocusLine.style.display = 'none';
      splitFocusCasing.removeAttribute('d');
      splitFocusLine.removeAttribute('d');
      clearBrushStats();
      setActiveClimb(null);
    }

    function applyRangeFocus({ fromMeters, toMeters, kind = 'split', index = 0, statsText = '', onClear = null }) {
      const from = Math.max(0, Math.min(total, Number(fromMeters) || 0));
      const to = Math.max(0, Math.min(total, Number(toMeters) || 0));
      const sliced = sliceCurveByDistance(curve, from, to);
      if (!(to > from) || sliced.length < 2) {
        clearSplitFocus();
        return;
      }
      splitFocusData = { kind, index, from, to };
      const d = `M${sliced.map((point) => `${at(point.along).toFixed(1)},${yOf(point.ele).toFixed(1)}`).join(' L')}`;
      splitFocusCasing.setAttribute('d', d);
      splitFocusLine.setAttribute('d', d);
      splitFocusCasing.style.display = '';
      splitFocusLine.style.display = '';
      splitBadge.textContent = focusBadgeText();
      splitBadge.hidden = false;
      splitFocus.hidden = false;
      if (statsText) {
        brushStatsText.textContent = statsText;
        brushClearHandler = onClear;
        brushStatsCrop.hidden = !(splitFocusData.kind === 'brush' && brushCropHandler);
        brushStats.hidden = false;
      } else {
        clearBrushStats();
      }
      positionSplitFocus();
    }

    function setSplitFocus(split) {
      if (!split) {
        clearSplitFocus();
        return;
      }
      setActiveClimb(null);
      applyRangeFocus({
        fromMeters: split.fromMeters,
        toMeters: split.toMeters,
        kind: 'split',
        index: split.index,
      });
    }

    function setBrushFocus(range, statsText, onClear) {
      if (!range) {
        clearSplitFocus();
        return;
      }
      setActiveClimb(null);
      applyRangeFocus({
        fromMeters: range.fromMeters,
        toMeters: range.toMeters,
        kind: 'brush',
        statsText,
        onClear,
      });
    }

    function setClimbFocus(climb, statsText, onClear) {
      if (!climb) {
        clearSplitFocus();
        return;
      }
      setActiveClimb(climb.index);
      applyRangeFocus({
        fromMeters: climb.fromMeters,
        toMeters: climb.toMeters,
        kind: 'climb',
        index: climb.index,
        statsText,
        onClear,
      });
    }

    function fit() {
      if (!box.offsetParent) return;
      const chartWidth = chart.getBoundingClientRect().width;
      if (chartWidth < 60) return;
      const ceiling = Math.max(MIN_PLOT, Math.min(MAX_PLOT, Math.round(innerHeight * 0.18)));
      const wanted = Math.round((TARGET_VE * span * chartWidth) / Math.max(total, 1));
      const plotHeight = Math.min(ceiling, Math.max(MIN_PLOT, wanted));
      plot.style.height = `${plotHeight}px`;
      const ve = (plotHeight * 0.92) / span / (chartWidth / Math.max(total, 1));
      noteVe = ve;
      noteOff = ve < 2 || ve > 4;
      scaleNote.hidden = !noteOff;
      scaleNote.textContent = noteOff
        ? t('profile.scale', { n: ve >= 10 ? String(Math.round(ve)) : ve.toFixed(1) })
        : '';
      document.documentElement.style.setProperty('--profile-height', `${box.offsetHeight}px`);
      positionSplitFocus();
    }

    let refitFrame = 0;
    addEventListener('resize', () => {
      if (refitFrame) return;
      refitFrame = requestAnimationFrame(() => {
        refitFrame = 0;
        fit();
      });
    });
    fit();

    return {
      points,
      samples,
      total,
      svg,
      plot,
      chart,
      guide,
      dot,
      readout,
      value,
      meta,
      yOf,
      heart: heartRate ? {
        data: heartRate,
        yOf: heartYOf,
        enabled: () => heartEnabled,
        setEnabled: setHeartEnabled,
        dot: heartDot,
        value: heartRateValue,
      } : null,
      box,
      climbs,
      pins,
      refit: fit,
      setSplitFocus,
      clearSplitFocus,
      setBrushFocus,
      setClimbFocus,
      setClimbHandler: (handler) => { climbSelectHandler = handler; },
      setBrushCropHandler: (handler) => { brushCropHandler = handler; },
      hasActiveRange: () => Boolean(splitFocusData && splitFocusData.kind !== 'split'),
      isCollapsed: () => collapsed,
      setCollapsed,
      toggleCollapsed: () => setCollapsed(!collapsed),
      refreshSplitFocus: positionSplitFocus,
    };
  };
}
