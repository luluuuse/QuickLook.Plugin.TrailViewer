// The overlay: the track on its own, no tiles and no background, with the totals in a right-hand column.
//
// Everything here is drawn from the parsed points rather than captured from the page, so the picture does
// not depend on where the map happens to be looking, which background is selected, or the window size. The
// Mercator maths is the same projection Leaflet uses; doing it here is what makes an export reproducible and
// lets the canvas be scaled to whatever size the photo needs.
//
// Three shapes, all composed on a 1080-wide canvas: 3:4 for a photo, 9:16 for a phone story, 1:1 for a square
// post. Only the height changes, so the drawing measures itself in fractions of the canvas and the same code
// lands at the same proportions -- no second layout to keep in step.
//
// The fourth shape is the one that turns the page sideways: 4:3 puts the figures in a column on the left and
// the track on the right, with the distance set at the top of that column and the other four numbers under it
// in a 2 x 2 block. It is a second layout rather than a rotation of the first, because a landscape frame gives
// the type more width and less height -- the numbers grow and the rules between them go away.
//
// The ink is a setting too: black for a bright photo, white for a dark one. Every colour in the picture is
// derived from it, including the direction of the backing wash, so the two can never contradict each other.
//
// The canvas is the composition, not the deliverable: the overlay is made to be laid into part of a photo,
// not to cover it, so it ships smaller than the camera's own frame. The long edge is 1536 to 2048 -- half the
// short edge of a 12 MP photo, the size the picture actually occupies when it sits in one half of the frame,
// and still double what a share leaves it. Larger only costs bytes and gets resampled on the way in.

// The RDP pass below does the real pixel-aware reduction. This is only a ceiling for pathologically long
// inputs, high enough that every file in the documented 30k-point range reaches RDP intact.
const MAX_POINTS = 30000;

// Three shapes: a square, a phone screen, and the landscape page. The key is the shape's own proportion and is
// what the file name carries; what the panel calls it is the i18n layer's business.
export const PRESETS = [
  { key: '1:1', width: 1080, height: 1080, pixels: 1536 }, // 1536 x 1536
  { key: '9:16', width: 1080, height: 1920, pixels: 1920 }, // 1080 x 1920
  { key: '4:3', width: 1440, height: 1080, pixels: 2048 }, // 2048 x 1536, the landscape page
];
export const DEFAULT_SIZE = '9:16';
export const DEFAULT_SCRIM = 'none';
export const DEFAULT_INK = 'black';
export const INKS = ['black', 'white'];

const FONT = '"Segoe UI", "Microsoft YaHei", sans-serif';

// Everything the type and the rules are drawn with, per ink. The shadow is the one that is not symmetric: white
// type on a bright photo needs a dark edge to hold it, black type needs nothing at all -- a halo behind it only
// greys the strokes.
const PENS = {
  black: {
    text: '#000000',
    label: 'rgba(0, 0, 0, 0.72)',
    faint: 'rgba(0, 0, 0, 0.55)',
    rule: 'rgba(0, 0, 0, 0.45)',
    hair: 'rgba(0, 0, 0, 0.30)',
    shadow: null,
    wash: ['rgba(255, 255, 255, 0)', 'rgba(255, 255, 255, 0.26)', 'rgba(255, 255, 255, 0.52)'],
  },
  white: {
    text: '#ffffff',
    label: 'rgba(255, 255, 255, 0.8)',
    faint: 'rgba(255, 255, 255, 0.74)',
    rule: 'rgba(255, 255, 255, 0.45)',
    hair: 'rgba(255, 255, 255, 0.28)',
    shadow: 'rgba(0, 0, 0, 0.45)',
    wash: ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0.22)', 'rgba(0, 0, 0, 0.44)'],
  },
};

// Green at the lowest point, red at the highest, yellow and orange in between: the ramp a topographic print
// uses, and the one that still reads once the overlay lands on a dark photo.
/** @type {Array<[number, [number, number, number]]>} */
const RAMP = [
  [0.0, [46, 204, 64]],
  [0.28, [143, 212, 0]],
  [0.5, [255, 208, 0]],
  [0.74, [255, 140, 0]],
  [1.0, [255, 45, 0]],
];

