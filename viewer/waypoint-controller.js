import { distanceMeters } from './geo.js';
import { createPointIndex } from './spatial.js';
import { createWaypointOverview } from './waypoint-overview.js';
import { classifyWaypoint } from './waypoint-insights.js';
import { sampleScreenPoints } from './waypoint-sampling.js';
import { readStored, writeStored } from './storage.js';
import { iconElement, setIcon, symbolMarkup } from './icons.js';
import { lineDistanceAt } from './route-model.js';
import { createSnapReticleMarker } from './snap-indicator.js';

const PINS_KEY = 'pins';
const OVERVIEW_MERGE_METERS = 25;
const NAVIGATION_MERGE_METERS = 5;
const WAYPOINT_SPACING_PIXELS = 34;

function pinIcon(L, withPhoto) {
  return L.divIcon({
    className: withPhoto ? 'gpx-pin has-photo' : 'gpx-pin',
    html: '<span class="pin-symbol-wrap">'
      + symbolMarkup('waypoint', { width: 24, height: 27, className: 'data-symbol pin-symbol' })
      + (withPhoto
        ? symbolMarkup('camera', { width: 11, height: 11, className: 'data-symbol pin-camera' })
        : '')
      + '</span>',
    // The 24x32 slender diamond survey pin scales into 24x27 with its horizontal centre at x=12 and
    // bottom needle tip at y=26.58, so anchoring at [12, 27] aligns the tip dead-centre on the coordinate.
    iconSize: [24, 27],
    iconAnchor: [12, 27],
    popupAnchor: [0, -26],
  });
}

