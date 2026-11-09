// Track viewer page: loads the file from ?src=, draws it with Leaflet and reports "ready\t<summary>" or
// "error:<text>" to the plugin (window.chrome.webview). Works in any browser through a local web server.
// GPX and KML are recognised by their root element, so a mis-named file still opens.
import { GpxError, parseGpxDocument, parseXml, summarize } from './gpx.js';
import { KmlError, parseKmlDocument } from './kml.js';
import { getLang, isChinese, langLabel, onLangChange, t, toggleLang, units } from './i18n.js';
import { installSpaceGuard } from './focus.js';
import { createPhotoViewer } from './photo-viewer.js';
import { createProfileController } from './profile-controller.js';
import {
  LAYERS,
  createExportControl,
  createLanguageControl,
  createLayerSwitcher,
  createLocateControl,
  savedLayer,
} from './map-controls.js';
import {
  formatCoord,
  formatDistance,
  formatters,
} from './format.js';
import { createWaypointContent, renderPointPopup } from './waypoint-content.js';
import { createSummaryView } from './summary-view.js';
import { createTrackLayer } from './track-layer.js';
import { createWaypointController } from './waypoint-controller.js';
import { createOverlayExport } from './overlay-export.js';
import { createKeyboardController } from './keyboard-controller.js';
import { createMapView } from './map-view.js';
import { createUiFeedback } from './ui-feedback.js';
import { gradeAwareHikeSeconds } from './track-analysis.js';

const L = window.L;
const params = new URLSearchParams(location.search);
const src = params.get('src');
const fileName = params.get('name') || fileNameFromSource(src);

function fileNameFromSource(source) {
  if (!source) return t('file.untitled');
  const leaf = source.split('?')[0].split('/').pop() || '';
  try {
    return decodeURIComponent(leaf) || t('file.untitled');
  } catch {
    return leaf || t('file.untitled');
  }
}


