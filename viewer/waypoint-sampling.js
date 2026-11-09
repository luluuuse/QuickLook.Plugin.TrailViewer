/**
 * Keeps pins that do not collide at the current zoom. Protected points are supplied first as occupied positions;
 * the remaining route-order points fill the gaps. Zooming changes the projections and therefore the sample.
 */
export function sampleScreenPoints(items, project, {
  minDistance = 34,
  bounds = null,
  margin = 36,
  occupied = [],
} = {}) {
  const accepted = [];
  const placed = occupied.slice();
  for (const item of items) {
    const point = project(item);
    if (bounds && (point.x < -margin || point.y < -margin
      || point.x > bounds.x + margin || point.y > bounds.y + margin)) continue;
    if (placed.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < minDistance)) continue;
    accepted.push({ item, point });
    placed.push(point);
  }
  return accepted;
}
