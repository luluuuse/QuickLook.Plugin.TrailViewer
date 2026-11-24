import { distanceMeters } from './geo.js';
import { symbolMarkup } from './icons.js';
import { SNAP_PIXELS, chooseSnap } from './measure.js';
import { createSnapReticleMarker } from './snap-indicator.js';
import { createPointIndex } from './spatial.js';
import { sliceRouteByDistance } from './track-analysis.js';
import { SPLIT_COLORS, detectAnomalyPoints, normalizedTracks, trackTotalDistance } from './track-ops.js';

const KEEP_COLOR = '#f97316';
const CUT_COLOR = '#64748b';
const KNOWN_WPT_SYMS = new Set(['pin', 'water', 'supply', 'camp', 'summit', 'danger', 'junction']);

function allPathEntries(parsed) {
  const entries = [];
  let flatSegIndex = 0;
  const tracks = (parsed?.tracks?.length || 0) > 0
    ? parsed.tracks
    : normalizedTracks(parsed);
  for (const t of tracks || []) {
    for (const seg of t.segments || []) {
      if (seg.length >= 2) {
        let south = Infinity;
        let west = Infinity;
        let north = -Infinity;
        let east = -Infinity;
        for (let i = 0; i < seg.length; i += 1) {
          const pt = seg[i];
          if (pt.lat < south) south = pt.lat;
          if (pt.lat > north) north = pt.lat;
          if (pt.lon < west) west = pt.lon;
          if (pt.lon > east) east = pt.lon;
        }
        entries.push({ flatSegIndex, points: seg, south, west, north, east });
      }
      flatSegIndex += 1;
    }
  }
  return entries;
}

function pointAtDistance(paths, targetMeters) {
  let along = 0;
  for (const pts of paths) {
    if (!pts || pts.length < 2) continue;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const segLen = distanceMeters(a, b);
      if (along + segLen >= targetMeters || (i === pts.length - 1 && paths[paths.length - 1] === pts)) {
        const ratio = segLen > 0 ? Math.max(0, Math.min(1, (targetMeters - along) / segLen)) : 0;
        return {
          lat: a.lat + (b.lat - a.lat) * ratio,
          lon: a.lon + (b.lon - a.lon) * ratio,
        };
      }
      along += segLen;
    }
  }
  return null;
}

function buildScreenCache(map, pathEntries) {
  const segments = [];
  let along = 0;
  for (const entry of pathEntries) {
    const pts = entry.points;
    let prevPt = null;
    let prevPx = null;
    for (let i = 0; i < pts.length; i += 1) {
      const pt = pts[i];
      const px = map.latLngToContainerPoint([pt.lat, pt.lon]);
      if (prevPt && prevPx) {
        const step = distanceMeters(prevPt, pt);
        segments.push({
          flatSegIndex: entry.flatSegIndex,
          segPtIndex: i - 1,
          a: prevPt,
          b: pt,
          pa: prevPx,
          pb: px,
          along,
          step,
        });
        along += step;
      }
      prevPt = pt;
      prevPx = px;
    }
  }
  return segments;
}

function nearestOnTrack(map, cachedSegments, latlng) {
  if (!cachedSegments || cachedSegments.length === 0) return null;
  const targetPx = map.latLngToContainerPoint(latlng);
  let best = null;

  for (let i = 0; i < cachedSegments.length; i += 1) {
    const seg = cachedSegments[i];
    const { flatSegIndex, segPtIndex, a, b, pa, pb, along, step } = seg;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0
      ? Math.max(0, Math.min(1, ((targetPx.x - pa.x) * dx + (targetPx.y - pa.y) * dy) / lenSq))
      : 0;
    const px = pa.x + dx * t;
    const py = pa.y + dy * t;
    const distPx = Math.hypot(targetPx.x - px, targetPx.y - py);
    if (!best || distPx < best.distPx) {
      const lat = a.lat + (b.lat - a.lat) * t;
      const lon = a.lon + (b.lon - a.lon) * t;
      const ele = Number.isFinite(a.ele) && Number.isFinite(b.ele)
        ? a.ele + (b.ele - a.ele) * t
        : (Number.isFinite(a.ele) ? a.ele : undefined);
      best = {
        distPx,
        lat,
        lon,
        ele,
        alongMeters: along + step * t,
        flatSegIndex,
        segPtIndex,
        segT: t,
      };
    }
  }
  return best;
}

/**
 * Semantic Leaflet overlay for the track editor: crop keep/cut preview, split cutter,
 * anomaly highlights, draggable waypoints and map context menu.
 * @param {{
 *   L: any,
 *   map: any,
 *   el?: Function,
 *   t?: Function,
 *   formatDistance?: (meters: number) => string,
 *   onSplitAt?: (meters: number) => void,
 *   onSplitHover?: (meters: number | null) => void,
 *   onPickWaypointLocation?: (loc: { lat: number, lon: number, ele?: number, snapped: boolean }) => void,
 *   onSelectWaypoint?: (index: number) => void,
 *   onMoveWaypoint?: (index: number, lat: number, lon: number) => void,
 *   onRotateLoopStart?: (alongMeters: number) => void,
 *   onBoxErase?: (bounds: { south: number, west: number, north: number, east: number }) => void,
 *   onMoveVertex?: (flatSegIndex: number, ptIndex: number, lat: number, lon: number) => void,
 *   onInsertVertex?: (flatSegIndex: number, afterIndex: number, lat: number, lon: number, ele?: number) => void,
 *   onViewportChange?: () => void,
 *   onContextMenu?: (info: { clientX: number, clientY: number, lat: number, lon: number, ele?: number, splitMeters: number | null, waypointIndex?: number }) => void,
 *   onDrawChange?: (draft: { count: number, distanceMeters: number, startSnap: any, endSnap: any }) => void,
 * }} opts
 */