const BANDS = 24; // one stroke per band, not one per point: a 20,000 point track is still ~24 draws

export const presetOf = (key) => PRESETS.find((p) => p.key === key)
  || PRESETS.find((p) => p.key === DEFAULT_SIZE)
  || PRESETS[0];

/**
 * Where everything goes, worked out from the canvas size alone.
 *
 * These are the proportions the 3:4 layout was drawn at: the rule at 64.8 % of the width, the column between
 * 21.5 % and 78.5 % of the height, the track inside the left 61 %. A taller canvas gives the column more room
 * and the type grows with it, a square one takes room away and the type shrinks -- within limits, because the
 * numbers are read at arm's length on the same phone either way.
 */
function layout(width, height) {
  if (width > height) return landscape(width, height);
  const columnTop = height * 0.215;
  const columnBottom = height * 0.785;
  return {
    width,
    height,
    rule: width * 0.648,
    textX: width * 0.935,
    columnTop,
    columnBottom,
    // 820 is the column of the 3:4 layout: the height the type was set for.
    fit: Math.min(Math.max((columnBottom - columnTop) / 820, 0.72), 1.22),
    track: { left: width * 0.056, top: height * 0.104, right: width * 0.611, bottom: height * 0.868 },
  };
}

/**
 * The landscape page is read top down: the figures in the upper third, the track across the band below.
 *
 * The block sits inside the top left -- half the width, a third of the height -- so everything under it stays
 * photograph. The distance is the heading: set large, flush left, with no name under it. The other four are a
 * 2 x 2 grid, each number centred with its label centred beneath, the label in a lighter ink so the eye lands
 * on the numbers first.
 *
 * The heading is twice the size of the grid: clearly the subject of the page, and the four still large enough
 * to be read at a glance once the picture is laid into a photo. A wider ratio turned the four into footnotes;
 * a narrower one cost the distance its place as the heading.
 *
 * Every size below was set on the 1080-high page and scales with the height, so the 2048 x 1536 file reads the
 * same. The gaps are set from the type they follow, which is why they move with it.
 */
const LS = { distance: 112, unit: 0.34, value: 54, label: 20, headGap: 48, row: 83, rowGap: 20 };

function landscape(width, height) {
  const k = height / 1080;
  const pad = width * 0.05;
  const columnRight = width * 0.47;
  const gapX = width * 0.017;
  const distanceSize = LS.distance * k;
  return {
    width,
    height,
    row: true,
    pad,
    gapX,
    columnWidth: columnRight - pad,
    cellWidth: (columnRight - pad - gapX) / 2,
    distanceTop: 48 * k,
    distanceSize,
    unitSize: distanceSize * LS.unit,
    gridTop: 48 * k + distanceSize * 0.78 + LS.headGap * k,
    cellHeight: LS.row * k,
    gapY: LS.rowGap * k,
    valueSize: LS.value * k,
    cellLabelSize: LS.label * k,
    // Below the block and full width: a landscape page is for a track that runs wide, so the band is 2:1
    // and a straight east-west ride uses every pixel of it. A loop only fills its height, and centres.
    track: { left: width * 0.05, top: height * 0.38, right: width * 0.95, bottom: height * 0.96 },
  };
}

