import { distanceMeters } from './geo.js';
import { createPointIndex } from './spatial.js';
import { createWaypointOverview } from './waypoint-overview.js';
import { classifyWaypoint } from './waypoint-insights.js';
import { sampleScreenPoints } from './waypoint-sampling.js';

const PHOTO_BADGE = '<circle cx="23" cy="7.5" r="5.6" fill="#ffffff" stroke="#1b1b1b" stroke-width="1.2"/>'
  + '<rect x="20.4" y="6.4" width="5.4" height="3.7" rx="0.8" fill="#1b1b1b"/>'
  + '<circle cx="23" cy="8.25" r="1.15" fill="#ffffff"/>';
const PINS_KEY = 'gpxviewer.pins';
const MAX_DOTS = 20000;
const OVERVIEW_MERGE_METERS = 25;
const WAYPOINT_SPACING_PIXELS = 34;

function pinIcon(L, withPhoto) {
  return L.divIcon({
    className: withPhoto ? 'gpx-pin has-photo' : 'gpx-pin',
    html: '<svg viewBox="0 0 30 34" width="24" height="27">'
      + '<path d="M12 1C6 1 1.5 5.6 1.5 11.5 1.5 19.5 12 33 12 33s10.5-13.5 10.5-21.5C22.5 5.6 18 1 12 1z"'
      + ' fill="#f5c400" stroke="#1b1b1b" stroke-width="1.5"/>'
      + '<circle cx="12" cy="11.5" r="4" fill="#1b1b1b"/>'
      + `${withPhoto ? PHOTO_BADGE : ''}</svg>`,
    iconSize: [24, 27],
    iconAnchor: [10, 26],
    popupAnchor: [0, -24],
  });
}

function buildRouteIndex(segments, gpx) {
  const lines = segments.length > 0
    ? segments.map((segment) => segment.points)
    : gpx.routes.map((route) => route.points);
  const points = [];
  let along = 0;
  for (const line of lines) {
    let previous = null;
    for (const point of line) {
      if (previous) along += distanceMeters(previous, point);
      points.push({ ...point, along });
      previous = point;
    }
  }
  return createPointIndex(points);
}

/**
 * Owns waypoint/track-dot visibility, the selected marker, the halo and keyboard/photo navigation.
 * This is one state machine rather than several modules sharing globals.
 */
