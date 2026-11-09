import { analyse } from './profile.js';
import { createProfileChart } from './profile-chart.js';
import { distanceMeters } from './gpx.js';

function trackPoints(gpx) {
  const points = [];
  let along = 0;
  for (const segment of gpx.tracks.flatMap((track) => track.segments)) {
    let previous = null;
    for (const point of segment) {
      if (previous) along += distanceMeters(previous, point);
      points.push({
        along,
        lat: point.lat,
        lon: point.lon,
        ele: point.ele,
        time: point.time,
      });
      previous = point;
    }
  }
  return points;
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
  const { points, total, svg, plot, chart, guide, dot, readout, value, meta, yOf } = state;
  const marker = L.circleMarker([0, 0], {
    radius: 7,
    color: '#ffffff',
    weight: 2.5,
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
    const rect = svg.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.min(total, Math.max(0, ratio * total));
  }

  function place(distance) {
    const point = pointNear(points, Math.max(0, Math.min(total, distance)));
    current = point;
    const rect = chart.getBoundingClientRect();
    const x = (point.along / total) * rect.width;
    guide.style.left = `${x}px`;
    guide.hidden = false;
    let y = rect.height - 6;
    if (point.ele !== undefined) {
      y = (yOf(point.ele) / 100) * rect.height;
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      dot.hidden = false;
    } else {
      dot.hidden = true;
    }

    value.textContent = point.ele !== undefined ? `${Math.round(point.ele)} ${t('unit.m')}` : '';
    value.hidden = value.textContent === '';
    const parts = [formatDistance(point.along)];
    if (point.time) parts.push(formatters().time.format(point.time));
    meta.textContent = parts.join(' \u00b7 ');
    readout.hidden = false;

    const width = readout.offsetWidth;
    const height = readout.offsetHeight;
    const half = width / 2 + 2;
    const left = rect.width <= width ? rect.width / 2 : Math.min(Math.max(x, half), rect.width - half);
    readout.style.left = `${left}px`;
    readout.style.top = `${Math.max(0, y - height - 10)}px`;

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
      if (current) place(current.along);
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
    read(gpx) {
      const points = trackPoints(gpx);
      const samples = points.filter((point) => point.ele !== undefined);
      if (samples.length < 2) return null;
      return { points, samples, ...analyse(samples) };
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
