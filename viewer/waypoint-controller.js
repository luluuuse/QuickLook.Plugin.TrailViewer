import { distanceMeters } from './geo.js';
import { createPointIndex } from './spatial.js';
import { createWaypointOverview } from './waypoint-overview.js';
import { classifyWaypoint } from './waypoint-insights.js';
import { sampleScreenPoints } from './waypoint-sampling.js';
import { readStored, writeStored } from './storage.js';

const PHOTO_BADGE = '<circle cx="23" cy="7.5" r="5.6" fill="#ffffff" stroke="#1b1b1b" stroke-width="1.2"/>'
  + '<rect x="20.4" y="6.4" width="5.4" height="3.7" rx="0.8" fill="#1b1b1b"/>'
  + '<circle cx="23" cy="8.25" r="1.15" fill="#ffffff"/>';
const PINS_KEY = 'pins';
const MAX_DOTS = 20000;
const OVERVIEW_MERGE_METERS = 25;
const NAVIGATION_MERGE_METERS = 5;
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
  let pinBar = null;
  let stops = [];
  let photoStops = [];
  let navigation = [];
  let photoNodes = [];
  let selectedNodeIndex = -1;
  let stopIndex = -1;
  let halo = null;
  let trackMarkCount = 0;
  let pendingPinRender = 0;
  const overview = createWaypointOverview({
    el,
    onSelect: (index) => selectNode(index),
    onLayoutChange,
  });
  let overviewCache = null;
  let shown = savedVisibility();

  function savedVisibility() {
    const fromHost = params.get('pins');
    if (fromHost === '0') return false;
    if (fromHost === '1') return true;
    return readStored(PINS_KEY) !== '0';
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
      writeStored(PINS_KEY, show ? '1' : '0');
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

  function selectedNode() {
    return navigation[selectedNodeIndex] || null;
  }

  function renderWaypointPins() {
    if (!map) return;
    if (!shown || stops.length === 0) return;

    for (const stop of stops) hideStop(stop);
    const protectedStops = new Set();
    const selected = selectedNode()?.stop || stops[stopIndex];
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

  function paintNavigationSelection(node) {
    const selected = new Set(node?.markers || []);
    for (const candidate of navigation) {
      for (const marker of candidate.markers) {
        marker.getElement()?.classList.toggle('selected', selected.has(marker));
      }
    }
  }

  function focusNode(index) {
    if (navigation.length === 0) return null;
    if (!shown) set(true, true);
    const next = ((index % navigation.length) + navigation.length) % navigation.length;
    selectedNodeIndex = next;
    const node = navigation[next];
    stopIndex = node.stop ? stops.indexOf(node.stop) : -1;
    renderWaypointPins();
    paintNavigationSelection(node);
    paintHalo(node);
    overview.refresh(overviewItems(), stopIndex);
    onFocus?.(node, node.markers.some((marker) => marker.isPopupOpen()));
    return node;
  }

  function focus(index) {
    const stop = stops[index];
    return stop ? focusNode(stop.navigationIndex) : null;
  }

  function selectNode(index) {
    const node = focusNode(index);
    if (node && !node.marker.isPopupOpen()) node.marker.openPopup();
    return node;
  }

  function select(index) {
    return selectNode(stops[index]?.navigationIndex ?? -1);
  }

  function stepPhoto(delta) {
    if (photoNodes.length === 0) return;
    const node = photoNodes.find((candidate) => candidate.point === photoViewer.current());
    if (!node) {
      const edge = photoNodes[delta > 0 ? 0 : photoNodes.length - 1];
      photoViewer.show(edge.stop.photos, edge.point.name || t('label.photo'), edge.point, 0);
      return;
    }
    if (photoViewer.stepWithin(delta)) return;
    const index = photoNodes.indexOf(node);
    const neighbour = photoNodes[(index + delta + photoNodes.length) % photoNodes.length];
    selectNode(neighbour.navIndex);
    photoViewer.show(
      neighbour.stop.photos,
      neighbour.point.name || t('label.photo'),
      neighbour.point,
      delta > 0 ? 0 : neighbour.stop.photos.length - 1,
    );
  }

  function stepByKey(delta) {
    if (photoViewer.isOpen()) {
      stepPhoto(delta);
      return;
    }
    if (navigation.length === 0) return;
    if (selectedNodeIndex < 0) {
      const waypoints = navigation.filter((node) => node.stop);
      const target = waypoints[delta > 0 ? 0 : waypoints.length - 1] || navigation[delta > 0 ? 0 : navigation.length - 1];
      if (target) selectNode(target.navIndex);
      return;
    }
    selectNode(selectedNodeIndex + delta);
  }

  function overviewItems() {
    if (overviewCache) return overviewCache;
    const sorted = stops
      .map((stop, index) => ({ stop, index, navIndex: stop.navigationIndex }))
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
      if (group.length === 1) return { ...first, members: [first.index], navIndex: first.navIndex };
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
        navIndex: first.navIndex,
      };
    });
    return overviewCache;
  }

  function orderValue(stop) {
    return Number.isFinite(stop.along) ? stop.along : Infinity;
  }

  function sortStops() {
    stops.sort((a, b) => orderValue(a) - orderValue(b) || a.sourceIndex - b.sourceIndex);
  }

  function buildNavigation(anchorMarks, routeIndex) {
    const waypointGroups = stops.map((stop) => ({ stop, anchors: [] }));
    const anchorGroups = [];
    for (const anchor of anchorMarks) {
      const withAlong = {
        ...anchor,
        along: routeIndex.nearest(anchor.point)?.along,
      };
      const candidates = [...waypointGroups, ...anchorGroups]
        .map((group) => ({
          group,
          distance: distanceMeters(group.stop?.point || group.anchors[0].point, withAlong.point),
        }))
        .filter(({ distance }) => distance <= NAVIGATION_MERGE_METERS)
        .sort((a, b) => a.distance - b.distance);
      if (candidates[0]) candidates[0].group.anchors.push(withAlong);
      else anchorGroups.push({ stop: null, anchors: [withAlong] });
    }

    const groups = [...waypointGroups, ...anchorGroups].sort((a, b) => {
      const left = a.stop ? orderValue(a.stop) : Math.min(...a.anchors.map((anchor) => anchor.along));
      const right = b.stop ? orderValue(b.stop) : Math.min(...b.anchors.map((anchor) => anchor.along));
      return left - right || (a.stop ? 1 : 0) - (b.stop ? 1 : 0);
    });

    navigation = groups.map((group, navIndex) => {
      const stop = group.stop;
      const anchor = group.anchors[0] || null;
      const point = stop?.point || anchor.point;
      const marker = stop?.marker || anchor.marker;
      const markers = [...group.anchors.map((item) => item.marker), ...(stop ? [stop.marker] : [])];
      const node = {
        navIndex,
        stop,
        point,
        marker,
        markers,
        anchors: group.anchors,
        kinds: group.anchors.map((item) => item.kind),
        along: stop ? orderValue(stop) : Math.min(...group.anchors.map((item) => item.along)),
      };
      if (stop) stop.navigationIndex = navIndex;
      return node;
    });

    for (const node of navigation) {
      for (const marker of node.markers) {
        marker.on('click', () => focusNode(node.navIndex));
        marker.on('popupopen', () => {
          requestAnimationFrame(() => onFocus?.(node, true));
        });
      }
      if (node.stop && node.anchors.length > 0) {
        for (const anchor of node.anchors) {
          const element = anchor.marker.getElement();
          if (element) element.style.pointerEvents = 'none';
        }
      }
    }
    photoNodes = navigation.filter((node) => node.stop?.photos.length > 0);
    photoStops = photoNodes.map((node) => node.stop);
    overviewCache = null;
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
        pinBar = bar;
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
        pinBar?.classList.add('joined-left');
        bar.classList.add('joined-right');
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
    draw(targetMap, gpx, segments, anchorMarks = []) {
      map = targetMap;
      stops = [];
      photoStops = [];
      navigation = [];
      photoNodes = [];
      selectedNodeIndex = -1;
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
          sourceIndex: stops.length,
        };
        stops.push(stop);
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
        bounds.extend([waypoint.lat, waypoint.lon]);
      }
      sortStops();
      buildNavigation(anchorMarks, routeIndex);
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
    navigation: () => navigation,
    nodeIndex: () => selectedNodeIndex,
    hasControl: () => pinControl !== null,
    hasOverview: () => listControl !== null,
    overviewOpen: () => overview.isOpen(),
    openOverview: () => overview.open(overviewItems(), stopIndex),
    closeOverview: () => overview.close(),
    refreshMapMarks: renderWaypointPins,
    relabel,
    openStop() {
      const node = selectedNode();
      const marker = node?.markers.find((candidate) => candidate.isPopupOpen());
      return marker ? { marker, point: node.point } : null;
    },
  };
}
