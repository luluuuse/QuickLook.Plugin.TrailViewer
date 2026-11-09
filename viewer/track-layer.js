import {
  adaptiveDistanceIntervals,
  directionSamples,
  findTrackGaps,
  pathDistance,
  routeDirectionSamples,
} from './track-analysis.js';
import { formatDistance } from './format.js';

const COLORS = ['#ff5a36', '#2f9bff', '#f5c400', '#c23cff', '#18c964', '#ff3d9a', '#00c2c7', '#ff9f1a'];
const ROUTE_COLOR = '#ffffff';

function distanceIcon(L, sample) {
  const label = sample.kilometre && sample.distanceMeters >= 1000
    ? `${(sample.distanceMeters / 1000).toFixed(0)} km`
    : '';
  return L.divIcon({
    className: 'gpx-distance',
    html: `<span class="gpx-direction" style="--bearing:${sample.bearing.toFixed(1)}deg"></span>`
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
      const length = pathDistance(entry.points);
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
  const width = clustered ? Math.max(27, 15 + label.length * 6) : 18;
  return L.divIcon({
    className: clustered ? 'gpx-gap-marker clustered' : 'gpx-gap-marker',
    html: `<span aria-hidden="true">${label}</span>`,
    iconSize: [width, 18],
    iconAnchor: [width / 2, 9],
  });
}

function anomalyIcon(L, eventCount, detailed) {
  const label = detailed && eventCount > 1 ? `GPS \u00d7${eventCount}` : 'GPS';
  const width = Math.max(29, 11 + label.length * 6);
  return L.divIcon({
    className: 'gpx-anomaly-marker',
    html: `<span aria-hidden="true">${label}</span>`,
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
    draw(map, gpx) {
      const bounds = L.latLngBounds([]);
      const segments = [];
      const distancePaths = [];
      const distanceLayer = L.layerGroup().addTo(map);
      const anomalyLineLayer = L.layerGroup().addTo(map);
      const anomalyMarkerLayer = L.layerGroup();
      const gapLineLayer = L.layerGroup().addTo(map);
      const gapMarkerLayer = L.layerGroup();
      let anomalyEpisodes = [];
      let gapEpisodes = [];
      let colorIndex = 0;
      let distanceOffset = 0;
      const showEnds = gpx.tracks.length <= 20;

      const renderMapMarks = () => {
        distanceLayer.clearLayers();
        anomalyLineLayer.clearLayers();
        anomalyMarkerLayer.clearLayers();
        gapLineLayer.clearLayers();
        gapMarkerLayer.clearLayers();
        const paths = distancePaths.map((entry) => entry.points);
        const totalDistance = distancePaths.reduce((sum, entry) => sum + pathDistance(entry.points), 0);
        const intervals = adaptiveDistanceIntervals(totalDistance, projectedLength(map, paths));
        const size = map.getSize();
        const arrowBoxes = [];
        const labelBoxes = [];
        for (const sample of samplesForRoute(distancePaths, intervals)) {
          const projected = map.latLngToContainerPoint([sample.point.lat, sample.point.lon]);
          if (projected.x < -40 || projected.y < -40
            || projected.x > size.x + 40 || projected.y > size.y + 40) continue;
          const arrowBox = { x: projected.x, y: projected.y, width: 13, height: 15 };
          if (overlaps(arrowBox, arrowBoxes)) continue;
          arrowBoxes.push(arrowBox);
          let kilometre = sample.kilometre;
          if (kilometre) {
            const labelBox = { x: projected.x, y: projected.y + 14, width: 48, height: 17 };
            if (overlaps(labelBox, labelBoxes)) kilometre = false;
            else labelBoxes.push(labelBox);
          }
          L.marker([sample.point.lat, sample.point.lon], {
            icon: distanceIcon(L, { ...sample, kilometre }),
            interactive: false,
            keyboard: false,
          }).addTo(distanceLayer);
        }

        const zoom = map.getZoom();
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
          const labelWidth = detailed ? Math.max(29, 11 + `GPS \u00d7${eventCount}`.length * 6) : 29;
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
          marker.bindTooltip(localized(el('span'), () => t('map.anomalyHint', {
            count: eventCount,
            distance: formatDistance(affectedDistance),
          })), { direction: 'top', offset: [0, -10] });
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
          marker.bindTooltip(localized(el('span'), () => t('map.gapHint', {
            count: eventCount,
            distance: formatDistance(missingDistance),
          })), { direction: 'top', offset: [0, -10] });
          const focus = clusterBounds(L, cluster);
          activateMarker(marker, () => onFocusBounds?.(focus, { maxZoom: 18, minZoomGain: 2 }));
          marker.addTo(gapMarkerLayer);
        }
      };

      let pendingRender = 0;
      const scheduleDistanceMarks = () => {
        if (pendingRender) return;
        pendingRender = requestAnimationFrame(() => {
          pendingRender = 0;
          renderMapMarks();
        });
      };
      map.on('zoomend', scheduleDistanceMarks);
      map.on('moveend', scheduleDistanceMarks);
      map.on('resize', scheduleDistanceMarks);

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

      gpx.tracks.forEach((track) => {
        track.segments.forEach((points, segmentIndex) => {
          const color = COLORS[colorIndex++ % COLORS.length];
          const line = L.polyline(points.map((point) => [point.lat, point.lon]), {
            color,
            weight: 4,
            opacity: 0.9,
            className: 'gpx-track',
          }).addTo(map);
          const title = track.name
            ? (number) => (track.segments.length > 1
              ? t('point.segment', { name: track.name, segment: number })
              : track.name)
            : null;
          if (title) line.bindTooltip(localized(el('span'), () => title(segmentIndex + 1)), { sticky: true });
          bounds.extend(line.getBounds());
          segments.push({ points, color, track });
          const length = pathDistance(points);
          distancePaths.push({ points, offset: distanceOffset });
          distanceOffset += length;
        });

        const first = track.segments[0]?.[0];
        const lastSegment = track.segments[track.segments.length - 1];
        const last = lastSegment?.[lastSegment.length - 1];
        if (last && showEnds) {
          L.circleMarker([last.lat, last.lon], {
            radius: 8,
            color: '#ffffff',
            weight: 3,
            fillColor: '#e5243b',
            fillOpacity: 1,
            className: 'gpx-end',
          }).bindPopup(() => pointPopup(last, t('label.end'))).addTo(map);
        }
        if (first && showEnds) {
          L.circleMarker([first.lat, first.lon], {
            radius: 5,
            color: '#ffffff',
            weight: 2,
            fillColor: '#18c964',
            fillOpacity: 1,
            className: 'gpx-start',
          }).bindPopup(() => pointPopup(first, t('label.start'))).addTo(map);
        }
      });

      for (const route of gpx.routes) {
        const line = L.polyline(route.points.map((point) => [point.lat, point.lon]), {
          color: ROUTE_COLOR,
          weight: 3,
          opacity: 0.9,
          dashArray: '8 8',
          className: 'gpx-route',
        }).addTo(map);
        if (route.name) line.bindTooltip(el('span', null, route.name), { sticky: true });
        bounds.extend(line.getBounds());
        const length = pathDistance(route.points);
        distancePaths.push({ points: route.points, offset: distanceOffset });
        distanceOffset += length;
      }

      const recordings = findTrackGaps(gpx.tracks);
      anomalyEpisodes = recordings.episodes.filter((gap) => gap.kind === 'jump');
      gapEpisodes = recordings.episodes.filter((gap) => gap.kind === 'segment');

      return {
        bounds,
        segments,
        refreshDistanceMarks: renderMapMarks,
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
