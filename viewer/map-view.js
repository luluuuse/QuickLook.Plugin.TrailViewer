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
  let fitFrame = 0;
  let revealFrame = 0;
  let revealAgain = false;
  let layoutSignature = '';
  let lastFittedSignature = '';
  let homeView = null;
  let atHome = true;
  let lastFocus = null;
  const observed = new WeakSet();
  let observer = null;

  function mapRect(node) {
    if (!shown(node)) return null;
    const base = container.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    return makeRect(
      rect.left - base.left,
      rect.top - base.top,
      rect.right - base.left,
      rect.bottom - base.top,
    );
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
      '#profile',
      '#export',
      '.waypoint-overview',
      '.leaflet-top.leaflet-left',
      '.leaflet-top.leaflet-right',
    ]) {
      addObserved(document.querySelector(selector));
    }
  }

  function controlWidths(row) {
    if (!shown(row)) return { total: 0, widest: 0 };
    const widths = [...row.children].filter(shown).map((node) => node.getBoundingClientRect().width);
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
  function placeControls() {
    const zoomWrap = map.zoomControl?.getContainer().closest('.leaflet-top.leaflet-left');
    const tools = document.querySelector('#map .leaflet-top.leaflet-right');
    if (!zoomWrap) return;

    const hidden = isChromeHidden();
    const card = hidden ? null : mapRect(document.getElementById('info'));
    const zoom = mapRect(zoomWrap);
    const zoomWidth = zoom?.width || 30;
    const row = controlWidths(tools);
    const zoomLeft = card ? card.right + 8 : 10;
    const zoomRight = zoomLeft + zoomWidth;
    const inlineRoom = innerWidth - zoomRight - 22;
    const inline = !tools || row.total <= inlineRoom;
    const minWrapped = Math.max(48, row.widest + 12);
    const wrappedRoom = Math.max(0, innerWidth - zoomRight - 22);
    const wrapped = !inline && wrappedRoom >= minWrapped;
    const next = inline ? 'inline' : wrapped ? 'wrapped' : 'docked';

    if (next !== layoutState) {
      layoutState = next;
      document.body.classList.remove(...LAYOUT_CLASSES);
      document.body.classList.add(`layout-${layoutState}`);
      document.body.classList.toggle('stepped', layoutState === 'docked');
    }

    if (layoutState === 'docked') {
      const cardBottom = card ? card.bottom : 8;
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
      setVariable('--tools-max-width', cssPixels(layoutState === 'inline'
        ? Math.max(120, innerWidth - 20)
        : Math.max(minWrapped, wrappedRoom)));
    }

    const profileHeight = shown(document.getElementById('profile'))
      ? document.getElementById('profile').getBoundingClientRect().height
      : 0;
    const infoCeiling = Math.max(120, Math.min(innerHeight * 0.48, innerHeight - profileHeight - 120));
    setVariable('--info-max-height', cssPixels(infoCeiling));
  }

  function measureSafeRect() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const hidden = isChromeHidden();
    const topBoxes = [
      hidden ? null : mapRect(document.getElementById('info')),
      mapRect(document.querySelector('#map .leaflet-top.leaflet-left')),
      mapRect(document.querySelector('#map .leaflet-top.leaflet-right')),
      mapRect(document.getElementById('export')),
    ].filter(Boolean);
    let top = topBoxes.reduce((largest, rect) => Math.max(largest, rect.bottom), 0);

    const bottomBoxes = [
      mapRect(document.getElementById('profile')),
      mapRect(document.querySelector('.leaflet-control-scale')),
      mapRect(document.querySelector('.leaflet-control-attribution')),
    ].filter(Boolean);
    let bottom = bottomBoxes.reduce((smallest, rect) => Math.min(smallest, rect.top), height);
    let right = 0;

    const overview = mapRect(document.querySelector('.waypoint-overview'));
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
    const measured = safeMapRect(width, height, { left: GAP, top, right, bottom });
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

  function scheduleFit() {
    if (fitFrame || !bounds?.isValid()) return;
    fitFrame = requestAnimationFrame(() => {
      fitFrame = 0;
      fit();
    });
  }

  function scheduleReveal() {
    if (!lastFocus) return;
    if (revealFrame) {
      revealAgain = true;
      return;
    }
    revealFrame = requestAnimationFrame(() => {
      revealFrame = requestAnimationFrame(() => {
        revealFrame = 0;
        revealPoint(lastFocus.latlng, lastFocus.options);
        if (revealAgain) {
          revealAgain = false;
          scheduleReveal();
        }
      });
    });
  }

  function refreshLayout({ refitHome = true } = {}) {
    observeLayoutNodes();
    placeControls();
    safeRect = measureSafeRect();
    const signature = currentSignature();
    if (signature === layoutSignature) return;
    layoutSignature = signature;
    if (!atHome && lastFocus) scheduleReveal();
    else if (refitHome && atHome && signature !== lastFittedSignature) {
      scheduleFit();
    }
  }

  function scheduleRefresh() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      refreshLayout();
    });
  }

  function fitRoute({ animate = false, maxZoom = 16 } = {}) {
    if (!bounds?.isValid()) return;
    placeControls();
    safeRect = measureSafeRect();
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
    placeControls();
    safeRect = measureSafeRect();
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
    if (content instanceof HTMLElement) {
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
    placeControls();
    safeRect = measureSafeRect();
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

  map.on('moveend', () => {
    if (homeView && sameView({
      lat: map.getCenter().lat,
      lng: map.getCenter().lng,
      zoom: map.getZoom(),
    }, homeView)) {
      atHome = true;
    } else if (homeView) {
      atHome = false;
    }
    scheduleRefresh();
  });
  map.on('zoomend', scheduleRefresh);
  map.on('resize', () => {
    scheduleRefresh();
    if (!atHome) scheduleReveal();
  });

  return {
    map,
    setRoute(nextBounds) {
      bounds = nextBounds;
    },
    fit,
    fitRoute,
    focusBounds,
    focusSelection,
    revealPoint,
    observeControls() {
      observer = new ResizeObserver(scheduleRefresh);
      observeLayoutNodes();
      placeControls();
      addEventListener('resize', scheduleRefresh);
      refreshLayout({ refitHome: false });
    },
    refreshControls() {
      scheduleRefresh();
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