function buildRouteIndex(segments, gpx, routeModel) {
  if (routeModel) {
    const points = [];
    const lines = routeModel.tracks.length > 0 ? routeModel.tracks : routeModel.routes;
    for (const line of lines) {
      for (let index = 0; index < line.points.length; index += 1) {
        const point = line.points[index];
        points.push({ lat: point.lat, lon: point.lon, along: lineDistanceAt(line, index) });
      }
    }
    return createPointIndex(points);
  }
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
  onOverviewOpen,
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
  let selectionReticle = null;
  let selectionTarget = null;
  let annotationMarkCount = 0;
  let lastPinOrigin = null;
  let pendingPinRender = 0;
  let waypointIndex = null;
  const renderedStops = new Set();
  const overview = createWaypointOverview({
    el,
    onSelect: (index) => selectNode(index),
    onLayoutChange,
    onOpen: onOverviewOpen,
  });
  let overviewCache = null;
  let shown = savedVisibility();
  let editingSuspended = false;

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
    if (show && !editingSuspended) {
      pinLayer?.addTo(map);
      renderWaypointPins();
    } else {
      pinLayer?.remove();
      clearSelectionReticle();
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
    if (renderedStops.has(stop)) return;
    pinLayer?.addLayer(stop.marker);
    renderedStops.add(stop);
  }

  function hideStop(stop) {
    if (!renderedStops.has(stop)) return;
    pinLayer?.removeLayer(stop.marker);
    renderedStops.delete(stop);
  }

  function selectedNode() {
    return navigation[selectedNodeIndex] || null;
  }

  function renderWaypointPins() {
    if (!map || editingSuspended) return;
    if (!shown || stops.length === 0) return;

    lastPinOrigin = map.containerPointToLayerPoint([0, 0]);
    const selected = selectedNode()?.stop || stops[stopIndex];
    const target = new Set();
    if (selected) target.add(selected);
    const protectedStops = new Set();
    if (selected) protectedStops.add(selected);
    const viewBounds = map.getBounds().pad(0.15);
    const inView = new Set(waypointIndex?.within({
      south: viewBounds.getSouth(),
      west: viewBounds.getWest(),
      north: viewBounds.getNorth(),
      east: viewBounds.getEast(),
    }) || []);
    for (const stop of stops) if (stop.important && inView.has(stop.point)) protectedStops.add(stop);
    for (const stop of protectedStops) target.add(stop);

    const ordinary = stops
      .map((stop, index) => ({ stop, index }))
      .filter(({ stop }) => !protectedStops.has(stop) && inView.has(stop.point));
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
    for (const { item } of sampled) target.add(item.stop);

    for (const stop of [...renderedStops]) {
      if (!target.has(stop)) hideStop(stop);
    }
    for (const stop of target) {
      showStop(stop);
      stop.marker.setZIndexOffset(stop === selected ? 1200 : 900);
      stop.marker.getElement()?.classList.toggle('selected', stop === selected);
    }
  }

  function scheduleWaypointPins() {
    if (pendingPinRender) return;
    pendingPinRender = requestAnimationFrame(() => {
      pendingPinRender = 0;
      renderWaypointPins();
    });
  }

  function onMapMove() {
    if (editingSuspended || !shown || stops.length === 0 || map?._animatingZoom) return;
    const origin = map.containerPointToLayerPoint([0, 0]);
    if (!lastPinOrigin
      || Math.hypot(origin.x - lastPinOrigin.x, origin.y - lastPinOrigin.y) >= 120) {
      scheduleWaypointPins();
    }
  }

  function clearSelectionReticle() {
    if (selectionReticle) {
      selectionReticle.remove();
      selectionReticle = null;
    }
    selectionTarget = null;
  }

  /**
   * Marks the selected waypoint or route anchor with the same standardized double-stroked snap reticle
   * (diamond for waypoints, cross for start/end track points) centred on its exact geographic coordinate.
   */
  function paintSelectionReticle(node) {
    if (!map || !node) return;
    const at = node.marker.getLatLng();
    const kind = node.stop ? 'marker' : 'track';
    if (selectionTarget
      && selectionTarget.kind === kind
      && selectionTarget.lat === at.lat
      && selectionTarget.lng === at.lng) {
      return;
    }
    clearSelectionReticle();
    selectionTarget = { kind, lat: at.lat, lng: at.lng };
    selectionReticle = createSnapReticleMarker(L, at, {
      kind,
      className: 'pin-selection-reticle',
      animate: true,
      zIndexOffset: 1200,
    });
    selectionReticle?.addTo(map);
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
    paintSelectionReticle(node);
    overview.refresh(overviewItems(), stopIndex);
    // No reveal here. popupopen is the single place that pans, so every route into a popup -- a pin click, an
    // arrow key, the overview list -- pans exactly once, with the popup already laid out. Revealing here as well
    // was the bug: Leaflet opens the popup before it fires click, so both paths ran and the map jumped twice.
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
      const preferred = group.find(({ stop }) => stop.photos.length > 0) || first;
      return {
        ...first,
        stop: {
          ...first.stop,
          point,
          photos: unique(group.flatMap(({ stop }) => stop.photos)),
          mergedCount: group.length,
        },
        members: group.map(({ index }) => index),
        navIndex: preferred.navIndex,
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
    for (const anchor of routeIndex ? anchorMarks : []) {
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
        // The one and only reveal. By the time this fires the popup exists and has a measurable box, so the pan
        // is computed against real geometry instead of a rectangle that is still animating open.
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
    if (!pinLayer || annotationMarkCount + stops.length === 0) return null;
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
        button.append(iconElement('pin'), labelNode);
        button.addEventListener('click', () => set(!shown, true));
        bar.append(button);
        control.relabel();
        L.DomEvent.disableClickPropagation(bar);
        return bar;
      },
    });
    const leafletControl = new Control();
    targetMap.addControl(leafletControl);
    control.remove = () => leafletControl.remove();
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
        setIcon(button, 'list');
        button.append(el('span', null, t('overview.label')));
        button.addEventListener('click', () => overview.toggle(overviewItems(), stopIndex));
        overview.attachButton(button);
        bar.append(button);
        control.relabel();
        L.DomEvent.disableClickPropagation(bar);
        return bar;
      },
    });
    const leafletControl = new Control();
    targetMap.addControl(leafletControl);
    control.remove = () => leafletControl.remove();
    listControl = control;
  }

  return {
    draw(targetMap, gpx, segments, anchorMarks = [], routeModel = null, annotationCount = 0) {
      map = targetMap;
      stops = [];
      photoStops = [];
      navigation = [];
      photoNodes = [];
      selectedNodeIndex = -1;
      stopIndex = -1;
      overviewCache = null;
      clearSelectionReticle();
      annotationMarkCount = Math.max(0, Number(annotationCount) || 0);
      lastPinOrigin = null;
      waypointIndex = createPointIndex(gpx.waypoints || []);
      renderedStops.clear();
      pinLayer = L.layerGroup();
      const bounds = L.latLngBounds([]);
      const routeIndex = gpx.network ? null : buildRouteIndex(segments, gpx, routeModel);

      for (const waypoint of gpx.waypoints) {
        const photos = photosOf(waypoint);
        const important = classifyWaypoint(waypoint).important;
        const pin = pinIcon(L, photos.length > 0);
        const marker = L.marker([waypoint.lat, waypoint.lon], {
          icon: pin,
          keyboard: false,
          title: waypoint.name || '',
        });
        const stop = {
          point: waypoint,
          marker,
          photos,
          along: routeIndex?.nearest(waypoint)?.along,
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
          // "Next" walks the photo stops and opens that pin's card in place. Both the action and its label are
          // resolved when the popup opens, not when the marker is bound: photoStops is filled by buildNavigation,
          // which runs after this loop.
          marker.bindPopup(() => {
            const next = photoStops.length > 1
              ? () => {
                const at = photoStops.indexOf(stop);
                const neighbour = photoStops[(at + 1) % photoStops.length];
                // navigationIndex, not sourceIndex: sourceIndex is assigned while the stops are still in file
                // order, and sortStops reorders them afterwards, so using it here jumped to an unrelated pin.
                if (neighbour) selectNode(neighbour.navigationIndex);
              }
              : null;
            const at = photoStops.indexOf(stop);
            return photoPreview(photos, waypoint, () => marker.closePopup(), {
              onNext: next,
              position: at >= 0 ? at + 1 : 0,
              total: photoStops.length,
            });
          }, {
            className: 'photo-popup',
            maxWidth: 240,
            minWidth: 224,
            autoPan: false,
          });
        } else {
          marker.bindPopup(
            () => pointPopup(
              waypoint,
              waypoint.name || t('label.waypoint'),
              () => marker.closePopup(),
            ),
            { className: 'place-popup', maxWidth: 240, minWidth: 224, autoPan: false },
          );
        }
        bounds.extend([waypoint.lat, waypoint.lon]);
      }
      sortStops();
      buildNavigation(anchorMarks, routeIndex);
      map.on('move', onMapMove);
      map.on('zoomend', scheduleWaypointPins);
      map.on('moveend', scheduleWaypointPins);
      map.on('resize', scheduleWaypointPins);
      if (shown && annotationMarkCount + stops.length > 0) {
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
    count: () => stops.length,
    stops: () => stops,
    photoStops: () => photoStops,
    index: () => stopIndex,
    navigation: () => navigation,
    waypointIndex: () => waypointIndex,
    nodeIndex: () => selectedNodeIndex,
    hasControl: () => pinControl !== null,
    hasOverview: () => listControl !== null,
    overviewOpen: () => overview.isOpen(),
    openOverview: () => overview.open(overviewItems(), stopIndex),
    closeOverview: (restoreFocus = true) => overview.close({ restoreFocus }),
    refreshMapMarks: renderWaypointPins,
    setEditingSuspended(suspended) {
      editingSuspended = Boolean(suspended);
      if (editingSuspended) {
        map?.closePopup?.();
        pinLayer?.remove();
        clearSelectionReticle();
      } else if (map && shown && annotationMarkCount + stops.length > 0) {
        pinLayer?.addTo(map);
        renderWaypointPins();
      }
    },
    relabel,
    destroy() {
      if (pendingPinRender) {
        cancelAnimationFrame(pendingPinRender);
        pendingPinRender = 0;
      }
      clearSelectionReticle();
      map?.off('move', onMapMove);
      map?.off('zoomend', scheduleWaypointPins);
      map?.off('moveend', scheduleWaypointPins);
      map?.off('resize', scheduleWaypointPins);
      pinLayer?.remove();
      pinControl?.remove?.();
      pinControl = null;
      pinBar = null;
      listControl?.remove?.();
      listControl = null;
      overview.destroy();
    },
    openStop() {
      const node = selectedNode();
      const marker = node?.markers.find((candidate) => candidate.isPopupOpen());
      return marker ? { marker, point: node.point } : null;
    },
  };
}
