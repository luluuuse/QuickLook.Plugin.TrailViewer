// A small static 2D k-d tree for the profile's waypoint lookup. The viewer has thousands of samples but
// usually few waypoints; scanning every sample for every pin was O(points × waypoints) and could stall a KML
// with many placemarks. The metric is deliberately the same raw degree-squared distance the old linear scan
// used, so this changes speed without changing which sample wins.

/** @typedef {import('./types.js').TrackPoint} TrackPoint */

function build(indices, points, depth) {
  if (indices.length === 0) return null;
  const axis = depth % 2 === 0 ? 'lon' : 'lat';
  indices.sort((a, b) => points[a][axis] - points[b][axis] || a - b);
  const middle = indices.length >> 1;
  const node = {
    index: indices[middle],
    axis,
    left: build(indices.slice(0, middle), points, depth + 1),
    right: build(indices.slice(middle + 1), points, depth + 1),
  };
  const point = points[node.index];
  node.minLon = Math.min(point.lon, node.left?.minLon ?? Infinity, node.right?.minLon ?? Infinity);
  node.maxLon = Math.max(point.lon, node.left?.maxLon ?? -Infinity, node.right?.maxLon ?? -Infinity);
  node.minLat = Math.min(point.lat, node.left?.minLat ?? Infinity, node.right?.minLat ?? Infinity);
  node.maxLat = Math.max(point.lat, node.left?.maxLat ?? -Infinity, node.right?.maxLat ?? -Infinity);
  return node;
}

function normalizeLongitude(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function longitudeRanges(west, east) {
  if (!Number.isFinite(west) || !Number.isFinite(east) || east - west >= 360) return [[-180, 180]];
  const start = normalizeLongitude(west);
  const end = normalizeLongitude(east);
  return start <= end ? [[start, end]] : [[start, 180], [-180, end]];
}

/**
 * @template {TrackPoint} T
 * @param {T[]} points
 * @returns {{
 *   nearest(target: Pick<TrackPoint, 'lat' | 'lon'>): T | null,
 *   within(bounds: { south: number, west: number, north: number, east: number }): T[]
 * }}
 */
export function createPointIndex(points) {
  const root = build(points.map((_, index) => index), points, 0);

  return {
    within(bounds) {
      const south = Math.min(bounds.south, bounds.north);
      const north = Math.max(bounds.south, bounds.north);
      const ranges = longitudeRanges(bounds.west, bounds.east);
      const found = [];
      const visit = (node) => {
        if (!node || node.maxLat < south || node.minLat > north) return;
        if (!ranges.some(([west, east]) => node.maxLon >= west && node.minLon <= east)) return;
        const point = points[node.index];
        if (point.lat >= south && point.lat <= north
          && ranges.some(([west, east]) => point.lon >= west && point.lon <= east)) {
          found.push(node.index);
        }
        visit(node.left);
        visit(node.right);
      };
      visit(root);
      return found.sort((a, b) => a - b).map((index) => points[index]);
    },
    nearest(target) {
      let bestIndex = -1;
      let bestDistance = Infinity;

      const visit = (node) => {
        if (!node) return;
        const point = points[node.index];
        const dLon = point.lon - target.lon;
        const dLat = point.lat - target.lat;
        const distance = dLon * dLon + dLat * dLat;
        if (distance < bestDistance || (distance === bestDistance && node.index < bestIndex)) {
          bestDistance = distance;
          bestIndex = node.index;
        }

        const delta = target[node.axis] - point[node.axis];
        const near = delta < 0 ? node.left : node.right;
        const far = delta < 0 ? node.right : node.left;
        visit(near);
        // Equal distances still matter: the old scan returned the earliest sample on a tie.
        if (delta * delta <= bestDistance) visit(far);
      };

      visit(root);
      return bestIndex >= 0 ? points[bestIndex] : null;
    },
  };
}
