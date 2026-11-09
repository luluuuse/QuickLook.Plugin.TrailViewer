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
  return {
    index: indices[middle],
    axis,
    left: build(indices.slice(0, middle), points, depth + 1),
    right: build(indices.slice(middle + 1), points, depth + 1),
  };
}

/**
 * @template {TrackPoint} T
 * @param {T[]} points
 * @returns {{ nearest(target: Pick<TrackPoint, 'lat' | 'lon'>): T | null }}
 */
export function createPointIndex(points) {
  const root = build(points.map((_, index) => index), points, 0);

  return {
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
