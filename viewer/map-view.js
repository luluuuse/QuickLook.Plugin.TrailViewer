import {
  focusOffset,
  makeRect,
  pointRect,
  revealOffset,
  safeMapRect,
  unionRects,
} from './map-focus.js';

const GAP = 12;
const LAYOUT_CLASSES = ['layout-inline', 'layout-wrapped', 'layout-docked'];

function shown(node) {
  if (!node || node.hidden) return false;
  const style = getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function sameNumber(a, b) {
  return Math.abs(a - b) < 0.5;
}

function sameView(a, b) {
  return Boolean(a && b) && sameNumber(a.lat, b.lat) && sameNumber(a.lng, b.lng)
    && sameNumber(a.zoom, b.zoom);
}

function cssPixels(value) {
  return `${Math.max(0, Math.round(value))}px`;
}

function storedLatLng(latlng) {
  if (Array.isArray(latlng)) return { lat: Number(latlng[0]), lng: Number(latlng[1]) };
  return { lat: Number(latlng.lat), lng: Number(latlng.lng) };
}

/** Owns wheel zoom, the unobstructed map frame, route fitting and corner-control placement. */
export function createMapView({ map, isChromeHidden }) {
  const container = map.getContainer();

  let fineWheel = false;
  let fineTimer = 0;
  const wheelStep = (fine) => {
    map.options.zoomSnap = fine ? 0.5 : 1;
    map.options.wheelPxPerZoomLevel = fine ? 120 : 60;
  };
  container.addEventListener('wheel', (event) => {
    if (event.altKey !== fineWheel) {
      fineWheel = event.altKey;
      wheelStep(fineWheel);
      const wheel = map.scrollWheelZoom;
      if (wheel) {
        clearTimeout(wheel._timer);
        wheel._timer = null;
        wheel._startTime = null;
        wheel._delta = 0;
      }
    }
    clearTimeout(fineTimer);
    fineTimer = setTimeout(() => {
      fineWheel = false;
      wheelStep(false);
    }, 300);
  }, { capture: true });

  map.setView([20, 0], 2);

  let bounds = null;
  let layoutState = 'inline';
  let safeRect = makeRect(0, 0, container.clientWidth, container.clientHeight);
  let layoutFrame = 0;
  let pendingRefitHome = true;
  let pendingRevealFocus = true;
  let revealFrame = 0;
  let revealAgain = false;
  let layoutSignature = '';
  let lastFittedSignature = '';
  let homeView = null;
  let atHome = true;
  let lastFocus = null;
  let initialRoutePending = false;
  const observed = new WeakSet();
  let observer = null;

  function mapRect(node) {
    if (!shown(node)) return null;
    const base = container.getBoundingClientRect();
    return rectWithin(node, base);
  }

  function rectWithin(node, base) {
    if (!node || node.hidden) return null;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return makeRect(
      rect.left - base.left,
      rect.top - base.top,
      rect.right - base.left,
      rect.bottom - base.top,
    );
  }

  function readLayoutSnapshot() {
    const base = container.getBoundingClientRect();
    const infoNode = document.getElementById('info');
    const splitNode = document.getElementById('splits');
    const zoomNode = map.zoomControl?.getContainer().closest('.leaflet-top.leaflet-left');
    const toolsNode = document.querySelector('#map .leaflet-top.leaflet-right');
    const hidden = isChromeHidden();
    const toolChildren = toolsNode
      ? [...toolsNode.children].map((node) => rectWithin(node, base)).filter(Boolean)
      : [];
    return {
      width: container.clientWidth,
      height: container.clientHeight,
      hidden,
      info: hidden ? null : rectWithin(infoNode, base),
      splitElement: splitNode,
      splits: hidden ? null : rectWithin(splitNode, base),
      zoom: rectWithin(zoomNode, base),
      tools: rectWithin(toolsNode, base),
      toolChildren,
      profile: rectWithin(document.getElementById('profile'), base),
      exportPanel: rectWithin(document.getElementById('export'), base),
      toolbox: rectWithin(document.getElementById('toolbox-panel'), base),
      overview: rectWithin(document.querySelector('.waypoint-overview'), base),
      editorTopbar: rectWithin(document.getElementById('editor-topbar'), base),
      editorRail: rectWithin(document.getElementById('editor-rail'), base),
      editorDrawer: rectWithin(document.getElementById('editor-drawer'), base),
      scale: rectWithin(document.querySelector('.leaflet-control-scale'), base),
      attribution: rectWithin(document.querySelector('.leaflet-control-attribution'), base),
    };
  }

  function addObserved(node) {
    if (!node || !observer || observed.has(node)) return;
    observed.add(node);
    observer.observe(node);
  }

  function observeLayoutNodes() {
    addObserved(container);
    for (const selector of [
      '#info',
      '#splits',
      '#profile',
      '#toolbox-panel',
      '.waypoint-overview',
      '#editor-topbar',
      '#editor-rail',
      '#editor-drawer',
      '.leaflet-top.leaflet-left',
      '.leaflet-top.leaflet-right',
    ]) {
      addObserved(document.querySelector(selector));
    }
  }

  function controlWidths(children) {
    const widths = children.map((rect) => rect.width);
    return {
      total: widths.reduce((sum, width) => sum + width + 10, 10),
      widest: widths.length > 0 ? Math.max(...widths) : 0,
    };
  }

  function setVariable(name, value) {
    const root = document.documentElement.style;
    if (root.getPropertyValue(name) !== value) root.setProperty(name, value);
  }

  /**
   * The three states are content-driven. Inline keeps the original top band; wrapped lets the
   * right-hand switches use two rows while zoom stays beside the card; docked gives zoom and tools
   * their own band below the card.
   */
  function placeControls(snapshot) {
    const card = snapshot.info;
    const splits = snapshot.splits;
    const zoom = snapshot.zoom;
    if (!zoom) return;
    const zoomWidth = zoom?.width || 30;
    const row = controlWidths(snapshot.toolChildren);
    const infoCompact = document.body.classList.contains('info-compact')
      && !document.body.classList.contains('is-editing');
    // The zoom/locate column belongs to the summary card normally, and tucks beneath #splits in compact mode.
    const zoomLeft = infoCompact ? 10 : (card ? card.right + 8 : 10);
    const zoomRight = infoCompact ? (card ? card.right + 8 : 10) : (zoomLeft + zoomWidth);
    const inlineRoom = innerWidth - zoomRight - 22;
    const inline = !snapshot.tools || row.total <= inlineRoom;
    // A wrapped tool bar needs enough room for at least the compact waypoint group and language chip.
    // Below that the controls belong in the measured docked band rather than stacking one per row.
    const minWrapped = Math.max(168, row.widest + 12);
    const wrappedRoom = Math.max(0, innerWidth - zoomRight - 22);
    const wrapped = !inline && wrappedRoom >= minWrapped && innerWidth > 419;
    const next = inline ? 'inline' : wrapped ? 'wrapped' : 'docked';
    const splitWouldMeetZoom = !infoCompact && splits && zoom
      && splits.right > zoomLeft - 6;
    const splitTop = Math.max(
      (card?.bottom || 0) + (infoCompact ? 6 : 8),
      snapshot.splitElement?.classList.contains('expanded') && splitWouldMeetZoom
        ? (zoom?.bottom || 0) + 8
        : 0,
      10,
    );
    setVariable('--splits-top', cssPixels(splitTop || 10));

    const layoutClass = `layout-${next}`;
    if (next !== layoutState || !document.body.classList.contains(layoutClass)) {
      layoutState = next;
      document.body.classList.remove(...LAYOUT_CLASSES);
      document.body.classList.add(layoutClass);
      document.body.classList.toggle('stepped', layoutState === 'docked');
    }

    if (infoCompact) {
      const splitsHeight = splits ? splits.height : 0;
      const underSplitsTop = splitsHeight > 0
        ? splitTop + splitsHeight + 6
        : (card?.bottom || 8) + 6;
      setVariable('--zoom-left', '10px');
      setVariable('--zoom-top', cssPixels(underSplitsTop));
      setVariable('--tools-left', 'auto');
      setVariable('--tools-right', '0px');
      setVariable('--tools-top', layoutState === 'docked' ? cssPixels((card?.bottom || 8) + 6) : '0px');
      setVariable('--tools-max-width', cssPixels(layoutState === 'wrapped'
        ? Math.max(minWrapped, wrappedRoom)
        : Math.max(120, innerWidth - 20)));
    } else if (layoutState === 'docked') {
      const cardBottom = card?.bottom || 8;
      const toolsRoom = Math.max(0, innerWidth - zoomWidth - 32);
      const toolsBelowZoom = toolsRoom < minWrapped;
      setVariable('--zoom-left', '0px');
      setVariable('--zoom-top', cssPixels(cardBottom));
      setVariable('--tools-left', 'auto');
      setVariable('--tools-right', '0px');
      setVariable('--tools-top', cssPixels(cardBottom + (toolsBelowZoom ? (zoom?.height || 0) + 6 : 0)));
      setVariable('--tools-max-width', cssPixels(toolsBelowZoom ? innerWidth - 20 : toolsRoom));
    } else {
      setVariable('--zoom-left', cssPixels(zoomLeft));
      setVariable('--zoom-top', '0px');
      setVariable('--tools-left', 'auto');
      setVariable('--tools-right', '0px');
      setVariable('--tools-top', '0px');
      setVariable('--tools-max-width', cssPixels(layoutState === 'wrapped'
        ? Math.max(minWrapped, wrappedRoom)
        : Math.max(120, innerWidth - 20)));
    }

    if (document.body.classList.contains('is-editing')) {
      const editorTopbar = document.getElementById('editor-topbar');
      const topbarRect = editorTopbar && !editorTopbar.hidden ? editorTopbar.getBoundingClientRect() : null;
      if (topbarRect && topbarRect.width > 0) {
        if (topbarRect.left < 10 + zoomWidth + 8) {
          setVariable('--zoom-left', '10px');
          setVariable('--zoom-top', cssPixels(Math.ceil(topbarRect.bottom)));
        } else {
          setVariable('--zoom-left', '10px');
          setVariable('--zoom-top', '0px');
        }
        if (row.total > 0) {
          const toolsLeftEdge = innerWidth - row.total - 10;
          if (topbarRect.right + 8 > toolsLeftEdge) {
            setVariable('--tools-top', cssPixels(Math.max(0, Math.ceil(topbarRect.bottom))));
            setVariable('--tools-left', 'auto');
            setVariable('--tools-right', '0px');
          }
        }
      }
    }
    const profileHeight = snapshot.profile?.height || 0;
    const infoCeiling = Math.max(120, Math.min(innerHeight * 0.48, innerHeight - profileHeight - 120));
    setVariable('--info-max-height', cssPixels(infoCeiling));
    const editorRailTop = snapshot.editorRail
      ? Math.max(68, Math.ceil((zoom?.bottom || 0) + 8))
      : 68;
    setVariable('--editor-rail-top', cssPixels(editorRailTop));
  }

  function measureSafeRect(snapshot) {
    const width = snapshot.width;
    const height = snapshot.height;
    const topBoxes = [
      snapshot.info,
      snapshot.splits,
      snapshot.zoom,
      snapshot.tools,
      snapshot.exportPanel,
      snapshot.toolbox,
      snapshot.editorTopbar,
    ].filter(Boolean);
    let top = topBoxes.reduce((largest, rect) => Math.max(largest, rect.bottom), 0);

    const bottomBoxes = [
      snapshot.profile,
      snapshot.scale,
      snapshot.attribution,
    ].filter(Boolean);
    let bottom = bottomBoxes.reduce((smallest, rect) => Math.min(smallest, rect.top), height);
    let right = 0;

    const overview = snapshot.overview;
    if (overview) {
      if (overview.left > width * 0.45 && overview.width <= 360) {
        right = Math.max(right, width - overview.left);
      } else {
        bottom = Math.min(bottom, overview.top);
      }
    }

    top = top > 0 ? top + GAP : GAP;
    bottom = Number.isFinite(bottom) ? height - bottom + GAP : GAP;
    right = right > 0 ? right + GAP : GAP;
    const leftBoxes = [
      snapshot.editorRail,
      width >= 760 ? snapshot.editorDrawer : null,
    ].filter(Boolean);
    const left = Math.max(GAP, leftBoxes.reduce((largest, rect) => Math.max(largest, rect.right + GAP), GAP));
    const measured = safeMapRect(width, height, { left, top, right, bottom });
    if (measured.width >= 80 && measured.height >= 80) return measured;

    // Keep a navigable rectangle at extreme sizes; reveal then clamps into what remains.
    return safeMapRect(width, height, {
      left: Math.min(GAP, width / 8),
      top: Math.min(top, height / 4),
      right: Math.min(right, width / 4),
      bottom: Math.min(bottom, height / 3),
    });
  }

  function currentSignature() {
    return [innerWidth, innerHeight, layoutState, safeRect.left, safeRect.top, safeRect.right, safeRect.bottom]
      .map((value) => Math.round(value)).join(':');
  }

  /**
   * Re-applies the current selection after the layout moved (summary expanded, window resized). This uses
   * focusSelection rather than revealPoint: revealPoint only nudges a card that is partly off screen, which
   * leaves a card taller than the safe band straddling the summary. focusSelection knows to align such a card
   * to the safe top, so the card reads from its heading down.
   */
  function scheduleReveal() {
    if (!lastFocus) return;
    if (revealFrame) {
      revealAgain = true;
      return;
    }
    revealFrame = requestAnimationFrame(() => {
      revealFrame = requestAnimationFrame(() => {
        revealFrame = 0;
        focusSelection(lastFocus.latlng, lastFocus.options);
        if (revealAgain) {
          revealAgain = false;
          scheduleReveal();
        }
      });
    });
  }

  function cancelScheduledReveal() {
    if (!revealFrame) return;
    cancelAnimationFrame(revealFrame);
    revealFrame = 0;
    revealAgain = false;
  }

  function refineDependentVariables(snapshot) {
    const card = snapshot.info;
    const splits = snapshot.splits;
    const zoom = snapshot.zoom;
    const infoCompact = document.body.classList.contains('info-compact')
      && !document.body.classList.contains('is-editing');
    const zoomLeft = infoCompact ? 10 : (card ? card.right + 8 : 10);
    const splitWouldMeetZoom = !infoCompact && splits && zoom && splits.right > zoomLeft - 6;
    const splitTop = Math.max(
      (card?.bottom || 0) + (infoCompact ? 6 : 8),
      snapshot.splitElement?.classList.contains('expanded') && splitWouldMeetZoom
        ? (zoom?.bottom || 0) + 8
        : 0,
      10,
    );
    setVariable('--splits-top', cssPixels(splitTop));
    if (infoCompact && zoom) {
      const underSplitsTop = splits ? splitTop + splits.height + 6 : (card?.bottom || 8) + 6;
      setVariable('--zoom-top', cssPixels(underSplitsTop));
    }
    const toolsBottom = snapshot.tools?.bottom || 0;
    setVariable('--floating-panel-top', cssPixels(Math.max(54, toolsBottom + 4)));
    if (!splits || sameNumber(splits.top, splitTop)) return snapshot;
    return {
      ...snapshot,
      splits: {
        ...splits,
        top: splitTop,
        bottom: splitTop + splits.height,
      },
    };
  }

  function finishLayout(snapshot) {
    const refined = refineDependentVariables(snapshot);
    safeRect = measureSafeRect(refined);
    const signature = currentSignature();
    const fitInitialRoute = initialRoutePending;
    initialRoutePending = false;
    const shouldRefitHome = pendingRefitHome;
    const shouldRevealFocus = pendingRevealFocus;
    pendingRefitHome = true;
    pendingRevealFocus = true;
    layoutFrame = 0;
    if (signature === layoutSignature) return;
    layoutSignature = signature;
    if (fitInitialRoute && bounds?.isValid()) fit();
    else if (!atHome && lastFocus && shouldRevealFocus) scheduleReveal();
    else if (shouldRefitHome && atHome && signature !== lastFittedSignature) {
      fit();
    }
  }

  function scheduleRefresh({ refitHome = true, revealFocus = true } = {}) {
    if (!revealFocus) cancelScheduledReveal();
    pendingRefitHome = layoutFrame ? pendingRefitHome && refitHome : refitHome;
    pendingRevealFocus = layoutFrame ? pendingRevealFocus && revealFocus : revealFocus;
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      observeLayoutNodes();
      placeControls(readLayoutSnapshot());
      layoutFrame = requestAnimationFrame(() => finishLayout(readLayoutSnapshot()));
    });
  }

  function fitRoute({ animate = false, maxZoom = 16 } = {}) {
    if (!bounds?.isValid()) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    map.fitBounds(bounds, {
      paddingTopLeft: [safeRect.left, safeRect.top],
      paddingBottomRight: [width - safeRect.right, height - safeRect.bottom],
      maxZoom,
      animate,
    });
    const center = map.getCenter();
    homeView = { lat: center.lat, lng: center.lng, zoom: map.getZoom() };
    atHome = true;
    lastFittedSignature = currentSignature();
  }

  function fit() {
    fitRoute();
  }

  function focusBounds(nextBounds, options = {}) {
    if (!nextBounds?.isValid()) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const before = map.getZoom();
    map.fitBounds(nextBounds, {
      paddingTopLeft: [safeRect.left, safeRect.top],
      paddingBottomRight: [width - safeRect.right, height - safeRect.bottom],
      maxZoom: options.maxZoom ?? 15,
      animate: options.animate ?? true,
    });
    const gain = options.minZoomGain ?? 0;
    if (gain > 0 && map.getZoom() < before + gain) {
      map.setView(nextBounds.getCenter(), Math.min(options.maxZoom ?? 15, before + gain), {
        animate: options.animate ?? true,
      });
    }
    atHome = false;
    homeView = null;
  }

  function popupRect(open) {
    if (!open) return null;
    const popup = document.querySelector('.leaflet-popup');
    if (!popup) return null;
    const content = popup.querySelector('.leaflet-popup-content');
    // Both pin cards size themselves: the photo one from its 4:3 frame, the plain one from its own text box,
    // which scrolls internally. Clamping the popup content here cut the facts and the next arrow off the
    // bottom of a portrait card, so the limit stays for text popups that have no card of their own.
    const isPinCard = popup.classList.contains('photo-popup') || popup.classList.contains('place-popup');
    if (content instanceof HTMLElement && !isPinCard) {
      const limit = Math.max(48, safeRect.height - 96);
      content.style.maxHeight = `${Math.round(limit)}px`;
      content.style.overflowY = 'auto';
    }
    return mapRect(popup);
  }

  function revealPoint(latlng, options = {}) {
    if (!latlng) return;
    const at = map.latLngToContainerPoint(latlng);
    const focus = unionRects([pointRect(at.x, at.y, 34), options.popup ? popupRect(true) : null]);
    const offset = revealOffset(focus, safeRect);
    if (offset.needed) map.panBy([-offset.x, -offset.y], { animate: options.animate ?? false });
    lastFocus = { latlng: storedLatLng(latlng), options: { popup: Boolean(options.popup), animate: false } };
  }

  function focusSelection(latlng, options = {}) {
    if (!latlng) return;
    const at = map.latLngToContainerPoint(latlng);
    const focus = unionRects([pointRect(at.x, at.y, 38), options.popup ? popupRect(true) : null]);
    const offset = focusOffset(focus, safeRect);
    if (offset.needed) {
      map.panBy([-offset.x, -offset.y], { animate: options.animate ?? true });
    }
    atHome = false;
    homeView = null;
    lastFocus = { latlng: storedLatLng(latlng), options: { popup: Boolean(options.popup), animate: false } };
  }

  let panVectorFrame = 0;
  function needsVectorBufferRefresh(renderer) {
    if (!renderer?._bounds || map._animatingZoom) return false;
    const size = map.getSize();
    if (size.x <= 0 || size.y <= 0) return false;
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    const pad = Number(renderer.options?.padding) || 0;
    const marginX = size.x * Math.min(0.25, pad * 0.4);
    const marginY = size.y * Math.min(0.25, pad * 0.4);
    const vectorBounds = renderer._bounds;
    return topLeft.x < vectorBounds.min.x + marginX
      || topLeft.y < vectorBounds.min.y + marginY
      || topLeft.x + size.x > vectorBounds.max.x - marginX
      || topLeft.y + size.y > vectorBounds.max.y - marginY;
  }

  map.on('movestart', () => document.body.classList.add('is-map-dragging'));
  map.on('move', () => {
    const renderer = map.options.renderer;
    if (!renderer || typeof renderer._update !== 'function') return;
    if (panVectorFrame || !needsVectorBufferRefresh(renderer)) return;
    panVectorFrame = requestAnimationFrame(() => {
      panVectorFrame = 0;
      if (needsVectorBufferRefresh(renderer)) renderer._update();
    });
  });
  map.on('moveend', () => {
    document.body.classList.remove('is-map-dragging');
    if (homeView && sameView({
      lat: map.getCenter().lat,
      lng: map.getCenter().lng,
      zoom: map.getZoom(),
    }, homeView)) {
      atHome = true;
    } else if (homeView) {
      atHome = false;
    }
  });
  map.on('resize', () => {
    scheduleRefresh();
    if (!atHome) scheduleReveal();
  });

  return {
    map,
    setRoute(nextBounds) {
      bounds = nextBounds;
      initialRoutePending = Boolean(nextBounds?.isValid());
    },
    fit,
    fitRoute,
    focusBounds,
    focusSelection,
    revealPoint,
    observeControls() {
      observer = new ResizeObserver((entries) => {
        const toolboxOnly = entries.length > 0
          && entries.every((entry) => entry.target.id === 'toolbox-panel');
        scheduleRefresh({ refitHome: false, revealFocus: !toolboxOnly });
      });
      observeLayoutNodes();
      addEventListener('resize', () => scheduleRefresh({ refitHome: true }));
      scheduleRefresh({ refitHome: true });
    },
    refreshControls({ refitHome = true, revealFocus = true } = {}) {
      scheduleRefresh({ refitHome, revealFocus });
    },
    safeRect: () => ({ ...safeRect }),
    layoutState: () => layoutState,
    isHome: () => atHome,
    focusState: () => lastFocus ? {
      latlng: [lastFocus.latlng.lat, lastFocus.latlng.lng],
      popup: lastFocus.options.popup,
    } : null,
  };
}
