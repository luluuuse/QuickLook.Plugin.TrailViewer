import { distanceMeters } from './geo.js';
import { symbolMarkup } from './icons.js';
import { createSnapReticleMarker } from './snap-indicator.js';
import { sliceRouteByDistance } from './track-analysis.js';
import { detectAnomalyPoints, normalizedTracks, trackTotalDistance } from './track-ops.js';

const KEEP_COLOR = '#f97316';
const CUT_COLOR = '#64748b';
const SPLIT_COLORS = ['#f97316', '#38bdf8', '#22c55e', '#eab308'];
const KNOWN_WPT_SYMS = new Set(['pin', 'water', 'supply', 'camp', 'summit', 'danger', 'junction']);

function allPaths(parsed) {
  const paths = [];
  for (const t of parsed?.tracks || []) {
    for (const seg of t.segments || []) {
      if (seg.length >= 2) paths.push(seg);
    }
  }
  if (paths.length === 0) {
    for (const r of parsed?.routes || []) {
      if ((r.points || []).length >= 2) paths.push(r.points);
    }
  }
  return paths;
}

function buildScreenCache(map, paths) {
  const segments = [];
  let along = 0;
  for (const pts of paths) {
    let prevPt = null;
    let prevPx = null;
    for (let i = 0; i < pts.length; i += 1) {
      const pt = pts[i];
      const px = map.latLngToContainerPoint([pt.lat, pt.lon]);
      if (prevPt && prevPx) {
        const step = distanceMeters(prevPt, pt);
        segments.push({ a: prevPt, b: pt, pa: prevPx, pb: px, along, step });
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
    const { a, b, pa, pb, along, step } = seg;
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
      best = { distPx, lat, lon, ele, alongMeters: along + step * t };
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
 *   onSplitAt?: (meters: number) => void,
 *   onPickWaypointLocation?: (loc: { lat: number, lon: number, ele?: number, snapped: boolean }) => void,
 *   onSelectWaypoint?: (index: number) => void,
 *   onMoveWaypoint?: (index: number, lat: number, lon: number) => void,
 *   onContextMenu?: (info: { clientX: number, clientY: number, lat: number, lon: number, ele?: number, splitMeters: number | null, waypointIndex?: number }) => void,
 * }} opts
 */
export function createEditorOverlay({
  L,
  map,
  el = null,
  t = (key) => key,
  onSplitAt = () => {},
  onPickWaypointLocation = () => {},
  onSelectWaypoint = () => {},
  onMoveWaypoint = () => {},
  onContextMenu = () => {},
}) {
  /** @type {(meters: number) => void} */
  const handleSplitAt = onSplitAt;
  /** @type {(loc: { lat: number, lon: number, ele?: number, snapped: boolean }) => void} */
  const handlePickWaypointLocation = onPickWaypointLocation;
  /** @type {(index: number) => void} */
  const handleSelectWaypoint = onSelectWaypoint;
  /** @type {(index: number, lat: number, lon: number) => void} */
  const handleMoveWaypoint = onMoveWaypoint;
  /** @type {(info: any) => void} */
  const handleContextMenu = onContextMenu;
  let group = null;
  let trackGroup = null;
  let waypointGroup = null;
  let splitCursor = null;
  let lifecycle = null;
  let currentParsed = null;
  let cachedPaths = [];
  let cachedTotalMeters = 0;
  let cachedScreenSegments = null;
  let hoverFrame = 0;
  let pendingHoverLatLng = null;
  let activeTool = 'crop';
  let activeSubMode = 'crop';
  let cropRange = [0, 0];
  let selectedWptIndex = -1;
  let waypointsVisible = true;

  function updateCursorClass() {
    const container = map.getContainer();
    container.classList.toggle(
      'editor-cursor-crosshair',
      Boolean(group) && (activeSubMode === 'split' || activeTool === 'waypoint'),
    );
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
      cachedScreenSegments = buildScreenCache(map, cachedPaths);
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
      for (const seg of sliceRouteByDistance(paths, { from, to })) {
        L.polyline(seg.map((p) => [p.lat, p.lon]), {
          color: KEEP_COLOR,
          weight: 5,
          opacity: 0.96,
          interactive: false,
        }).addTo(trackGroup);
      }
    } else if (activeTool === 'crop' && activeSubMode === 'split') {
      normalizedTracks(currentParsed).forEach((track, idx) => {
        const color = SPLIT_COLORS[idx % SPLIT_COLORS.length];
        for (const seg of track.segments || []) {
          if (seg.length < 2) continue;
          L.polyline(seg.map((p) => [p.lat, p.lon]), {
            color,
            weight: 5,
            opacity: 0.92,
            interactive: false,
          }).addTo(trackGroup);
        }
      });
    } else {
      for (const seg of paths) {
        L.polyline(seg.map((p) => [p.lat, p.lon]), {
          color: KEEP_COLOR,
          weight: 4.5,
          opacity: 0.92,
          interactive: false,
        }).addTo(trackGroup);
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

    // Highlight detected GPS drift anomalies in clean mode
    if (activeTool === 'clean') {
      for (const spike of detectAnomalyPoints(currentParsed)) {
        L.circleMarker([spike.lat, spike.lon], {
          radius: 6,
          color: '#ffffff',
          weight: 1.5,
          fillColor: '#ef4444',
          fillOpacity: 0.95,
          interactive: false,
        }).addTo(trackGroup);
      }
    }
  }

  function renderWaypoints() {
    if (!waypointGroup || !currentParsed) return;
    waypointGroup.clearLayers();
    if (!waypointsVisible) return;

    const canDrag = activeTool === 'waypoint';
    (currentParsed.waypoints || []).forEach((wpt, index) => {
      if (!Number.isFinite(wpt.lat) || !Number.isFinite(wpt.lon)) return;
      const isSelected = index === selectedWptIndex;
      if (isSelected) {
        createSnapReticleMarker(L, { lat: wpt.lat, lon: wpt.lon }, {
          kind: 'marker',
          className: 'pin-selection-reticle',
          animate: false,
          zIndexOffset: 390,
        })?.addTo(waypointGroup);
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
        zIndexOffset: isSelected ? 400 : 200,
      }).addTo(waypointGroup);
      marker.bindTooltip(() => buildWptTooltip(wpt, index), {
        direction: 'top',
        offset: [0, -24],
        className: 'editor-wpt-tooltip',
      });
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        selectedWptIndex = index;
        handleSelectWaypoint(index);
        renderWaypoints();
      });
      marker.on('contextmenu', (event) => {
        L.DomEvent.stopPropagation(event);
        event.originalEvent?.preventDefault?.();
        selectedWptIndex = index;
        handleSelectWaypoint(index);
        renderWaypoints();
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

  function render() {
    if (!group || !currentParsed) return;
    renderTrackLayer();
    renderWaypoints();
    updateCursorClass();
  }

  function updateHoverAt(latlng) {
    if (!group || !currentParsed || !latlng) return;
    const isSplit = activeTool === 'crop' && activeSubMode === 'split';
    const isWpt = activeTool === 'waypoint';
    if (isSplit || isWpt) {
      const maxPx = isSplit ? 24 : 18;
      const hit = nearestOnTrack(map, getScreenSegments(), latlng);
      if (hit && hit.distPx <= maxPx) {
        const fillColor = isSplit ? '#ef4444' : '#22c55e';
        if (!splitCursor) {
          splitCursor = L.circleMarker([hit.lat, hit.lon], {
            radius: 7,
            color: '#ffffff',
            weight: 2,
            fillColor,
            fillOpacity: 1,
            interactive: false,
          }).addTo(trackGroup);
        } else {
          splitCursor.setStyle({ fillColor });
          splitCursor.setLatLng([hit.lat, hit.lon]);
        }
      } else if (splitCursor) {
        splitCursor.remove();
        splitCursor = null;
      }
    } else if (splitCursor) {
      splitCursor.remove();
      splitCursor = null;
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
    if (activeTool === 'crop' && activeSubMode === 'split') {
      const hit = nearestOnTrack(map, getScreenSegments(), event.latlng);
      if (hit && hit.distPx <= 24) {
        handleSplitAt(hit.alongMeters);
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

  function mount(parsed) {
    unmount();
    lifecycle = new AbortController();
    group = L.layerGroup().addTo(map);
    trackGroup = L.layerGroup().addTo(group);
    waypointGroup = L.layerGroup().addTo(group);
    currentParsed = parsed;
    cachedPaths = allPaths(parsed);
    cachedTotalMeters = trackTotalDistance(parsed);
    cachedScreenSegments = null;
    cropRange = [0, cachedTotalMeters];

    map.on('mousemove', onMapMouseMove);
    map.on('click', onMapClick);
    map.on('contextmenu', onMapContextMenu);
    map.on('zoomend', invalidateScreenCache);
    map.on('moveend', invalidateScreenCache);

    render();
  }

  function unmount() {
    if (hoverFrame) {
      cancelAnimationFrame(hoverFrame);
      hoverFrame = 0;
    }
    pendingHoverLatLng = null;
    map.off('mousemove', onMapMouseMove);
    map.off('click', onMapClick);
    map.off('contextmenu', onMapContextMenu);
    map.off('zoomend', invalidateScreenCache);
    map.off('moveend', invalidateScreenCache);
    if (lifecycle) {
      lifecycle.abort();
      lifecycle = null;
    }
    if (group) {
      group.clearLayers();
      group.remove();
      group = null;
    }
    trackGroup = null;
    waypointGroup = null;
    cachedPaths = [];
    cachedTotalMeters = 0;
    cachedScreenSegments = null;
    splitCursor = null;
    map.getContainer().classList.remove('editor-cursor-crosshair', 'editor-cursor-grab', 'editor-cursor-grabbing');
  }

  return {
    mount,
    unmount,
    setTrack(parsed) {
      currentParsed = parsed;
      cachedPaths = allPaths(parsed);
      cachedTotalMeters = trackTotalDistance(parsed);
      cachedScreenSegments = null;
      cropRange = [0, Math.min(cachedTotalMeters, cropRange[1] > 0 ? cropRange[1] : cachedTotalMeters)];
      if (cropRange[0] >= cropRange[1]) cropRange = [0, cachedTotalMeters];
      render();
    },
    setTool(tool, subMode = tool) {
      activeTool = tool;
      activeSubMode = subMode;
      render();
    },
    setCropRange(fromMeters, toMeters) {
      cropRange = [fromMeters, toMeters];
      renderTrackLayer();
    },
    setSelectedWaypoint(index) {
      selectedWptIndex = index;
      renderWaypoints();
    },
    setWaypointsVisible(visible) {
      waypointsVisible = Boolean(visible);
      renderWaypoints();
    },
    focusWaypoint(index) {
      const wpt = currentParsed?.waypoints?.[index];
      if (!wpt || !Number.isFinite(wpt.lat) || !Number.isFinite(wpt.lon)) return;
      map.panInside([wpt.lat, wpt.lon], { padding: [80, 80], animate: true });
    },
  };
}
