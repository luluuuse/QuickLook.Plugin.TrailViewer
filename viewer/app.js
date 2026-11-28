// Track viewer page: loads the file from ?src=, draws it with Leaflet and reports "ready\t<summary>" or
// "error:<text>" to the plugin (window.chrome.webview). Works in any browser through a local web server.
// FIT is recognised by its binary signature. GPX and KML are recognised by their root element, so a
// mis-named text track still opens.
import { GpxError, parseGpxDocument, parseXml, summarize } from './gpx.js';
import { KmlError, parseKmlDocument } from './kml.js';
import { FitError, isFit, parseFit } from './fit.js';
import { createRouteModel } from './route-model.js';
import { getLang, isChinese, onLangChange, setLang, t, units } from './i18n.js';
import { THEMES, getTheme, initTheme, onThemeChange, setTheme } from './theme.js';
import { attachSwissScaleRatio } from './swiss-scale.js';
import { installSpaceGuard } from './focus.js';
import { createProfileController } from './profile-controller.js';
import {
  LAYERS,
  createLayerSwitcher,
  loadCustomProviders,
  createLocateControl,
  createCompassControl,
  createMap3DControl,
  savedLayer,
  savedTileCache,
} from './map-controls.js';
import {
  formatCoord,
  formatDistance,
  formatSpeed,
  formatTimer,
  formatters,
} from './format.js';
import { createWaypointContent, renderPointPopup } from './waypoint-content.js';
import { createSummaryView, trackSummaryText } from './summary-view.js';
import { analyseSplits, splitCount } from './split-analysis.js';
import { createSplitsView } from './split-view.js';
import { createTrackLayer } from './track-layer.js';
import { createTrackViewController } from './track-view-controller.js';
import { createTrackColorControl, savedTrackColor } from './track-color-control.js';
import { createWaypointController } from './waypoint-controller.js';
import { createKeyboardController } from './keyboard-controller.js';
import { createMapView } from './map-view.js';
import { createUiFeedback } from './ui-feedback.js';
import { createMeasurement } from './measure.js';
import { createToolbox } from './toolbox.js';
import {
  TERRAIN_PROVIDERS,
  WEATHER_CATEGORIES,
  WEATHER_PROVIDERS,
  WEATHER_TARGETS,
  availableTargets,
  normalizeAnyWeatherProvider,
  openExternal,
  saveProviderForCategory,
  saveWeatherCategory,
  savedActiveWeatherProvider,
  savedProviderForCategory,
  savedWeatherCategory,
  weatherTargetPoint,
  weatherUrl,
  zoomFor,
} from './weather.js';
import { installLeafletIcons } from './icons.js';
import { gradeAwareHikeSeconds } from './track-analysis.js';
import { readStored } from './storage.js';
import { coordinateTargets } from './coordinates.js';
import { createHostBridge } from './host-bridge.js';
import { createTestApi } from './test-api.js';

const L = window.L;
const params = new URLSearchParams(location.search);
const src = params.get('src');
const fileName = params.get('name') || fileNameFromSource(src);
const appVersion = params.get('ver') || '';
const timing = {
  parseMs: null,
  prepareMs: null,
  readyMs: null,
  firstPaintMs: null,
  splitFirstOpenMs: null,
};
const hostBridge = createHostBridge();
const {
  hasHost: hasQuickLookHost,
  post,
  decodeMessage,
  copyText,
  clipboardResult,
  persistCustomSources,
  installViewerMessages,
  installTextInputReporting,
} = hostBridge;
if (hasQuickLookHost) document.body.classList.add('ql-host');
const runtimeConfig = window.__TRAILVIEWER_RUNTIME_CONFIG__ || {};
const initialTileCache = savedTileCache(params, runtimeConfig.tileCache);
let runtimeTiandituKey = runtimeConfig.direct === true
  && /^[0-9a-fA-F]{32}$/.test(runtimeConfig.tiandituKey || '')
  ? runtimeConfig.tiandituKey
  : '';
const initialDirectTiandituKey = runtimeTiandituKey;
let tiandituTransientShown = false;
let tiandituRejectedShown = false;
let photoAttachments = [];
let buildAttachmentItems = null;
let attachmentExporter = null;