export function mercator(p) {
  // Web Mercator is undefined at the poles. Latitude 90 is valid in GPX/KML, so clamp to the same limit as
  // map tiles rather than letting one point turn the whole export into NaN or Infinity.
  const lat = Math.max(-85.05112878, Math.min(85.05112878, p.lat));
  const x = (p.lon + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return { x, y };
}

/** Put a longitude on the same world copy as the reference, choosing the short way across 180 degrees. */
export function unwrapLongitude(lon, reference) {
  return reference + ((((lon - reference + 540) % 360) + 360) % 360 - 180);
}

/** Every point kept, or a regular sample of them, always including the last one. */
function decimate(points) {
  if (points.length <= MAX_POINTS) return points;
  const step = Math.ceil(points.length / MAX_POINTS);
  const kept = [];
  for (let i = 0; i < points.length; i += step) kept.push(points[i]);
  if (kept[kept.length - 1] !== points[points.length - 1]) kept.push(points[points.length - 1]);
  return kept;
}

/** Maps points to page pixels, fitting every line into `box` without stretching it. */
function projector(lines, box) {
  const anchorLon = lines.find((line) => line.length > 0)?.[0]?.lon ?? 0;
  const project = (p) => mercator({ lat: p.lat, lon: unwrapLongitude(p.lon, anchorLon) });
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const line of lines) {
    for (const p of line) {
      const q = project(p);
      if (q.x < minX) minX = q.x;
      if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.y > maxY) maxY = q.y;
    }
  }
  // A route that runs dead north or is a single point has a zero span: a tiny floor keeps the scale finite.
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const scale = Math.min((box.right - box.left) / spanX, (box.bottom - box.top) / spanY);
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  return (p) => {
    const q = project(p);
    return [cx + (q.x - mx) * scale, cy + (q.y - my) * scale];
  };
}

