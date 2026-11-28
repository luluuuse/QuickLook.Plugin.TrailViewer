import { analyse } from './profile.js';
import { detectClimbs, summariseRange } from './climb-analysis.js';
import { createProfileChart } from './profile-chart.js';
import { isValidHeartRate } from './track-analysis.js';
import { createRouteModel } from './route-model.js';

function trackPoints(model) {
  const points = [];
  let segmentIndex = 0;
  for (const line of model.tracks) {
    for (let index = 0; index < line.points.length; index += 1) {
      const point = line.points[index];
      points.push({
        along: line.startMeters + line.cumulative[index],
        lat: point.lat,
        lon: point.lon,
        ele: point.ele,
        time: point.time,
        heartRate: point.heartRate,
        segmentIndex,
      });
    }
    segmentIndex += 1;
  }
  return points;
}

export function heartRateData(points) {
  const segments = [];
  let run = [];
  let segmentIndex = -1;
  const flush = () => {
    if (run.length >= 2) segments.push(run);
    run = [];
  };
  for (const point of points) {
    if (point.segmentIndex !== segmentIndex) {
      flush();
      segmentIndex = point.segmentIndex;
    }
    const rate = point.heartRate;
    if (!isValidHeartRate(rate)) {
      flush();
      continue;
    }
    run.push({ along: point.along, heartRate: rate });
  }
  flush();
  let count = 0;
  let dataMin = Infinity;
  let dataMax = -Infinity;
  let total = 0;
  for (const segment of segments) {
    for (const point of segment) {
      count += 1;
      total += point.heartRate;
      if (point.heartRate < dataMin) dataMin = point.heartRate;
      if (point.heartRate > dataMax) dataMax = point.heartRate;
    }
  }
  if (count < 2) return null;
  const average = total / count;
  const spread = Math.max(10, dataMax - dataMin);
  const min = Math.max(0, Math.floor((dataMin - Math.max(5, spread * 0.08)) / 10) * 10);
  const max = Math.max(min + 10, Math.ceil((dataMax + Math.max(5, spread * 0.08)) / 10) * 10);
  return { segments, min, max, dataMin, dataMax, average, count };
}

function pointNear(points, distance) {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (points[middle].along <= distance) low = middle;
    else high = middle - 1;
  }
  return points[low];
}

