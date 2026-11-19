import {
  adaptiveDistanceIntervals,
  directionSamples,
  findTrackGaps,
  pathDistance,
  routeDirectionSamples,
  sliceRouteByDistance,
} from './track-analysis.js';
import { formatDistance } from './format.js';
import { iconMarkup, symbolMarkup } from './icons.js';
import { createRouteModel } from './route-model.js';

const COLORS = ['#ff5a36', '#2f9bff', '#f5c400', '#c23cff', '#18c964', '#ff3d9a', '#00c2c7', '#ff9f1a'];
const ROUTE_COLOR = '#ffffff';
const NETWORK_LOD_PIXELS = 0.75;
const NETWORK_VIEW_PADDING = 0.25;

function lineBounds(L, points) {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const point of points) {
    if (point.lat < south) south = point.lat;
    if (point.lat > north) north = point.lat;
    if (point.lon < west) west = point.lon;
    if (point.lon > east) east = point.lon;
  }
  return L.latLngBounds([south, west], [north, east]);
}

function networkLatLngs(L, map, points, zoom) {
  const projected = new Array(points.length);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    projected[index] = map.project({ lat: point.lat, lng: point.lon }, zoom);
  }
  // shortcut: LOD uses the current Web Mercator pixel scale, so a route crossing the antimeridian would
  // need segment splitting if such a network appears.
  return L.LineUtil.simplify(projected, NETWORK_LOD_PIXELS)
    .map((point) => map.unproject(point, zoom));
}