function fileNameFromSource(source) {
  if (!source) return t('file.untitled');
  const leaf = source.split('?')[0].split('/').pop() || '';
  try {
    return decodeURIComponent(leaf) || t('file.untitled');
  } catch {
    return leaf || t('file.untitled');
  }
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

const pointPopup = (point, title, close) => renderPointPopup(point, title, el, close);

// Built on first use: photo-viewer.js is only fetched when the user opens a photo lightbox.
let photoViewerInstance = null;
let photoViewerPromise = null;
function ensurePhotoViewer() {
  if (photoViewerInstance) return Promise.resolve(photoViewerInstance);
  if (!photoViewerPromise) {
    photoViewerPromise = import('./photo-viewer.js').then(({ createPhotoViewer }) => {
      photoViewerInstance = createPhotoViewer({ el, formatters, formatCoord, t });
      return photoViewerInstance;
    }).catch((err) => {
      photoViewerPromise = null;
      throw err;
    });
  }
  return photoViewerPromise;
}
const photoViewer = {
  show(...args) {
    if (photoViewerInstance) return photoViewerInstance.show(...args);
    return ensurePhotoViewer().then((viewer) => viewer.show(...args));
  },
  hide() { photoViewerInstance?.hide(); },
  relabel() { photoViewerInstance?.relabel(); },
  stepWithin(delta) { return photoViewerInstance ? photoViewerInstance.stepWithin(delta) : false; },
  current: () => (photoViewerInstance ? photoViewerInstance.current() : null),
  isOpen: () => Boolean(photoViewerInstance && photoViewerInstance.isOpen()),
  count: () => (photoViewerInstance ? photoViewerInstance.count() : 0),
};
const waypointContent = createWaypointContent({ el, src, photoViewer });
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

function pruneLocalized() {
  let write = 0;
  for (let i = 0; i < localizedNodes.length; i += 1) {
    const entry = localizedNodes[i];
    if (!entry.node?.isConnected) continue;
    localizedNodes[write++] = entry;
  }
  localizedNodes.length = write;
}

function repaintLocalized() {
  let write = 0;
  for (let i = 0; i < localizedNodes.length; i += 1) {
    const entry = localizedNodes[i];
    if (!entry.node?.isConnected) continue;
    if (entry.attribute) entry.node.setAttribute(entry.attribute, entry.fill());
    else entry.node.textContent = entry.fill();
    localizedNodes[write++] = entry;
  }
  localizedNodes.length = write;
}

let splitData = null;
let loadSplitsData = () => null;
const splitController = createSplitsView({
  el,
  t,
  formatSpeed,
  formatTimer,
  loadData: () => loadSplitsData(),
  onLayoutChange: () => mapViewController?.refreshControls({ refitHome: false }),
  onSelect: (split) => focusSplit(split),
});
async function copySummaryText(text) {
  try {
    await copyText(text);
    showToast(t('summary.copied'), 2500);
  } catch (error) {
    showToast(t('summary.copyFailed', { detail: error.message }), 4000);
    throw error;
  }
}

function syncHostTitleMeta(summary, elevations) {
  const parts = [];
  if (summary && Number.isFinite(summary.distanceMeters) && summary.distanceMeters > 0) {
    parts.push(formatDistance(summary.distanceMeters));
  }
  if (elevations && summary?.elevation && Number.isFinite(elevations.ascent) && elevations.ascent > 0) {
    parts.push(`\u25b2 ${Math.round(elevations.ascent).toLocaleString('en-US')} m`);
  }
  post(`title-meta\t${parts.length > 0 ? encodeURIComponent(parts.join(' \u00b7 ')) : ''}`);
}

const renderInfo = createSummaryView({
  el,
  fileName,
  photosOf,
  onCopySummary: copySummaryText,
  onLayoutChange: () => mapViewController?.refreshControls(),
});

// There used to be a bar of key hints across the top of the map. It took the widest part of the window and
// pushed the summary and the corner switches apart, so the keys now live where their own control is: the
// tooltip of the button they stand for (Q/E on the backgrounds, W on the markers, C on the fit button). Keys
// with no button of their own -- the arrows, A/D, S -- are left unsaid.

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
let trackViewController = null;
let updatePhotoAttachments = null;
let activeProfile = null;
function focusSplit(split) {
  if (!split) {
    activeTrackLayer?.clearSplitHighlight();
    activeProfile?.clearSplitFocus();
    return;
  }
  const highlight = activeTrackLayer?.highlightRange(split.fromMeters, split.toMeters);
  activeProfile?.setSplitFocus(split);
  if (highlight?.bounds.isValid()) {
    if (map3dActive) map3dController?.fitBounds?.(highlight.bounds, { animate: true });
    else mapViewController?.focusBounds(highlight.bounds, { maxZoom: 16, animate: true });
  }
}
function focusProfileRange(range) {
  if (!range) {
    activeTrackLayer?.clearSplitHighlight();
    return;
  }
  splitController.clearSelection?.();
  const highlight = activeTrackLayer?.highlightRange(range.fromMeters, range.toMeters);
  if (range.focusMap && highlight?.bounds.isValid()) {
    if (map3dActive) map3dController?.fitBounds?.(highlight.bounds, { animate: true });
    else mapViewController?.focusBounds(highlight.bounds, { maxZoom: 16, animate: true });
  }
}
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
  onVisibilityChange: (visible) => {
    if (!editorStore?.isActive()) {
      activeTrackLayer?.setAnnotationMarkersVisible(visible);
    }
    editorOverlay?.setWaypointsVisible?.(visible);
    if (map3dActive) map3dController?.setWaypointsVisible?.(visible);
  },
  onFocus: (stop, popup) => {
    if (map3dActive && stop?.point) {
      open3DWaypointCard(stop.point, { focus: true });
      return;
    }
    mapViewController?.focusSelection(
      [stop.point.lat, stop.point.lon],
      { popup },
    );
  },
  onLayoutChange: () => mapViewController?.refreshControls({ refitHome: true, animate: true }),
  onOverviewOpen: () => {
    toolboxController?.close();
    layerSwitch?.close();
  },
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
  formatSpeed,
  formatTimer,
  photosOf,
  getPinsShown: () => waypointController.visible(),
  setProfilePins: (pins) => { profilePins = pins; },
  getStops: () => waypointController.stops(),
  focusStop: (index) => {
    if (!editorStore?.isActive()) waypointController.focus(index);
  },
  revealPoint: (latlng, options) => {
    if (!map3dActive) mapViewController?.revealPoint(latlng, options);
  },
  onHighlight: (lat, lon) => {
    if (map3dActive) map3dController?.setHighlightPoint?.(lat, lon);
  },
  onLayoutChange: () => mapViewController?.refreshControls({ refitHome: true, animate: true }),
  onRangeSelect: (range) => focusProfileRange(range),
  onCropRange: (fromMeters, toMeters) => openTrackEditor({ initialTool: 'crop', cropRange: [fromMeters, toMeters] }),
  isEditingSuspended: () => Boolean(editorStore?.isActive()),
});
let overlayExport = null;
let toolboxController = null;
let measurementController = null;
let mapViewController = null;
let layerSwitch = null;
let trackColorControl = null;
let activeScrub = null;
let mapInstance = null;
let editorStore = null;
let editorOverlay = null;
let editorShell = null;
let editorLoadPromise = null;
let openingEditor = false;
let editorContext = null;
let currentEditedGpx = null;
let savedColorModeBeforeEdit = null;
let map3dController = null;
let map3dModulePromise = null;
let map3dActive = false;
let map3dToggling = false;
let map3dSessionToken = 0;
let map3dControl = null;
let map3dControlsBar = null;
let map3dHudLeft = null;
let map3dExaggeration = 1.0;
let exit3DView = (/** @type {{ syncCamera?: boolean }} */ _opts = {}) => {};
let toggle3DView = () => {};
let sync3DTracks = () => {};
let open3DWaypointCard = (/** @type {any} */ _point, /** @type {{ focus?: boolean }} */ _opts = {}) => {};

function ensureEditorCss() {
  if (document.getElementById('editor-stylesheet')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = 'editor-stylesheet';
    link.rel = 'stylesheet';
    link.href = 'css/editor.css';
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    document.head.append(link);
  });
}