export function createWaypointController({
  L,
  el,
  t,
  units,
  localized,
  photosOf,
  photoPreview,
  pointPopup,
  photoViewer,
  params,
  onPreferenceChange,
  onVisibilityChange,
  onFocus,
  onLayoutChange,
  setProfilePinsVisible,
}) {
  let map = null;
  let pinLayer = null;
  let pinControl = null;
  let listControl = null;
  let stops = [];
  let photoStops = [];
  let stopIndex = -1;
  let halo = null;
  let trackMarkCount = 0;
  let pendingPinRender = 0;
  const overview = createWaypointOverview({
    el,
    onSelect: (index) => select(index),
    onLayoutChange,
  });
  let overviewCache = null;
  let shown = savedVisibility();

  function savedVisibility() {
    const fromHost = params.get('pins');
    if (fromHost === '0') return false;
    if (fromHost === '1') return true;
    try {
      return localStorage.getItem(PINS_KEY) !== '0';
    } catch {
      return true;
    }
  }

  function relabel() {
    if (!pinControl) return;
    pinControl.relabel();
    listControl?.relabel();
    overview.relabel(overviewItems(), stopIndex);
    renderWaypointPins();
  }

  function set(show, remember) {
    shown = show;
    if (show) {
      pinLayer?.addTo(map);
      renderWaypointPins();
    } else {
      pinLayer?.remove();
      if (halo) {
        halo.remove();
        halo = null;
      }
    }
    setProfilePinsVisible(show);
    onVisibilityChange?.(show);
    if (remember) {
      try { localStorage.setItem(PINS_KEY, show ? '1' : '0'); }
      catch { /* Private mode or storage disabled. */ }
      onPreferenceChange?.();
    }
    relabel();
  }

  function showStop(stop) {
    stop.marker.setIcon(stop.pinIcon);
    const marker = stop.marker.getElement();
    if (marker) marker.style.display = '';
  }

  function hideStop(stop) {
    const marker = stop.marker.getElement();
    if (marker) marker.style.display = 'none';
  }

  function renderWaypointPins() {
    if (!map) return;
    if (!shown || stops.length === 0) return;

    for (const stop of stops) hideStop(stop);
    const protectedStops = new Set();
    const selected = stops[stopIndex];
    if (selected) protectedStops.add(selected);
    for (const stop of stops) if (stop.important) protectedStops.add(stop);
    for (const stop of protectedStops) {
      showStop(stop);
      stop.marker.setZIndexOffset(stop === selected ? 1200 : 900);
    }
    for (const stop of stops) {
      stop.marker.getElement()?.classList.toggle('selected', stop === selected);
    }

    const ordinary = stops
      .map((stop, index) => ({ stop, index }))
      .filter(({ stop }) => !protectedStops.has(stop));
    const protectedPoints = [...protectedStops].map((stop) =>
      map.latLngToContainerPoint([stop.point.lat, stop.point.lon]));
    const sampled = sampleScreenPoints(
      ordinary,
      ({ stop }) => map.latLngToContainerPoint([stop.point.lat, stop.point.lon]),
      {
        minDistance: WAYPOINT_SPACING_PIXELS,
        bounds: map.getSize(),
        occupied: protectedPoints,
      },
    );
    for (const { item } of sampled) showStop(item.stop);
  }

  function scheduleWaypointPins() {
    if (pendingPinRender) return;
    pendingPinRender = requestAnimationFrame(() => {
      pendingPinRender = 0;
      renderWaypointPins();
    });
  }

  function paintHalo(stop) {
    if (!map) return;
    const at = stop.marker.getLatLng();
    if (!halo) {
      halo = L.circleMarker(at, {
        radius: 16,
        color: '#2f9bff',
        weight: 2,
        opacity: 0.95,
        fillColor: '#2f9bff',
        fillOpacity: 0.14,
        interactive: false,
      }).addTo(map);
    }
    halo.setLatLng(at).bringToFront();
  }

  function focus(index) {
    if (stops.length === 0) return null;
    if (!shown) set(true, true);
    const next = ((index % stops.length) + stops.length) % stops.length;
    const previous = stops[stopIndex];
    const stop = stops[next];
    if (previous && previous !== stop) previous.marker.getElement()?.classList.remove('selected');
    stopIndex = next;
    renderWaypointPins();
    stop.marker.getElement()?.classList.add('selected');
    paintHalo(stop);
    overview.refresh(overviewItems(), stopIndex);
    onFocus?.(stop, stop.marker.isPopupOpen());
    return stop;
  }

  function select(index) {
    const stop = focus(index);
    if (stop && !stop.marker.isPopupOpen()) stop.marker.openPopup();
    return stop;
  }

  function stepPhoto(delta) {
    if (photoStops.length === 0) return;
    const stop = photoStops.find((candidate) => candidate.point === photoViewer.current());
    if (!stop) {
      const edge = photoStops[delta > 0 ? 0 : photoStops.length - 1];
      photoViewer.show(edge.photos, edge.point.name || t('label.photo'), edge.point, 0);
      return;
    }
    if (photoViewer.stepWithin(delta)) return;
    const index = photoStops.indexOf(stop);
    const neighbour = photoStops[(index + delta + photoStops.length) % photoStops.length];
    select(stops.indexOf(neighbour));
    photoViewer.show(
      neighbour.photos,
      neighbour.point.name || t('label.photo'),
      neighbour.point,
      delta > 0 ? 0 : neighbour.photos.length - 1,
    );
  }

  function stepByKey(delta) {
    if (photoViewer.isOpen()) {
      stepPhoto(delta);
      return;
    }
    if (stops.length === 0) return;
    select(stopIndex < 0 ? (delta > 0 ? 0 : stops.length - 1) : stopIndex + delta);
  }

  function overviewItems() {
    if (overviewCache) return overviewCache;
    const sorted = stops
      .map((stop, index) => ({ stop, index }))
      .sort((a, b) => {
        const left = Number.isFinite(a.stop.along) ? a.stop.along : Infinity;
        const right = Number.isFinite(b.stop.along) ? b.stop.along : Infinity;
        return left - right || a.index - b.index;
      });
    const groups = [];
    for (const item of sorted) {
      const group = groups[groups.length - 1];
      if (group && distanceMeters(group[0].stop.point, item.stop.point) <= OVERVIEW_MERGE_METERS) {
        group.push(item);
      } else {
        groups.push([item]);
      }
    }
    overviewCache = groups.map((group) => {
      const first = group[0];
      if (group.length === 1) return { ...first, members: [first.index] };
      const unique = (values) => [...new Set(values.filter(Boolean))];
      const point = { ...first.stop.point };
      const names = unique(group.map(({ stop }) => stop.point.name));
      const descriptions = unique(group.map(({ stop }) => stop.point.description));
      const insightTexts = unique(group.map(({ stop }) => stop.point.insightText));
      const icons = unique(group.map(({ stop }) => stop.point.icon));
      if (names.length > 1) point.name = names.join(' / ');
      if (descriptions.length > 0) point.description = descriptions.join(' · ');
      if (insightTexts.length > 0) point.insightText = insightTexts.join('\n');
      if (icons.length > 0) point.icon = icons.join(' ');
      return {
        ...first,
        stop: {
          ...first.stop,
          point,
          photos: unique(group.flatMap(({ stop }) => stop.photos)),
          mergedCount: group.length,
        },
        members: group.map(({ index }) => index),
      };
    });
    return overviewCache;
  }

  function createControl(targetMap) {
    if (!pinLayer || trackMarkCount + stops.length === 0) return null;
    let button = null;
    let labelNode = null;
    const control = {
      relabel() {
        if (!button) return;
        button.classList.toggle('active', shown);
        button.title = t(shown ? 'pins.hideTitle' : 'pins.showTitle');
        button.setAttribute('aria-pressed', String(shown));
        button.setAttribute('aria-label', button.title);
        labelNode.textContent = t('pins.label');
      },
    };
    const Control = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const bar = el('div', 'pins-switch leaflet-bar');
        button = el('button');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(shown));
        button.dataset.pins = 'toggle';
        labelNode = el('span', null, t('pins.label'));
        button.append(el('span', 'dot'), labelNode);
        button.addEventListener('click', () => set(!shown, true));
        bar.append(button);
        control.relabel();
        L.DomEvent.disableClickPropagation(bar);
        return bar;
      },
    });
    targetMap.addControl(new Control());
    pinControl = control;
    createOverviewControl(targetMap);
    return control;
  }

  function createOverviewControl(targetMap) {
    if (stops.length === 0) return;
    let button = null;
    const control = {
      relabel() {
        if (!button) return;
        button.title = t('overview.openTitle');
        button.setAttribute('aria-label', t('overview.openTitle'));
        button.querySelector('span').textContent = t('overview.label');
      },
    };
    const Control = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const bar = el('div', 'waypoint-overview-switch leaflet-bar');
        button = el('button');
        button.type = 'button';
        button.title = t('overview.openTitle');
        button.setAttribute('aria-label', t('overview.openTitle'));
        button.dataset.waypoints = 'overview';
        button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
          + '<path d="M3 3h10M3 8h10M3 13h10" stroke="currentColor" stroke-width="1.6"'
          + ' stroke-linecap="round"/></svg>';
        button.append(el('span', null, t('overview.label')));
        button.addEventListener('click', () => overview.toggle(overviewItems(), stopIndex));
        overview.attachButton(button);
        bar.append(button);
        control.relabel();
        L.DomEvent.disableClickPropagation(bar);
        return bar;
      },
    });
    targetMap.addControl(new Control());
    listControl = control;
  }

  return {
    draw(targetMap, gpx, segments) {
      map = targetMap;
      stops = [];
      photoStops = [];
      stopIndex = -1;
      overviewCache = null;
      halo = null;
      trackMarkCount = 0;
      pinLayer = L.layerGroup();
      const dots = L.canvas({ padding: 0.5 });
      const pointCount = segments.reduce((sum, segment) => sum + segment.points.length, 0);
      const withDots = pointCount <= MAX_DOTS;
      const bounds = L.latLngBounds([]);
      const routeIndex = buildRouteIndex(segments, gpx);

      if (withDots) {
        for (const segment of segments) {
          for (const point of segment.points) {
            pinLayer.addLayer(L.circleMarker([point.lat, point.lon], {
              renderer: dots,
              radius: 3,
              color: '#1b1b1b',
              weight: 1,
              fillColor: segment.color,
              fillOpacity: 1,
            }).bindPopup(() => pointPopup(point, segment.track.name)));
            trackMarkCount += 1;
          }
        }
      }

      for (const waypoint of gpx.waypoints) {
        const photos = photosOf(waypoint);
        const important = classifyWaypoint(waypoint).important;
        const pin = pinIcon(L, photos.length > 0);
        const marker = L.marker([waypoint.lat, waypoint.lon], {
          icon: pin,
          keyboard: false,
          title: waypoint.name || '',
        });
        pinLayer.addLayer(marker);
        const stop = {
          point: waypoint,
          marker,
          photos,
          along: routeIndex.nearest(waypoint)?.along,
          pinIcon: pin,
          important,
        };
        const index = stops.push(stop) - 1;
        if (photos.length > 0) photoStops.push(stop);
        marker.on('click', () => focus(index));
        if (photos.length > 0) {
          const label = localized(
            el('span'),
            () => `${waypoint.name || t('label.photo')} \u00b7 ${units(photos.length, 'photo')}`,
          );
          marker.bindTooltip(label, { direction: 'top', offset: [0, -30] });
          marker.bindPopup(() => photoPreview(photos, waypoint, () => marker.closePopup()), {
            className: 'photo-popup',
            maxWidth: 300,
            minWidth: 220,
            autoPan: false,
          });
        } else {
          marker.bindPopup(
            () => pointPopup(waypoint, waypoint.name || t('label.waypoint')),
            { autoPan: false },
          );
        }
        marker.on('popupopen', () => {
          requestAnimationFrame(() => onFocus?.(stop, true));
        });
        bounds.extend([waypoint.lat, waypoint.lon]);
      }
      map.on('zoomend', scheduleWaypointPins);
      map.on('moveend', scheduleWaypointPins);
      map.on('resize', scheduleWaypointPins);
      if (shown && trackMarkCount + stops.length > 0) {
        pinLayer.addTo(map);
        renderWaypointPins();
      }
      return bounds;
    },
    createControl,
    focus,
    select,
    stepByKey,
    set,
    show: () => set(true, true),
    hide: () => set(false, true),
    toggle: () => set(!shown, true),
    visible: () => shown,
    count: () => trackMarkCount + stops.length,
    stops: () => stops,
    photoStops: () => photoStops,
    index: () => stopIndex,
    hasControl: () => pinControl !== null,
    hasOverview: () => listControl !== null,
    overviewOpen: () => overview.isOpen(),
    openOverview: () => overview.open(overviewItems(), stopIndex),
    closeOverview: () => overview.close(),
    refreshMapMarks: renderWaypointPins,
    relabel,
    openStop: () => stops.find((stop) => stop.marker.isPopupOpen()) || null,
  };
}
