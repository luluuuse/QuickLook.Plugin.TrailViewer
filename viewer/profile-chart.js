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
  photosOf,
  getPinsShown,
  setPins,
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
    const splitBadge = localized(el('span', 'split-focus-badge'), () => (
      splitFocusData
        ? t('profile.splitFocus', {
          index: splitFocusData.index,
          range: `${formatKmMark(splitFocusData.from)}\u2013${formatKmMark(splitFocusData.to)} ${t('unit.km')}`,
        })
        : ''
    ));
    splitBadge.hidden = true;
    label.append(splitBadge);
    let noteOff = false;
    let noteVe = 3;
    const scaleNote = localized(el('span', 'scale'), () => (noteOff
      ? t('profile.scale', { n: noteVe >= 10 ? String(Math.round(noteVe)) : noteVe.toFixed(1) })
      : ''));
    scaleNote.hidden = true;
    label.append(scaleNote);

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

    const box = document.getElementById('profile');
    box.append(label, gradeLegend(steep), plot);
    box.hidden = false;
    document.body.classList.add('with-profile');

    const MIN_PLOT = 56;
    const MAX_PLOT = 128;
    const TARGET_VE = 3;
    const MIN_SPLIT_BAND_PX = 8;

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
      } else {
        splitDimLeft.style.width = `${(startRatio * 100).toFixed(4)}%`;
        splitDimRight.style.left = `${(endRatio * 100).toFixed(4)}%`;
        splitBand.style.left = `${(startRatio * 100).toFixed(4)}%`;
        splitBand.style.width = `${((endRatio - startRatio) * 100).toFixed(4)}%`;
      }
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
    }

    function setSplitFocus(split) {
      if (!split) {
        clearSplitFocus();
        return;
      }
      const from = Math.max(0, Math.min(total, Number(split.fromMeters) || 0));
      const to = Math.max(0, Math.min(total, Number(split.toMeters) || 0));
      const sliced = sliceCurveByDistance(curve, from, to);
      if (!(to > from) || sliced.length < 2) {
        clearSplitFocus();
        return;
      }
      splitFocusData = { index: split.index, from, to };
      const d = `M${sliced.map((point) => `${at(point.along).toFixed(1)},${yOf(point.ele).toFixed(1)}`).join(' L')}`;
      splitFocusCasing.setAttribute('d', d);
      splitFocusLine.setAttribute('d', d);
      splitFocusCasing.style.display = '';
      splitFocusLine.style.display = '';
      splitBadge.textContent = t('profile.splitFocus', {
        index: splitFocusData.index,
        range: `${formatKmMark(from)}\u2013${formatKmMark(to)} ${t('unit.km')}`,
      });
      splitBadge.hidden = false;
      splitFocus.hidden = false;
      positionSplitFocus();
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
      pins,
      refit: fit,
      setSplitFocus,
      clearSplitFocus,
      refreshSplitFocus: positionSplitFocus,
    };
  };
}
