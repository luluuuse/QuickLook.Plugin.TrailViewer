import { coordinateTargets } from './coordinates.js';
import { trackSummaryText } from './summary-view.js';

/** Assembles the diagnostic API used by the harness and browser tests. */
export function createTestApi({
  gpx, summary, map, scrub, photoViewer, hikeEstimate, tracks, timing, loadSplitsData,
  localizedNodes, splitController, elevations, waypointController, switcher,
  getRuntimeTiandituKey, setRuntimeTiandituKey, clearTiandituFlags,
  warnTiandituTemporarily, rejectTiandituKey, mapViewController, pressKey, overlayExport,
  toolboxController, showToast, t, fileName, clipboardResult, copyText, photoAttachments,
  attachmentExporter, decodeMessage, measurement, theme,
}) {
  return {
    gpx, summary, map, scrub, photos: photoViewer, hikeEstimate, theme,
    trackStats: tracks.networkStats,
    performance: () => ({ ...timing }),
    get splits() { return loadSplitsData(); },
    localizedNodeCount: () => localizedNodes.length,
    splitPanel: {
      open: splitController.open,
      close: splitController.close,
      toggle: splitController.toggle,
      isOpen: splitController.isOpen,
      loaded: splitController.loaded,
      select: splitController.select,
      selected: splitController.selected,
      mode: splitController.mode,
      setMode: splitController.setMode,
      toggleMode: splitController.toggleMode,
    },
    profile: elevations && {
      min: elevations.min, max: elevations.max, total: elevations.total,
      ascent: elevations.ascent, descent: elevations.descent, runs: elevations.runs,
      rawAscent: elevations.rawAscent, rawDescent: elevations.rawDescent, steep: elevations.steep,
      slopeBins: elevations.slopeBins, heartRate: elevations.heartRate,
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
    selectLayer: (key) => switcher.select(key, true),
    setTiandituKey: (key) => {
      const normalized = /^[0-9a-fA-F]{32}$/.test(key || '') ? key : '';
      setRuntimeTiandituKey(normalized);
      clearTiandituFlags();
      switcher.setDirectKey(normalized);
      return Boolean(normalized);
    },
    tiandituResponse: (status) => {
      const code = Number(status);
      if (code === 401 || code === 403) {
        rejectTiandituKey();
        return 'rejected';
      }
      if (code >= 400) {
        warnTiandituTemporarily();
        return 'temporary';
      }
      return 'ok';
    },
    tiandituKeyRejected: rejectTiandituKey,
    tiandituTransport: () => getRuntimeTiandituKey() ? 'direct' : 'none',
    layer: switcher.current,
    layerCategory: switcher.currentCategory,
    tileCache: {
      settings: () => switcher.tileCacheSettings(),
    },
    tileCacheStats: (totalBytes, tileCount) => switcher.setTileCacheStats(totalBytes, tileCount),
    tileCacheCleared: (totalBytes, tileCount) => {
      switcher.setTileCacheStats(totalBytes, tileCount);
      showToast(t('layer.cacheCleared'), 3000);
    },
    updateStatus: (info) => toolboxController?.applyUpdateStatus?.(info),
    updateProgress: (downloaded, total) => toolboxController?.applyUpdateProgress?.(downloaded, total),
    updateDownloadResult: (ok, detail) => toolboxController?.applyUpdateDownloadResult?.(ok, detail),
    locate: () => mapViewController.fit(),
    mapLayout: () => ({
      state: mapViewController.layoutState(),
      safe: mapViewController.safeRect(),
      home: mapViewController.isHome(),
      focus: mapViewController.focusState(),
    }),
    focusBounds: (bounds, options) => mapViewController.focusBounds(bounds, options),
    revealPoint: (latlng, options) => mapViewController.revealPoint(latlng, options),
    pressKey,
    overlayCanvas: (options) => overlayExport.build(options),
    exportOverlay: () => overlayExport.save(),
    exportSettings: () => overlayExport.settings(),
    panelOpen: () => toolboxController?.isView('export') ?? false,
    exported: (path) => showToast(t('export.done', { name: String(path).split(/[\\/]/).pop() }), 4000),
    exportFailed: (detail) => showToast(t('export.failed', { detail }), 4000),
    summaryText: () => trackSummaryText(gpx, summary, elevations, fileName),
    clipboardResult,
    coordinates: {
      targets: () => coordinateTargets(gpx),
      copy: copyText,
    },
    attachments: {
      items: () => photoAttachments,
      exportAll: (includeExternal, onProgress) =>
        attachmentExporter.exportAll(photoAttachments, includeExternal, onProgress),
      result: (batch, index, ok, path, detail) =>
        attachmentExporter.result(batch, index, ok, path, detail),
    },
    attachmentResult: (batch, index, ok, path, detail) =>
      attachmentExporter.result(batch, index, ok, decodeMessage(path), decodeMessage(detail)),
    attachmentResume: (batch, indices, folder) =>
      attachmentExporter.resumeResult(batch, indices, folder),
    measure: {
      active: measurement.active,
      start: measurement.start,
      stop: measurement.stop,
      add: measurement.addAt,
      endSection: measurement.endSection,
      undo: measurement.undo,
      redo: measurement.redo,
      clear: measurement.clear,
      canUndo: measurement.canUndo,
      canRedo: measurement.canRedo,
      indexed: measurement.indexed,
      summary: measurement.summary,
      sections: measurement.sections,
      snapAt: measurement.snapAt,
      toolboxOpen: toolboxController.isOpen,
      openToolbox: toolboxController.open,
    },
  };
}
