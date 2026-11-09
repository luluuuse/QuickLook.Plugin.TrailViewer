// What the profile above the map is made of: how much the route climbs, and which stretches are steep.
//
// Recorded heights are noisy. A flat city ride that never leaves a 50 m band still adds up to a thousand
// metres of "climbing" if every wobble counts, so two filters stand between the file and the number on
// screen: a short moving average, and a switch that only commits a climb once the track has turned back
// by a threshold. Both are deliberately conservative constants, not preferences.

const SMOOTH_WINDOW = 5; // points averaged together, about 5 samples wide at the head and tail
const GAIN_THRESHOLD = 10; // metres of reversal before a climb is believed
const STEP = 25; // metres between gradient samples
const MIN_RUN = 200; // a stretch shorter than this is folded into the neighbour it sits in
const FLAT = 0.03; // |slope| below this is level
const STEEP = 0.10; // slope at or beyond this is steep

/** @typedef {import('./types.js').ElevationSample} ElevationSample */
/** @typedef {import('./types.js').ProfileData} ProfileData */
/** @typedef {import('./types.js').GroundCell} GroundCell */

/**
 * The gradient the colour scale is full at.
 *
 * Fixed rather than taken from the file on purpose: a scale that stretches to whatever the route happens
 * to contain paints a 4 % towpath as fiercely as a 25 % wall, and two profiles side by side stop being
 * comparable. 25 % is where a road stops being a road -- above it the colour simply stays at the end of the
 * scale, which is honest about what the eye is being shown.
 */
export const SLOPE_FULL = 0.25;

/** Moving average over `window` samples, shrinking at the ends instead of padding with zeros. */
/** @param {number[]} values @returns {number[]} */
export function smooth(values, window = SMOOTH_WINDOW) {
  const half = Math.floor(window / 2);
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const from = Math.max(0, i - half);
    const to = Math.min(values.length, i + half + 1);
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += values[j];
    out[i] = sum / (to - from);
  }
  return out;
}

/**
 * Ascent and descent, counting only reversals of at least `threshold` metres.
 *
 * Walking forward from a committed point, the highest point seen is remembered; the climb to it is only
 * added once the track has fallen `threshold` metres below it, which is what tells a hill from a wobble.
 */
/** @param {number[]} values @returns {{ ascent: number, descent: number }} */
export function elevationGain(values, threshold = GAIN_THRESHOLD) {
  if (values.length < 2) return { ascent: 0, descent: 0 };
  let ascent = 0;
  let descent = 0;
  let committed = values[0];
  let peak = values[0];
  let valley = values[0];
  let rising = true;
  for (let i = 1; i < values.length; i += 1) {
    const value = values[i];
    if (rising) {
      if (value > peak) peak = value;
      else if (peak - value >= threshold) {
        ascent += peak - committed;
        committed = peak;
        rising = false;
        valley = value;
      }
    } else if (value < valley) valley = value;
    else if (value - valley >= threshold) {
      descent += committed - valley;
      committed = valley;
      rising = true;
      peak = value;
    }
  }
  // A recording can stop on the climb or descent. The final extremum never reversed, but it is still
  // ground the walker covered: a route that only climbs must not report zero ascent.
  if (rising) ascent += Math.max(0, peak - committed);
  else descent += Math.max(0, committed - valley);
  return { ascent, descent };
}

/** Unfiltered cumulative changes, kept only to explain how much noise the displayed ascent removed. */
export function rawElevationGain(values) {
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    if (change > 0) ascent += change;
    else descent -= change;
  }
  return { ascent, descent };
}

/** Elevation at an arbitrary distance, straight between the two samples that bracket it. */
export function elevationAt(samples, distance) {
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (samples[mid].along <= distance) low = mid;
    else high = mid - 1;
  }
  const a = samples[low];
  const b = samples[low + 1];
  if (!b) return a.ele;
  const span = b.along - a.along;
  if (span <= 0) return a.ele;
  const t = Math.min(1, Math.max(0, (distance - a.along) / span));
  return a.ele + (b.ele - a.ele) * t;
}

/** The same route, put down at even distances so a slope can be read over a fixed run of ground. */
function resample(samples, step) {
  const total = samples[samples.length - 1].along;
  const out = [];
  let cursor = 0;
  for (let distance = 0; distance <= total; distance += step) {
    while (cursor < samples.length - 2 && samples[cursor + 1].along < distance) cursor += 1;
    const a = samples[cursor];
    const b = samples[cursor + 1] || a;
    const span = b.along - a.along;
    const t = span > 0 ? Math.min(1, Math.max(0, (distance - a.along) / span)) : 0;
    out.push({ along: distance, ele: a.ele + (b.ele - a.ele) * t });
  }
  return out;
}

/**
 * Keep the shape of a profile while bounding its SVG to the pixels that can show it. Each one-pixel column
 * contributes its lowest and highest samples, so spikes survive; consecutive columns stay in route order.
 */