function distanceToSegmentSquared(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return (point[0] - a[0]) ** 2 + (point[1] - a[1]) ** 2;
  const t = Math.max(0, Math.min(1,
    ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  const x = a[0] + t * dx;
  const y = a[1] + t * dy;
  return (point[0] - x) ** 2 + (point[1] - y) ** 2;
}

/**
 * Ramer-Douglas-Peucker in output pixels, with an iterative stack so a long track cannot overflow the call
 * stack. It keeps corners and spikes rather than blindly dropping every nth point.
 */
export function simplifyPath(points, tolerance = 0.35) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  const limit = tolerance * tolerance;
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop();
    let farthest = -1;
    let farthestDistance = limit;
    for (let i = from + 1; i < to; i += 1) {
      const d = distanceToSegmentSquared(points[i].xy, points[from].xy, points[to].xy);
      if (d > farthestDistance) {
        farthestDistance = d;
        farthest = i;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([from, farthest], [farthest, to]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

function ramp(stop) {
  const t = Math.min(Math.max(stop, 0), 1);
  for (let i = 1; i < RAMP.length; i += 1) {
    const [right, to] = RAMP[i];
    if (t <= right) {
      const [left, from] = RAMP[i - 1];
      const k = (t - left) / (right - left);
      const c = from.map((v, j) => Math.round(v + (to[j] - v) * k));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  const last = RAMP[RAMP.length - 1][1];
  return `rgb(${last[0]}, ${last[1]}, ${last[2]})`;
}

function strokeRun(ctx, points, from, to) {
  ctx.beginPath();
  ctx.moveTo(points[from][0], points[from][1]);
  for (let i = from + 1; i <= to; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
}

/**
 * Colours a route by height: one stroke per colour band, each run of a band drawn as a single path. Adjacent
 * runs repeat the point where they meet, so round caps close the seam instead of leaving a notch.
 */
function paintRoute(ctx, lines, minEle, maxEle, flat) {
  const span = maxEle - minEle;
  const bandOf = (p) => {
    if (flat || p.ele === undefined || span <= 0) return 0;
    return Math.round(((p.ele - minEle) / span) * BANDS);
  };

  for (const line of lines) {
    const points = line.map((p) => p.xy);
    ctx.lineWidth = 22;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
    if (points.length > 1) strokeRun(ctx, points, 0, points.length - 1);

    ctx.lineWidth = 10;
    let start = 0;
    let band = bandOf(line[0]);
    for (let i = 1; i < line.length; i += 1) {
      const next = bandOf(line[i]);
      if (next === band) continue;
      ctx.strokeStyle = flat ? '#2ecc40' : ramp(band / BANDS);
      strokeRun(ctx, points, start, i);
      start = i - 1; // the seam: the next run starts where this one ended
      band = next;
    }
    ctx.strokeStyle = flat ? '#2ecc40' : ramp(band / BANDS);
    if (points.length > 1) strokeRun(ctx, points, start, points.length - 1);
  }
}

/**
 * A wash behind the figures, in the opposite direction to the ink: white behind black type, black behind white.
 *
 * It fades out to the left and to the top and bottom, so what lands on the picture is a soft haze rather than
 * a rectangle with four straight edges. Everything under it still shows through: this is a backing for the
 * words, not an opaque plate.
 */
function paintScrim(ctx, box, wash) {
  const { width, height } = box;
  ctx.save();
  // The wash goes where the type is: the right half of a portrait page, the top of a landscape one.
  const shade = box.row
    ? ctx.createLinearGradient(0, 0, 0, height * 0.66)
    : ctx.createLinearGradient(width * 0.5, 0, width, 0);
  shade.addColorStop(0, box.row ? wash[2] : wash[0]);
  shade.addColorStop(0.45, wash[1]);
  shade.addColorStop(1, box.row ? wash[0] : wash[2]);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  // Erase the far ends of the band: destination-out takes away the wash that is already there and nothing
  // else, because at this point it is the only thing on the canvas.
  ctx.globalCompositeOperation = 'destination-out';
  const fade = height * 0.16;
  const along = ctx.createLinearGradient(0, 0, 0, fade);
  along.addColorStop(0, 'rgba(0, 0, 0, 1)');
  along.addColorStop(1, 'rgba(0, 0, 0, 0)');
  if (!box.row) {
    // Portrait: the wash is a vertical strip, so it is the top and bottom edges that have to go.
    ctx.fillStyle = along;
    ctx.fillRect(0, 0, width, fade);
    const foot = ctx.createLinearGradient(0, height, 0, height - fade);
    foot.addColorStop(0, 'rgba(0, 0, 0, 1)');
    foot.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = foot;
    ctx.fillRect(0, height - fade, width, fade);
  } else {
    // Landscape: it is a band across the top, so its right edge is the one that has to disappear before the
    // track starts. The gradient itself already reaches nothing by two thirds of the height.
    const right = ctx.createLinearGradient(width * 0.42, 0, width * 0.72, 0);
    right.addColorStop(0, 'rgba(0, 0, 0, 0)');
    right.addColorStop(1, 'rgba(0, 0, 0, 1)');
    ctx.fillStyle = right;
    ctx.fillRect(width * 0.42, 0, width * 0.58, height);
  }
  ctx.restore();
}

function badge(ctx, [x, y], fill, text) {
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.font = `600 15px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/**
 * Where a badge sits: just past the end of the route, along the direction of travel.
 *
 * A loop starts and finishes on the same spot, so two badges drawn on the points themselves are one badge --
 * the red one on top of the green. Pushing each a little further along the line separates them, and reads as
 * "here is where it began, there is where it ended".
 */
function badgeAt(points, atEnd) {
  const n = points.length;
  if (n < 2) return [points[0][0], points[0][1] - 18];
  const tip = atEnd ? points[n - 1] : points[0];
  const behind = atEnd ? points[n - 2] : points[1];
  const dx = tip[0] - behind[0];
  const dy = tip[1] - behind[1];
  const length = Math.hypot(dx, dy) || 1;
  return [tip[0] + (dx / length) * 18, tip[1] + (dy / length) * 18];
}

/**
 * Two badges on the same spot are one badge: push them apart until both circles can be read.
 *
 * The direction-of-travel offset above separates most loops, but not the ones whose last few metres bent
 * back on themselves -- then the two ends sit a few pixels apart and the circles overlap again.
 */
function separate(a, b, gap) {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  let d = Math.hypot(dx, dy);
  if (d >= gap) return [a, b];
  if (d < 0.01) {
    dx = 0;
    dy = 1;
    d = 1; // exactly on top of each other: split them vertically, the way a list would
  }
  const push = (gap - d) / 2;
  return [
    [a[0] - (dx / d) * push, a[1] - (dy / d) * push],
    [b[0] + (dx / d) * push, b[1] + (dy / d) * push],
  ];
}

/** A number and its unit, right-aligned as one block so the column edge stays straight. */
function pair(ctx, row, size, unitSize, baseline, textX, pen) {
  const { value, unit } = row;
  ctx.font = `500 ${size}px ${FONT}`;
  const wide = ctx.measureText(value).width;
  const gap = unit ? size * 0.14 : 0;
  ctx.font = `400 ${unitSize}px ${FONT}`;
  const narrow = unit ? ctx.measureText(unit).width : 0;
  const left = textX - wide - gap - narrow;

  ctx.textAlign = 'left';
  ctx.font = `500 ${size}px ${FONT}`;
  ctx.fillStyle = pen.text;
  ctx.fillText(value, left, baseline);
  if (unit) {
    ctx.font = `400 ${unitSize}px ${FONT}`;
    ctx.fillText(unit, left + wide + gap, baseline);
  }
}

/** How wide a value and its unit will be at a given size, for fitting a block to the room it has. */
function widthOf(ctx, row, size, unitSize) {
  ctx.font = `500 ${size}px ${FONT}`;
  const wide = ctx.measureText(row.value).width;
  if (!row.unit) return wide;
  ctx.font = `400 ${unitSize}px ${FONT}`;
  return wide + size * 0.14 + ctx.measureText(row.unit).width;
}

/** A number with its unit, flush left: the same block as `pair`, mirrored, for the landscape page. */
function leftPair(ctx, row, size, unitSize, baseline, x, pen) {
  const { value, unit } = row;
  const gap = unit ? size * 0.14 : 0;
  ctx.textAlign = 'left';
  ctx.font = `500 ${size}px ${FONT}`;
  ctx.fillStyle = pen.text;
  ctx.fillText(value, x, baseline);
  if (unit) {
    const wide = ctx.measureText(value).width;
    ctx.font = `400 ${unitSize}px ${FONT}`;
    ctx.fillText(unit, x + wide + gap, baseline);
  }
}

/** The same block centred on an axis: measured first, then drawn from the left that puts its middle there. */
function centredPair(ctx, row, size, unitSize, baseline, cx, pen) {
  leftPair(ctx, row, size, unitSize, baseline, cx - widthOf(ctx, row, size, unitSize) / 2, pen);
}

/**
 * The column: label over value, five rows, separated by hairlines.
 *
 * No shadow behind the type. A halo on white-on-dark used to earn its keep; behind black it only greys the
 * strokes, so the ink stays pure and a photo too dark to read it is what the backing wash is for.
 */
function column(ctx, rows, box, pen) {
  const { rule, textX, columnTop, columnBottom, fit } = box;
  const rowHeight = (columnBottom - columnTop) / rows.length;

  if (pen.shadow) {
    ctx.shadowColor = pen.shadow;
    ctx.shadowBlur = 10;
  }

  ctx.strokeStyle = pen.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rule, columnTop);
  ctx.lineTo(rule, columnBottom);
  ctx.stroke();

  rows.forEach((row, i) => {
    const big = i === 0;
    const top = columnTop + rowHeight * i;
    ctx.font = `400 ${24 * fit}px ${FONT}`;
    ctx.fillStyle = pen.label;
    ctx.textAlign = 'right';
    ctx.fillText(row.label, textX, top + rowHeight * 0.15);

    pair(ctx, row, (big ? 56 : 42) * fit, (big ? 26 : 21) * fit, top + rowHeight * 0.55, textX, pen);

    if (i < rows.length - 1) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = pen.hair;
      ctx.beginPath();
      ctx.moveTo(rule + 20, top + rowHeight);
      ctx.lineTo(textX, top + rowHeight);
      ctx.stroke();
      if (pen.shadow) ctx.shadowBlur = 10;
    }
  });

  ctx.shadowBlur = 0;
  ctx.textAlign = 'left';
}

/**
 * The landscape page: one heading, then a 2 x 2 grid centred on its own two columns.
 *
 * The heading is set at the tuned size and measured afterwards -- only a genuinely long ride gets scaled back,
 * so it never runs into the track. It carries no name: the number is large enough to say what it is, and a word
 * beneath would compete with the four names under the grid.
 *
 * Each cell of the grid is centred on its column axis, number and name together, so the pair reads as one item
 * rather than a left-aligned list. Nothing is underlined or boxed: the spacing separates the cells, and a grid
 * of rules would make the block look like a table.
 */
function figures(ctx, rows, box, pen) {
  const { pad, gapX, cellWidth, cellHeight, gapY, gridTop, valueSize, cellLabelSize } = box;

  if (pen.shadow) {
    ctx.shadowColor = pen.shadow;
    ctx.shadowBlur = 10;
  }

  const [head, ...rest] = rows;
  let size = box.distanceSize;
  ctx.font = `500 ${size}px ${FONT}`;
  const room = box.columnWidth;
  const wide = ctx.measureText(head.value).width + (head.unit ? size * 0.14 + box.unitSize : 0);
  if (wide > room) size = Math.floor(size * (room / wide));
  leftPair(ctx, head, size, box.unitSize, box.distanceTop + size * 0.78, pad, pen);

  // One size for the whole grid, set by the widest of the four: a clock is eight characters and would
  // otherwise run into the cell beside it. They stay equal to each other -- four sizes of number would read
  // as four kinds of number.
  const wide4 = Math.max(0, ...rest.map((row) => widthOf(ctx, row, valueSize, valueSize * 0.5)));
  const gridSize = wide4 > cellWidth ? Math.floor(valueSize * (cellWidth / wide4)) : valueSize;
  const firstCentre = pad + cellWidth / 2;

  rest.forEach((row, i) => {
    const cx = firstCentre + (i % 2) * (cellWidth + gapX);
    const top = gridTop + Math.floor(i / 2) * (cellHeight + gapY);
    const baseline = top + gridSize * 0.78;
    centredPair(ctx, row, gridSize, gridSize * 0.5, baseline, cx, pen);
    ctx.font = `400 ${cellLabelSize}px ${FONT}`;
    ctx.fillStyle = pen.faint;
    ctx.textAlign = 'center';
    ctx.fillText(row.label, cx, baseline + cellLabelSize * 1.75);
  });

  ctx.shadowBlur = 0;
  ctx.textAlign = 'left';
}

/**
 * Draws the whole overlay and returns the canvas.
 *
 * `segments` is an array of point arrays ({lat, lon, ele}); `rows` is what the figures show, already
 * formatted, so the drawing code knows nothing about languages or units. `ends` are the two words in the
 * start and end badges, and `size` / `scrim` / `ink` are the three settings the panel offers.
 */
export function drawOverlay({ segments, rows, ends, size, scrim, ink }) {
  const pen = PENS[ink] || PENS[DEFAULT_INK];
  const preset = presetOf(size);
  const box = layout(preset.width, preset.height);
  // The composition is 1080 wide; the file is what the photo wants. Everything below is in composition
  // pixels, so the line and the type keep their weight whatever the output size. `pixels` is the long edge,
  // which is the height for the three portrait shapes and the width for the landscape one.
  const scale = preset.pixels / Math.max(preset.width, preset.height);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(box.width * scale);
  canvas.height = Math.round(box.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (scrim && scrim !== 'none') paintScrim(ctx, box, pen.wash);

  const fullLines = segments.filter((line) => line.length > 0);
  const lines = fullLines.map(decimate);
  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const line of fullLines) {
    for (const p of line) {
      if (p.ele === undefined) continue;
      if (p.ele < minEle) minEle = p.ele;
      if (p.ele > maxEle) maxEle = p.ele;
    }
  }
  const flat = !Number.isFinite(minEle) || !Number.isFinite(maxEle);

  if (lines.length > 0) {
    const to = projector(fullLines, box.track);
    const placed = lines
      .map((line) => simplifyPath(line.map((p) => ({ ...p, xy: to(p) }))))
      .filter((line) => line.length > 0);
    paintRoute(ctx, placed, minEle, maxEle, flat);
    const firstLine = placed[0].map((p) => p.xy);
    const lastLine = placed[placed.length - 1].map((p) => p.xy);
    const [start, end] = separate(badgeAt(firstLine, false), badgeAt(lastLine, true), 40);
    badge(ctx, start, '#2ecc40', ends.start);
    badge(ctx, end, '#ff2d00', ends.end);
  }

  if (box.row) figures(ctx, rows, box, pen);
  else column(ctx, rows, box, pen);
  return canvas;
}
