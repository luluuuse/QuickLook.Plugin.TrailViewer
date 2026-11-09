import {
  elevationAt,
  profileSamples,
  SLOPE_FULL,
  slopeColor,
  slopeScale,
} from './profile.js';
import { createPointIndex } from './spatial.js';

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
    const { points, samples, min, max, total, cells, steep } = data;
    const width = 600;
    const height = 100;
    const curve = profileSamples(samples, width);
    const sampleIndex = createPointIndex(samples);
    const span = max - min || 1;
    const at = (distance) => (distance / Math.max(total, 1)) * width;
    const yOf = (elevation) => height - ((elevation - min) / span) * (height - 8) - 4;

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
    let cursor = 0;
    let shape = null;
    let previousFill = null;
    let gradientId = 0;
    for (const cell of cells) {
      const bucket = bucketOf(cell.slope);
      if (!shape || shape.bucket !== bucket) {
        if (shape) emit(shape);
        shape = { bucket, from: cell.from, to: cell.to, points: [] };
      } else {
        shape.to = cell.to;
      }
      while (cursor < curve.length && curve[cursor].along <= cell.to) {
        if (curve[cursor].along > cell.from) shape.points.push([curve[cursor].along, curve[cursor].ele]);
        cursor += 1;
      }
      shape.to = cell.to;
    }
    if (shape) emit(shape);

    function emit(part) {
      const left = Math.max(0, at(part.from) - 0.5);
      const right = Math.min(width, at(part.to) + 0.5);
      const colour = slopeColor((part.bucket * SLOPE_FULL) / BUCKETS);
      let fill = colour;
      if (previousFill && previousFill !== colour && right - left > 0.8) {
        const ramp = document.createElementNS(ns, 'linearGradient');
        const id = `slope-${gradientId += 1}`;
        ramp.setAttribute('id', id);
        ramp.setAttribute('gradientUnits', 'userSpaceOnUse');
        ramp.setAttribute('x1', left.toFixed(2));
        ramp.setAttribute('x2', right.toFixed(2));
        ramp.setAttribute('y1', '0');
        ramp.setAttribute('y2', '0');
        for (const [offset, stop] of [[0, previousFill], [1, colour]]) {
          const node = document.createElementNS(ns, 'stop');
          node.setAttribute('offset', String(offset));
          node.setAttribute('stop-color', stop);
          ramp.append(node);
        }
        defs.append(ramp);
        fill = `url(#${id})`;
      }
      const area = document.createElementNS(ns, 'path');
      area.setAttribute('class', 'area');
      area.setAttribute('fill', fill);
      area.setAttribute('d', `M${left.toFixed(1)},${height} L`
        + `${at(part.from).toFixed(1)},${yOf(elevationAt(samples, part.from)).toFixed(1)} L`
        + part.points.map(([along, elevation]) => `${at(along).toFixed(1)},${yOf(elevation).toFixed(1)}`).join(' L')
        + ` L${right.toFixed(1)},${yOf(elevationAt(samples, part.to)).toFixed(1)} L${right.toFixed(1)},${height} Z`);
      svg.append(area);
      previousFill = colour;
    }

    const line = document.createElementNS(ns, 'path');
    line.setAttribute('class', 'line');
    line.setAttribute('d', `M${curve.map((point) => `${at(point.along).toFixed(1)},${yOf(point.ele).toFixed(1)}`).join(' L')}`);
    svg.append(line);

    const guide = el('div', 'guide');
    const dot = el('div', 'dot');
    guide.hidden = true;
    dot.hidden = true;
    const chart = el('div', 'chart');
    chart.append(svg);

    const gutter = el('div', 'gutter');
    gutter.append(
      localized(el('span', 'axis top'), () => `${Math.round(max)} ${t('unit.m')}`),
      localized(el('span', 'axis bottom'), () => `${Math.round(min)} ${t('unit.m')}`),
    );
    const plot = el('div', 'plot');
    plot.append(gutter, chart);

    const pins = [];
    for (const waypoint of gpx.waypoints || []) {
      const near = sampleIndex.nearest(waypoint);
      const pin = el('span', photosOf(waypoint).length > 0 ? 'pin photo' : 'pin');
      pin.style.left = `${(near.along / Math.max(total, 1)) * 100}%`;
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
    const meta = el('span', 'meta');
    const readout = el('span', 'readout');
    readout.append(value, meta);
    readout.hidden = true;
    chart.append(readout);

    const label = el('div', 'label');
    label.append(localized(el('span', 'range'), () => t('profile.title')));
    let noteOff = false;
    let noteVe = 3;
    const scaleNote = localized(el('span', 'scale'), () => (noteOff
      ? t('profile.scale', { n: noteVe >= 10 ? String(Math.round(noteVe)) : noteVe.toFixed(1) })
      : ''));
    scaleNote.hidden = true;
    label.append(scaleNote);

    const box = document.getElementById('profile');
    box.append(label, gradeLegend(steep), plot);
    box.hidden = false;
    document.body.classList.add('with-profile');

    const MIN_PLOT = 56;
    const MAX_PLOT = 128;
    const TARGET_VE = 3;
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
      pins,
      refit: fit,
    };
  };
}
