function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function makeRect(left, top, right, bottom) {
  return {
    left: finite(left),
    top: finite(top),
    right: finite(right),
    bottom: finite(bottom),
    width: Math.max(0, finite(right) - finite(left)),
    height: Math.max(0, finite(bottom) - finite(top)),
  };
}

export function rectCenter(rect) {
  return {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2,
  };
}

export function insetRect(rect, left, top = left, right = left, bottom = top) {
  const inner = makeRect(rect.left + left, rect.top + top, rect.right - right, rect.bottom - bottom);
  if (inner.width <= 0 || inner.height <= 0) {
    const x = (rect.left + rect.right) / 2;
    const y = (rect.top + rect.bottom) / 2;
    return makeRect(x, y, x, y);
  }
  return inner;
}

export function comfortRect(rect) {
  const x = Math.min(72, rect.width * 0.18);
  const y = Math.min(72, rect.height * 0.18);
  return insetRect(rect, x, y, x, y);
}

export function pointRect(x, y, size = 28) {
  const half = size / 2;
  return makeRect(x - half, y - half, x + half, y + half);
}

export function unionRects(rects) {
  const present = rects.filter((rect) => rect && rect.width >= 0 && rect.height >= 0);
  if (present.length === 0) return null;
  return makeRect(
    Math.min(...present.map((rect) => rect.left)),
    Math.min(...present.map((rect) => rect.top)),
    Math.max(...present.map((rect) => rect.right)),
    Math.max(...present.map((rect) => rect.bottom)),
  );
}

export function containsRect(outer, inner) {
  return inner.left >= outer.left && inner.top >= outer.top
    && inner.right <= outer.right && inner.bottom <= outer.bottom;
}

/**
 * A selected point is left alone while it sits in the comfort rectangle. Once it falls outside,
 * the camera is moved so the visible marker/popup union is centred in the safe map area.
 */
export function focusOffset(focus, safe) {
  if (!focus || safe.width <= 0 || safe.height <= 0 || containsRect(comfortRect(safe), focus)) {
    return { x: 0, y: 0, needed: false };
  }
  const from = rectCenter(focus);
  const to = rectCenter(safe);
  return {
    x: Math.round(to.x - from.x),
    y: Math.round(to.y - from.y),
    needed: Math.abs(to.x - from.x) >= 0.5 || Math.abs(to.y - from.y) >= 0.5,
  };
}

/** Continuous interactions such as profile scrubbing only move enough to clear an overlay. */
export function revealOffset(focus, safe) {
  if (!focus || safe.width <= 0 || safe.height <= 0 || containsRect(safe, focus)) {
    return { x: 0, y: 0, needed: false };
  }
  let x = 0;
  let y = 0;
  if (focus.width > safe.width) x = rectCenter(safe).x - rectCenter(focus).x;
  else if (focus.left < safe.left) x = safe.left - focus.left;
  else if (focus.right > safe.right) x = safe.right - focus.right;
  if (focus.height > safe.height) y = rectCenter(safe).y - rectCenter(focus).y;
  else if (focus.top < safe.top) y = safe.top - focus.top;
  else if (focus.bottom > safe.bottom) y = safe.bottom - focus.bottom;
  x = Math.round(x);
  y = Math.round(y);
  return { x, y, needed: Math.abs(x) >= 0.5 || Math.abs(y) >= 0.5 };
}

/** Insets are measured from the map-container edges to the unobstructed rectangle. */
export function safeMapRect(width, height, insets) {
  const left = Math.max(0, finite(insets.left));
  const top = Math.max(0, finite(insets.top));
  const right = Math.max(0, finite(insets.right));
  const bottom = Math.max(0, finite(insets.bottom));
  return makeRect(left, top, Math.max(left, width - right), Math.max(top, height - bottom));
}
