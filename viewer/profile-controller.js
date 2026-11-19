import { analyse } from './profile.js';
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
  t,
  getStops,
  focusStop,
  revealPoint,
}) {
  const { points, total, svg, plot, chart, guide, dot, readout, value, meta, yOf, heart } = state;
  const marker = L.circleMarker([0, 0], {
    radius: 7,
    color: '#1b1b1b',
    weight: 1.5,
    fillColor: '#e5243b',
    fillOpacity: 1,
    interactive: false,
    className: 'scrub-marker',
  });
  let pinned = false;
  let onMap = false;
  let current = null;
  let frame = 0;
  let queued = null;
  let chartRect = chart.getBoundingClientRect();
  let readoutKey = '';
  let readoutWidth = 0;
  let readoutHeight = 0;

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

  function place(distance) {
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
    readout.hidden = false;

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
    revealPoint?.(latlng);
  }

  function clear() {
    guide.hidden = true;
    dot.hidden = true;
    if (heart) heart.dot.hidden = true;
    if (heart) heart.value.hidden = true;
    readout.hidden = true;
    if (onMap) {
      marker.remove();
      onMap = false;
    }
    current = null;
  }

  function schedule(clientX) {
    queued = clientX;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (queued !== null) place(distanceAt(queued));
      queued = null;
    });
  }

  svg.addEventListener('pointermove', (event) => {
    if (!pinned) schedule(event.clientX);
  });
  svg.addEventListener('pointerleave', () => {
    if (!pinned) clear();
  });
  svg.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    place(distanceAt(event.clientX));
    pinned = !pinned;
    plot.classList.toggle('pinned', pinned);
  });

  return {
    at: (meters) => place(meters),
    hide: clear,
    point: () => current,
    pinned: () => pinned,
    refresh: () => {
      measureChart();
      if (current) place(current.along);
    },
    destroy: () => {
      chartResize?.disconnect();
      removeEventListener('resize', measureChart);
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
  photosOf,
  getPinsShown,
  setProfilePins,
  getStops,
  focusStop,
  revealPoint,
}) {
  const renderProfile = createProfileChart({
    el,
    localized,
    t,
    photosOf,
    getPinsShown,
    setPins: setProfilePins,
  });

  return {
    read(gpx, routeModel = null) {
      const model = routeModel || createRouteModel(gpx);
      const points = trackPoints(model);
      const samples = points.filter((point) => point.ele !== undefined);
      if (samples.length < 2) return null;
      return { points, samples, heartRate: heartRateData(points), ...analyse(samples) };
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
        t,
        getStops,
        focusStop,
        revealPoint,
      });
    },
  };
}