export function createEditorOverlay({
  L,
  map,
  el = null,
  t = (key) => key,
  formatDistance = (meters) => (meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`),
  onSplitAt = () => {},
  onSplitHover = () => {},
  onPickWaypointLocation = () => {},
  onSelectWaypoint = () => {},
  onMoveWaypoint = () => {},
  onRotateLoopStart = () => {},
  onBoxErase = () => {},
  onMoveVertex = () => {},
  onInsertVertex = () => {},
  onViewportChange = () => {},
  onContextMenu = () => {},
  onDrawChange = () => {},
}) {
  /** @type {(meters: number) => void} */
  const handleSplitAt = onSplitAt;
  /** @type {(meters: number | null) => void} */
  const handleSplitHover = onSplitHover;
  /** @type {(loc: { lat: number, lon: number, ele?: number, snapped: boolean }) => void} */
  const handlePickWaypointLocation = onPickWaypointLocation;
  /** @type {(index: number) => void} */
  const handleSelectWaypoint = onSelectWaypoint;
  /** @type {(index: number, lat: number, lon: number) => void} */
  const handleMoveWaypoint = onMoveWaypoint;
  /** @type {(meters: number) => void} */
  const handleRotateLoopStart = onRotateLoopStart;
  /** @type {(bounds: { south: number, west: number, north: number, east: number }) => void} */
  const handleBoxErase = onBoxErase;
  /** @type {(segIdx: number, ptIdx: number, lat: number, lon: number) => void} */
  const handleMoveVertex = onMoveVertex;
  /** @type {(segIdx: number, afterIdx: number, lat: number, lon: number, ele?: number) => void} */
  const handleInsertVertex = onInsertVertex;
  /** @type {() => void} */
  const handleViewportChange = onViewportChange;
  /** @type {(info: any) => void} */
  const handleContextMenu = onContextMenu;
  /** @type {(draft: { count: number, distanceMeters: number, startSnap: any, endSnap: any }) => void} */
  const handleDrawChange = onDrawChange;
  let group = null;
  let trackGroup = null;
  let boxPreviewGroup = null;
  let waypointGroup = null;
  let vertexGroup = null;
  let drawGroup = null;
  let drawPoints = [];
  let drawRubberLine = null;
  let drawSnapReticle = null;
  let drawEndpointIndex = null;
  let drawWptIndex = null;
  let boxEl = null;
  let boxBadgeEl = null;
  let boxStartPt = null;
  let boxLatestClient = null;
  let boxPreviewFrame = 0;
  const boxTargetedWpts = new Set();
  let panState = null;
  let suppressNextContextMenu = false;
  let visibleVertexCount = 0;
  let hiddenMidpoints = false;
  let excludedAnomalyKeys = new Set();
  let splitCursor = null;
  let splitDistMarker = null;
  let lifecycle = null;
  let currentParsed = null;
  let cachedPathEntries = [];
  let cachedPaths = [];
  let cachedTotalMeters = 0;
  let cachedScreenSegments = null;
  let hoverFrame = 0;
  let pendingHoverLatLng = null;
  let activeTool = 'crop';
  let activeSubMode = 'crop';
  let cropRange = [0, 0];
  let selectedWptIndex = -1;
  let highlightedSegIndex = -1;
  let segmentColorResolver = null;
  let waypointsVisible = true;

  function resolveColors(tracks) {
    if (typeof segmentColorResolver === 'function') return segmentColorResolver(tracks);
    return tracks.map((_, idx) => SPLIT_COLORS[idx % SPLIT_COLORS.length]);
  }
  const wptMarkers = new Map();
  let wptSelectionReticle = null;
  let focusFrame = 0;
  const vertexDotIcon = L.divIcon({
    className: 'editor-vertex-dot',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
  const vertexMidIcon = L.divIcon({
    className: 'editor-vertex-mid',
    html: '+',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
  const MAX_MARKER_POOL = 220;
  const markerMeta = new WeakMap();
  const activeVertexMarkers = new Map();
  const vertexMarkerPool = [];
  const activeMidMarkers = new Map();
  const midMarkerPool = [];

  function clearBoxPreview() {
    if (boxPreviewFrame) {
      cancelAnimationFrame(boxPreviewFrame);
      boxPreviewFrame = 0;
    }
    boxPreviewGroup?.clearLayers();
    for (const elNode of boxTargetedWpts) {
      elNode.classList.remove('is-box-targeted');
    }
    boxTargetedWpts.clear();
  }

  function clearBox() {
    clearBoxPreview();
    if (boxEl) {
      boxEl.remove();
      boxEl = null;
    }
    boxBadgeEl = null;
    boxStartPt = null;
    boxLatestClient = null;
  }

  function pointInGeoBounds(pt, bounds) {
    return pt.lat >= bounds.south && pt.lat <= bounds.north
      && pt.lon >= bounds.west && pt.lon <= bounds.east;
  }

  function flushBoxPreview() {
    boxPreviewFrame = 0;
    clearBoxPreview();
    if (!boxStartPt || !boxLatestClient || !boxBadgeEl || !currentParsed || !boxPreviewGroup) return;
    const width = Math.abs(boxLatestClient.x - boxStartPt.x);
    const height = Math.abs(boxLatestClient.y - boxStartPt.y);
    if (width < 6 && height < 6) {
      boxBadgeEl.hidden = true;
      return;
    }

    const p1 = map.containerPointToLatLng([
      Math.min(boxStartPt.x, boxLatestClient.x),
      Math.max(boxStartPt.y, boxLatestClient.y),
    ]);
    const p2 = map.containerPointToLatLng([
      Math.max(boxStartPt.x, boxLatestClient.x),
      Math.min(boxStartPt.y, boxLatestClient.y),
    ]);
    const bounds = {
      south: Math.min(p1.lat, p2.lat),
      west: Math.min(p1.lng, p2.lng),
      north: Math.max(p1.lat, p2.lat),
      east: Math.max(p1.lng, p2.lng),
    };

    let validSegCount = 0;
    const segStates = cachedPathEntries.map((entry) => {
      if (entry.north < bounds.south || entry.south > bounds.north
        || entry.east < bounds.west || entry.west > bounds.east) {
        validSegCount += 1;
        return { entry, overlaps: false, keptCount: entry.points.length };
      }
      let keptCount = 0;
      const pts = entry.points;
      for (let i = 0; i < pts.length; i += 1) {
        if (!pointInGeoBounds(pts[i], bounds)) keptCount += 1;
      }
      if (keptCount >= 2) validSegCount += 1;
      return { entry, overlaps: true, keptCount };
    });

    if (validSegCount === 0) {
      boxBadgeEl.classList.add('is-blocked');
      boxBadgeEl.textContent = t('editor.clean.boxPreviewBlocked');
      boxBadgeEl.hidden = false;
      return;
    }

    let erasedPtCount = 0;
    let previewDots = 0;
    for (const item of segStates) {
      if (!item.overlaps) continue;
      const pts = item.entry.points;
      if (item.keptCount < 2) {
        erasedPtCount += pts.length;
        L.polyline(
          pts.map((pt) => [pt.lat, pt.lon]),
          { color: '#ef4444', weight: 6, opacity: 0.9, interactive: false },
        ).addTo(boxPreviewGroup);
        continue;
      }
      let run = [];
      const flushRun = () => {
        if (run.length >= 2) {
          L.polyline(
            run.map((pt) => [pt.lat, pt.lon]),
            { color: '#ef4444', weight: 6, opacity: 0.9, interactive: false },
          ).addTo(boxPreviewGroup);
        } else if (run.length === 1 && previewDots < 120) {
          previewDots += 1;
          L.circleMarker([run[0].lat, run[0].lon], {
            radius: 4.5,
            color: '#ffffff',
            weight: 1.5,
            fillColor: '#ef4444',
            fillOpacity: 0.95,
            interactive: false,
          }).addTo(boxPreviewGroup);
        }
        run = [];
      };
      for (let i = 0; i < pts.length; i += 1) {
        const pt = pts[i];
        if (pointInGeoBounds(pt, bounds)) {
          erasedPtCount += 1;
          run.push(pt);
        } else {
          flushRun();
        }
      }
      flushRun();
    }

    let erasedWptCount = 0;
    (currentParsed.waypoints || []).forEach((wpt, index) => {
      if (!Number.isFinite(wpt.lat) || !Number.isFinite(wpt.lon)) return;
      if (!pointInGeoBounds(wpt, bounds)) return;
      erasedWptCount += 1;
      L.circleMarker([wpt.lat, wpt.lon], {
        radius: 11,
        color: '#ef4444',
        weight: 2.5,
        fillColor: '#ef4444',
        fillOpacity: 0.25,
        interactive: false,
      }).addTo(boxPreviewGroup);
      const wptEl = wptMarkers.get(index)?.getElement();
      if (wptEl) {
        wptEl.classList.add('is-box-targeted');
        boxTargetedWpts.add(wptEl);
      }
    });

    boxBadgeEl.classList.remove('is-blocked');
    if (erasedPtCount > 0 && erasedWptCount > 0) {
      boxBadgeEl.textContent = t('editor.clean.boxPreviewBoth', { points: erasedPtCount, waypoints: erasedWptCount });
      boxBadgeEl.hidden = false;
    } else if (erasedPtCount > 0) {
      boxBadgeEl.textContent = t('editor.clean.boxPreviewPoints', { points: erasedPtCount });
      boxBadgeEl.hidden = false;
    } else if (erasedWptCount > 0) {
      boxBadgeEl.textContent = t('editor.clean.boxPreviewWaypoints', { waypoints: erasedWptCount });
      boxBadgeEl.hidden = false;
    } else {
      boxBadgeEl.hidden = true;
    }
  }

  function clearPan() {
    if (!panState) return;
    if (panState.button === 2 && panState.moved) {
      suppressNextContextMenu = true;
      setTimeout(() => { suppressNextContextMenu = false; }, 0);
    }
    panState = null;
    map.getContainer().classList.remove('editor-cursor-grabbing');
  }

  function isBoxEraseMode() {
    return Boolean(group) && activeTool === 'draw' && activeSubMode === 'box-erase';
  }

  function isVertexMode() {
    return Boolean(group) && activeTool === 'draw' && activeSubMode === 'vertex';
  }

  function isDrawMode() {
    return Boolean(group) && activeTool === 'draw' && (activeSubMode === 'draw' || activeSubMode === '');
  }

  function rebuildDrawSnapIndexes() {
    const endpoints = [];
    for (const entry of cachedPathEntries) {
      const pts = entry.points;
      if (pts.length === 0) continue;
      endpoints.push({
        lat: pts[0].lat,
        lon: pts[0].lon,
        ele: pts[0].ele,
        flatSegIndex: entry.flatSegIndex,
        ptIndex: 0,
      });
      if (pts.length > 1) {
        const lastIdx = pts.length - 1;
        endpoints.push({
          lat: pts[lastIdx].lat,
          lon: pts[lastIdx].lon,
          ele: pts[lastIdx].ele,
          flatSegIndex: entry.flatSegIndex,
          ptIndex: lastIdx,
        });
      }
    }
    drawEndpointIndex = endpoints.length > 0 ? createPointIndex(endpoints) : null;
    const wpts = (currentParsed?.waypoints || []).filter(
      (wpt) => Number.isFinite(wpt.lat) && Number.isFinite(wpt.lon),
    );
    drawWptIndex = wpts.length > 0 ? createPointIndex(wpts) : null;
  }

  function computeDrawDistance() {
    let total = 0;
    for (let i = 1; i < drawPoints.length; i += 1) {
      total += distanceMeters(drawPoints[i - 1], drawPoints[i]);
    }
    return total;
  }

  function notifyDrawChange() {
    const startSnap = drawPoints.length > 0 ? (drawPoints[0].snap || null) : null;
    const endSnap = drawPoints.length > 1 ? (drawPoints[drawPoints.length - 1].snap || null) : null;
    handleDrawChange({
      count: drawPoints.length,
      distanceMeters: computeDrawDistance(),
      startSnap,
      endSnap,
    });
  }

  function resolveDrawSnap(latlng) {
    if (!latlng) return null;
    const cursorPt = map.latLngToContainerPoint(latlng);
    // Tier 1 (higher priority): waypoints and segment start/end/break endpoints.
    const priorityCandidates = [];
    const nearWpt = drawWptIndex?.nearest({ lat: latlng.lat, lon: latlng.lng });
    if (nearWpt) {
      const p = map.latLngToContainerPoint([nearWpt.lat, nearWpt.lon]);
      const d = Math.hypot(p.x - cursorPt.x, p.y - cursorPt.y);
      if (d <= SNAP_PIXELS) {
        // If this waypoint sits right on a segment endpoint or along a track, preserve its track anchor too.
        let attachedSnap = null;
        const nearEnd = drawEndpointIndex?.nearest({ lat: nearWpt.lat, lon: nearWpt.lon });
        if (nearEnd && distanceMeters(nearWpt, nearEnd) <= 3) {
          attachedSnap = { flatSegIndex: nearEnd.flatSegIndex, ptIndex: nearEnd.ptIndex, segT: 0 };
        } else {
          const wptTrackHit = nearestOnTrack(map, getScreenSegments(), { lat: nearWpt.lat, lng: nearWpt.lon });
          if (wptTrackHit && distanceMeters(nearWpt, wptTrackHit) <= 15) {
            attachedSnap = {
              flatSegIndex: wptTrackHit.flatSegIndex,
              ptIndex: wptTrackHit.segPtIndex,
              segT: wptTrackHit.segT,
            };
          }
        }
        priorityCandidates.push({
          kind: 'marker',
          distancePixels: d,
          lat: nearWpt.lat,
          lon: nearWpt.lon,
          ele: nearWpt.ele,
          snap: attachedSnap,
        });
      }
    }
    const nearEnd = drawEndpointIndex?.nearest({ lat: latlng.lat, lon: latlng.lng });
    if (nearEnd) {
      const p = map.latLngToContainerPoint([nearEnd.lat, nearEnd.lon]);
      const d = Math.hypot(p.x - cursorPt.x, p.y - cursorPt.y);
      if (d <= SNAP_PIXELS) {
        priorityCandidates.push({
          kind: 'measure',
          distancePixels: d,
          lat: nearEnd.lat,
          lon: nearEnd.lon,
          ele: nearEnd.ele,
          snap: { flatSegIndex: nearEnd.flatSegIndex, ptIndex: nearEnd.ptIndex, segT: 0 },
        });
      }
    }
    const priorityHit = chooseSnap(priorityCandidates);
    if (priorityHit) return priorityHit;

    // Tier 2: arbitrary continuous point along any track segment.
    const trackHit = nearestOnTrack(map, getScreenSegments(), latlng);
    if (trackHit && trackHit.distPx <= SNAP_PIXELS) {
      return {
        kind: 'track',
        distancePixels: trackHit.distPx,
        lat: trackHit.lat,
        lon: trackHit.lon,
        ele: trackHit.ele,
        snap: {
          flatSegIndex: trackHit.flatSegIndex,
          ptIndex: trackHit.segPtIndex,
          segT: trackHit.segT,
        },
      };
    }
    return null;
  }

  function clearDrawHover() {
    if (drawRubberLine) {
      drawRubberLine.remove();
      drawRubberLine = null;
    }
    if (drawSnapReticle) {
      drawSnapReticle.remove();
      drawSnapReticle = null;
    }
  }

  function renderDrawLayer() {
    if (!drawGroup) return;
    drawGroup.clearLayers();
    clearDrawHover();
    if (!isDrawMode() || drawPoints.length === 0) return;

    if (drawPoints.length >= 2) {
      L.polyline(
        drawPoints.map((pt) => [pt.lat, pt.lon]),
        {
          color: '#38bdf8',
          weight: 4,
          opacity: 0.95,
          dashArray: '8 5',
          interactive: false,
        },
      ).addTo(drawGroup);
    }
    drawPoints.forEach((pt, idx) => {
      const isEndpoint = idx === 0 || idx === drawPoints.length - 1;
      L.circleMarker([pt.lat, pt.lon], {
        radius: isEndpoint ? 6 : 4.5,
        color: '#ffffff',
        weight: 2,
        fillColor: pt.snap ? '#22c55e' : '#38bdf8',
        fillOpacity: 1,
        interactive: false,
      }).addTo(drawGroup);
    });
  }

  function clearDrawDraft({ notify = true } = {}) {
    const hadPoints = drawPoints.length > 0;
    drawPoints = [];
    clearDrawHover();
    if (drawGroup) drawGroup.clearLayers();
    if (notify && hadPoints) notifyDrawChange();
  }

  function updateCursorClass() {
    const container = map.getContainer();
    const isSplit = activeTool === 'crop' && activeSubMode === 'split';
    const isLoopStart = activeTool === 'topology' && activeSubMode === 'loop-start';
    container.classList.toggle(
      'editor-cursor-crosshair',
      Boolean(group) && (
        isSplit
        || isLoopStart
        || activeTool === 'waypoint'
        || isBoxEraseMode()
        || isDrawMode()
      ),
    );
    if (map.dragging) {
      if (isBoxEraseMode() || isDrawMode()) map.dragging.disable();
      else map.dragging.enable();
    }
  }

  function buildWptTooltip(wpt, index) {
    const wrap = el ? el('div') : document.createElement('div');
    const title = el
      ? el('div', 'editor-wpt-tooltip-title', wpt.name || t('editor.wpt.defaultName', { index: index + 1 }))
      : document.createElement('div');
    if (!el) {
      title.className = 'editor-wpt-tooltip-title';
      title.textContent = wpt.name || `#${index + 1}`;
    }
    wrap.append(title);

    const metaParts = [];
    if (wpt.icon && KNOWN_WPT_SYMS.has(wpt.icon)) {
      metaParts.push(t(`editor.wpt.sym.${wpt.icon}`));
    }
    if (Number.isFinite(wpt.ele)) metaParts.push(`${Math.round(wpt.ele)} ${t('unit.m')}`);
    if (metaParts.length > 0) {
      const meta = el ? el('div', 'editor-wpt-tooltip-meta', metaParts.join(' · ')) : document.createElement('div');
      if (!el) {
        meta.className = 'editor-wpt-tooltip-meta';
        meta.textContent = metaParts.join(' · ');
      }
      wrap.append(meta);
    }

    if (wpt.description) {
      const desc = el ? el('div', 'editor-wpt-tooltip-desc', wpt.description) : document.createElement('div');
      if (!el) {
        desc.className = 'editor-wpt-tooltip-desc';
        desc.textContent = wpt.description;
      }
      wrap.append(desc);
    }
    return wrap;
  }

  function getScreenSegments() {
    if (!cachedScreenSegments) {
      cachedScreenSegments = buildScreenCache(map, cachedPathEntries);
    }
    return cachedScreenSegments;
  }

  function invalidateScreenCache() {
    cachedScreenSegments = null;
  }

  function renderTrackLayer() {
    if (!trackGroup || !currentParsed) return;
    trackGroup.clearLayers();
    splitCursor = null;

    const paths = cachedPaths;
    const total = cachedTotalMeters;

    if (activeTool === 'crop' && activeSubMode === 'crop' && total > 0) {
      const from = Math.max(0, Math.min(total, cropRange[0]));
      const to = Math.max(from, Math.min(total, cropRange[1]));
      if (from > 1) {
        for (const seg of sliceRouteByDistance(paths, { from: 0, to: from })) {
          L.polyline(seg.map((p) => [p.lat, p.lon]), {
            color: CUT_COLOR,
            weight: 4,
            opacity: 0.75,
            dashArray: '6 5',
            interactive: false,
          }).addTo(trackGroup);
        }
      }
      if (to < total - 1) {
        for (const seg of sliceRouteByDistance(paths, { from: to, to: total })) {
          L.polyline(seg.map((p) => [p.lat, p.lon]), {
            color: CUT_COLOR,
            weight: 4,
            opacity: 0.75,
            dashArray: '6 5',
            interactive: false,
          }).addTo(trackGroup);
        }
      }
      const tracks = normalizedTracks(currentParsed);
      if (tracks.length > 1) {
        const colors = resolveColors(tracks);
        let trackOffset = 0;
        tracks.forEach((track, idx) => {
          const trackSegs = (track.segments || []).filter((s) => s.length >= 2);
          const trackLen = trackTotalDistance({ name: '', tracks: [track], routes: [], waypoints: [] });
          const overlapFrom = Math.max(from, trackOffset) - trackOffset;
          const overlapTo = Math.min(to, trackOffset + trackLen) - trackOffset;
          if (overlapTo > overlapFrom && trackSegs.length > 0) {
            const color = colors[idx] || SPLIT_COLORS[idx % SPLIT_COLORS.length];
            for (const seg of sliceRouteByDistance(trackSegs, { from: overlapFrom, to: overlapTo })) {
              L.polyline(seg.map((p) => [p.lat, p.lon]), {
                color,
                weight: 5,
                opacity: 0.96,
                interactive: false,
              }).addTo(trackGroup);
            }
          }
          trackOffset += trackLen;
        });
      } else {
        for (const seg of sliceRouteByDistance(paths, { from, to })) {
          L.polyline(seg.map((p) => [p.lat, p.lon]), {
            color: KEEP_COLOR,
            weight: 5,
            opacity: 0.96,
            interactive: false,
          }).addTo(trackGroup);
        }
      }
    } else {
      const tracks = normalizedTracks(currentParsed);
      const weight = activeTool === 'crop' && activeSubMode === 'split' ? 5 : 4.5;
      if (tracks.length > 1) {
        const colors = resolveColors(tracks);
        const hasHighlight = highlightedSegIndex >= 0 && highlightedSegIndex < tracks.length;
        const drawTrackItem = (track, idx, isFocused) => {
          const color = colors[idx] || SPLIT_COLORS[idx % SPLIT_COLORS.length];
          const segs = (track.segments || []).filter((s) => s.length >= 2);
          for (const seg of segs) {
            const latlngs = seg.map((p) => [p.lat, p.lon]);
            if (isFocused) {
              L.polyline(latlngs, {
                color: '#ffffff',
                weight: 9,
                opacity: 0.8,
                interactive: false,
              }).addTo(trackGroup);
            }
            L.polyline(latlngs, {
              color,
              weight: isFocused ? 5.5 : (hasHighlight ? 3.5 : weight),
              opacity: isFocused ? 1 : (hasHighlight ? 0.28 : 0.92),
              interactive: false,
            }).addTo(trackGroup);
          }
          if (isFocused && segs.length > 0) {
            const firstPt = segs[0][0];
            const lastSeg = segs[segs.length - 1];
            const lastPt = lastSeg[lastSeg.length - 1];
            for (const endPt of [firstPt, lastPt]) {
              if (!endPt) continue;
              L.circleMarker([endPt.lat, endPt.lon], {
                radius: 6.5,
                color: '#ffffff',
                weight: 2,
                fillColor: color,
                fillOpacity: 1,
                interactive: false,
              }).addTo(trackGroup);
            }
          }
        };
        tracks.forEach((track, idx) => {
          if (hasHighlight && idx === highlightedSegIndex) return;
          drawTrackItem(track, idx, false);
        });
        if (hasHighlight) {
          drawTrackItem(tracks[highlightedSegIndex], highlightedSegIndex, true);
        }
      } else {
        for (const seg of paths) {
          L.polyline(seg.map((p) => [p.lat, p.lon]), {
            color: KEEP_COLOR,
            weight,
            opacity: 0.92,
            interactive: false,
          }).addTo(trackGroup);
        }
      }
    }

    // Start/End markers for the current edited track
    const firstPt = paths[0]?.[0];
    const lastSeg = paths[paths.length - 1];
    const lastPt = lastSeg?.[lastSeg.length - 1];
    if (lastPt) {
      L.circleMarker([lastPt.lat, lastPt.lon], {
        radius: 7,
        color: '#1b1b1b',
        weight: 1.5,
        fillColor: '#e5243b',
        fillOpacity: 1,
        interactive: false,
      }).addTo(trackGroup);
    }
    if (firstPt) {
      L.circleMarker([firstPt.lat, firstPt.lon], {
        radius: 5,
        color: '#1b1b1b',
        weight: 1.5,
        fillColor: '#18c964',
        fillOpacity: 1,
        interactive: false,
      }).addTo(trackGroup);
    }

    // Highlight detected GPS drift anomalies in clean auto-detect mode
    if (activeTool === 'clean' && activeSubMode !== 'smooth-ele' && activeSubMode !== 'simplify') {
      for (const spike of detectAnomalyPoints(currentParsed)) {
        const excluded = excludedAnomalyKeys.has(spike.key);
        L.circleMarker([spike.lat, spike.lon], {
          radius: excluded ? 5 : 6,
          color: excluded ? '#94a3b8' : '#ffffff',
          weight: 1.5,
          opacity: excluded ? 0.45 : 1,
          fillColor: excluded ? '#94a3b8' : '#ef4444',
          fillOpacity: excluded ? 0.3 : 0.95,
          interactive: false,
        }).addTo(trackGroup);
      }
    }
  }

  function updateWaypointSelection(nextIndex) {
    const prevIndex = selectedWptIndex;
    selectedWptIndex = nextIndex;
    if (!waypointGroup || !currentParsed || !waypointsVisible) return;
    if (prevIndex !== nextIndex) {
      const prevMarker = wptMarkers.get(prevIndex);
      if (prevMarker) {
        prevMarker.getElement()?.classList.remove('is-selected');
        prevMarker.setZIndexOffset(200);
      }
      const nextMarker = wptMarkers.get(nextIndex);
      if (nextMarker) {
        nextMarker.getElement()?.classList.add('is-selected');
        nextMarker.setZIndexOffset(400);
      }
    }
    const wpt = nextIndex >= 0 ? currentParsed.waypoints?.[nextIndex] : null;
    if (wpt && Number.isFinite(wpt.lat) && Number.isFinite(wpt.lon)) {
      if (wptSelectionReticle) {
        wptSelectionReticle.setLatLng([wpt.lat, wpt.lon]);
      } else {
        wptSelectionReticle = createSnapReticleMarker(L, { lat: wpt.lat, lon: wpt.lon }, {
          kind: 'marker',
          className: 'pin-selection-reticle',
          animate: false,
          zIndexOffset: 390,
        })?.addTo(waypointGroup) || null;
      }
    } else if (wptSelectionReticle) {
      wptSelectionReticle.remove();
      wptSelectionReticle = null;
    }
  }

  function renderWaypoints() {
    if (!waypointGroup || !currentParsed) return;
    waypointGroup.clearLayers();
    wptMarkers.clear();
    wptSelectionReticle = null;
    if (!waypointsVisible) return;

    const canDrag = activeTool === 'waypoint';
    const allowWptInteract = !isDrawMode();
    (currentParsed.waypoints || []).forEach((wpt, index) => {
      if (!Number.isFinite(wpt.lat) || !Number.isFinite(wpt.lon)) return;
      const isSelected = index === selectedWptIndex;
      if (isSelected) {
        wptSelectionReticle = createSnapReticleMarker(L, { lat: wpt.lat, lon: wpt.lon }, {
          kind: 'marker',
          className: 'pin-selection-reticle',
          animate: false,
          zIndexOffset: 390,
        })?.addTo(waypointGroup) || null;
      }
      const hasPhoto = Array.isArray(wpt.images) && wpt.images.length > 0;
      const icon = L.divIcon({
        className: `editor-wpt-pin${hasPhoto ? ' has-photo' : ''}${isSelected ? ' is-selected' : ''}`,
        html: '<span class="pin-symbol-wrap">'
          + symbolMarkup('waypoint', { width: 24, height: 27, className: 'data-symbol pin-symbol' })
          + (hasPhoto ? symbolMarkup('camera', { width: 11, height: 11, className: 'data-symbol pin-camera' }) : '')
          + '</span>',
        iconSize: [24, 27],
        iconAnchor: [12, 28],
      });
      const marker = L.marker([wpt.lat, wpt.lon], {
        icon,
        draggable: canDrag,
        interactive: allowWptInteract,
        zIndexOffset: isSelected ? 400 : 200,
      }).addTo(waypointGroup);
      wptMarkers.set(index, marker);
      if (!allowWptInteract) return;
      marker.bindTooltip(() => buildWptTooltip(wpt, index), {
        direction: 'top',
        offset: [0, -24],
        className: 'editor-wpt-tooltip',
      });
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        updateWaypointSelection(index);
        handleSelectWaypoint(index);
      });
      marker.on('contextmenu', (event) => {
        L.DomEvent.stopPropagation(event);
        event.originalEvent?.preventDefault?.();
        if (suppressNextContextMenu) {
          suppressNextContextMenu = false;
          return;
        }
        updateWaypointSelection(index);
        handleSelectWaypoint(index);
        const hit = nearestOnTrack(map, getScreenSegments(), event.latlng);
        handleContextMenu({
          clientX: event.originalEvent?.clientX ?? 200,
          clientY: event.originalEvent?.clientY ?? 200,
          lat: wpt.lat,
          lon: wpt.lon,
          ele: wpt.ele,
          splitMeters: hit && hit.distPx <= 20 ? hit.alongMeters : null,
          waypointIndex: index,
        });
      });
      if (canDrag) {
        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          handleMoveWaypoint(index, pos.lat, pos.lng);
        });
      }
    });
  }

  function acquireVertexMarker(lat, lon, meta) {
    let marker = vertexMarkerPool.pop();
    if (!marker) {
      marker = L.marker([lat, lon], {
        icon: vertexDotIcon,
        draggable: true,
        zIndexOffset: 300,
      });
      marker.on('dragend', () => {
        const info = markerMeta.get(marker);
        if (!info) return;
        const pos = marker.getLatLng();
        handleMoveVertex(info.flatSegIndex, info.ptIndex, pos.lat, pos.lng);
      });
      marker.on('contextmenu', (event) => {
        const info = markerMeta.get(marker);
        if (!info) return;
        L.DomEvent.stopPropagation(event);
        event.originalEvent?.preventDefault?.();
        if (suppressNextContextMenu) {
          suppressNextContextMenu = false;
          return;
        }
        handleContextMenu({
          clientX: event.originalEvent?.clientX ?? 200,
          clientY: event.originalEvent?.clientY ?? 200,
          lat: info.pt.lat,
          lon: info.pt.lon,
          ele: info.pt.ele,
          splitMeters: null,
          waypointIndex: -1,
          vertexTarget: { flatSegIndex: info.flatSegIndex, ptIndex: info.ptIndex },
        });
      });
    } else {
      marker.setLatLng([lat, lon]);
    }
    markerMeta.set(marker, meta);
    marker.addTo(vertexGroup);
    return marker;
  }

  function releaseVertexMarker(marker) {
    if (vertexGroup) vertexGroup.removeLayer(marker);
    markerMeta.delete(marker);
    if (vertexMarkerPool.length < MAX_MARKER_POOL) vertexMarkerPool.push(marker);
  }

  function acquireMidMarker(lat, lon, meta) {
    let marker = midMarkerPool.pop();
    if (!marker) {
      marker = L.marker([lat, lon], {
        icon: vertexMidIcon,
        zIndexOffset: 250,
      });
      marker.on('click', (event) => {
        const info = markerMeta.get(marker);
        if (!info) return;
        L.DomEvent.stopPropagation(event);
        handleInsertVertex(info.flatSegIndex, info.ptIndex, info.midLat, info.midLon, info.midEle);
      });
    } else {
      marker.setLatLng([lat, lon]);
    }
    markerMeta.set(marker, meta);
    marker.addTo(vertexGroup);
    return marker;
  }

  function releaseMidMarker(marker) {
    if (vertexGroup) vertexGroup.removeLayer(marker);
    markerMeta.delete(marker);
    if (midMarkerPool.length < MAX_MARKER_POOL) midMarkerPool.push(marker);
  }

  function releaseAllVertexMarkers() {
    for (const marker of activeVertexMarkers.values()) releaseVertexMarker(marker);
    activeVertexMarkers.clear();
    for (const marker of activeMidMarkers.values()) releaseMidMarker(marker);
    activeMidMarkers.clear();
  }

  function renderVertexLayer() {
    visibleVertexCount = 0;
    hiddenMidpoints = false;
    const zoom = map.getZoom();
    if (!vertexGroup || !currentParsed || !isVertexMode() || zoom < 15) {
      releaseAllVertexMarkers();
      return;
    }

    const bounds = map.getBounds();
    const bSouth = bounds.getSouth();
    const bWest = bounds.getWest();
    const bNorth = bounds.getNorth();
    const bEast = bounds.getEast();
    const visible = [];
    for (let eIdx = 0; eIdx < cachedPathEntries.length; eIdx += 1) {
      const entry = cachedPathEntries[eIdx];
      if (entry.north < bSouth || entry.south > bNorth || entry.east < bWest || entry.west > bEast) {
        continue;
      }
      const seg = entry.points;
      for (let i = 0; i < seg.length; i += 1) {
        const pt = seg[i];
        if (pt.lat >= bSouth && pt.lat <= bNorth && pt.lon >= bWest && pt.lon <= bEast) {
          visible.push({ flatSegIndex: entry.flatSegIndex, ptIndex: i, pt, seg });
        }
      }
    }

    const maxRender = zoom >= 17 ? 200 : zoom === 16 ? 160 : 120;
    const step = visible.length > maxRender ? Math.ceil(visible.length / maxRender) : 1;
    hiddenMidpoints = step > 1;

    const nextVertices = new Map();
    const nextMids = new Map();
    for (let k = 0; k < visible.length; k += step) {
      const item = visible[k];
      const { flatSegIndex, ptIndex, pt, seg } = item;
      const key = `${flatSegIndex}:${ptIndex}`;
      nextVertices.set(key, item);

      if (step === 1 && ptIndex + 1 < seg.length) {
        const nextPt = seg[ptIndex + 1];
        const p1 = map.latLngToContainerPoint([pt.lat, pt.lon]);
        const p2 = map.latLngToContainerPoint([nextPt.lat, nextPt.lon]);
        if (Math.hypot(p1.x - p2.x, p1.y - p2.y) >= 10) {
          const midLat = (pt.lat + nextPt.lat) * 0.5;
          const midLon = (pt.lon + nextPt.lon) * 0.5;
          const midEle = Number.isFinite(pt.ele) && Number.isFinite(nextPt.ele)
            ? (pt.ele + nextPt.ele) * 0.5
            : undefined;
          nextMids.set(key, { flatSegIndex, ptIndex, midLat, midLon, midEle });
        }
      }
    }

    for (const [key, marker] of activeVertexMarkers.entries()) {
      if (!nextVertices.has(key)) {
        releaseVertexMarker(marker);
        activeVertexMarkers.delete(key);
      }
    }
    for (const [key, marker] of activeMidMarkers.entries()) {
      if (!nextMids.has(key)) {
        releaseMidMarker(marker);
        activeMidMarkers.delete(key);
      }
    }

    for (const [key, item] of nextVertices.entries()) {
      const existing = activeVertexMarkers.get(key);
      if (existing) {
        markerMeta.set(existing, item);
        const cur = existing.getLatLng();
        if (Math.abs(cur.lat - item.pt.lat) > 1e-9 || Math.abs(cur.lng - item.pt.lon) > 1e-9) {
          existing.setLatLng([item.pt.lat, item.pt.lon]);
        }
      } else {
        activeVertexMarkers.set(key, acquireVertexMarker(item.pt.lat, item.pt.lon, item));
      }
    }

    for (const [key, mid] of nextMids.entries()) {
      const existing = activeMidMarkers.get(key);
      if (existing) {
        markerMeta.set(existing, mid);
        const cur = existing.getLatLng();
        if (Math.abs(cur.lat - mid.midLat) > 1e-9 || Math.abs(cur.lng - mid.midLon) > 1e-9) {
          existing.setLatLng([mid.midLat, mid.midLon]);
        }
      } else {
        activeMidMarkers.set(key, acquireMidMarker(mid.midLat, mid.midLon, mid));
      }
    }

    visibleVertexCount = activeVertexMarkers.size;
  }

  function render() {
    if (!group || !currentParsed) return;
    renderTrackLayer();
    renderWaypoints();
    renderVertexLayer();
    updateCursorClass();
  }

  function clearSplitPreview() {
    if (splitCursor) {
      splitCursor.remove();
      splitCursor = null;
    }
    if (splitDistMarker) {
      splitDistMarker.remove();
      splitDistMarker = null;
    }
  }

  function paintSplitPreview(lat, lon, alongMeters, fillColor) {
    if (!trackGroup) return;
    if (!splitCursor) {
      splitCursor = L.circleMarker([lat, lon], {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor,
        fillOpacity: 1,
        interactive: false,
      }).addTo(trackGroup);
    } else {
      splitCursor.setStyle({ fillColor });
      splitCursor.setLatLng([lat, lon]);
    }
    if (alongMeters != null && Number.isFinite(alongMeters)) {
      const labelText = formatDistance(alongMeters);
      const icon = L.divIcon({
        className: 'editor-split-dist-badge',
        html: `<span class="editor-split-dist-pill">${labelText}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 26],
      });
      if (!splitDistMarker) {
        splitDistMarker = L.marker([lat, lon], {
          icon,
          interactive: false,
          zIndexOffset: 600,
        }).addTo(trackGroup);
      } else {
        splitDistMarker.setLatLng([lat, lon]);
        splitDistMarker.setIcon(icon);
      }
    } else if (splitDistMarker) {
      splitDistMarker.remove();
      splitDistMarker = null;
    }
  }

  function updateHoverAt(latlng) {
    if (!group || !currentParsed || !latlng) return;
    const isLoopStart = activeTool === 'topology' && activeSubMode === 'loop-start';
    const isSplit = activeTool === 'crop' && activeSubMode === 'split';
    const isTrackSnap = isSplit || isLoopStart;
    const isWpt = activeTool === 'waypoint';
    if (isDrawMode()) {
      clearSplitPreview();
      clearDrawHover();
      const snapped = resolveDrawSnap(latlng);
      const targetLat = snapped ? snapped.lat : latlng.lat;
      const targetLon = snapped ? snapped.lon : latlng.lng;
      if (snapped && drawGroup) {
        drawSnapReticle = createSnapReticleMarker(L, { lat: targetLat, lon: targetLon }, {
          kind: snapped.kind === 'track' ? 'track' : 'marker',
          animate: false,
          zIndexOffset: 500,
        });
        drawSnapReticle?.addTo(drawGroup);
      }
      if (drawPoints.length > 0 && drawGroup) {
        const prev = drawPoints[drawPoints.length - 1];
        drawRubberLine = L.polyline(
          [[prev.lat, prev.lon], [targetLat, targetLon]],
          {
            color: '#38bdf8',
            weight: 2.5,
            opacity: 0.7,
            dashArray: '5 5',
            interactive: false,
          },
        ).addTo(drawGroup);
      }
      return;
    }
    if (isTrackSnap || isWpt) {
      const maxPx = isTrackSnap ? 24 : 18;
      const hit = nearestOnTrack(map, getScreenSegments(), latlng);
      if (hit && hit.distPx <= maxPx) {
        const fillColor = isLoopStart ? '#38bdf8' : isSplit ? '#ef4444' : '#22c55e';
        paintSplitPreview(hit.lat, hit.lon, isTrackSnap ? hit.alongMeters : null, fillColor);
        if (isSplit) handleSplitHover(hit.alongMeters);
      } else {
        clearSplitPreview();
        if (isSplit) handleSplitHover(null);
      }
    } else {
      clearSplitPreview();
    }
  }

  const onMapMouseMove = (event) => {
    if (!group || !currentParsed) return;
    pendingHoverLatLng = event.latlng;
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      if (pendingHoverLatLng) {
        updateHoverAt(pendingHoverLatLng);
        pendingHoverLatLng = null;
      }
    });
  };

  const onMapClick = (event) => {
    if (!group || !currentParsed) return;
    if (isDrawMode()) {
      if (event.originalEvent && event.originalEvent.button !== 0) return;
      const snapped = resolveDrawSnap(event.latlng);
      const pt = snapped
        ? {
          lat: snapped.lat,
          lon: snapped.lon,
          ele: Number.isFinite(snapped.ele) ? snapped.ele : undefined,
          snap: snapped.snap || null,
        }
        : {
          lat: event.latlng.lat,
          lon: event.latlng.lng,
          snap: null,
        };
      drawPoints.push(pt);
      renderDrawLayer();
      notifyDrawChange();
      return;
    }
    if (activeTool === 'crop' && activeSubMode === 'split') {
      const hit = nearestOnTrack(map, getScreenSegments(), event.latlng);
      if (hit && hit.distPx <= 24) {
        handleSplitAt(hit.alongMeters);
      }
      return;
    }
    if (activeTool === 'topology' && activeSubMode === 'loop-start') {
      const hit = nearestOnTrack(map, getScreenSegments(), event.latlng);
      if (hit && hit.distPx <= 24) {
        handleRotateLoopStart(hit.alongMeters);
      }
      return;
    }
    if (activeTool === 'waypoint') {
      const unsnap = Boolean(event.originalEvent?.altKey);
      const hit = unsnap ? null : nearestOnTrack(map, getScreenSegments(), event.latlng);
      if (hit && hit.distPx <= 18) {
        handlePickWaypointLocation({
          lat: hit.lat,
          lon: hit.lon,
          ele: hit.ele,
          snapped: true,
        });
      } else if (unsnap) {
        handlePickWaypointLocation({
          lat: event.latlng.lat,
          lon: event.latlng.lng,
          ele: undefined,
          snapped: false,
        });
      }
    }
  };

  const onMapContextMenu = (event) => {
    if (!group || !currentParsed) return;
    event.originalEvent?.preventDefault?.();
    if (suppressNextContextMenu) {
      suppressNextContextMenu = false;
      return;
    }
    const hit = nearestOnTrack(map, getScreenSegments(), event.latlng);
    handleContextMenu({
      clientX: event.originalEvent?.clientX ?? 200,
      clientY: event.originalEvent?.clientY ?? 200,
      lat: hit && hit.distPx <= 20 ? hit.lat : event.latlng.lat,
      lon: hit && hit.distPx <= 20 ? hit.lon : event.latlng.lng,
      ele: hit && hit.distPx <= 20 ? hit.ele : undefined,
      splitMeters: hit && hit.distPx <= 20 ? hit.alongMeters : null,
      waypointIndex: -1,
    });
  };

  const onViewportUpdated = () => {
    invalidateScreenCache();
    if (isVertexMode()) {
      renderVertexLayer();
      handleViewportChange();
    }
  };

  function mount(parsed) {
    unmount();
    lifecycle = new AbortController();
    group = L.layerGroup().addTo(map);
    trackGroup = L.layerGroup().addTo(group);
    boxPreviewGroup = L.layerGroup().addTo(group);
    waypointGroup = L.layerGroup().addTo(group);
    vertexGroup = L.layerGroup().addTo(group);
    drawGroup = L.layerGroup().addTo(group);
    currentParsed = parsed;
    cachedPathEntries = allPathEntries(parsed);
    cachedPaths = cachedPathEntries.map((entry) => entry.points);
    cachedTotalMeters = trackTotalDistance(parsed);
    cachedScreenSegments = null;
    rebuildDrawSnapIndexes();
    cropRange = [0, cachedTotalMeters];

    const container = map.getContainer();
    window.addEventListener('blur', () => {
      clearPan();
      clearBox();
    }, { signal: lifecycle.signal });
    container.addEventListener('pointerdown', (event) => {
      if (!isBoxEraseMode() && !isDrawMode()) return;
      if (event.target instanceof Element && event.target.closest('.leaflet-control, .leaflet-control-container')) {
        return;
      }
      if (event.button === 2 || event.button === 1) {
        event.preventDefault();
        clearBox();
        panState = {
          x: event.clientX,
          y: event.clientY,
          button: event.button,
          pointerId: event.pointerId,
          moved: false,
        };
        container.classList.add('editor-cursor-grabbing');
        return;
      }
      if (!isBoxEraseMode()) return;
      if (event.button !== 0 || panState) return;
      clearBox();
      const rect = container.getBoundingClientRect();
      boxStartPt = { x: event.clientX - rect.left, y: event.clientY - rect.top, pointerId: event.pointerId };
      boxLatestClient = { x: boxStartPt.x, y: boxStartPt.y };
      boxEl = document.createElement('div');
      boxEl.className = 'editor-box-select';
      boxEl.style.left = `${boxStartPt.x}px`;
      boxEl.style.top = `${boxStartPt.y}px`;
      boxBadgeEl = document.createElement('span');
      boxBadgeEl.className = 'editor-box-badge';
      boxBadgeEl.hidden = true;
      boxEl.append(boxBadgeEl);
      container.append(boxEl);
    }, { signal: lifecycle.signal });
    window.addEventListener('pointermove', (event) => {
      if (panState) {
        if (event.pointerId !== panState.pointerId) return;
        const dx = panState.x - event.clientX;
        const dy = panState.y - event.clientY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panState.moved = true;
        panState.x = event.clientX;
        panState.y = event.clientY;
        map.panBy([dx, dy], { animate: false });
        return;
      }
      if (!boxStartPt || !boxEl || event.pointerId !== boxStartPt.pointerId) return;
      const rect = container.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      boxLatestClient = { x: cx, y: cy };
      boxEl.style.left = `${Math.min(boxStartPt.x, cx)}px`;
      boxEl.style.top = `${Math.min(boxStartPt.y, cy)}px`;
      boxEl.style.width = `${Math.abs(cx - boxStartPt.x)}px`;
      boxEl.style.height = `${Math.abs(cy - boxStartPt.y)}px`;
      if (!boxPreviewFrame) boxPreviewFrame = requestAnimationFrame(flushBoxPreview);
    }, { signal: lifecycle.signal });
    window.addEventListener('pointercancel', () => {
      clearPan();
      clearBox();
    }, { signal: lifecycle.signal });
    window.addEventListener('pointerup', (event) => {
      if (panState) {
        if (event.pointerId === panState.pointerId) clearPan();
        return;
      }
      if (!boxStartPt || !boxEl || event.pointerId !== boxStartPt.pointerId) return;
      const rect = container.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const start = boxStartPt;
      clearBox();
      if (Math.abs(cx - start.x) < 6 && Math.abs(cy - start.y) < 6) return;
      const p1 = map.containerPointToLatLng([Math.min(start.x, cx), Math.max(start.y, cy)]);
      const p2 = map.containerPointToLatLng([Math.max(start.x, cx), Math.min(start.y, cy)]);
      handleBoxErase({
        south: Math.min(p1.lat, p2.lat),
        west: Math.min(p1.lng, p2.lng),
        north: Math.max(p1.lat, p2.lat),
        east: Math.max(p1.lng, p2.lng),
      });
    }, { signal: lifecycle.signal });

    map.on('mousemove', onMapMouseMove);
    map.on('click', onMapClick);
    map.on('contextmenu', onMapContextMenu);
    map.on('zoomend', onViewportUpdated);
    map.on('moveend', onViewportUpdated);

    render();
  }

  function unmount() {
    if (hoverFrame) {
      cancelAnimationFrame(hoverFrame);
      hoverFrame = 0;
    }
    if (focusFrame) {
      cancelAnimationFrame(focusFrame);
      focusFrame = 0;
    }
    wptMarkers.clear();
    selectedWptIndex = -1;
    highlightedSegIndex = -1;
    wptSelectionReticle = null;
    pendingHoverLatLng = null;
    clearBox();
    clearPan();
    releaseAllVertexMarkers();
    vertexMarkerPool.length = 0;
    midMarkerPool.length = 0;
    suppressNextContextMenu = false;
    if (map.dragging) map.dragging.enable();
    map.off('mousemove', onMapMouseMove);
    map.off('click', onMapClick);
    map.off('contextmenu', onMapContextMenu);
    map.off('zoomend', onViewportUpdated);
    map.off('moveend', onViewportUpdated);
    if (lifecycle) {
      lifecycle.abort();
      lifecycle = null;
    }
    if (group) {
      group.clearLayers();
      group.remove();
      group = null;
    }
    clearDrawDraft({ notify: false });
    trackGroup = null;
    boxPreviewGroup = null;
    waypointGroup = null;
    vertexGroup = null;
    drawGroup = null;
    drawEndpointIndex = null;
    drawWptIndex = null;
    cachedPathEntries = [];
    cachedPaths = [];
    cachedTotalMeters = 0;
    cachedScreenSegments = null;
    clearSplitPreview();
    hiddenMidpoints = false;
    excludedAnomalyKeys.clear();
    map.getContainer().classList.remove('editor-cursor-crosshair', 'editor-cursor-grab', 'editor-cursor-grabbing');
  }

  return {
    mount,
    unmount,
    setTrack(parsed) {
      currentParsed = parsed;
      highlightedSegIndex = -1;
      cachedPathEntries = allPathEntries(parsed);
      cachedPaths = cachedPathEntries.map((entry) => entry.points);
      cachedTotalMeters = trackTotalDistance(parsed);
      cachedScreenSegments = null;
      rebuildDrawSnapIndexes();
      clearDrawDraft({ notify: true });
      cropRange = [0, Math.min(cachedTotalMeters, cropRange[1] > 0 ? cropRange[1] : cachedTotalMeters)];
      if (cropRange[0] >= cropRange[1]) cropRange = [0, cachedTotalMeters];
      render();
    },
    setTool(tool, subMode = tool) {
      if (tool === activeTool && subMode === activeSubMode) return;
      clearBox();
      clearPan();
      clearSplitPreview();
      clearDrawDraft({ notify: true });
      handleSplitHover(null);
      activeTool = tool;
      activeSubMode = subMode;
      if (activeTool !== 'crop' || activeSubMode !== 'split') highlightedSegIndex = -1;
      render();
    },
    setSegmentColorResolver(fn) {
      segmentColorResolver = typeof fn === 'function' ? fn : null;
    },
    setHighlightedSegment(index) {
      const next = Number.isInteger(index) ? index : -1;
      if (next === highlightedSegIndex) return;
      highlightedSegIndex = next;
      renderTrackLayer();
    },
    focusTrackSegment(index) {
      const tracks = normalizedTracks(currentParsed);
      const track = tracks[index];
      if (!track) return;
      const pts = [];
      for (const seg of track.segments || []) {
        for (const pt of seg) {
          if (Number.isFinite(pt?.lat) && Number.isFinite(pt?.lon)) pts.push([pt.lat, pt.lon]);
        }
      }
      if (pts.length === 0) return;
      const bounds = L.latLngBounds(pts);
      if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
        map.setView(pts[0], Math.max(map.getZoom(), 16), { animate: true });
      } else {
        map.fitBounds(bounds, { padding: [90, 90], maxZoom: 17, animate: true });
      }
    },
    showSplitPreviewAt(alongMeters) {
      if (!group || !currentParsed || alongMeters == null || !Number.isFinite(alongMeters)) {
        clearSplitPreview();
        return;
      }
      const pt = pointAtDistance(cachedPaths, alongMeters);
      if (!pt) {
        clearSplitPreview();
        return;
      }
      paintSplitPreview(pt.lat, pt.lon, alongMeters, '#ef4444');
    },
    setCropRange(fromMeters, toMeters) {
      cropRange = [fromMeters, toMeters];
      renderTrackLayer();
    },
    setSelectedWaypoint(index) {
      if (wptMarkers.size > 0 && waypointsVisible) {
        updateWaypointSelection(index);
      } else {
        selectedWptIndex = index;
      }
    },
    setWaypointsVisible(visible) {
      waypointsVisible = Boolean(visible);
      renderWaypoints();
    },
    focusWaypoint(index) {
      const wpt = currentParsed?.waypoints?.[index];
      if (!wpt || !Number.isFinite(wpt.lat) || !Number.isFinite(wpt.lon)) return;
      if (focusFrame) cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        focusFrame = 0;
        map.panTo([wpt.lat, wpt.lon], { animate: true, duration: 0.28, easeLinearity: 0.25 });
      });
    },
    focusLatLon(lat, lon) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      map.panInside([lat, lon], { padding: [80, 80], animate: true });
    },
    setExcludedAnomalyKeys(keys, { render: shouldRender = true } = {}) {
      excludedAnomalyKeys = new Set(keys || []);
      if (shouldRender && activeTool === 'clean') renderTrackLayer();
    },
    getVertexStatus() {
      return { zoom: map.getZoom(), visibleCount: visibleVertexCount, hiddenMidpoints };
    },
    getDrawDraft() {
      return {
        points: drawPoints.map((pt) => ({ lat: pt.lat, lon: pt.lon, ele: pt.ele })),
        startSnap: drawPoints.length > 0 ? (drawPoints[0].snap || null) : null,
        endSnap: drawPoints.length > 1 ? (drawPoints[drawPoints.length - 1].snap || null) : null,
        distanceMeters: computeDrawDistance(),
      };
    },
    undoDrawPoint() {
      if (drawPoints.length === 0) return false;
      drawPoints.pop();
      renderDrawLayer();
      notifyDrawChange();
      return true;
    },
    clearDrawDraft() {
      clearDrawDraft({ notify: true });
    },
  };
}
