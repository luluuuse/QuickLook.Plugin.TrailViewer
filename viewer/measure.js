import { distanceMeters } from './geo.js';
import { createPointIndex } from './spatial.js';

export const SNAP_PIXELS = 14;

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
 * Pick the closest target within the snap radius. A marker wins an exact tie so the more meaningful
 * object is recorded when a waypoint and a track sample occupy the same pixel.
 *
 * @param {{kind:string, distancePixels:number}[]} candidates
 */
export function chooseSnap(candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (!(candidate.distancePixels <= SNAP_PIXELS)) continue;
    if (!best
      || candidate.distancePixels < best.distancePixels
      || (candidate.distancePixels === best.distancePixels
        && candidate.kind === 'marker' && best.kind !== 'marker')) {
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
  onLayoutChange,
}) {
  const waypointIndex = createPointIndex(gpx.waypoints || []);
  const trackPoints = segments.flatMap((segment) => segment.points);
  const trackIndex = createPointIndex(trackPoints);
  const layer = L.layerGroup().addTo(map);
  const previewLayer = L.layerGroup().addTo(map);
  const snapLayer = L.layerGroup().addTo(map);
  const listeners = new Set();
  let sections = [];
  let current = null;
  let active = false;
  let hover = null;
  let moveFrame = 0;
  const undoStack = [];
  let redoStack = [];

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
    const lon = Number(latlng.lng ?? latlng.lon);
    const point = index.nearest({ lat: Number(latlng.lat), lon });
    if (!point) return null;
    const target = map.latLngToContainerPoint(latlng);
    const pointScreen = map.latLngToContainerPoint([point.lat, point.lon]);
    return {
      lat: point.lat,
      lon: point.lon,
      kind,
      distancePixels: target.distanceTo(pointScreen),
    };
  }

  function snapAt(latlng) {
    const marker = nearest(waypointIndex, latlng, 'marker');
    const track = nearest(trackIndex, latlng, 'track');
    return chooseSnap([marker, track].filter(Boolean)) || {
      lat: Number(latlng.lat),
      lon: Number(latlng.lng ?? latlng.lon),
      kind: 'free',
      distancePixels: Infinity,
    };
  }

  function hideHover() {
    hover = null;
    previewLayer.clearLayers();
    snapLayer.clearLayers();
  }

  function paintHover(target) {
    if (!active) return;
    hover = target;
    previewLayer.clearLayers();
    snapLayer.clearLayers();
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
    if (target.kind === 'free') return;
    L.circleMarker([target.lat, target.lon], {
      radius: 10,
      color: '#fff2a8',
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 0.08,
      interactive: false,
      pane: 'markerPane',
    }).addTo(snapLayer);
    const text = target.kind === 'marker' ? t('measure.snapMarker') : t('measure.snapTrack');
    L.marker([target.lat, target.lon], {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'measure-snap-label',
        html: `<span>${text}</span>`,
        iconAnchor: [-12, 22],
      }),
    }).addTo(snapLayer);
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

  function onContextMenu(event) {
    if (!active) return;
    L.DomEvent.preventDefault(event.originalEvent);
    addAt(event.latlng);
  }

  function onMouseMove(event) {
    if (!active || moveFrame) return;
    const latlng = event.latlng;
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;
      if (active) paintHover(snapAt(latlng));
    });
  }

  map.on('contextmenu', onContextMenu);
  map.on('mousemove', onMouseMove);
  map.on('mouseout', hideHover);
  map.on('movestart zoomstart', hideHover);

  function start() {
    active = true;
    document.body.classList.add('measuring');
    notify();
  }

  function stop() {
    active = false;
    document.body.classList.remove('measuring');
    hideHover();
    notify();
  }

  function endSection() {
    if (!current || current.points.length < 2) return false;
    remember();
    current = null;
    hideHover();
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
    if (hover) paintHover(hover);
    notify();
  }

  return {
    start,
    stop,
    addAt,
    endSection,
    undo,
    redo,
    clear,
    relabel,
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
    snapAt,
  };
}