function distanceIcon(L, sample) {
  const label = sample.kilometre && sample.distanceMeters >= 1000
    ? `${(sample.distanceMeters / 1000).toFixed(0)} km`
    : '';
  return L.divIcon({
    className: 'gpx-distance',
    html: `<span class="gpx-direction" style="--bearing:${sample.bearing.toFixed(1)}deg">`
      + symbolMarkup('direction', { width: 12, height: 12, className: 'data-symbol gpx-direction-symbol' })
      + '</span>'
      + (label ? `<span class="gpx-km">${label}</span>` : ''),
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function projectedLength(map, paths) {
  const worldWidth = map.getPixelWorldBounds().getSize().x;
  let total = 0;
  for (const points of paths) {
    for (let i = 1; i < points.length; i += 1) {
      const from = map.project([points[i - 1].lat, points[i - 1].lon]);
      const to = map.project([points[i].lat, points[i].lon]);
      let dx = to.x - from.x;
      if (Math.abs(dx) > worldWidth / 2) dx -= Math.sign(dx) * worldWidth;
      total += Math.hypot(dx, to.y - from.y);
    }
  }
  return total;
}

function samplesForRoute(entries, intervals) {
  const paths = entries.map((entry) => entry.points);
  const labels = new Set(routeDirectionSamples(paths, {
    interval: intervals.labelIntervalMeters,
  }).map((sample) => Math.round(sample.distanceMeters)));
  const arrows = routeDirectionSamples(paths, {
    interval: intervals.arrowIntervalMeters,
  });
  if (arrows.length === 0) {
    return entries.flatMap((entry) => {
      const length = entry.length ?? pathDistance(entry.points);
      if (length < 20) return [];
      return directionSamples(entry.points, {
        interval: length / 2,
        offset: entry.offset - length / 2,
      }).map((sample) => ({ ...sample, kilometre: false }));
    });
  }
  return arrows.map((sample) => ({
    ...sample,
    kilometre: labels.has(Math.round(sample.distanceMeters)),
  }));
}

function overlaps(box, boxes) {
  return boxes.some((other) => Math.abs(box.x - other.x) < (box.width + other.width) / 2
    && Math.abs(box.y - other.y) < (box.height + other.height) / 2);
}

function gapIcon(L, eventCount) {
  const clustered = eventCount > 1;
  const label = clustered ? `\u00d7${eventCount}` : '!';
  const width = clustered ? Math.max(35, 23 + label.length * 6) : 18;
  return L.divIcon({
    className: clustered ? 'gpx-gap-marker clustered' : 'gpx-gap-marker',
    html: `<span aria-hidden="true">${iconMarkup('warning', { size: 12 })}`
      + `${clustered ? `<b>${label}</b>` : ''}</span>`,
    iconSize: [width, 18],
    iconAnchor: [width / 2, 9],
  });
}

function anomalyWidth(eventCount, detailed) {
  const label = detailed && eventCount > 1 ? `GPS \u00d7${eventCount}` : 'GPS';
  return Math.max(42, 25 + label.length * 6);
}

function anomalyIcon(L, eventCount, detailed) {
  const label = detailed && eventCount > 1 ? `GPS \u00d7${eventCount}` : 'GPS';
  const width = anomalyWidth(eventCount, detailed);
  return L.divIcon({
    className: 'gpx-anomaly-marker',
    html: `<span aria-hidden="true">${iconMarkup('activity', { size: 12 })}<b>${label}</b></span>`,
    iconSize: [width, 18],
    iconAnchor: [width / 2, 9],
  });
}

function gapAnchor(gap) {
  const representative = (gap.rawItems || [gap]).reduce((largest, item) =>
    item.distanceMeters > largest.distanceMeters ? item : largest);
  return representative.distanceMeters >= 10
    ? {
      lat: (representative.from.lat + representative.to.lat) / 2,
      lon: (representative.from.lon + representative.to.lon) / 2,
    }
    : representative.to;
}

function clusterGaps(episodes, map, radiusPixels = 26) {
  const size = map.getSize();
  const clusters = [];
  for (const gap of episodes) {
    const anchor = gapAnchor(gap);
    const point = map.latLngToContainerPoint([anchor.lat, anchor.lon]);
    if (point.x < -30 || point.y < -30 || point.x > size.x + 30 || point.y > size.y + 30) continue;
    const cluster = clusters.find((candidate) =>
      Math.hypot(point.x - candidate.seed.x, point.y - candidate.seed.y) <= radiusPixels);
    if (cluster) {
      cluster.items.push(gap);
      cluster.x = (cluster.x * (cluster.items.length - 1) + point.x) / cluster.items.length;
      cluster.y = (cluster.y * (cluster.items.length - 1) + point.y) / cluster.items.length;
    } else {
      clusters.push({ seed: point, x: point.x, y: point.y, items: [gap] });
    }
  }
  return clusters;
}

function clusterBounds(L, cluster) {
  const bounds = L.latLngBounds([]);
  for (const episode of cluster.items) {
    const points = episode.rawItems?.length
      ? [episode.rawItems[0].from, ...episode.rawItems.map((item) => item.to)]
      : [episode.from, episode.to];
    for (const point of points) {
      if (point) bounds.extend([point.lat, point.lon]);
    }
  }
  return bounds;
}

function activateMarker(marker, action) {
  marker.on('add', () => {
    const node = marker.getElement();
    if (!node) return;
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      action();
    });
  });
  marker.on('click', action);
}

/** Draws KML areas, track/route lines and start/end markers; waypoint markers are left to the controller. */
export function createTrackLayer({ L, el, localized, t, pointPopup, onFocusBounds }) {
  return {
    draw(map, gpx, routeModel = null) {
      const model = routeModel || createRouteModel(gpx);
      const network = Boolean(gpx.network);
      const bounds = L.latLngBounds([]);
      const segments = [];
      const navigationMarks = [];
      const distancePaths = [];
      const networkEntries = [];
      const distanceLayer = L.layerGroup().addTo(map);
      const anomalyLineLayer = L.layerGroup().addTo(map);
      const anomalyMarkerLayer = L.layerGroup();
      const gapLineLayer = L.layerGroup().addTo(map);
      const gapMarkerLayer = L.layerGroup();
      const splitHighlightLayer = L.layerGroup().addTo(map);
      let anomalyEpisodes = [];
      let gapEpisodes = [];
      let colorIndex = 0;
      let distanceOffset = 0;
      const showEnds = !network && model.trackGroups.length <= 20;
      let distanceCache = null;
      let networkLayer = null;
      let networkStats = null;

      function createNetworkLayer() {
        const renderer = L.canvas({ padding: 0.5 });
        const layer = L.layerGroup().addTo(map);
        const rendered = new Map();
        const simplified = new Map();
        let lodZoom = null;
        let pending = 0;
        let renderCount = 0;

        function refresh() {
          pending = 0;
          const zoom = map.getZoom();
          if (zoom !== lodZoom) {
            layer.clearLayers();
            rendered.clear();
            simplified.clear();
            lodZoom = zoom;
          }
          const visibleBounds = map.getBounds().pad(NETWORK_VIEW_PADDING);
          const visible = networkEntries.filter((entry) => visibleBounds.intersects(entry.bounds));
          const wanted = new Set(visible);
          for (const entry of rendered.keys()) {
            if (wanted.has(entry)) continue;
            layer.removeLayer(rendered.get(entry));
            rendered.delete(entry);
          }
          let renderedPoints = 0;
          for (const entry of visible) {
            let latlngs = simplified.get(entry);
            if (!latlngs) {
              latlngs = networkLatLngs(L, map, entry.points, zoom);
              simplified.set(entry, latlngs);
            }
            renderedPoints += latlngs.length;
            if (rendered.has(entry)) continue;
            const line = L.polyline(latlngs, {
              color: entry.color,
              weight: entry.weight,
              opacity: 0.9,
              dashArray: entry.dashArray,
              className: entry.className,
              renderer,
              smoothFactor: 0,
            });
            if (entry.tooltip) line.bindTooltip(entry.tooltip, { sticky: true });
            line.addTo(layer);
            rendered.set(entry, line);
          }
          networkStats = {
            zoom,
            renderCount: ++renderCount,
            totalLines: networkEntries.length,
            visibleLines: visible.length,
            renderedLines: rendered.size,
            sourcePoints: networkEntries.reduce((sum, entry) => sum + entry.points.length, 0),
            renderedPoints,
          };
        }

        function schedule() {
          if (pending) return;
          pending = requestAnimationFrame(refresh);
        }

        map.on('move zoomend resize', schedule);
        refresh();
        return layer;
      }

      function renderDistanceMarks() {
        distanceLayer.clearLayers();
        const zoom = map.getZoom();
        if (!distanceCache || distanceCache.zoom !== zoom) {
          const paths = distancePaths.map((entry) => entry.points);
          const intervals = adaptiveDistanceIntervals(distanceOffset, projectedLength(map, paths));
          distanceCache = { zoom, samples: samplesForRoute(distancePaths, intervals) };
        }
        const size = map.getSize();
        const mapBox = map.getContainer().getBoundingClientRect();
        const pinCentres = [...document.querySelectorAll('.gpx-pin')].map((pin) => {
          const rect = pin.getBoundingClientRect();
          return {
            x: rect.left - mapBox.left + rect.width / 2,
            y: rect.top - mapBox.top + rect.height / 2,
          };
        });
        const arrowBoxes = [];
        const labelBoxes = [];
        const firstPath = distancePaths[0]?.points;
        const lastPath = distancePaths[distancePaths.length - 1]?.points;
        const routeEnds = [
          firstPath?.[0],
          lastPath?.[lastPath.length - 1],
        ].filter(Boolean).map((point) => map.latLngToContainerPoint([point.lat, point.lon]));
        let lastCapsule = null;
        for (const sample of distanceCache.samples) {
          const projected = map.latLngToContainerPoint([sample.point.lat, sample.point.lon]);
          if (projected.x < -40 || projected.y < -40
            || projected.x > size.x + 40 || projected.y > size.y + 40) continue;
          const arrowBox = { x: projected.x, y: projected.y, width: 13, height: 15 };
          if (overlaps(arrowBox, arrowBoxes)) continue;
          arrowBoxes.push(arrowBox);
          let kilometre = sample.kilometre;
          if (kilometre) {
            if (pinCentres.some((pin) => Math.hypot(pin.x - projected.x, pin.y - projected.y) < 24)) {
              kilometre = false;
            }
            const capsule = { x: projected.x, y: projected.y + 14 };
            if (routeEnds.some((end) => Math.hypot(end.x - capsule.x, end.y - capsule.y) < 28)
              || (lastCapsule && Math.hypot(lastCapsule.x - capsule.x, lastCapsule.y - capsule.y) < 36)) {
              kilometre = false;
            }
            const labelBox = { x: projected.x, y: projected.y + 14, width: 48, height: 17 };
            if (kilometre && overlaps(labelBox, labelBoxes)) kilometre = false;
            if (kilometre) {
              labelBoxes.push(labelBox);
              lastCapsule = capsule;
            }
          }
          L.marker([sample.point.lat, sample.point.lon], {
            icon: distanceIcon(L, { ...sample, kilometre }),
            interactive: false,
            keyboard: false,
          }).addTo(distanceLayer);
        }
      }

      function renderAnnotationMarks() {
        anomalyLineLayer.clearLayers();
        anomalyMarkerLayer.clearLayers();
        gapLineLayer.clearLayers();
        gapMarkerLayer.clearLayers();
        const zoom = map.getZoom();
        const size = map.getSize();
        const anomalyRadius = zoom <= 12 ? 120 : zoom <= 14 ? 72 : 30;
        const anomalyLabels = [];
        for (const cluster of clusterGaps(anomalyEpisodes, map, anomalyRadius)) {
          const eventCount = cluster.items.reduce((sum, gap) => sum + gap.rawCount, 0);
          const affectedDistance = cluster.items.reduce((sum, gap) => sum + gap.distanceMeters, 0);
          for (const gap of cluster.items) {
            const points = gap.rawItems?.length
              ? [gap.rawItems[0].from, ...gap.rawItems.map((item) => item.to)]
              : [gap.from, gap.to];
            const latLngs = points.map((point) => [point.lat, point.lon]);
            L.polyline(latLngs, {
              color: '#07191c',
              weight: 6,
              opacity: 0.9,
              dashArray: '3 7',
              interactive: false,
              className: 'gpx-anomaly-segment',
            }).addTo(anomalyLineLayer);
            L.polyline(latLngs, {
              color: '#4ee4ee',
              weight: 3,
              opacity: 1,
              dashArray: '3 7',
              interactive: false,
              className: 'gpx-anomaly-segment',
            }).addTo(anomalyLineLayer);
          }
          const detailed = zoom > 12;
          const labelWidth = anomalyWidth(eventCount, detailed);
          const labelX = Math.max(28, Math.min(size.x - 28, cluster.x + 22));
          const labelBox = { x: labelX, y: cluster.y, width: labelWidth, height: 18 };
          if (overlaps(labelBox, anomalyLabels) || (zoom <= 12 && anomalyLabels.length >= 3)) continue;
          anomalyLabels.push(labelBox);
          const marker = L.marker(map.containerPointToLatLng([labelX, cluster.y]), {
            icon: anomalyIcon(L, eventCount, detailed),
            interactive: true,
            keyboard: true,
            title: t('map.anomalyHint', {
              count: eventCount,
              distance: formatDistance(affectedDistance),
            }),
            zIndexOffset: 350,
          });
          marker.bindTooltip(() => {
            const span = el('span');
            span.textContent = t('map.anomalyHint', {
              count: eventCount,
              distance: formatDistance(affectedDistance),
            });
            return span;
          }, { direction: 'top', offset: [0, -10] });
          const focus = clusterBounds(L, cluster);
          activateMarker(marker, () => onFocusBounds?.(focus, { maxZoom: 18, minZoomGain: 2 }));
          marker.addTo(anomalyMarkerLayer);
        }

        for (const cluster of clusterGaps(gapEpisodes, map)) {
          const eventCount = cluster.items.reduce((sum, gap) => sum + gap.rawCount, 0);
          const missingDistance = cluster.items.reduce((sum, gap) => sum + gap.distanceMeters, 0);
          const representative = cluster.items.reduce((largest, gap) =>
            gap.distanceMeters > largest.distanceMeters ? gap : largest);
          if (representative.distanceMeters >= 10) {
            L.polyline([
              [representative.from.lat, representative.from.lon],
              [representative.to.lat, representative.to.lon],
            ], {
              color: '#ff6b5e',
              weight: 2,
              opacity: 0.8,
              dashArray: '3 9',
              interactive: false,
              className: 'gpx-gap',
            }).addTo(gapLineLayer);
          }
          const marker = L.marker(map.containerPointToLatLng([cluster.x, cluster.y]), {
            icon: gapIcon(L, eventCount),
            interactive: true,
            keyboard: true,
            title: t('map.gapHint', {
              count: eventCount,
              distance: formatDistance(missingDistance),
            }),
            zIndexOffset: 400,
          });
          marker.bindTooltip(() => {
            const span = el('span');
            span.textContent = t('map.gapHint', {
              count: eventCount,
              distance: formatDistance(missingDistance),
            });
            return span;
          }, { direction: 'top', offset: [0, -10] });
          const focus = clusterBounds(L, cluster);
          activateMarker(marker, () => onFocusBounds?.(focus, { maxZoom: 18, minZoomGain: 2 }));
          marker.addTo(gapMarkerLayer);
        }
      }

      let pendingDistanceRender = 0;
      let pendingAnnotationRender = 0;
      const scheduleDistanceMarks = () => {
        if (pendingDistanceRender) return;
        pendingDistanceRender = requestAnimationFrame(() => {
          pendingDistanceRender = 0;
          renderDistanceMarks();
        });
      };
      const scheduleAnnotationMarks = () => {
        if (pendingAnnotationRender) return;
        pendingAnnotationRender = requestAnimationFrame(() => {
          pendingAnnotationRender = 0;
          renderAnnotationMarks();
        });
      };
      map.on('zoomend', () => {
        scheduleDistanceMarks();
        scheduleAnnotationMarks();
      });
      map.on('moveend', () => {
        scheduleDistanceMarks();
        scheduleAnnotationMarks();
      });
      map.on('resize', () => {
        scheduleDistanceMarks();
        scheduleAnnotationMarks();
      });

      for (const area of gpx.areas || []) {
        const shape = L.polygon(area.rings.map((ring) => ring.map((point) => [point.lat, point.lon])), {
          color: '#378ADD',
          weight: 2,
          opacity: 0.8,
          fillColor: '#378ADD',
          fillOpacity: 0.06,
          className: 'kml-area',
        }).addTo(map);
        if (area.name) shape.bindTooltip(el('span', null, area.name), { sticky: true });
        bounds.extend(shape.getBounds());
      }

      model.trackGroups.forEach((group) => {
        const track = group.track;
        group.segments.forEach((segmentLine, segmentIndex) => {
          const points = segmentLine.points;
          const color = COLORS[colorIndex++ % COLORS.length];
          const title = track.name
            ? (number) => (track.segments.length > 1
              ? t('point.segment', { name: track.name, segment: number })
              : track.name)
            : null;
          const lineBoundsValue = lineBounds(L, points);
          bounds.extend(lineBoundsValue);
          segments.push({ points, color, track });
          if (network) {
            networkEntries.push({
              points,
              bounds: lineBoundsValue,
              color,
              weight: 4,
              className: 'gpx-track gpx-network-track',
              tooltip: title
                ? localized(el('span'), () => title(segmentIndex + 1))
                : null,
            });
          } else {
            const polyline = L.polyline(points.map((point) => [point.lat, point.lon]), {
              color,
              weight: 4,
              opacity: 0.9,
              className: 'gpx-track',
            }).addTo(map);
            if (title) {
              polyline.bindTooltip(
                localized(el('span'), () => title(segmentIndex + 1)),
                { sticky: true },
              );
            }
            distancePaths.push({
              points,
              offset: distanceOffset,
              length: segmentLine.length,
            });
            distanceOffset += segmentLine.length;
          }
        });

        const first = group.segments[0]?.points[0];
        const lastLine = group.segments[group.segments.length - 1];
        const last = lastLine?.points[lastLine.points.length - 1];
        if (last && showEnds) {
          const marker = L.circleMarker([last.lat, last.lon], {
            radius: 8,
            color: '#1b1b1b',
            weight: 1.5,
            fillColor: '#e5243b',
            fillOpacity: 1,
            className: 'gpx-end',
          }).bindPopup(() => pointPopup(last, t('label.end'))).addTo(map);
          navigationMarks.push({ kind: 'end', marker, point: last });
        }
        if (first && showEnds) {
          const marker = L.circleMarker([first.lat, first.lon], {
            radius: 5,
            color: '#1b1b1b',
            weight: 1.5,
            fillColor: '#18c964',
            fillOpacity: 1,
            className: 'gpx-start',
          }).bindPopup(() => pointPopup(first, t('label.start'))).addTo(map);
          navigationMarks.push({ kind: 'start', marker, point: first });
        }
      });

      for (const routeLine of model.routes) {
        const route = routeLine.route;
        const lineBoundsValue = lineBounds(L, routeLine.points);
        bounds.extend(lineBoundsValue);
        if (network) {
          networkEntries.push({
            points: routeLine.points,
            bounds: lineBoundsValue,
            color: ROUTE_COLOR,
            weight: 3,
            dashArray: '8 8',
            className: 'gpx-route gpx-network-route',
            tooltip: route.name ? el('span', null, route.name) : null,
          });
        } else {
          const line = L.polyline(routeLine.points.map((point) => [point.lat, point.lon]), {
            color: ROUTE_COLOR,
            weight: 3,
            opacity: 0.9,
            dashArray: '8 8',
            className: 'gpx-route',
          }).addTo(map);
          if (route.name) line.bindTooltip(el('span', null, route.name), { sticky: true });
          distancePaths.push({
            points: routeLine.points,
            offset: distanceOffset,
            length: routeLine.length,
          });
          distanceOffset += routeLine.length;
        }
      }
      if (network) networkLayer = createNetworkLayer();

      const recordings = network
        ? { episodes: [] }
        : findTrackGaps(gpx.tracks);
      anomalyEpisodes = recordings.episodes.filter((gap) => gap.kind === 'jump');
      gapEpisodes = recordings.episodes.filter((gap) => gap.kind === 'segment');

      return {
        bounds,
        segments,
        navigationMarks,
        networkStats: () => networkLayer ? networkStats : null,
        refreshDistanceMarks() {
          if (network) return;
          renderDistanceMarks();
          renderAnnotationMarks();
        },
        highlightRange(from, to) {
          splitHighlightLayer.clearLayers();
          const paths = sliceRouteByDistance(
            distancePaths.map((entry) => entry.points),
            { from, to },
          );
          const bounds = L.latLngBounds([]);
          for (const points of paths) {
            const latLngs = points.map((point) => [point.lat, point.lon]);
            L.polyline(latLngs, {
              color: '#07141a',
              weight: 10,
              opacity: 0.88,
              interactive: false,
              className: 'gpx-split-highlight',
            }).addTo(splitHighlightLayer);
            L.polyline(latLngs, {
              color: '#72e7ff',
              weight: 6,
              opacity: 1,
              interactive: false,
              className: 'gpx-split-highlight',
            }).addTo(splitHighlightLayer);
            for (const point of points) bounds.extend([point.lat, point.lon]);
          }
          return { bounds, paths: paths.length, points: paths.reduce((sum, points) => sum + points.length, 0) };
        },
        clearSplitHighlight() {
          splitHighlightLayer.clearLayers();
        },
        setAnnotationMarkersVisible(visible) {
          if (visible) {
            anomalyMarkerLayer.addTo(map);
            gapMarkerLayer.addTo(map);
          } else {
            anomalyMarkerLayer.remove();
            gapMarkerLayer.remove();
          }
        },
      };
    },
  };
}