export function profileSamples(samples, width = 600) {
  if (samples.length <= width * 2 + 2) return samples;
  const total = samples[samples.length - 1].along || 1;
  const buckets = new Array(width);
  for (let i = 0; i < samples.length; i += 1) {
    const bucket = Math.min(width - 1, Math.max(0, Math.floor((samples[i].along / total) * width)));
    const current = buckets[bucket];
    if (!current) {
      buckets[bucket] = { low: i, high: i };
    } else {
      if (samples[i].ele < samples[current.low].ele) current.low = i;
      if (samples[i].ele > samples[current.high].ele) current.high = i;
    }
  }

  const kept = new Set([0, samples.length - 1]);
  for (const bucket of buckets) {
    if (!bucket) continue;
    kept.add(bucket.low);
    kept.add(bucket.high);
  }
  return [...kept].sort((a, b) => a - b).map((index) => samples[index]);
}

/** @returns {GroundCell['grade']} */
function gradeOf(slope) {
  if (Math.abs(slope) < FLAT) return 'flat';
  if (slope >= STEEP) return 'steepUp';
  if (slope >= FLAT) return 'up';
  if (slope <= -STEEP) return 'steepDown';
  return 'down';
}

/**
 * The route cut into equal steps of ground, each carrying the gradient it was walked at.
 *
 * Every cell looks 50 m back and forward rather than at its own two ends, so a single noisy reading cannot
 * claim a cell; that is the same window the stretches have always been classified with, kept because it is
 * the one that held up against a route whose true gradient was known. The gradient is also what the fill
 * colour is drawn from, so the drawing gains detail without the classification losing any.
 */
export function groundCells(samples, { step = STEP } = {}) {
  if (samples.length < 2) return [];
  const grid = resample(samples, step);
  const reach = Math.max(1, Math.round(50 / step));
  const raw = [];
  for (let i = 0; i < grid.length; i += 1) {
    const from = Math.max(0, i - reach);
    const to = Math.min(grid.length - 1, i + reach);
    const span = grid[to].along - grid[from].along;
    raw.push(span > 0 ? (grid[to].ele - grid[from].ele) / span : 0);
  }
  // A second pass, along the route rather than across it. The first window already steadies a single
  // reading, but neighbouring windows still disagree by a percent or two, and a percent or two of colour is
  // a stripe: the fill came out looking like a barcode until this was added. Averaging over five cells is
  // 225 m of ground, about the shortest run the legend would name anyway.
  const slopes = smooth(raw, 9);

  const cells = [];
  for (let i = 0; i < grid.length; i += 1) {
    const start = i === 0 ? 0 : grid[i - 1].along;
    cells.push({ from: start, to: grid[i].along, slope: slopes[i], grade: gradeOf(slopes[i]) });
  }
  // The first cell would otherwise be a metre wide; the last one runs to the end of the route.
  if (cells.length) {
    cells[0].from = 0;
    cells[cells.length - 1].to = grid[grid.length - 1].along;
  }
  return cells;
}

/**
 * Contiguous stretches of one kind of ground.
 *
 * A slope per point is useless -- noise turns every sample into its own category -- so the route is first
 * laid out at 25 m intervals and each sample looks 50 m back and forward. Whatever survives that is then
 * tidied: a stretch shorter than 200 m is folded into the neighbour it sits in, because a 30 m "steep bit"
 * is a bump in the path, not a climb worth naming.
 */
export function groundRuns(samples, { step = STEP, minRun = MIN_RUN } = {}) {
  return runsFrom(groundCells(samples, { step }), minRun);
}

/** The stretches of one kind of ground, from cells that have already been laid out. */
function runsFrom(cells, minRun = MIN_RUN) {
  const raw = [];
  for (const cell of cells) {
    const last = raw[raw.length - 1];
    if (last && last.grade === cell.grade) last.to = cell.to;
    else {
      // The new stretch starts exactly where the old one stopped: a gap of one sample would show up as a
      // strip of whatever is behind the profile.
      if (last) last.to = cell.to;
      raw.push({ grade: cell.grade, from: cell.from, to: cell.to });
    }
  }
  return tidy(raw, minRun);
}

/** Folds short runs into a neighbour, then joins neighbours that ended up the same kind. */
function tidy(runs, minRun) {
  const out = [];
  let leading = null;
  for (const source of runs) {
    const run = { ...source };
    if (leading) {
      run.from = leading.from;
      leading = null;
    }

    if (out.length === 0) {
      // A short first run has no previous neighbour; fold it into the following run instead.
      if (run.to - run.from < minRun) leading = run;
      else out.push(run);
      continue;
    }

    if (run.to - run.from < minRun) out[out.length - 1].to = run.to;
    else out.push(run);
  }
  if (leading) out.push(leading);

  const joined = [];
  for (const run of out) {
    const last = joined[joined.length - 1];
    if (last && last.grade === run.grade) last.to = run.to;
    else joined.push(run);
  }
  return joined;
}