function post(message) {
  window.chrome?.webview?.postMessage(message);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showError(text) {
  document.body.classList.add('failed');
  const box = document.getElementById('message');
  box.replaceChildren(el('h1', null, t('error.title')), el('p', 'file', fileName), el('p', 'detail', text));
  box.hidden = false;
  post(`error:${text}`);
}

const pointPopup = (point, title) => renderPointPopup(point, title, el);

// Built on first use: a file whose waypoints carry no photos never pays for the modal DOM.
const photoViewer = createPhotoViewer({ el, formatters, formatCoord, t });
const waypointContent = createWaypointContent({ el, src, photoViewer, pointPopup });
const { photosOf, photoPreview } = waypointContent;

// ---------- info box and elevation profile ----------

// Text that lives on the map as long as the file is open (tooltips, the profile's range line). A language
// switch repaints these in place instead of rebuilding the map.
const localizedNodes = [];

function localized(node, fill, attribute = null) {
  if (attribute) node.setAttribute(attribute, fill());
  else node.textContent = fill();
  localizedNodes.push({ node, fill, attribute });
  return node;
}

function repaintLocalized() {
  for (const { node, fill, attribute } of localizedNodes) {
    if (attribute) node.setAttribute(attribute, fill());
    else node.textContent = fill();
  }
}

const renderInfo = createSummaryView({
  el,
  fileName,
  photosOf,
  onLayoutChange: () => mapViewController?.refreshControls(),
});

// There used to be a bar of key hints across the top of the map. It took the widest part of the window and
// pushed the summary and the corner switches apart, so the keys now live where their own control is: the
// tooltip of the button they stand for (Q/E on the backgrounds, W on the markers, C on the fit button, X on
// the export button). Keys with no button of their own -- the arrows, A/D, S -- are left unsaid.

// ---------- map ----------

let profilePins = [];
const trackLayer = createTrackLayer({
  L,
  el,
  localized,
  t,
  pointPopup,
  onFocusBounds: (bounds, options) => mapViewController?.focusBounds(bounds, options),
});
let activeTrackLayer = null;
const waypointController = createWaypointController({
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
  onPreferenceChange: () => syncPreferences(),
  onVisibilityChange: (visible) => activeTrackLayer?.setAnnotationMarkersVisible(visible),
  onFocus: (stop, popup) => mapViewController?.focusSelection(
    [stop.point.lat, stop.point.lon],
    { popup },
  ),
  onLayoutChange: () => mapViewController?.refreshControls(),
  setProfilePinsVisible: (visible) => {
    for (const pin of profilePins) pin.node.hidden = !visible;
  },
});
const profileController = createProfileController({
  L,
  el,
  localized,
  t,
  formatters,
  formatDistance,
  photosOf,
  getPinsShown: () => waypointController.visible(),
  setProfilePins: (pins) => { profilePins = pins; },
  getStops: () => waypointController.stops(),
  focusStop: (index) => waypointController.focus(index),
  revealPoint: (latlng) => mapViewController?.revealPoint(latlng),
});
let overlayExport = null;
let mapViewController = null;
let layerSwitch = null;
const uiFeedback = createUiFeedback({
  t,
  overlay: () => overlayExport,
  afterShow: () => mapViewController?.refreshControls(),
});
const showToast = uiFeedback.showToast;
const toggleChrome = uiFeedback.toggle;
const keyboardController = createKeyboardController({
  LAYERS,
  photoViewer,
  waypointController,
  overlay: () => overlayExport,
  layerSwitch: () => layerSwitch,
  fit: () => mapViewController?.fit(),
  toggleChrome,
});
const pressKey = keyboardController.pressKey;
const onKeyDown = keyboardController.onKeyDown;

/** Keep the host's origin-independent copy in step with what the page is showing. */
function syncPreferences() {
  const settings = overlayExport?.settings() || { size: '9:16', ink: 'black', scrim: 'none' };
  const values = new URLSearchParams({
    lang: getLang(),
    layer: layerSwitch?.current() || savedLayer(params),
    pins: waypointController.visible() ? '1' : '0',
    exportSize: settings.size,
    exportInk: settings.ink,
    exportScrim: settings.scrim,
  });
  post(`settings\t${values.toString()}`);
}

/** Keeps the host-language hints (spell check, screen readers, window title) in step with the interface. */
function applyPageLanguage() {
  document.documentElement.lang = isChinese() ? 'zh-CN' : 'en';
  document.title = t('page.title');
}

/** The plugin logs the ready line as it arrives, so it keeps one machine-readable shape in both languages. */
function distanceLog(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
}

async function main() {
  applyPageLanguage();

  if (!src) {
    showError(t('error.noFile'));
    return;
  }

  let text;
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    text = await response.text();
  } catch (e) {
    showError(t('error.read', { detail: e.message }));
    return;
  }

  let gpx;
  let summary;
  try {
    // One XML parse for both formats; the root element decides which reader runs. Keyhole markup uses
    // <kml> at the root, GPX uses <gpx>, so neither can be mistaken for the other.
    const doc = parseXml(text);
    const rootName = doc.documentElement?.localName;
    if (rootName !== 'kml' && rootName !== 'gpx') {
      throw new KmlError(t('error.notTrack'));
    }
    gpx = rootName === 'kml' ? parseKmlDocument(doc) : parseGpxDocument(doc);
    summary = summarize(gpx);
  } catch (e) {
    const known = e instanceof GpxError || e instanceof KmlError;
    showError(known ? e.message : t('error.unexpected', { detail: e.message }));
    return;
  }

  // Worked out once: the summary box and the profile read the same numbers, and neither recomputes on a
  // language switch.
  const elevations = summary.elevation ? profileController.read(gpx) : null;
  const hikeEstimate = elevations ? gradeAwareHikeSeconds({
    distance: summary.distanceMeters,
    ascent: elevations.ascent,
    descent: elevations.descent,
    bins: elevations.slopeBins,
  }) : null;
  renderInfo(gpx, summary, elevations, hikeEstimate);
  // Drawn before the map: the fit below needs to know whether the panel is there, and the panel's own height
  // is fixed in CSS, so the map never has to be told its size changed.
  const profile = elevations ? profileController.render(gpx, elevations) : null;

  const map = L.map('map', { keyboard: false, worldCopyJump: false });
  map.getContainer().tabIndex = -1;
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank">Leaflet</a>');
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  mapViewController = createMapView({ map, isChromeHidden: uiFeedback.isHidden });
  const tracks = trackLayer.draw(map, gpx);
  activeTrackLayer = tracks;
  const waypointBounds = waypointController.draw(map, gpx, tracks.segments, tracks.navigationMarks);
  tracks.bounds.extend(waypointBounds);
  const bounds = tracks.bounds;
  mapViewController.setRoute(bounds);
  tracks.refreshDistanceMarks();
  waypointController.refreshMapMarks();
  tracks.setAnnotationMarkersVisible(waypointController.visible());

  overlayExport = createOverlayExport({
    L,
    el,
    t,
    post,
    showToast,
    params,
    gpx,
    summary,
    elevations,
    fileName,
    onSettingsChange: syncPreferences,
  });

  // First of the corner controls, so it stands leftmost: "where the map looks" before "what the map shows".
  const locateCtrl = createLocateControl({ L, map, el, t, onLocate: () => mapViewController.fit() });
  const exportCtrl = overlayExport.available()
    ? createExportControl({ L, map, el, t, onExport: () => void overlayExport.save() })
    : null;
  if (exportCtrl) map.on('click', () => overlayExport.close());
  const switcher = createLayerSwitcher({
    L, map, el, t, initial: savedLayer(params), onRemember: syncPreferences,
  }); // after the view is set: the grid needs the map bounds
  layerSwitch = switcher;
  // A file that draws no dots and has no waypoints gets no switch: there is nothing for it to show or hide.
  waypointController.createControl(map);
  const langControl = createLanguageControl({
    L, map, el, t, label: langLabel, toggle: toggleLang,
  });
  mapViewController.observeControls();
  mapViewController.fit();
  const scrub = profile ? profileController.attach(map, profile) : null;
  installSpaceGuard();
  document.addEventListener('keydown', onKeyDown);

  // A language switch repaints the page where it stands: same map, same view, same selection. Everything
  // that is generated from that state is rebuilt from the same values, so nothing has to be reparsed.
  onLangChange(() => {
    applyPageLanguage();
    syncPreferences();
    renderInfo(gpx, summary, elevations, hikeEstimate);
    switcher.relabel();
    locateCtrl.relabel();
    exportCtrl?.relabel();
    waypointController.relabel();
    langControl.relabel();
    repaintLocalized();
    activeTrackLayer?.refreshDistanceMarks();
    if (scrub?.point()) scrub.refresh();
    // Popup content is built on open, so the open one is closed and opened again to be typed in the new
    // language; the pin stays selected and the card lands where it already was.
    const open = waypointController.openStop();
    if (open) {
      open.marker.closePopup();
      open.marker.openPopup();
    }
    photoViewer.relabel();
    overlayExport?.relabel();
    // The switch labels grew or shrank with the language, so whether the corner still holds them is a new
    // question -- and the card may not have changed width at all, leaving the observer silent.
    requestAnimationFrame(() => mapViewController.refreshControls());
  });

  const api = {
    gpx, summary, map, scrub, photos: photoViewer, hikeEstimate,
    // The worked-out route shape, without the point arrays a test does not need.
    profile: elevations && {
      min: elevations.min, max: elevations.max, total: elevations.total,
      ascent: elevations.ascent, descent: elevations.descent, runs: elevations.runs,
      rawAscent: elevations.rawAscent, rawDescent: elevations.rawDescent, steep: elevations.steep,
      slopeBins: elevations.slopeBins,
    },
    nav: {
      select: waypointController.select,
      index: waypointController.index,
      stops: waypointController.stops,
      photoStops: waypointController.photoStops,
      nodes: () => waypointController.navigation().map((node) => ({
        kind: [...node.kinds, ...(node.stop ? ['waypoint'] : [])].join('+'),
        name: node.point.name || '',
        along: node.along,
        stop: node.stop?.sourceIndex ?? null,
      })),
      nodeIndex: waypointController.nodeIndex,
      hasOverview: waypointController.hasOverview,
      overviewOpen: waypointController.overviewOpen,
      openOverview: waypointController.openOverview,
      closeOverview: waypointController.closeOverview,
    },
    pins: {
      show: () => waypointController.show(),
      hide: () => waypointController.hide(),
      visible: waypointController.visible,
      hasControl: waypointController.hasControl,
      count: waypointController.count,
    },
    selectLayer: (key) => switcher.select(key, true), layer: switcher.current,
    // The frame the file opened with, for a test that wants it without walking the layers.
    locate: () => mapViewController.fit(),
    mapLayout: () => ({
      state: mapViewController.layoutState(),
      safe: mapViewController.safeRect(),
      home: mapViewController.isHome(),
      focus: mapViewController.focusState(),
    }),
    focusBounds: (bounds, options) => mapViewController.focusBounds(bounds, options),
    revealPoint: (latlng, options) => mapViewController.revealPoint(latlng, options),
    // For the host: it owns the keys until the page gets the keyboard (see TrailViewerPanel).
    pressKey,
    // The overlay export: the canvas is exposed for the tests, the toast callbacks for the host.
    overlayCanvas: (options) => overlayExport.build(options),
    exportOverlay: () => overlayExport.save(),
    exportSettings: () => overlayExport.settings(),
    panelOpen: () => overlayExport.panelOpen(),
    exported: (path) => showToast(t('export.done', { name: String(path).split(/[\\/]/).pop() }), 4000),
    exportFailed: (detail) => showToast(t('export.failed', { detail }), 4000),
  };
  window.trailViewer = api;
  window.gpxViewer = api; // Remove after one compatibility release.
  document.body.classList.add('loaded');
  post(`ready\t${summary.points} points, ${distanceLog(summary.distanceMeters)}`);
}

main().catch((error) => showError(t('error.unexpected', { detail: error.message })));
