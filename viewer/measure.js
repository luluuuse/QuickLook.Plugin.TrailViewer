import { distanceMeters } from './geo.js';
import { createSnapIndicator } from './snap-indicator.js';
import { createPointIndex } from './spatial.js';

export const SNAP_PIXELS = 14;

const SNAP_PRIORITY = Object.freeze({
  marker: 3,
  measure: 2,
  track: 1,
});

/**
 * @param {{lat:number, lon:number}[][]} sections
 */
export function measurementSummary(sections) {
  const segmentMeters = sections.map((points) => {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += distanceMeters(points[index - 1], points[index]);
    }
    return total;
  });
  return {
    segmentMeters,
    totalMeters: segmentMeters.reduce((sum, value) => sum + value, 0),
    pointCount: sections.reduce((sum, points) => sum + points.length, 0),
    sectionCount: sections.filter((points) => points.length > 0).length,
  };
}

/**
 * Pick the closest target within the snap radius. Exact ties follow marker > measure > track so
 * explicit waypoints win over measured vertices, which win over dense track samples.
 *
 * @template {{ kind: string, distancePixels: number }} T
 * @param {T[]} candidates
 * @returns {T | null}
 */
export function chooseSnap(candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (!(candidate.distancePixels <= SNAP_PIXELS)) continue;
    const rank = SNAP_PRIORITY[candidate.kind] || 0;
    const bestRank = best ? (SNAP_PRIORITY[best.kind] || 0) : -1;
    if (!best
      || candidate.distancePixels < best.distancePixels
      || (candidate.distancePixels === best.distancePixels && rank > bestRank)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Draws the user-created measurement sections and owns snapping. Map panning and wheel zoom stay entirely
 * with Leaflet; only the context menu commits a point.
 */
export function createMeasurement({
  L,
  map,
  t,
  formatDistance,
  gpx,
  segments,
  waypointIndex: sharedWaypointIndex,
  onLayoutChange,
}) {
  let waypointIndex = null;
  let trackIndex = null;
  const layer = L.layerGroup().addTo(map);
  const previewLayer = L.layerGroup().addTo(map);
  const snapIndicator = createSnapIndicator({
    L,
    map,
    t,
    labelClassName: 'snap-label measure-snap-label',
  });
  const listeners = new Set();
  let sections = [];
  let current = null;
  let active = false;
  let hover = null;
  let moveFrame = 0;
  const undoStack = [];
  let redoStack = [];

  function getWaypointIndex() {
    const live = sharedWaypointIndex?.();
    if (live) return live;
    if (!waypointIndex) {
      waypointIndex = createPointIndex(gpx.waypoints || []);
    }
    return waypointIndex;
  }

  function getTrackIndex() {
    if (!trackIndex) {
      const trackPoints = [];
      for (const segment of segments) {
        for (const point of segment.points) trackPoints.push(point);
      }
      trackIndex = createPointIndex(trackPoints);
    }
    return trackIndex;
  }

  function snapshot() {
    return {
      sections: sections.map((section) => section.points.map((point) => ({ ...point }))),
      currentIndex: current ? sections.indexOf(current) : -1,
    };
  }

  function restore(state) {
    sections = state.sections.map((points) => ({ points }));
    current = state.currentIndex >= 0 ? sections[state.currentIndex] : null;
  }

  function remember() {
    undoStack.push(snapshot());
    redoStack = [];
  }

  function notify() {
    const summary = measurementSummary(sections.map((section) => section.points));
    for (const listener of listeners) listener(summary);
    onLayoutChange?.();
  }

  function sectionLabel(points, currentSection) {
    const last = points[points.length - 1];
    if (!last) return null;
    const meter = measurementSummary([points]).totalMeters;
    return L.marker([last.lat, last.lon], {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: currentSection ? 'measure-section-label current' : 'measure-section-label',
        html: `<span>${formatDistance(meter)}</span>`,
        iconAnchor: [-10, 2],
      }),
    });
  }

  function draw() {
    layer.clearLayers();
    sections.forEach((section) => {
      const points = section.points;
      if (points.length > 1) {
        const latLngs = points.map((point) => [point.lat, point.lon]);
        L.polyline(latLngs, {
          color: '#07141a',
          weight: 7,
          opacity: 0.82,
          interactive: false,
          className: 'measure-line',
        }).addTo(layer);
        L.polyline(latLngs, {
          color: '#72e7ff',
          weight: 3,
          opacity: 1,
          interactive: false,
          className: 'measure-line',
        }).addTo(layer);
        sectionLabel(points, section === current)?.addTo(layer);
      }
      points.forEach((point, pointIndex) => {
        const snapped = point.kind !== 'free';
        L.circleMarker([point.lat, point.lon], {
          radius: snapped ? 5 : 4,
          color: snapped ? '#fff2a8' : '#07141a',
          weight: snapped ? 2.5 : 2,
          fillColor: '#72e7ff',
          fillOpacity: 1,
          interactive: false,
          className: 'measure-vertex',
          pane: 'markerPane',
        }).addTo(layer);
        if (pointIndex === points.length - 1) {
          L.circleMarker([point.lat, point.lon], {
            radius: 10,
            color: '#72e7ff',
            weight: 1.5,
            opacity: 0.7,
            fill: false,
            interactive: false,
            pane: 'markerPane',
          }).addTo(layer);
        }
      });
    });
    if (hover) paintHover(hover);
  }

  function nearest(index, latlng, kind) {
    if (!index) return null;
    const lon = Number(latlng.lng ?? latlng.lon);
    const point = index.nearest({ lat: Number(latlng.lat), lon });
    if (!point) return null;
    const target = map.latLngToContainerPoint(latlng);
    const pointScreen = map.latLngToContainerPoint([point.lat, point.lon]);
    return {
      lat: point.lat,
      lon: point.lon,
      ele: point.ele,
      kind,
      distancePixels: target.distanceTo(pointScreen),
    };
  }

  function nearestMeasured(latlng) {
    if (sections.length === 0) return null;
    const lat = Number(latlng.lat);
    const lon = Number(latlng.lng ?? latlng.lon);
    const targetScreen = map.latLngToContainerPoint([lat, lon]);
    const last = current?.points.length ? current.points[current.points.length - 1] : null;
    let best = null;
    for (const section of sections) {
      for (const point of section.points) {
        if (last && distanceMeters(last, point) < 0.01) continue;
        const pointScreen = map.latLngToContainerPoint([point.lat, point.lon]);
        const distancePixels = targetScreen.distanceTo(pointScreen);
        if (!best || distancePixels < best.distancePixels) {
          best = {
            lat: point.lat,
            lon: point.lon,
            ele: point.ele,
            kind: 'measure',
            distancePixels,
          };
        }
      }
    }
    return best;
  }

  function snapAt(latlng) {
    const marker = nearest(getWaypointIndex(), latlng, 'marker');
    const measured = nearestMeasured(latlng);
    const track = nearest(getTrackIndex(), latlng, 'track');
    return chooseSnap([marker, measured, track].filter(Boolean)) || {
      lat: Number(latlng.lat),
      lon: Number(latlng.lng ?? latlng.lon),
      kind: 'free',
      distancePixels: Infinity,
    };
  }

  function snapMarkerAt(latlng) {
    const marker = nearest(getWaypointIndex(), latlng, 'marker');
    return chooseSnap([marker].filter(Boolean)) || {
      lat: Number(latlng.lat),
      lon: Number(latlng.lng ?? latlng.lon),
      kind: 'free',
      distancePixels: Infinity,
    };
  }

  function snapCoordinateAt(latlng) {
    const marker = nearest(getWaypointIndex(), latlng, 'marker');
    const track = nearest(getTrackIndex(), latlng, 'track');
    return chooseSnap([marker, track].filter(Boolean)) || {
      lat: Number(latlng.lat),
      lon: Number(latlng.lng ?? latlng.lon),
      kind: 'free',
      distancePixels: Infinity,
    };
  }

  function hideHover() {
    if (moveFrame) {
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
    }
    hover = null;
    previewLayer.clearLayers();
    snapIndicator.hide();
  }

  function paintHover(target) {
    if (!active) return;
    hover = target;
    previewLayer.clearLayers();
    if (current?.points.length) {
      const last = current.points[current.points.length - 1];
      L.polyline([[last.lat, last.lon], [target.lat, target.lon]], {
        color: '#bdf4ff',
        weight: 2,
        opacity: 0.85,
        dashArray: '5 6',
        interactive: false,
        className: 'measure-preview',
      }).addTo(previewLayer);
    }
    snapIndicator.show(target);
  }

  function addAt(latlng) {
    if (!active || !latlng) return null;
    const target = snapAt(latlng);
    const previous = current?.points[current.points.length - 1];
    if (previous && distanceMeters(previous, target) < 0.01) return previous;
    remember();
    if (!current) {
      current = { points: [] };
      sections.push(current);
    }
    current.points.push(target);
    hideHover();
    draw();
    notify();
    return target;
  }

  let panState = null;

  function onContainerClick(event) {
    if (!active || event.button !== 0) return;
    if (event.target instanceof Element
      && event.target.closest('.leaflet-control, .leaflet-control-container')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    addAt(map.mouseEventToLatLng(event));
  }

  function onContextMenu(event) {
    if (!active) return;
    L.DomEvent.preventDefault(event.originalEvent);
  }

  function clearPan() {
    if (!panState) return;
    panState = null;
    map.getContainer().style.cursor = '';
  }

  const domLifecycle = new AbortController();
  const container = map.getContainer();
  container.addEventListener('click', onContainerClick, { capture: true, signal: domLifecycle.signal });
  container.addEventListener('pointerdown', (event) => {
    if (!active || (event.button !== 2 && event.button !== 1)) return;
    if (event.target instanceof Element && event.target.closest('.leaflet-control, .leaflet-control-container')) {
      return;
    }
    event.preventDefault();
    panState = { x: event.clientX, y: event.clientY };
    hideHover();
    container.style.cursor = 'grabbing';
  }, { signal: domLifecycle.signal });
  window.addEventListener('pointermove', (event) => {
    if (!panState) return;
    const dx = panState.x - event.clientX;
    const dy = panState.y - event.clientY;
    panState.x = event.clientX;
    panState.y = event.clientY;
    map.panBy([dx, dy], { animate: false });
  }, { signal: domLifecycle.signal });
  window.addEventListener('pointerup', clearPan, { signal: domLifecycle.signal });
  window.addEventListener('pointercancel', clearPan, { signal: domLifecycle.signal });
  window.addEventListener('blur', clearPan, { signal: domLifecycle.signal });

  let pendingHoverLatLng = null;
  function onMouseMove(event) {
    if (!active || panState) return;
    if (event.originalEvent?.target?.closest?.('.leaflet-control')) {
      pendingHoverLatLng = null;
      hideHover();
      return;
    }
    pendingHoverLatLng = event.latlng;
    if (moveFrame) return;
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;
      const latlng = pendingHoverLatLng;
      pendingHoverLatLng = null;
      if (active && !panState && latlng) paintHover(snapAt(latlng));
    });
  }

  map.on('contextmenu', onContextMenu);
  map.on('mousemove', onMouseMove);
  map.on('mouseout', hideHover);
  map.on('movestart zoomstart', hideHover);

  function start() {
    getTrackIndex();
    active = true;
    map.closePopup();
    if (map.dragging) map.dragging.disable();
    document.body.classList.add('measuring');
    notify();
  }

  function stop() {
    active = false;
    clearPan();
    if (map.dragging) map.dragging.enable();
    document.body.classList.remove('measuring');
    hideHover();
    notify();
  }

  function endSection() {
    if (!current || current.points.length < 2) return false;
    remember();
    current = null;
    hideHover();
    draw();
    notify();
    return true;
  }

  function undo() {
    if (undoStack.length === 0) return false;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    hideHover();
    draw();
    notify();
    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    hideHover();
    draw();
    notify();
    return true;
  }

  function clear() {
    if (sections.length === 0) return false;
    remember();
    sections = [];
    current = null;
    hideHover();
    draw();
    notify();
    return true;
  }

  function relabel() {
    draw();
    snapIndicator.relabel();
    notify();
  }

  function destroy() {
    stop();
    if (moveFrame) {
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
    }
    pendingHoverLatLng = null;
    domLifecycle.abort();
    map.off('contextmenu', onContextMenu);
    map.off('mousemove', onMouseMove);
    map.off('mouseout', hideHover);
    map.off('movestart zoomstart', hideHover);
    layer.remove();
    previewLayer.remove();
    listeners.clear();
  }

  return {
    start,
    stop,
    destroy,
    addAt,
    endSection,
    undo,
    redo,
    clear,
    relabel,
    /** @param {{ gpx?: any, segments?: any }} [next] */
    updateData(next = {}) {
      const { gpx: nextGpx, segments: nextSegments } = next;
      if (nextGpx) gpx = nextGpx;
      if (nextSegments) segments = nextSegments;
      waypointIndex = null;
      trackIndex = null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    active: () => active,
    summary: () => measurementSummary(sections.map((section) => section.points)),
    sections: () => sections.map((section) => section.points.map((point) => ({ ...point }))),
    canEndSection: () => Boolean(current && current.points.length >= 2),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    indexed: () => Boolean(trackIndex),
    snapAt,
    snapMarker: snapMarkerAt,
    snapCoordinate: snapCoordinateAt,
  };
}
