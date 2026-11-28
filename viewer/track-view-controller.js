import { createRouteModel } from './route-model.js';
import { summarize } from './gpx.js';
import { splitCount } from './split-analysis.js';
import { gradeAwareHikeSeconds } from './track-analysis.js';
import {
  buildTrackViewGpx,
  createTrackSelector,
  extractTrackChoices,
} from './track-selector.js';

/**
 * Orchestrates multi-track selection, per-track view caching, and full viewer synchronization
 * (map layer, dimmed reference tracks, filtered waypoints, profile, splits, summary, tools).
 */
export function createTrackViewController({
  map,
  node,
  el,
  t,
  formatDistance,
  initialGpx,
  initialModel,
  trackLayer,
  waypointController,
  profileController,
  splitController,
  renderInfo,
  getActiveTrackLayer,
  setActiveTrackLayer,
  getActiveProfile,
  setActiveProfile,
  getActiveScrub,
  setActiveScrub,
  getTrackColorControl,
  getMeasurementController,
  getOverlayExport,
  getMapViewController,
  onViewDataApplied,
  pruneLocalized,
}) {
  let sourceGpx = initialGpx;
  let sourceModel = initialModel;
  let selectedTrackIndex = null;
  const trackViewCache = new Map();

  function getTrackViewData(index) {
    if (trackViewCache.has(index)) return trackViewCache.get(index);
    const viewGpx = buildTrackViewGpx(sourceGpx, index);
    const viewModel = index === null ? sourceModel : createRouteModel(viewGpx);
    const viewSummary = summarize(viewGpx, viewModel);
    const viewElevations = viewSummary.elevation ? profileController.read(viewGpx, viewModel) : null;
    const viewHikeEstimate = viewElevations ? gradeAwareHikeSeconds({
      distance: viewSummary.distanceMeters,
      ascent: viewElevations.ascent,
      descent: viewElevations.descent,
      bins: viewElevations.slopeBins,
    }) : null;
    const viewSplitPreview = {
      count: splitCount(viewSummary.distanceMeters),
      available: viewSummary.points > 0 && viewSummary.start !== null && viewSummary.end !== null,
    };
    let drawOptions = {};
    if (index !== null) {
      const choices = extractTrackChoices(sourceGpx, sourceModel);
      const activeChoice = choices[index];
      drawOptions = {
        trackColorStartIndex: activeChoice?.colorIndex || 0,
        referenceTracks: choices
          .filter((choice) => choice.index !== index)
          .map((choice) => ({
            track: sourceGpx.tracks[choice.index],
            colorIndex: choice.colorIndex,
          })),
      };
    }
    const entry = {
      viewGpx,
      viewModel,
      viewSummary,
      viewElevations,
      viewHikeEstimate,
      viewSplitPreview,
      drawOptions,
    };
    trackViewCache.set(index, entry);
    return entry;
  }

  function applySelection(nextIndex, { fit = true } = {}) {
    const count = sourceGpx?.tracks?.length || 0;
    const normalized = nextIndex !== null && nextIndex >= 0 && nextIndex < count ? nextIndex : null;
    if (normalized === selectedTrackIndex) return;
    selectedTrackIndex = normalized;

    const viewData = getTrackViewData(selectedTrackIndex);
    const {
      viewGpx,
      viewModel,
      viewSummary,
      viewElevations,
      viewHikeEstimate,
      viewSplitPreview,
      drawOptions,
    } = viewData;

    onViewDataApplied?.(viewData);
    renderInfo(viewGpx, viewSummary, viewElevations, viewHikeEstimate);
    splitController.render(viewSummary, { reset: true, ...viewSplitPreview });

    const trackColorControl = getTrackColorControl?.();
    const prevColorMode = trackColorControl?.mode() || 'single';
    const prevPinsVisible = waypointController.visible();

    getActiveTrackLayer?.()?.destroy?.();
    waypointController.destroy();
    const nextTracks = trackLayer.draw(map, viewGpx, viewModel, drawOptions);
    setActiveTrackLayer?.(nextTracks);

    const nextWpBounds = waypointController.draw(
      map, viewGpx, nextTracks.segments, nextTracks.navigationMarks, viewModel, nextTracks.annotationCount,
    );
    nextTracks.bounds.extend(nextWpBounds);
    nextTracks.refreshDistanceMarks();
    waypointController.createControl(map);
    if (!prevPinsVisible) waypointController.hide();
    waypointController.refreshMapMarks();
    nextTracks.setAnnotationMarkersVisible(waypointController.visible());

    if (trackColorControl) {
      trackColorControl.setTracks?.(nextTracks);
      if (prevColorMode !== 'single') nextTracks.setColorMode?.(prevColorMode);
    }

    getMeasurementController?.()?.updateData?.({ gpx: viewGpx, segments: nextTracks.segments });
    getOverlayExport?.()?.updateData?.({
      gpx: viewGpx,
      summary: viewSummary,
      elevations: viewElevations,
      routeModel: viewModel,
    });

    const profileBox = document.getElementById('profile');
    if (profileBox) profileBox.textContent = '';
    getActiveScrub?.()?.destroy?.();
    setActiveScrub?.(null);
    getActiveProfile?.()?.destroy?.();
    setActiveProfile?.(null);

    if (viewElevations) {
      if (profileBox) profileBox.hidden = false;
      document.body.classList.add('with-profile');
      const nextProfile = profileController.render(viewGpx, viewElevations);
      setActiveProfile?.(nextProfile);
      setActiveScrub?.(profileController.attach(map, nextProfile));
    } else {
      if (profileBox) profileBox.hidden = true;
      document.body.classList.remove('with-profile');
    }

    pruneLocalized?.();
    const mapView = getMapViewController?.();
    mapView?.setRoute(nextTracks.bounds);
    if (fit && nextTracks.bounds?.isValid()) {
      mapView?.fit({ animate: true });
    }
    mapView?.refreshControls({ refitHome: false, revealFocus: false });
  }

  const selector = createTrackSelector({
    node,
    el,
    t,
    formatDistance,
    onSelect: (index) => applySelection(index, { fit: true }),
    onLayoutChange: () => getMapViewController?.()?.refreshControls({ refitHome: false, revealFocus: false }),
  });
  selector.render(sourceGpx, sourceModel, null);

  return {
    applySelection,
    reset() {
      if (selectedTrackIndex !== null) {
        applySelection(null, { fit: false });
        selector.setSelected(null);
      }
    },
    syncSource(nextGpx, nextModel) {
      sourceGpx = nextGpx;
      sourceModel = nextModel;
      selectedTrackIndex = null;
      trackViewCache.clear();
      selector.render(nextGpx, nextModel, null);
    },
    relabel: () => selector.relabel(),
    refreshTheme: () => selector.refreshTheme(),
    selectedIndex: () => selectedTrackIndex,
    isOpen: () => selector.isOpen(),
    open: () => selector.open(),
    close: () => selector.close(),
  };
}