/** Everything the profile and the summary need, from samples that carry a height. */
/** @param {ElevationSample[]} samples @returns {Omit<ProfileData, 'points' | 'samples'>} */
export function analyse(samples) {
  let min = Infinity;
  let max = -Infinity;
  for (const sample of samples) {
    if (sample.ele < min) min = sample.ele;
    if (sample.ele > max) max = sample.ele;
  }
  const total = samples[samples.length - 1].along || 1;
  const gain = elevationGain(smooth(samples.map((sample) => sample.ele)));
  const rawGain = rawElevationGain(samples.map((sample) => sample.ele));
  // Laid out once and shared: the fill, the stretches and the summary all read these same cells, so the
  // legend cannot claim a gradient the picture does not show.
  const cells = groundCells(samples);
  return {
    min,
    max,
    total,
    ascent: Math.round(gain.ascent),
    descent: Math.round(gain.descent),
    rawAscent: Math.round(rawGain.ascent),
    rawDescent: Math.round(rawGain.descent),
    cells,
    runs: runsFrom(cells),
    steep: steepSummary(cells),
    slopeBins: slopeBins(cells),
  };
}

/**
 * How much of the route is steep, and the steepest ground on it.
 *
 * Both numbers come from the same smoothed cells the fill is coloured from, so "18 %" is a gradient the
 * picture shows somewhere rather than a peak the drawing has already averaged away. Eleven percent counts:
 * the threshold is where the legend has always stopped calling a climb gentle.
 */
export function steepSummary(cells) {
  let metres = 0;
  let maxSlope = 0;
  for (const cell of cells) {
    const magnitude = Math.abs(cell.slope);
    if (magnitude > maxSlope) maxSlope = magnitude;
    if (magnitude >= STEEP) metres += cell.to - cell.from;
  }
  return { metres, maxSlope };
}

/** Vertical ascent/descent in the slope bands used by the grade-aware walking estimate. */
export function slopeBins(cells) {
  const bins = {
    flatUp: 0,
    gentleUp: 0,
    steepUp: 0,
    flatDown: 0,
    gentleDown: 0,
    steepDown: 0,
  };
  const toDegrees = 180 / Math.PI;
  for (const cell of cells) {
    const length = cell.to - cell.from;
    if (!(length > 0)) continue;
    const vertical = length * Math.abs(cell.slope);
    const angle = Math.atan(Math.abs(cell.slope)) * toDegrees;
    const direction = cell.slope >= 0 ? 'Up' : 'Down';
    const band = angle < 5 ? 'flat' : angle <= 12 ? 'gentle' : 'steep';
    bins[band + direction] += vertical;
  }
  return bins;
}

// The colour scale. One band, not two: the curve already says which way the ground goes, so the colour is
// free to say how much it costs, which is the thing the eye cannot measure from a stretched drawing. It
// runs from the blue that has always meant level, through green and yellow, to the red of a wall -- cold to
// warm, in one direction of the wheel, so neighbouring cells never meet at a seam.
/** @type {Array<[number, [number, number, number]]>} */
const SCALE_STOPS = [
  [0, [58, 160, 110]], // level: a calm green, the one colour that never means "go harder"
  [0.04, [102, 181, 82]], // most of a real route lives between here and eight percent, so the ramp gives
  [0.08, [150, 196, 74]], // that stretch small steps: a large area of colour cannot carry a fast gradient
  [0.12, [224, 182, 62]], // without turning into bands
  [0.17, [230, 134, 59]], // the steep threshold, and past it
  [0.21, [224, 85, 69]], // walking pace
  [SLOPE_FULL, [201, 58, 122]], // the end of the scale, and past it
];

/** @returns {[number, number, number]} */
function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** The colour for a gradient, straight from the scale above: `slope` is a ratio, not a percentage. */
export function slopeColor(slope) {
  const magnitude = Math.min(Math.abs(slope), SLOPE_FULL);
  let colour = SCALE_STOPS[SCALE_STOPS.length - 1][1];
  for (let i = 1; i < SCALE_STOPS.length; i += 1) {
    if (magnitude > SCALE_STOPS[i][0]) continue;
    const [toT, to] = SCALE_STOPS[i];
    const [fromT, from] = SCALE_STOPS[i - 1];
    colour = mix(from, to, (magnitude - fromT) / (toT - fromT));
    break;
  }
  return `rgb(${colour[0]},${colour[1]},${colour[2]})`;
}

/** The scale itself, as stops for a gradient strip: level at one end, the wall at the other. */
export function slopeScale() {
  /** @type {Array<[number, string]>} */
  const stops = [];
  for (const [slope, colour] of SCALE_STOPS) {
    stops.push([slope / SLOPE_FULL, `rgb(${colour[0]},${colour[1]},${colour[2]})`]);
  }
  return stops;
}