function attachScrub({
  L,
  map,
  state,
  formatters,
  formatDistance,
  formatSpeed,
  formatTimer,
  t,
  getStops,
  focusStop,
  revealPoint,
  onHighlight,
  onRangeSelect,
  onCropRange,
  isEditingSuspended = () => false,
}) {
  const { points, samples, total, svg, plot, chart, guide, dot, readout, value, meta, yOf, heart, box } = state;
  const marker = L.circleMarker([0, 0], {
    radius: 7,
    color: '#1b1b1b',
    weight: 1.5,
    fillColor: '#e5243b',
    fillOpacity: 1,
    interactive: false,
    className: 'scrub-marker',
  });
  const HOVER_REVEAL_DELAY_MS = 200;
  const HOVER_HORIZONTAL_ARM_PX = 28;
  const HOVER_HORIZONTAL_RATIO = 2.2;
  let pinned = false;
  let onMap = false;
  let current = null;
  let frame = 0;
  let queued = null;
  let hoverRevealArmed = false;
  let hoverRevealTimer = 0;
  let lastHoverPos = null;
  let hoverTravelX = 0;
  let hoverTravelY = 0;
  let chartRect = chart.getBoundingClientRect();
  let readoutKey = '';
  let readoutWidth = 0;
  let readoutHeight = 0;

  function resetHoverGate() {
    if (hoverRevealTimer) {
      clearTimeout(hoverRevealTimer);
      hoverRevealTimer = 0;
    }
    hoverRevealArmed = false;
    lastHoverPos = null;
    hoverTravelX = 0;
    hoverTravelY = 0;
  }

  function updateHoverGate(clientX, clientY) {
    if (hoverRevealArmed) return;
    if (!lastHoverPos) {
      lastHoverPos = { x: clientX, y: clientY };
      hoverRevealTimer = setTimeout(() => {
        hoverRevealTimer = 0;
        if (drag || pinned || !current) return;
        hoverRevealArmed = true;
        revealPoint?.([current.lat, current.lon], { remember: false });
      }, HOVER_REVEAL_DELAY_MS);
      return;
    }
    hoverTravelX += Math.abs(clientX - lastHoverPos.x);
    hoverTravelY += Math.abs(clientY - lastHoverPos.y);
    lastHoverPos = { x: clientX, y: clientY };
    if (hoverTravelX >= HOVER_HORIZONTAL_ARM_PX
      && hoverTravelX >= hoverTravelY * HOVER_HORIZONTAL_RATIO) {
      if (hoverRevealTimer) {
        clearTimeout(hoverRevealTimer);
        hoverRevealTimer = 0;
      }
      hoverRevealArmed = true;
    }
  }

  function measureChart() {
    chartRect = chart.getBoundingClientRect();
  }

  const chartResize = typeof ResizeObserver === 'function'
    ? new ResizeObserver(measureChart)
    : null;
  chartResize?.observe(chart);
  addEventListener('resize', measureChart);

  for (const pin of state.pins || []) {
    pin.node.addEventListener('click', (event) => {
      event.stopPropagation();
      const stops = getStops();
      const index = stops.findIndex((stop) => stop.point === pin.point);
      if (index < 0) return;
      focusStop(index);
      const stop = stops[index];
      if (!stop.marker.isPopupOpen()) stop.marker.openPopup();
    });
  }

  function distanceAt(clientX) {
    const ratio = chartRect.width > 0 ? (clientX - chartRect.left) / chartRect.width : 0;
    return Math.min(total, Math.max(0, ratio * total));
  }

  function place(distance, { reveal = true } = {}) {
    const point = pointNear(points, Math.max(0, Math.min(total, distance)));
    current = point;
    const x = (point.along / total) * chartRect.width;
    guide.style.transform = `translate3d(${x}px, 0, 0)`;
    guide.hidden = false;
    let y = chartRect.height - 6;
    if (point.ele !== undefined) {
      y = (yOf(point.ele) / 100) * chartRect.height;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      dot.hidden = false;
    } else {
      dot.hidden = true;
    }
    if (heart?.enabled() && Number.isFinite(point.heartRate)) {
      const heartY = (heart.yOf(point.heartRate) / 100) * chartRect.height;
      heart.dot.style.transform = `translate3d(${x}px, ${heartY}px, 0)`;
      heart.dot.hidden = false;
      heart.value.hidden = false;
    } else if (heart) {
      heart.dot.hidden = true;
      heart.value.hidden = true;
    }

    const valueText = point.ele !== undefined ? `${Math.round(point.ele)} ${t('unit.m')}` : '';
    const parts = [formatDistance(point.along)];
    if (point.time) parts.push(formatters().time.format(point.time));
    const metaText = parts.join(' \u00b7 ');
    const heartText = heart?.enabled() && Number.isFinite(point.heartRate)
      ? `${Math.round(point.heartRate)} bpm`
      : '';
    const nextReadoutKey = `${valueText}\u0000${metaText}\u0000${heartText}`;
    readout.hidden = false;
    if (nextReadoutKey !== readoutKey) {
      value.textContent = valueText;
      value.hidden = valueText === '';
      meta.textContent = metaText;
      if (heart) {
        heart.value.textContent = heartText;
        heart.value.hidden = heartText === '';
      }
      readoutWidth = readout.offsetWidth;
      readoutHeight = readout.offsetHeight;
      readoutKey = nextReadoutKey;
    }

    const half = readoutWidth / 2 + 2;
    const left = chartRect.width <= readoutWidth
      ? chartRect.width / 2
      : Math.min(Math.max(x, half), chartRect.width - half);
    const top = Math.max(0, y - readoutHeight - 12);
    readout.style.transform = `translate3d(${left}px, ${top}px, 0) translateX(-50%)`;

    const latlng = [point.lat, point.lon];
    marker.setLatLng(latlng);
    if (!onMap) {
      marker.addTo(map);
      onMap = true;
    }
    onHighlight?.(point.lat, point.lon);
    if (reveal) revealPoint?.(latlng, { remember: pinned });
  }

  function clear() {
    resetHoverGate();
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    queued = null;
    guide.hidden = true;
    dot.hidden = true;
    if (heart) heart.dot.hidden = true;
    if (heart) heart.value.hidden = true;
    readout.hidden = true;
    if (onMap) {
      marker.remove();
      onMap = false;
    }
    onHighlight?.(null, null);
    current = null;
  }

  function schedule(clientX, clientY) {
    updateHoverGate(clientX, clientY);
    queued = clientX;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (queued !== null) place(distanceAt(queued), { reveal: hoverRevealArmed });
      queued = null;
    });
  }

  function formatRangeStats(stats) {
    if (!stats) return '';
    const parts = [formatDistance(stats.distanceMeters)];
    if (stats.ascent !== null && stats.descent !== null) {
      parts.push(`+${stats.ascent} / -${stats.descent} ${t('unit.m')}`);
    }
    if (stats.avgGrade !== null) {
      const sign = stats.avgGrade > 0 ? '+' : '';
      parts.push(`${sign}${(stats.avgGrade * 100).toFixed(1)}%`);
    }
    if (stats.durationSeconds !== null) parts.push(formatTimer(stats.durationSeconds));
    if (stats.avgSpeedMps !== null) parts.push(formatSpeed(stats.avgSpeedMps));
    if (stats.avgHeartRate !== null) parts.push(`${stats.avgHeartRate} bpm`);
    return parts.join(' \u00b7 ');
  }

  let activeRange = null;
  function clearRange() {
    if (!activeRange && !state.hasActiveRange?.()) return;
    activeRange = null;
    state.clearSplitFocus();
    onRangeSelect?.(null);
  }

  state.setBrushCropHandler?.((fromMeters, toMeters) => {
    clearRange();
    onCropRange?.(fromMeters, toMeters);
  });

  state.setClimbHandler?.((climb) => {
    if (isEditingSuspended()) return;
    if (!climb) {
      clearRange();
      return;
    }
    const stats = summariseRange(points, samples, climb.fromMeters, climb.toMeters);
    activeRange = { fromMeters: climb.fromMeters, toMeters: climb.toMeters, source: 'climb', index: climb.index };
    state.setClimbFocus?.(climb, formatRangeStats(stats), clearRange);
    onRangeSelect?.({ ...climb, source: 'climb', focusMap: true });
  });

  let drag = null;
  function applyBrush(startDist, endDist, finalize) {
    const from = Math.min(startDist, endDist);
    const to = Math.max(startDist, endDist);
    const stats = summariseRange(points, samples, from, to);
    if (!stats) return false;
    activeRange = { fromMeters: stats.fromMeters, toMeters: stats.toMeters, source: 'brush' };
    state.setBrushFocus?.(stats, formatRangeStats(stats), clearRange);
    if (finalize) {
      onRangeSelect?.({ fromMeters: stats.fromMeters, toMeters: stats.toMeters, source: 'brush', focusMap: false });
    }
    return true;
  }

  const onWindowPointerMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = Math.abs(event.clientX - drag.startX);
    if (!drag.active && dx >= 6) {
      drag.active = true;
      pinned = false;
      plot.classList.remove('pinned');
      clear();
    }
    if (drag.active) {
      applyBrush(drag.startDist, distanceAt(event.clientX), false);
    }
  };

  const onWindowPointerUp = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const finished = drag;
    drag = null;
    removeEventListener('pointermove', onWindowPointerMove);
    removeEventListener('pointerup', onWindowPointerUp);
    removeEventListener('pointercancel', onWindowPointerUp);
    if (finished.active) {
      const endDist = distanceAt(event.clientX);
      if (Math.abs(event.clientX - finished.startX) >= 6 && applyBrush(finished.startDist, endDist, true)) {
        return;
      }
      clearRange();
      return;
    }
    if (event.type === 'pointercancel') return;
    place(distanceAt(event.clientX));
    pinned = !pinned;
    plot.classList.toggle('pinned', pinned);
  };

  const onDocumentPointerDown = (event) => {
    if (!state.hasActiveRange?.()) return;
    if (box && event.target instanceof Node && !box.contains(event.target)) {
      clearRange();
    }
  };

  const onDocumentKeyDown = (event) => {
    if (event.key === 'Escape' && state.hasActiveRange?.()) {
      event.preventDefault();
      clearRange();
    }
  };

  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeyDown);

  svg.addEventListener('pointermove', (event) => {
    if (!drag && !pinned) schedule(event.clientX, event.clientY);
  });
  svg.addEventListener('pointerleave', () => {
    resetHoverGate();
    if (!drag && !pinned) clear();
  });
  svg.addEventListener('pointerdown', (event) => {
    if (isEditingSuspended()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startDist: distanceAt(event.clientX),
      active: false,
    };
    addEventListener('pointermove', onWindowPointerMove);
    addEventListener('pointerup', onWindowPointerUp);
    addEventListener('pointercancel', onWindowPointerUp);
  });

  return {
    at: (meters) => place(meters),
    hide: clear,
    point: () => current,
    pinned: () => pinned,
    brushRange: () => activeRange,
    clearRange,
    refresh: () => {
      measureChart();
      if (current) place(current.along);
    },
    destroy: () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      queued = null;
      clear();
      if (onMap) {
        marker.remove();
        onMap = false;
      }
      chartResize?.disconnect();
      removeEventListener('resize', measureChart);
      removeEventListener('pointermove', onWindowPointerMove);
      removeEventListener('pointerup', onWindowPointerUp);
      removeEventListener('pointercancel', onWindowPointerUp);
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
    },
  };
}