async function ensureEditorLoaded() {
  if (editorShell && editorStore && editorOverlay) return;
  if (!editorLoadPromise) {
    editorLoadPromise = (async () => {
      try {
        const [
          storeMod,
          overlayMod,
          shellMod,
          opsMod,
        ] = await Promise.all([
          import('./track-editor-store.js'),
          import('./editor-overlay.js'),
          import('./editor-shell.js'),
          import('./track-ops.js'),
          ensureEditorCss(),
        ]);
        const ctx = editorContext;
        if (!ctx) return;
        editorStore = storeMod.createTrackEditorStore({
          onChange: (nextParsed) => {
            currentEditedGpx = nextParsed;
            const nextModel = createRouteModel(nextParsed);
            const nextProfile = profileController.read(nextParsed, nextModel);
            const profileBox = document.getElementById('profile');
            if (profileBox) profileBox.textContent = '';
            activeScrub?.destroy?.();
            activeScrub = null;
            activeProfile?.destroy?.();
            activeProfile = null;
            if (nextProfile) {
              activeProfile = profileController.render(nextParsed, nextProfile);
              if (mapInstance) activeScrub = profileController.attach(mapInstance, activeProfile);
            } else {
              activeProfile = null;
            }
            activeTrackLayer?.updateDistancePaths?.(nextParsed);
            editorShell?.refresh();
          },
          onStateChange: (state) => {
            hostBridge.setEditorState(state.active);
            hostBridge.setEditorDirty(state.dirty);
          },
        });
        editorOverlay = overlayMod.createEditorOverlay({
          L,
          map: ctx.map,
          el,
          t,
          formatDistance,
          onSplitAt: (splitMeters) => {
            const current = editorStore.getCurrent();
            if (!current) return;
            editorStore.apply('split', opsMod.splitTrackAt(current, splitMeters));
          },
          onSplitHover: (meters) => editorShell?.setSplitHover?.(meters),
          onPickWaypointLocation: (loc) => editorShell?.pickWaypointLocation(loc),
          onSelectWaypoint: (idx) => editorShell?.selectWaypoint(idx),
          onMoveWaypoint: (idx, lat, lon) => {
            const current = editorStore.getCurrent();
            if (!current) return;
            editorStore.apply('move-waypoint', opsMod.moveWaypoint(current, idx, lat, lon));
          },
          onRotateLoopStart: (alongMeters) => {
            const current = editorStore.getCurrent();
            if (!current) return;
            const { track, rotated, timestampsCleared } = opsMod.rotateLoopStart(current, alongMeters);
            if (rotated) {
              editorStore.apply('rotate-loop', track);
              showToast?.(t(timestampsCleared ? 'editor.topology.loopStartCleared' : 'editor.topology.loopStartDone'));
            }
          },
          onBoxErase: (bounds) => {
            const current = editorStore.getCurrent();
            if (!current) return;
            const { track, removedCount, removedWaypointCount } = opsMod.eraseTrackPointsInBounds(current, bounds);
            if (removedCount > 0 || removedWaypointCount > 0) {
              editorStore.apply('box-erase', track);
              if (removedCount > 0 && removedWaypointCount > 0) {
                showToast?.(t('editor.clean.boxDoneWithWpts', { count: removedCount, wptCount: removedWaypointCount }));
              } else if (removedCount > 0) {
                showToast?.(t('editor.clean.boxDone', { count: removedCount }));
              } else {
                showToast?.(t('editor.clean.boxDoneWptsOnly', { wptCount: removedWaypointCount }));
              }
            } else {
              showToast?.(t('editor.clean.boxNone'));
            }
          },
          onMoveVertex: (flatSegIndex, ptIndex, lat, lon) => {
            const current = editorStore.getCurrent();
            if (!current) return;
            editorStore.apply('move-vertex', opsMod.moveTrackVertex(current, flatSegIndex, ptIndex, lat, lon));
          },
          onInsertVertex: (flatSegIndex, afterIndex, lat, lon, ele) => {
            const current = editorStore.getCurrent();
            if (!current) return;
            editorStore.apply('insert-vertex', opsMod.insertTrackVertex(current, flatSegIndex, afterIndex, lat, lon, ele));
          },
          onViewportChange: () => editorShell?.refreshVertexStatus?.(),
          onDrawChange: () => editorShell?.refreshDrawStatus?.(),
          onContextMenu: (info) => editorShell?.showContextMenu(info),
          onFocusBounds: (bounds, options) => mapViewController?.focusBounds(bounds, options),
        });
        editorShell = shellMod.createEditorShell({
          el,
          t,
          formatDistance,
          store: editorStore,
          overlay: editorOverlay,
          getTrackName: () => ctx.fileName,
          getProfileState: () => activeProfile,
          getSourceFormat: () => {
            const clean = (ctx.fileName || ctx.src || '').split(/[?#]/)[0];
            const match = clean.match(/\.(gpx|kml|kmz)$/i);
            return match ? match[1].toLowerCase() : '';
          },
          isGpxSource: () => /\.gpx$/i.test((ctx.fileName || ctx.src || '').split(/[?#]/)[0]),
          onSaveTrack: ({ id, fileName: outName, xml, content, format, overwrite, packRemoteImages, onProgress }) =>
            hostBridge.saveTrackGpx({
              id,
              fileName: outName,
              xml,
              content: content ?? xml,
              format,
              overwrite,
              packRemoteImages,
              onProgress,
            }),
          onListSiblingTracks: hasQuickLookHost ? () => hostBridge.listSiblingTracks() : null,
          onImportExternalTrack: hasQuickLookHost ? (opts) => hostBridge.importExternalTrack(opts) : null,
          onToggleLayers: () => layerSwitch?.toggle?.(),
          isLayersOpen: () => Boolean(layerSwitch?.isOpen?.()),
          onTogglePins: () => waypointController?.toggle?.(),
          onShowPins: () => waypointController?.show?.(),
          isPinsVisible: () => Boolean(waypointController?.visible?.()),
          onExit: ({ overwroteOriginal = false, committed = null } = {}) => {
            let routeUpdated = false;
            if (overwroteOriginal && committed) {
              ctx.gpx = committed;
              currentEditedGpx = committed;
              const nextModel = createRouteModel(committed);
              const nextSummary = summarize(committed, nextModel);
              const nextElevations = nextSummary.elevation ? profileController.read(committed, nextModel) : null;
              ctx.elevations = nextElevations;
              const nextHikeEstimate = nextElevations ? gradeAwareHikeSeconds({
                distance: nextSummary.distanceMeters,
                ascent: nextElevations.ascent,
                descent: nextElevations.descent,
                bins: nextElevations.slopeBins,
              }) : null;
              renderInfo(committed, nextSummary, nextElevations, nextHikeEstimate);
              splitData = null;
              const nextSplitPreview = {
                count: splitCount(nextSummary.distanceMeters),
                available: nextSummary.points > 0 && nextSummary.start !== null && nextSummary.end !== null,
              };
              if (editorContext?.liveState) {
                Object.assign(editorContext.liveState, {
                  gpx: committed,
                  routeModel: nextModel,
                  summary: nextSummary,
                  elevations: nextElevations,
                  hikeEstimate: nextHikeEstimate,
                  splitPreview: nextSplitPreview,
                });
              }
              splitController.render(nextSummary, { reset: true, ...nextSplitPreview });
              trackViewController?.syncSource(committed, nextModel);
              updatePhotoAttachments?.(committed);
              syncHostTitleMeta(nextSummary, nextElevations);
              activeTrackLayer?.destroy?.();
              waypointController.destroy();
              const newTracks = trackLayer.draw(ctx.map, committed, nextModel);
              activeTrackLayer = newTracks;
              const wpBounds = waypointController.draw(
                ctx.map, committed, newTracks.segments, newTracks.navigationMarks, nextModel, newTracks.annotationCount,
              );
              newTracks.bounds.extend(wpBounds);
              newTracks.refreshDistanceMarks();
              waypointController.createControl(ctx.map);
              waypointController.setEditingSuspended?.(false);
              waypointController.refreshMapMarks();
              newTracks.setAnnotationMarkersVisible(waypointController.visible());
              measurementController?.updateData?.({ gpx: committed, segments: newTracks.segments });
              overlayExport?.updateData?.({
                gpx: committed,
                summary: nextSummary,
                elevations: nextElevations,
                routeModel: nextModel,
              });
              if (trackColorControl) {
                trackColorControl.setTracks?.(newTracks);
              } else if (!committed.network && newTracks.segments.length > 0) {
                trackColorControl = createTrackColorControl({
                  L,
                  map: ctx.map,
                  el,
                  t,
                  tracks: newTracks,
                  initialMode: savedTrackColor(params),
                  showToast,
                  onChange: () => {
                    syncPreferences();
                    sync3DTracks();
                  },
                });
                trackColorControl.mount();
              }
              savedColorModeBeforeEdit = null;
              mapViewController?.setRoute(newTracks.bounds);
              routeUpdated = Boolean(newTracks.bounds?.isValid());
            } else {
              currentEditedGpx = ctx.gpx;
              if (savedColorModeBeforeEdit) {
                activeTrackLayer?.setColorMode?.(savedColorModeBeforeEdit);
                savedColorModeBeforeEdit = null;
              }
              activeTrackLayer?.updateDistancePaths?.(ctx.gpx);
              activeTrackLayer?.setBaseVisible?.(true);
              activeTrackLayer?.setAnnotationMarkersVisible?.(waypointController.visible());
              waypointController?.setEditingSuspended?.(false);
            }
            const profileBox = document.getElementById('profile');
            if (profileBox) profileBox.textContent = '';
            activeScrub?.destroy?.();
            activeScrub = null;
            activeProfile?.destroy?.();
            activeProfile = null;
            if (ctx.elevations) {
              if (profileBox) profileBox.hidden = false;
              document.body.classList.add('with-profile');
              activeProfile = profileController.render(ctx.gpx, ctx.elevations);
              activeScrub = profileController.attach(ctx.map, activeProfile);
            } else {
              activeProfile = null;
              if (profileBox) profileBox.hidden = true;
              document.body.classList.remove('with-profile');
            }
            if (routeUpdated) {
              mapViewController?.fit({ animate: true });
            }
            mapViewController?.refreshControls({ refitHome: routeUpdated, revealFocus: false });
          },
          onLayoutChange: () => mapViewController?.refreshControls({ refitHome: false, revealFocus: false }),
          showToast,
        });
      } catch (err) {
        editorLoadPromise = null;
        throw err;
      }
    })();
  }
  await editorLoadPromise;
}

async function openTrackEditor({ initialTool = 'crop', cropRange = null } = {}) {
  const source = currentEditedGpx;
  if (!source || source.network || openingEditor || editorStore?.isActive()) return;
  openingEditor = true;
  try {
    exit3DView({ syncCamera: true });
    await ensureEditorLoaded();
    if (!editorShell || !editorOverlay || editorStore?.isActive()) return;
    if (measurementController?.active()) measurementController.stop();
    trackViewController?.reset();
    activeScrub?.clearRange?.();
    activeProfile?.clearSplitFocus?.();
    activeTrackLayer?.clearSplitHighlight?.();
    toolboxController?.close();
    layerSwitch?.close();
    savedColorModeBeforeEdit = trackColorControl?.mode() || null;
    if (savedColorModeBeforeEdit && savedColorModeBeforeEdit !== 'single') {
      activeTrackLayer?.setColorMode?.('single');
    }
    activeTrackLayer?.setBaseVisible?.(false);
    activeTrackLayer?.setAnnotationMarkersVisible?.(false);
    waypointController?.setEditingSuspended?.(true);
    editorOverlay.setWaypointsVisible(waypointController?.visible?.() ?? true);
    editorShell.open({ parsed: source, initialTool, cropRange });
    mapViewController?.refreshControls({ refitHome: false, revealFocus: false });
  } finally {
    openingEditor = false;
  }
}
const uiFeedback = createUiFeedback({
  t,
  toolbox: () => toolboxController,
  afterShow: () => mapViewController?.refreshControls(),
});
const showToast = uiFeedback.showToast;
const toggleChrome = uiFeedback.toggle;
const keyboardController = createKeyboardController({
  LAYERS,
  photoViewer,
  waypointController,
  measurement: () => measurementController,
  layerSwitch: () => layerSwitch,
  toolbox: () => toolboxController,
  trackColor: () => trackColorControl,
  profile: () => activeProfile,
  editor: () => ({
    isActive: () => Boolean(editorStore?.isActive()),
    undo: () => editorStore?.undo(),
    redo: () => editorStore?.redo(),
    save: () => editorShell?.triggerSave(),
  }),
  fit: () => {
    if (map3dActive && activeTrackLayer?.bounds?.isValid?.()) {
      map3dController?.fitBounds?.(activeTrackLayer.bounds, { animate: true });
      return;
    }
    mapViewController?.fit({ animate: true });
  },
  toggleChrome,
  toggle3d: () => { void toggle3DView(); },
});
const pressKey = keyboardController.pressKey;
const onKeyDown = keyboardController.onKeyDown;

/** Keep the host's origin-independent copy in step with what the page is showing. */
function syncPreferences(layerOverride = null) {
  const settings = overlayExport?.settings()
    || { size: '9:16', ink: 'black', scrim: 'none', content: 'full', profile: 'off' };
  const tileCache = layerSwitch?.tileCacheSettings() || initialTileCache;
  const activeLayer = typeof layerOverride === 'string' && layerOverride
    ? layerOverride
    : (layerSwitch?.current() || savedLayer(params));
  const values = new URLSearchParams({
    lang: getLang(),
    theme: getTheme(),
    layer: activeLayer,
    pins: waypointController.visible() ? '1' : '0',
    exportSize: settings.size,
    exportInk: settings.ink,
    exportScrim: settings.scrim,
    tileCache: tileCache.enabled ? '1' : '0',
    tileCacheMaxMb: String(tileCache.maxMb),
    tileCacheDays: String(tileCache.maxAgeDays),
    exportContent: settings.content || 'full',
    exportProfile: settings.profile || 'off',
    trackColor: trackColorControl?.mode() || savedTrackColor(params),
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
  const started = performance.now();
  initTheme(params);
  applyPageLanguage();
  if (!src) {
    showError(t('error.noFile'));
    return;
  }
  let bytes;
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // FIT is binary. Reading the response as bytes first also lets a FIT file keep working if it was renamed;
    // GPX and KML are decoded only after the FIT signature check fails.
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (e) {
    showError(t('error.read', { detail: e.message }));
    return;
  }
  let gpx;
  let routeModel;
  let summary;
  try {
    if (isFit(bytes)) {
      gpx = parseFit(bytes);
    } else {
      // One XML parse for both text formats; the root element decides which reader runs. Keyhole markup uses
      // <kml> at the root, GPX uses <gpx>, so neither can be mistaken for the other.
      const doc = parseXml(new TextDecoder().decode(bytes));
      const rootName = doc.documentElement?.localName;
      if (rootName !== 'kml' && rootName !== 'gpx') {
        throw new KmlError(t('error.notTrack'));
      }
      gpx = rootName === 'kml' ? parseKmlDocument(doc) : parseGpxDocument(doc);
    }
    routeModel = createRouteModel(gpx);
    summary = summarize(gpx, routeModel);
    const hasWaypointPhotos = (gpx.waypoints || []).some((wpt) => photosOf(wpt).length > 0);
    if (hasWaypointPhotos) {
      const { attachmentItems, createAttachmentExporter } = await import('./attachments.js');
      buildAttachmentItems = attachmentItems;
      photoAttachments = attachmentItems(gpx, photosOf, src);
      attachmentExporter = createAttachmentExporter({ post, hasHost: hasQuickLookHost });
    } else {
      buildAttachmentItems = null;
      photoAttachments = [];
      let lazyExporter = null;
      let lazyExporterPromise = null;
      const ensureExporter = () => {
        if (lazyExporter) return Promise.resolve(lazyExporter);
        if (!lazyExporterPromise) {
          lazyExporterPromise = import('./attachments.js').then(({ createAttachmentExporter }) => {
            lazyExporter = createAttachmentExporter({ post, hasHost: hasQuickLookHost });
            return lazyExporter;
          }).catch((err) => {
            lazyExporterPromise = null;
            throw err;
          });
        }
        return lazyExporterPromise;
      };
      attachmentExporter = {
        exportAll: (...args) => ensureExporter().then((exp) => exp.exportAll(...args)),
        result: (...args) => { lazyExporter?.result(...args); },
        resumeResult: (...args) => { lazyExporter?.resumeResult(...args); },
      };
    }
    timing.parseMs = performance.now() - started;
  } catch (e) {
    if (e instanceof FitError) {
      const key = {
        notFit: 'error.notFit',
        truncated: 'error.fitTruncated',
        crc: 'error.fitCrc',
        corrupt: 'error.fitCorrupt',
        noGps: 'error.fitNoGps',
        workoutNoGps: 'error.fitWorkoutNoGps',
        unsupported: 'error.fitUnsupported',
      }[e.code] || 'error.fitCorrupt';
      showError(t(key));
      return;
    }
    const known = e instanceof GpxError || e instanceof KmlError;
    showError(known ? e.message : t('error.unexpected', { detail: e.message }));
    return;
  }
  // Worked out once: the summary box and the profile read the same numbers, and neither recomputes on a
  // language switch.
  const elevations = summary.elevation ? profileController.read(gpx, routeModel) : null;
  const hikeEstimate = elevations ? gradeAwareHikeSeconds({
    distance: summary.distanceMeters,
    ascent: elevations.ascent,
    descent: elevations.descent,
    bins: elevations.slopeBins,
  }) : null;
  splitData = null;
  const splitPreview = {
    count: splitCount(summary.distanceMeters),
    available: summary.points > 0 && summary.start !== null && summary.end !== null,
  };
  const liveState = {
    gpx,
    routeModel,
    summary,
    elevations,
    hikeEstimate,
    splitPreview,
  };
  loadSplitsData = () => {
    if (!splitData) {
      const splitStarted = performance.now();
      splitData = analyseSplits(liveState.gpx, liveState.summary, liveState.routeModel);
      timing.splitFirstOpenMs = performance.now() - splitStarted;
    }
    return splitData;
  };
  renderInfo(gpx, summary, elevations, hikeEstimate);
  splitController.render(summary, { reset: true, ...splitPreview });
  // Drawn before the map: the fit below needs to know whether the panel is there, and the panel's own height
  // is fixed in CSS, so the map never has to be told its size changed.
  const profile = elevations ? profileController.render(gpx, elevations) : null;
  activeProfile = profile;
  timing.prepareMs = performance.now() - started;
  const vectorRenderer = L.svg({ padding: 1 });
  const map = L.map('map', {
    keyboard: false,
    worldCopyJump: false,
    renderer: vectorRenderer,
  });
  mapInstance = map;
  currentEditedGpx = gpx;
  editorContext = { map, gpx, fileName, src, elevations, liveState };
  map.getContainer().tabIndex = -1;
  installLeafletIcons(map, { closeLabel: () => t('tool.close') });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank">Leaflet</a>');
  const scaleControl = L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  mapViewController = createMapView({ map, isChromeHidden: uiFeedback.isHidden });
  const swissScaleRatio = attachSwissScaleRatio(map, scaleControl);
  const tracks = trackLayer.draw(map, gpx, routeModel);
  activeTrackLayer = tracks;
  const waypointBounds = waypointController.draw(
    map, gpx, tracks.segments, tracks.navigationMarks, routeModel, tracks.annotationCount,
  );
  tracks.bounds.extend(waypointBounds);
  const bounds = tracks.bounds;
  mapViewController.setRoute(bounds);
  tracks.setAnnotationMarkersVisible(waypointController.visible());
  let overlayInstance = null;
  let overlayPromise = null;
  let overlayConfig = { gpx, summary, elevations, routeModel };
  let overlayMountNode = null;
  let overlayPanelHandle = null;
  const pickExportChoice = (param, key, choices, fallback) => {
    const raw = params.get(param) || readStored(key);
    return choices.includes(raw) ? raw : fallback;
  };
  const fallbackOverlaySettings = () => ({
    size: pickExportChoice('exportSize', 'exportSize', ['1:1', '9:16', '4:3'], '4:3'),
    ink: pickExportChoice('exportInk', 'exportInk', ['black', 'white', 'swiss'], 'black'),
    scrim: pickExportChoice('exportScrim', 'exportScrim', ['none', 'soft'], 'none'),
    content: pickExportChoice('exportContent', 'exportContent', ['full', 'bare'], 'full'),
    profile: pickExportChoice('exportProfile', 'exportProfile', ['on', 'off'], 'off'),
  });
  const ensureOverlayExport = () => {
    if (overlayInstance) return Promise.resolve(overlayInstance);
    if (!overlayPromise) {
      overlayPromise = import('./overlay-export.js').then(({ createOverlayExport }) => {
        overlayInstance = createOverlayExport({
          el,
          t,
          post,
          showToast,
          params,
          gpx: overlayConfig.gpx,
          summary: overlayConfig.summary,
          elevations: overlayConfig.elevations,
          routeModel: overlayConfig.routeModel,
          fileName,
          onSettingsChange: syncPreferences,
        });
        if (overlayMountNode) {
          overlayPanelHandle = overlayInstance.mount(overlayMountNode);
        }
        return overlayInstance;
      }).catch((err) => {
        overlayPromise = null;
        throw err;
      });
    }
    return overlayPromise;
  };
  overlayExport = {
    available: () => Boolean(overlayConfig.routeModel?.lines?.length > 0),
    settings: () => (overlayInstance ? overlayInstance.settings() : fallbackOverlaySettings()),
    save: () => ensureOverlayExport().then((exp) => exp.save()),
    build: (options) => ensureOverlayExport().then((exp) => exp.build(options)),
    mount(node) {
      overlayMountNode = node;
      if (overlayInstance) {
        overlayPanelHandle = overlayInstance.mount(node);
      } else {
        void ensureOverlayExport();
      }
      return {
        focus: () => {
          if (overlayPanelHandle) overlayPanelHandle.focus();
          else void ensureOverlayExport().then(() => overlayPanelHandle?.focus());
        },
        relabel: () => overlayPanelHandle?.relabel(),
      };
    },
    focus: () => overlayPanelHandle?.focus(),
    relabel: () => overlayInstance?.relabel(),
    updateData(next = {}) {
      overlayConfig = { ...overlayConfig, ...next };
      overlayInstance?.updateData(next);
    },
  };
  const measurement = createMeasurement({
    L,
    map,
    t,
    formatDistance,
    gpx,
    segments: tracks.segments,
    waypointIndex: () => waypointController.waypointIndex(),
    onLayoutChange: () => mapViewController?.refreshControls({ refitHome: false, revealFocus: false }),
  });
  measurementController = measurement;
  let reportedMeasurementActive = null;
  const reportMeasurementState = () => {
    const active = measurement.active();
    if (active) exit3DView({ syncCamera: true });
    if (active === reportedMeasurementActive) return;
    reportedMeasurementActive = active;
    post(`measure-state\t${active ? '1' : '0'}`);
  };
  measurement.subscribe(reportMeasurementState);
  reportMeasurementState();
  if (!gpx.network && tracks.segments.length > 0) {
    trackColorControl = createTrackColorControl({
      L,
      map,
      el,
      t,
      tracks,
      initialMode: savedTrackColor(params),
      showToast,
      onChange: () => {
        syncPreferences();
        sync3DTracks();
      },
    });
    trackColorControl.mount();
  }
  updatePhotoAttachments = (targetGpx) => {
    const nextItems = buildAttachmentItems ? buildAttachmentItems(targetGpx, photosOf, src) : [];
    photoAttachments.splice(0, photoAttachments.length, ...nextItems);
    toolboxController?.render?.();
  };
  trackViewController = createTrackViewController({
    map,
    node: document.getElementById('track-selector'),
    el,
    t,
    formatDistance,
    initialGpx: gpx,
    initialModel: routeModel,
    trackLayer,
    waypointController,
    profileController,
    splitController,
    renderInfo,
    getActiveTrackLayer: () => activeTrackLayer,
    setActiveTrackLayer: (next) => { activeTrackLayer = next; },
    getActiveProfile: () => activeProfile,
    setActiveProfile: (next) => { activeProfile = next; },
    getActiveScrub: () => activeScrub,
    setActiveScrub: (next) => { activeScrub = next; },
    getTrackColorControl: () => trackColorControl,
    getMeasurementController: () => measurementController,
    getOverlayExport: () => overlayExport,
    getMapViewController: () => mapViewController,
    onViewDataApplied: ({
      viewGpx, viewModel, viewSummary, viewElevations, viewHikeEstimate, viewSplitPreview,
    }) => {
      Object.assign(liveState, {
        gpx: viewGpx,
        routeModel: viewModel,
        summary: viewSummary,
        elevations: viewElevations,
        hikeEstimate: viewHikeEstimate,
        splitPreview: viewSplitPreview,
      });
      if (editorContext) editorContext.elevations = viewElevations;
      splitData = null;
      updatePhotoAttachments?.(viewGpx);
      syncHostTitleMeta(viewSummary, viewElevations);
    },
    onTrackViewChanged: ({ bounds: nextBounds, fit }) => {
      if (!map3dActive) return;
      sync3DTracks();
      if (fit && nextBounds?.isValid?.()) {
        map3dController?.fitBounds?.(nextBounds, { animate: true });
      }
    },
    pruneLocalized,
  });
  let pendingCoordinateMove = null;
  toolboxController = createToolbox({
    L,
    map,
    el,
    t,
    formatDistance,
    measurement,
    copyText,
    showToast,
    coordinatePoints: () => coordinateTargets(liveState.gpx),
    focusCoordinate: (point) => {
      const latlng = [point.lat, point.lon];
      if (pendingCoordinateMove) {
        map.off('moveend', pendingCoordinateMove);
        pendingCoordinateMove = null;
      }
      map.stop();
      const targetZoom = Math.max(map.getZoom(), 14);
      const curCenter = map.getCenter();
      if (Math.abs(curCenter.lat - point.lat) < 1e-6 && Math.abs(curCenter.lng - point.lon) < 1e-6
        && map.getZoom() === targetZoom) {
        mapViewController.focusSelection(latlng, { animate: true });
        return;
      }
      pendingCoordinateMove = () => {
        pendingCoordinateMove = null;
        mapViewController.focusSelection(latlng, { animate: true });
      };
      map.once('moveend', pendingCoordinateMove);
      map.setView(latlng, targetZoom, { animate: true });
    },
    onCoordinateWeather: (point) => {
      const provider = savedActiveWeatherProvider();
      const url = weatherUrl(point, provider, zoomFor('start', provider));
      if (!url) {
        showToast(t('weather.unavailable'), 4000);
        return;
      }
      openExternal(url);
      showToast(t('weather.opened', { provider: t(`weather.provider.${provider}`) }), 3500);
    },
    attachmentItems: photoAttachments,
    onExportAttachments: (includeExternal, onProgress) =>
      attachmentExporter.exportAll(photoAttachments, includeExternal, onProgress),
    exportAvailable: overlayExport.available,
    mountExportView: overlayExport.mount,
    weatherAvailable: () => availableTargets(liveState.gpx).length > 0,
    weatherModes: [...WEATHER_TARGETS],
    weatherCategories: [...WEATHER_CATEGORIES],
    weatherProvidersByCategory: {
      weather: [...WEATHER_PROVIDERS],
      terrain: [...TERRAIN_PROVIDERS],
    },
    weatherCategory: savedWeatherCategory,
    setWeatherCategory: saveWeatherCategory,
    weatherProviderForCategory: savedProviderForCategory,
    weatherProvider: savedActiveWeatherProvider,
    setWeatherProvider: saveProviderForCategory,
    weatherHasElevation: () => availableTargets(liveState.gpx).includes('highest'),
    lang: getLang,
    setLang,
    theme: getTheme,
    setTheme,
    themeModes: [...THEMES],
    editAvailable: () => Boolean(liveState.gpx && !liveState.gpx.network),
    onEdit: () => openTrackEditor({ initialTool: 'crop' }),
    currentVersion: appVersion,
    hasHost: hostBridge.hasHost,
    onCheckUpdate: (force) => hostBridge.checkUpdate(force),
    onDownloadUpdate: (url, name) => hostBridge.downloadUpdate(url, name),
    onIgnoreUpdate: (version) => hostBridge.ignoreUpdate(version),
    onOpenUpdateRelease: (url) => hostBridge.openUpdateRelease(url),
    onWeather: (mode, provider) => {
      const activeProvider = normalizeAnyWeatherProvider(provider || savedActiveWeatherProvider());
      const target = weatherTargetPoint(liveState.gpx, mode);
      const url = weatherUrl(target, activeProvider, zoomFor(mode, activeProvider));
      if (!url) {
        showToast(t(mode === 'highest' ? 'weather.noElevation' : 'weather.unavailable'), 4000);
        return;
      }
      openExternal(url);
      showToast(t('weather.opened', { provider: t(`weather.provider.${activeProvider}`) }), 3500);
    },
    onOpen: () => {
      waypointController.closeOverview(false);
      layerSwitch?.close();
    },
    onLayoutChange: () => mapViewController?.refreshControls({ refitHome: false, revealFocus: false }),
    onExit3d: () => {
      exit3DView({ syncCamera: true });
    },
  });
  // First of the corner controls, so it stands leftmost: "where the map looks" before "what the map shows".
  const locateCtrl = createLocateControl({
    L,
    map,
    el,
    t,
    onLocate: () => {
      if (map3dActive && activeTrackLayer?.bounds?.isValid?.()) {
        map3dController?.fitBounds?.(activeTrackLayer.bounds, { animate: true });
        return;
      }
      mapViewController.fit({ animate: true });
    },
  });
  const compassCtrl = createCompassControl({
    L,
    map,
    el,
    t,
    onReset: () => map3dController?.resetNorth?.(),
  });
  const warnTiandituTemporarily = () => {
    if (tiandituTransientShown) return;
    tiandituTransientShown = true;
    showToast(t('layer.tiandituUnavailable'), 5000);
  };
  const rejectTiandituKey = () => {
    if (tiandituRejectedShown) return;
    tiandituRejectedShown = true;
    runtimeTiandituKey = '';
    layerSwitch?.keyRejected();
    showToast(t('layer.tiandituRejected'), 5000);
  };
  // The user's own sources must be registered before the switcher builds its provider list. The host file wins;
  // ordinary browser runs keep using localStorage.
  const initialCustomSources = loadCustomProviders(undefined, runtimeConfig.customSources);
  if (hasQuickLookHost && runtimeConfig.customSources === undefined && initialCustomSources.length > 0) {
    persistCustomSources(initialCustomSources);
  }
  const switcher = createLayerSwitcher({
    L,
    map,
    el,
    t,
    initial: savedLayer(params),
    onRemember: syncPreferences,
    onLayerChange: () => sync3DBaseLayer(),
    tiandituDirectKey: initialDirectTiandituKey,
    onTiandituDirectError: () => queueMicrotask(warnTiandituTemporarily),
    onCustomError: () => showToast(t('layer.customError'), 5000),
    onOpen: () => {
      toolboxController?.close();
      waypointController.closeOverview(false);
    },
    onCustomSave: persistCustomSources,
    customSources: initialCustomSources,
    onConfigureTianditu: () => {
      if (hasQuickLookHost) post(`tianditu-key\tconfigure\t${getLang()}`);
      else showToast(t('layer.tiandituHostOnly'), 5000);
    },
    onRemoveTianditu: () => {
      if (hasQuickLookHost) post(`tianditu-key\tremove\t${getLang()}`);
    },
    hasHost: hasQuickLookHost,
    tileCacheConfig: initialTileCache,
    onTileCacheChange: () => syncPreferences(),
    onRequestTileCacheStats: () => {
      if (hasQuickLookHost) post('tile-cache\tstats');
    },
    onClearTileCache: () => {
      if (hasQuickLookHost) post('tile-cache\tclear');
      else showToast(t('layer.cacheHostOnlyToast'), 4000);
    },
    onProbeNode: hasQuickLookHost ? hostBridge.probeNode : null,
  }); // after the view is set: the grid needs the map bounds
  layerSwitch = switcher;

  function build3DLayerSpec() {
    const spec = switcher.getLayerSpec();
    const styles = getComputedStyle(document.documentElement);
    const noMapBg = styles.getPropertyValue('--no-map-bg').trim() || '#181a1f';
    const isDark = styles.colorScheme === 'dark';
    return { ...spec, noMapBg, isDark };
  }

  function stripHtml(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw.replace(/<[^>]*>/g, '').replace(/&copy;/gi, '\u00a9').replace(/&mdash;/gi, '\u2014').replace(/\s+/g, ' ').trim();
  }

  function describe3DBaseLayer(spec) {
    if (!spec || spec.key === 'none' || !spec.provider) {
      return {
        shortName: t('layer.none'),
        fullAttrib: `${t('layer.none')} \u00b7 MapLibre GL \u00b7 AWS Terrarium DEM`,
      };
    }
    const provider = spec.provider;
    const shortName = provider.custom
      ? (provider.custom.name || t('layer.custom'))
      : (provider.label ? t(provider.label) : spec.key);
    const rawAttrib = provider.custom
      ? (provider.custom.attribution || '')
      : (provider.options?.attribution || provider.layers?.[0]?.options?.attribution || '');
    const overlayAttribs = (spec.overlays || [])
      .map((o) => stripHtml(o.options?.attribution || ''))
      .filter(Boolean);
    const parts = ['MapLibre GL', stripHtml(rawAttrib), ...overlayAttribs, 'AWS Terrarium DEM'].filter(Boolean);
    return {
      shortName,
      fullAttrib: parts.join(' \u00b7 '),
    };
  }

  function ensure3DHudLeft() {
    if (map3dHudLeft) return map3dHudLeft;
    const wrap = el('div', 'map3d-hud-left');
    wrap.hidden = true;

    const scaleBox = el('div', 'map3d-scale leaflet-control-scale');
    const scaleLine = el('div', 'map3d-scale-line leaflet-control-scale-line');
    const scaleRatio = el('span', 'swiss-scale-ratio');
    scaleRatio.setAttribute('aria-hidden', 'true');
    scaleRatio.hidden = true;
    scaleBox.append(scaleLine, scaleRatio);

    const attrib = el('div', 'map3d-attrib');
    wrap.append(scaleBox, attrib);
    document.body.append(wrap);

    map3dHudLeft = {
      node: wrap,
      updateScale(metrics) {
        if (!metrics || !metrics.label || !metrics.widthPx) {
          scaleBox.hidden = true;
          return;
        }
        scaleBox.hidden = false;
        scaleLine.style.width = `${metrics.widthPx}px`;
        scaleLine.textContent = metrics.label;
        scaleRatio.textContent = metrics.ratioText || '';
        scaleRatio.hidden = !metrics.ratioText;
      },
      updateAttrib() {
        const info = describe3DBaseLayer(switcher.getLayerSpec());
        attrib.textContent = `${info.shortName} \u00b7 ${t('map3d.terrainTag')}`;
        attrib.title = info.fullAttrib;
      },
    };
    map3dHudLeft.updateAttrib();
    return map3dHudLeft;
  }

  function sync3DBaseLayer() {
    if (!map3dActive || !map3dController) return;
    map3dController.updateBaseLayer(build3DLayerSpec());
    map3dHudLeft?.updateAttrib();
  }

  sync3DTracks = () => {
    if (!map3dActive || !map3dController) return;
    const drawOptions = trackViewController?.getDrawOptions?.() || {};
    map3dController.updateTracks(liveState.gpx, {
      theme: getTheme(),
      colorMode: trackColorControl?.activeMode?.() || 'single',
      trackColorStartIndex: drawOptions.trackColorStartIndex || 0,
      referenceTracks: drawOptions.referenceTracks || [],
    });
  };

  open3DWaypointCard = (point, { focus = true } = {}) => {
    if (!map3dActive || !map3dController || !point) return;
    const closePopup = () => map3dController?.closePopup?.();
    const photos = photosOf(point);
    const card = photos.length > 0
      ? photoPreview(photos, point, closePopup)
      : renderPointPopup(point, point.name || t('label.waypoint'), el, closePopup);
    map3dController.showWaypointPopup(point.lat, point.lon, card, { focus });
  };

  function ensure3DControlsBar() {
    if (map3dControlsBar) return map3dControlsBar;
    const bar = el('div', 'map3d-controls');
    bar.hidden = true;
    bar.setAttribute('role', 'toolbar');

    const exagGroup = el('div', 'map3d-exag-group');
    exagGroup.setAttribute('role', 'group');
    const levels = [1.0, 1.3, 1.8];
    const exagButtons = levels.map((val) => {
      const btn = el('button', 'map3d-exag-btn', `${val === 1 ? '1' : val}\u00d7`);
      btn.type = 'button';
      btn.dataset.exaggeration = String(val);
      btn.setAttribute('aria-pressed', String(val === map3dExaggeration));
      btn.addEventListener('click', () => {
        map3dExaggeration = val;
        map3dController?.setExaggeration?.(val);
        for (const item of exagButtons) {
          item.setAttribute('aria-pressed', String(Number(item.dataset.exaggeration) === map3dExaggeration));
        }
      });
      exagGroup.append(btn);
      return btn;
    });

    const hint = el('div', 'map3d-hint');
    const hintPan = el('span', 'map3d-hint-item');
    const hintRotate = el('span', 'map3d-hint-item');
    const hintZoom = el('span', 'map3d-hint-item');
    hint.append(hintPan, hintRotate, hintZoom);

    bar.append(exagGroup, hint);
    document.body.append(bar);
    map3dControlsBar = {
      node: bar,
      exagGroup,
      exagButtons,
      hintPan,
      hintRotate,
      hintZoom,
      relabel() {
        bar.setAttribute('aria-label', t('map3d.controlsLabel'));
        exagGroup.setAttribute('aria-label', t('map3d.exaggerationLabel'));
        for (const btn of exagButtons) {
          const v = btn.dataset.exaggeration;
          const key = v === '1'
            ? 'map3d.exaggerationHint1'
            : v === '1.3'
              ? 'map3d.exaggerationHint13'
              : 'map3d.exaggerationHint18';
          btn.title = t(key);
          btn.setAttribute('aria-label', btn.title);
        }
        hintPan.innerHTML = `<kbd class="control-key">${t('map3d.hintLeftKey')}</kbd><span>${t('map3d.hintPan')}</span>`;
        hintRotate.innerHTML = `<kbd class="control-key">${t('map3d.hintRightKey')}</kbd><span>${t('map3d.hintRotate')}</span>`;
        hintZoom.innerHTML = `<kbd class="control-key">${t('map3d.hintWheelKey')}</kbd><span>${t('map3d.hintZoom')}</span>`;
      },
    };
    map3dControlsBar.relabel();
    return map3dControlsBar;
  }

  exit3DView = ({ syncCamera = true } = {}) => {
    map3dSessionToken += 1;
    if (!map3dActive) return;
    const cam = syncCamera ? map3dController?.getCamera?.() : null;
    map3dController?.destroy?.();
    map3dController = null;
    map3dActive = false;
    const container3d = document.getElementById('map-3d');
    if (container3d) container3d.hidden = true;
    if (map3dControlsBar) map3dControlsBar.node.hidden = true;
    if (map3dHudLeft) map3dHudLeft.node.hidden = true;
    compassCtrl.setVisible(false);
    document.body.classList.remove('is-3d');
    map3dControl?.setActive(false);
    map.invalidateSize({ animate: false });
    if (cam && Number.isFinite(cam.center?.lat) && Number.isFinite(cam.center?.lng)) {
      map.setView([cam.center.lat, cam.center.lng], cam.zoom, { animate: false });
    }
  };

  async function enter3DView() {
    if (map3dActive || map3dToggling || editorStore?.isActive?.()) return;
    const container3d = document.getElementById('map-3d');
    if (!container3d) return;
    const token = ++map3dSessionToken;
    map3dToggling = true;
    map3dControl?.setLoading(true);
    let pendingController = null;
    const isStale = () => token !== map3dSessionToken || Boolean(editorStore?.isActive?.());
    try {
      toolboxController?.close();
      layerSwitch?.close();
      waypointController.closeOverview(false);
      if (measurement.active()) measurement.stop();

      if (!map3dModulePromise) {
        map3dModulePromise = import('./map-3d.js').catch((err) => {
          map3dModulePromise = null;
          throw err;
        });
      }
      const mod = await map3dModulePromise;
      if (isStale()) return;

      const controller = mod.createMap3D();
      pendingController = controller;
      const center = map.getCenter();
      const zoom = map.getZoom();

      container3d.hidden = false;
      document.body.classList.add('is-3d');
      const hudLeft = ensure3DHudLeft();
      hudLeft.updateAttrib();
      const controls = ensure3DControlsBar();
      const drawOptions = trackViewController?.getDrawOptions?.() || {};
      await controller.mount(container3d, {
        center: { lat: center.lat, lng: center.lng },
        zoom,
        gpx: liveState.gpx,
        layerSpec: build3DLayerSpec(),
        theme: getTheme(),
        colorMode: trackColorControl?.activeMode?.() || 'single',
        trackColorStartIndex: drawOptions.trackColorStartIndex || 0,
        referenceTracks: drawOptions.referenceTracks || [],
        exaggeration: map3dExaggeration,
        waypointsVisible: waypointController.visible(),
        onWaypointClick: (hit) => {
          if (hit.kind === 'start' || hit.kind === 'end') {
            open3DWaypointCard({
              lat: hit.lat,
              lon: hit.lon,
              ele: hit.ele,
              time: hit.time,
              name: t(hit.kind === 'start' ? 'label.start' : 'label.end'),
            }, { focus: true });
            return;
          }
          const wpt = liveState.gpx?.waypoints?.[hit.index];
          if (wpt) open3DWaypointCard(wpt, { focus: true });
        },
        onScaleChange: (metrics) => hudLeft.updateScale(metrics),
        onCompassChange: (state) => compassCtrl.update(state),
      });
      if (isStale()) {
        controller.destroy();
        pendingController = null;
        container3d.hidden = true;
        document.body.classList.remove('is-3d');
        map3dControl?.setActive(false);
        return;
      }
      pendingController = null;
      map3dController = controller;
      map3dActive = true;
      map3dControl?.setActive(true);
      compassCtrl.setVisible(true);
      controls.node.hidden = false;
      hudLeft.node.hidden = false;
    } catch (err) {
      pendingController?.destroy?.();
      pendingController = null;
      container3d.hidden = true;
      document.body.classList.remove('is-3d');
      map3dController?.destroy?.();
      map3dController = null;
      map3dActive = false;
      map3dControl?.setActive(false);
      if (isStale()) return;
      if (err?.name === 'WebGLUnsupportedError') {
        showToast(t('map3d.webglUnsupported'), 4500);
      } else {
        showToast(t('map3d.loadFailed'), 4000);
      }
    } finally {
      map3dToggling = false;
      map3dControl?.setLoading(false);
    }
  }

  toggle3DView = () => {
    if (map3dActive) exit3DView({ syncCamera: true });
    else void enter3DView();
  };

  map3dControl = createMap3DControl({
    L,
    map,
    el,
    t,
    onToggle: () => toggle3DView(),
  });
  const zoomContainer = map.zoomControl?.getContainer?.();
  zoomContainer?.addEventListener('click', (event) => {
    if (!map3dActive || !map3dController) return;
    const btn = event.target instanceof Element ? event.target.closest('a') : null;
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    if (btn.classList.contains('leaflet-control-zoom-in')) map3dController.zoomIn?.();
    else if (btn.classList.contains('leaflet-control-zoom-out')) map3dController.zoomOut?.();
  }, { capture: true });
  // A file that draws no dots and has no waypoints gets no switch: there is nothing for it to show or hide.
  waypointController.createControl(map);
  mapViewController.observeControls();
  mapViewController.fit();
  tracks.refreshDistanceMarks();
  waypointController.refreshMapMarks();
  document.fonts?.ready.then(() => mapViewController.refreshControls());
  const scrub = profile ? profileController.attach(map, profile) : null;
  activeScrub = scrub;
  installSpaceGuard();
  const nonTextInputTypes = new Set([
    'button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit',
  ]);
  const textFieldOf = (node) => {
    if (!(node instanceof Element)) return false;
    const field = node.closest('input, textarea, select, [contenteditable="true"]');
    if (!field) return false;
    if (field instanceof HTMLInputElement && nonTextInputTypes.has((field.type || '').toLowerCase())) {
      return false;
    }
    return true;
  };
  document.addEventListener('keydown', (event) => {
    if (editorStore?.isActive()) {
      if (!textFieldOf(event.target) && editorShell?.handleKeyDown?.(event)) {
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z') {
        if (textFieldOf(event.target)) return;
        event.preventDefault();
        if (event.shiftKey) editorStore.redo();
        else editorStore.undo();
        return;
      }
      if (mod && key === 's') {
        event.preventDefault();
        editorShell?.triggerSave();
        return;
      }
      if (event.key === 'Escape') {
        if (layerSwitch?.isOpen?.()) {
          event.preventDefault();
          layerSwitch.close();
          return;
        }
        event.preventDefault();
        editorShell?.requestExit();
        return;
      }
    }
    onKeyDown(event);
  });
  installTextInputReporting(textFieldOf);
  // A language switch repaints the page where it stands: same map, same view, same selection. Everything
  // that is generated from that state is rebuilt from the same values, so nothing has to be reparsed.
  onLangChange(() => {
    applyPageLanguage();
    syncPreferences();
    renderInfo(liveState.gpx, liveState.summary, liveState.elevations, liveState.hikeEstimate);
    splitController.render(liveState.summary, liveState.splitPreview);
    trackViewController?.relabel();
    syncHostTitleMeta(liveState.summary, liveState.elevations);
    switcher.relabel();
    locateCtrl.relabel();
    compassCtrl.relabel();
    map3dControl?.relabel();
    map3dControlsBar?.relabel();
    map3dHudLeft?.updateAttrib();
    measurement.relabel();
    toolboxController.relabel();
    trackColorControl?.relabel();
    waypointController.relabel();
    repaintLocalized();
    activeProfile?.refreshSplitFocus();
    activeTrackLayer?.refreshDistanceMarks();
    if (activeScrub?.point()) activeScrub.refresh();
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
  onThemeChange(() => {
    syncPreferences();
    toolboxController?.refreshTheme?.();
    activeTrackLayer?.refreshTheme?.();
    trackViewController?.refreshTheme?.();
    sync3DBaseLayer();
    sync3DTracks();
  });
  const api = createTestApi({
    gpx, summary, map, scrub, photoViewer, hikeEstimate, tracks, timing, loadSplitsData,
    localizedNodes, splitController, elevations, waypointController, switcher,
    getRuntimeTiandituKey: () => runtimeTiandituKey,
    setRuntimeTiandituKey: (key) => { runtimeTiandituKey = key; },
    clearTiandituFlags: () => {
      tiandituTransientShown = false;
      tiandituRejectedShown = false;
    },
    warnTiandituTemporarily, rejectTiandituKey, mapViewController, pressKey, overlayExport,
    toolboxController, showToast, t, fileName, clipboardResult, copyText, photoAttachments,
    attachmentExporter, decodeMessage, measurement,
    theme: { get: getTheme, set: setTheme, modes: [...THEMES] },
  });
  let viewerRevealed = !hasQuickLookHost;
  let revealFallbackTimer = 0;
  function revealViewer() {
    if (viewerRevealed) return;
    viewerRevealed = true;
    if (revealFallbackTimer) {
      clearTimeout(revealFallbackTimer);
      revealFallbackTimer = 0;
    }
    activeProfile?.refit?.();
    mapViewController?.settleAndFit?.();
    activeTrackLayer?.refreshDistanceMarks?.();
    waypointController?.refreshMapMarks?.();
    document.body.classList.add('revealed');
  }
  api.revealViewer = revealViewer;
  api.hostAction = (action) => {
    if (editorStore?.isActive?.()) {
      showToast(t('host.exitEditFirst'), 2500);
      return;
    }
    if (action === 'copySummary') {
      void copySummaryText(trackSummaryText(liveState.gpx, liveState.summary, liveState.elevations, fileName));
    } else if (action === 'openExport') {
      toolboxController?.openView?.('export');
    } else if (action === 'openAttachments') {
      toolboxController?.openView?.('attachments');
    }
  };
  window.trailViewer = api;
  window.addEventListener('pagehide', () => {
    if (revealFallbackTimer) {
      clearTimeout(revealFallbackTimer);
      revealFallbackTimer = 0;
    }
    swissScaleRatio?.destroy?.();
    exit3DView({ syncCamera: false });
    map3dControl?.destroy?.();
    compassCtrl.destroy();
    map3dControlsBar?.node?.remove?.();
    map3dHudLeft?.node?.remove?.();
    toolboxController?.destroy();
    layerSwitch?.destroy();
    trackColorControl?.destroy();
    waypointController.destroy();
  }, { once: true });
  installViewerMessages(api, clipboardResult);
  document.body.classList.add('loaded');
  timing.readyMs = performance.now() - started;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    timing.firstPaintMs = performance.now() - started;
  }));
  syncHostTitleMeta(summary, elevations);
  post(`ready\t${summary.points} points, ${distanceLog(summary.distanceMeters)}`);
  if (hasQuickLookHost && !viewerRevealed) {
    revealFallbackTimer = setTimeout(revealViewer, 180);
  }
  if (hostBridge.hasHost) {
    setTimeout(() => hostBridge.checkUpdate(false), 1200);
  }
}

main().catch((error) => showError(t('error.unexpected', { detail: error.message })));