export function createProfileController({
  L,
  el,
  localized,
  t,
  formatters,
  formatDistance,
  formatSpeed,
  formatTimer,
  photosOf,
  getPinsShown,
  setProfilePins,
  getStops,
  focusStop,
  revealPoint,
  onHighlight,
  onLayoutChange,
  onRangeSelect,
  onCropRange,
  isEditingSuspended = () => false,
}) {
  const renderProfile = createProfileChart({
    el,
    localized,
    t,
    formatDistance,
    photosOf,
    getPinsShown,
    setPins: setProfilePins,
    onLayoutChange,
  });

  return {
    read(gpx, routeModel = null) {
      const model = routeModel || createRouteModel(gpx);
      const points = trackPoints(model);
      const samples = points.filter((point) => point.ele !== undefined);
      if (samples.length < 2) return null;
      const analysed = analyse(samples);
      return {
        points,
        samples,
        heartRate: heartRateData(points),
        climbs: detectClimbs(samples, analysed.cells),
        ...analysed,
      };
    },
    render(gpx, data) {
      return renderProfile(gpx, data);
    },
    attach(map, state) {
      return attachScrub({
        L,
        map,
        state,
        formatters,
        formatDistance,
        formatSpeed,
        formatTimer,
        t,
        getStops,
        focusStop,
        revealPoint,
        onHighlight,
        onRangeSelect,
        onCropRange,
        isEditingSuspended,
      });
    },
  };
}
