#!/usr/bin/env node
// ============================================================================
// Bulu's atlas, rebuilt from the authoring renders in docs/pet-sources/:
//
//   bulu-actions.webp   16 frames x 5 rows, 192 px cells — the five right-click
//                       actions (rows 0-4), each assembled from a 4x4 sheet in
//                       docs/pet-sources/bulu-actions/.
//
// Why 192: the pet is drawn at 132 CSS px (x devicePixelRatio, up to ~1.6x with
// the size setting), so a 64 px frame would be stretched 2.6-4.1x and look soft.
//
// bulu.png uses the idle and walking poses from the original "默认状态" sheet.
// Sleep and click still use the old 64 px source because their complete frame
// sequences have not been recovered.
//
// The five action sheets were drawn in a different pass than the default pose
// and arrived with a heavy black contour, a darker palette and a hard alpha
// edge, so the pet changed style the moment an action played. `cleanSilhouette`
// and the tone match below put them back on the default pose's rendering.
//
// src/renderer/lite-app.ts derives everything from the image: the sheet cell is
// `naturalWidth / 4`, and an atlas row is `ACTION_FRAMES` wide.
//
//   npm run bulu-art
//
// The outputs are committed; this only runs when the art changes.
// ============================================================================
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'docs', 'pet-sources');
const actionSourceDir = path.join(sourceDir, 'bulu-actions');
const sheetOutput = path.join(root, 'src', 'assets', 'animated-pets', 'bulu.png');
const actionOutput = path.join(root, 'src', 'assets', 'animated-pets', 'bulu-actions.webp');
const actionPreview = path.join(sourceDir, 'bulu-actions-preview.png');
const walkPreview = path.join(sourceDir, 'bulu-walk-preview.png');

/**
 * Atlas rows, in the order the renderer indexes them. Keep in sync with
 * `actionRows` (rows 0-4) in src/renderer/lite-app.ts.
 */
const ACTIONS = [
  { id: 'wave', source: '挥爪子-修正版2' },
  { id: 'groom', source: '舔爪子-修正版' },
  { id: 'stretch', source: '伸懒腰' },
  { id: 'yawn', source: '打哈欠' },
  { id: 'scratch', source: '挠头-修正版2' },
];
/** The static default pose, taken from frame 0 of this 4x4 sheet. */
const IDLE_SHEET = '默认状态';
/**
 * Where the walking row comes from, and which cells of that sheet are played.
 *
 * `走路` is a dedicated sixteen-cell stride sheet and the preferred source, but
 * it is *not* in use: every one of its cells is the same mid-stride pose with all
 * four feet planted — there is no swing phase anywhere in the sheet, so looping
 * four of them reads as the pet gliding rather than walking (measured: the
 * lowest opaque pixel moves by under 5% between cells).
 *
 * Until a sheet with a real stride arrives, the row falls back to the four
 * walking poses in the default-pose sheet — what shipped before this change, and
 * the best of the two: its front legs visibly stride, its hind pair barely does.
 *
 * To switch to the dedicated sheet, use `{ sheet: '走路', order: [0, 1, 2, 3] }`.
 */
const WALK_SOURCE = { sheet: IDLE_SHEET, order: [4, 5, 6, 7] };

const COLS = 4;
const ROWS = 4;
const FRAMES = COLS * ROWS;
const CELL = 192;
/** Cell padding, proportional to the old 3 px on a 64 px cell. */
const PAD = 10;
/**
 * How much of a cell the idle art filled in the original 64 px sheet. The rebuild
 * matches it so the pet does not change size. Measured once; not read back
 * from the sheet we replace.
 */
const IDLE_HEIGHT_RATIO = 0.906;
const ACTION_ART_WIDTH = 176;
const ACTION_ART_HEIGHT = 178;
/** Distance from the cell bottom the action art sits on, so poses do not jump. */
const ART_BASELINE = 4;
/**
 * The walking art is much wider than it is tall, so it gets its own box. The
 * numbers keep the cat the same on-screen size and height as the walk row this
 * replaces: ~190 px wide inside the 192 px cell, with its feet 13 px above the
 * cell bottom.
 */
const WALK_ART_WIDTH = 190;
const WALK_ART_HEIGHT = 184;
const WALK_BASELINE = 13;
/**
 * Background key tolerance for the walk sheet, far below the actions' 34.
 *
 * The action sheets carry a stroked outline that stops the border flood fill.
 * This art has none and its white fur sits directly against the white ground, so
 * at 34 the fill walks straight through the fur and punches holes under the chin
 * — which read as black fur on a dark desktop.
 */
const WALK_KEY_TOLERANCE = 14;
/**
 * Outer band to drop from the walk silhouette, in source pixels. It is the
 * antialiased mix of fur and white ground; removing it, and letting
 * `cleanSilhouette` bleed interior colour into what is left, is what keeps the
 * pet from wearing a white halo. There is no stroked contour here, so the band
 * is thin.
 */
const WALK_ERODE = 2;

// ---------- shared background/geometry helpers ----------

/** Remove a flat background, seeded from the borders (same idea as cutout.rs). */
function keyOutBackground(rgba, width, height, tolerance = 34, feather = 2) {
  const reference = [0, 1, 2].map((channel) => {
    const samples = [];
    for (let x = 0; x < width; x++) {
      samples.push(rgba[x * 4 + channel], rgba[((height - 1) * width + x) * 4 + channel]);
    }
    for (let y = 1; y < height - 1; y++) {
      samples.push(rgba[y * width * 4 + channel], rgba[(y * width + width - 1) * 4 + channel]);
    }
    samples.sort((a, b) => a - b);
    return samples[samples.length >> 1];
  });

  const limit = 3 * tolerance * tolerance;
  const total = width * height;
  const background = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  const nearBackground = (index) => {
    const offset = index * 4;
    const dr = rgba[offset] - reference[0];
    const dg = rgba[offset + 1] - reference[1];
    const db = rgba[offset + 2] - reference[2];
    return dr * dr + dg * dg + db * db <= limit;
  };
  const seed = (index) => {
    if (!background[index] && nearBackground(index)) {
      background[index] = 1;
      stack[top++] = index;
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (top > 0) {
    const index = stack[--top];
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) seed(index - 1);
    if (x + 1 < width) seed(index + 1);
    if (y > 0) seed(index - width);
    if (y + 1 < height) seed(index + width);
  }

  let removed = 0;
  for (let i = 0; i < total; i++) if (background[i]) removed++;
  let alpha = new Float32Array(total);
  for (let i = 0; i < total; i++) alpha[i] = background[i] ? 0 : 255;
  if (feather > 0) alpha = boxBlur(alpha, width, height, feather);

  const out = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i++) {
    out[i * 4] = rgba[i * 4];
    out[i * 4 + 1] = rgba[i * 4 + 1];
    out[i * 4 + 2] = rgba[i * 4 + 2];
    out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(alpha[i])));
  }
  return { buffer: out, removed, total };
}

function boxBlur(source, width, height, radius) {
  const temp = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x < Math.min(radius, width - 1) + 1; x++) sum += source[row + x];
    for (let x = 0; x < width; x++) {
      if (x > 0) {
        if (x + radius < width) sum += source[row + x + radius];
        if (x - radius - 1 >= 0) sum -= source[row + x - radius - 1];
      }
      const count = Math.min(radius, x) + Math.min(radius, width - 1 - x) + 1;
      temp[row + x] = sum / count;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < Math.min(radius, height - 1) + 1; y++) sum += temp[y * width + x];
    for (let y = 0; y < height; y++) {
      if (y > 0) {
        if (y + radius < height) sum += temp[(y + radius) * width + x];
        if (y - radius - 1 >= 0) sum -= temp[(y - radius - 1) * width + x];
      }
      const count = Math.min(radius, y) + Math.min(radius, height - 1 - y) + 1;
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

/** Visible pixels of one buffer, plus how many there are. */
function visibleBounds(buffer, width, height) {
  let left = width, top = height, right = -1, bottom = -1, opaque = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (buffer[(y * width + x) * 4 + 3] <= 16) continue;
      opaque++;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < left
    ? { empty: true, opaque, left: 0, top: 0, width: 0, height: 0 }
    : { empty: false, opaque, left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** Uniform grid boxes: the sheets are regular even when the side is not divisible. */
function gridCells(width, height, cols, rows) {
  const boxes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const left = Math.round((c * width) / cols);
      const right = Math.round(((c + 1) * width) / cols);
      const top = Math.round((r * height) / rows);
      const bottom = Math.round(((r + 1) * height) / rows);
      boxes.push({ left, top, width: right - left, height: bottom - top });
    }
  }
  return boxes;
}

/**
 * Drop everything but the subject blob.
 *
 * The sheets come from an image model that lays the frames out itself, so a cell
 * regularly contains a sliver of the neighbouring pose (or a speck of dust). Any
 * of those that is not connected to the subject is removed here; the surviving
 * pixels keep their exact position, so the motion inside a loop is untouched.
 */
function keepLargestComponent(data, width, height) {
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let best = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || data[start * 4 + 3] < 24) continue;
    let head = 0;
    let tail = 0;
    const component = [];
    seen[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const p = queue[head++];
      component.push(p);
      const x = p % width;
      const y = Math.floor(p / width);
      const visit = (n) => {
        if (!seen[n] && data[n * 4 + 3] >= 24) {
          seen[n] = 1;
          queue[tail++] = n;
        }
      };
      if (x > 0) visit(p - 1);
      if (x + 1 < width) visit(p + 1);
      if (y > 0) visit(p - width);
      if (y + 1 < height) visit(p + width);
    }
    if (component.length > best.length) best = component;
  }
  const keep = new Uint8Array(width * height);
  for (const p of best) keep[p] = 1;
  // Put two pixels of antialiased edge back around the solid component.
  for (let pass = 0; pass < 2; pass++) {
    const next = keep.slice();
    for (let p = 0; p < width * height; p++) {
      if (!keep[p]) continue;
      const x = p % width;
      const y = Math.floor(p / width);
      if (x > 0) next[p - 1] = 1;
      if (x + 1 < width) next[p + 1] = 1;
      if (y > 0) next[p - width] = 1;
      if (y + 1 < height) next[p + width] = 1;
    }
    keep.set(next);
  }
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (!keep[p] || data[i + 3] === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }
}

/**
 * The action sheets were rendered in a different pass than the default pose and
 * they show it: every one of them carries a heavy near-black contour stroked
 * along the whole silhouette (20% of their pixels are near-black, against 1.1%
 * for the default pose), a darker, more saturated palette, and a hard alpha
 * edge whose un-premultiplied fringe reads as a grey halo on a desktop.
 *
 * This four-step pass makes them read like the default pose without touching
 * the motion, so the pet keeps the same animation and the same size:
 *
 *   1. erode   — drop the contour band, which sits *on* the silhouette;
 *   2. bleed   — push interior colour out into the alpha fringe, so no dark
 *                rim survives compositing over a wallpaper;
 *   3. feather — soften the cut edge the way the default pose's is soft;
 *   4. match   — pull the tonal curve and saturation onto the default pose's.
 *
 * Steps 1-3 are local; step 4 is measured once per sheet so all 16 frames of an
 * action move together instead of flickering.
 */

/** Silhouette band to drop, as a share of the cell. Measured on the 1254 px sheets. */
const CONTOUR_ERODE_RATIO = 0.024;
/** Feather width on the cut edge, in cell pixels. */
const CONTOUR_FEATHER = 2;
/** The default pose's near-black share; the outline pass must land near it. */
const DEFAULT_NEAR_BLACK = 0.011;
/** Quantiles the tonal match pins together. */
const TONE_ANCHORS = [0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 0.98];
/** How much of the measured tonal / saturation correction to apply. */
const TONE_STRENGTH = 0.85;
const SATURATION_STRENGTH = 0.7;

const pixelLuma = (data, p) => {
  const i = p * 4;
  return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
};

const pixelSaturation = (data, p) => {
  const i = p * 4;
  const max = Math.max(data[i], data[i + 1], data[i + 2]);
  if (max === 0) return 0;
  return (max - Math.min(data[i], data[i + 1], data[i + 2])) / max;
};

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[index];
}

/** Distance from every pixel to the transparent region, capped at `cap`. */
function edgeDepth(data, width, height, cap) {
  const count = width * height;
  const depth = new Int16Array(count).fill(cap);
  let frontier = [];
  for (let p = 0; p < count; p++) {
    if (data[p * 4 + 3] < 24) {
      depth[p] = 0;
      frontier.push(p);
    }
  }
  for (let d = 1; d < cap && frontier.length; d++) {
    const next = [];
    for (const p of frontier) {
      const x = p % width;
      const y = (p - x) / width;
      const visit = (n) => {
        if (depth[n] === cap) {
          depth[n] = d;
          next.push(n);
        }
      };
      if (x > 0) visit(p - 1);
      if (x + 1 < width) visit(p + 1);
      if (y > 0) visit(p - width);
      if (y + 1 < height) visit(p + width);
    }
    frontier = next;
  }
  return depth;
}

/**
 * Drop the stroked contour, soften the cut edge, and let the interior colour run
 * out into the fringe. The order is what makes it work: the contour has to go
 * before the bleed (or the bleed samples the contour), and the bleed has to come
 * after the feather (or the pixels the feather uncovers — transparent black —
 * composite as a dark rim).
 */
function cleanSilhouette(data, width, height, erode, feather) {
  const count = width * height;
  const depth = edgeDepth(data, width, height, erode + 2 + feather);
  const opaque = new Float32Array(count);
  for (let p = 0; p < count; p++) {
    opaque[p] = depth[p] > erode ? 255 : 0;
    if (opaque[p] === 0) data[p * 4 + 3] = 0;
  }

  // Blur the coverage mask, never the source alpha: blurring the original would
  // smear the contour back across the silhouette we just cleaned.
  const soft = boxBlur(opaque, width, height, feather);
  for (let p = 0; p < count; p++) {
    data[p * 4 + 3] = Math.max(0, Math.min(255, Math.round(Math.max(opaque[p], soft[p]))));
  }

  // Nearest fully opaque pixel, by BFS, for every partly transparent pixel.
  const donor = new Int32Array(count).fill(-1);
  const queue = new Int32Array(count);
  let head = 0, tail = 0;
  for (let p = 0; p < count; p++) {
    if (data[p * 4 + 3] >= 250) {
      donor[p] = p;
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const y = (p - x) / width;
    const spread = (n) => {
      if (donor[n] !== -1 || data[n * 4 + 3] === 0) return;
      donor[n] = donor[p];
      queue[tail++] = n;
    };
    if (x > 0) spread(p - 1);
    if (x + 1 < width) spread(p + 1);
    if (y > 0) spread(p - width);
    if (y + 1 < height) spread(p + width);
  }
  for (let p = 0; p < count; p++) {
    if (data[p * 4 + 3] === 0 || donor[p] < 0 || donor[p] === p) continue;
    const from = donor[p] * 4;
    const to = p * 4;
    data[to] = data[from];
    data[to + 1] = data[from + 1];
    data[to + 2] = data[from + 2];
  }

  // The contour is thicker at the zig-zag vertices of the fur than the flat
  // erode assumes, leaving dark flecks just inside the new edge. Anything this
  // close to the silhouette that is far darker than its own neighbourhood is
  // leftover outline, not fur.
  const radius = Math.max(4, Math.round(erode * 0.8));
  if (radius > 0) {
    const planes = [0, 1, 2].map((channel) => {
      const plane = new Float32Array(count);
      for (let p = 0; p < count; p++) plane[p] = (data[p * 4 + channel] * data[p * 4 + 3]) / 255;
      return boxBlur(plane, width, height, radius);
    });
    const coverage = new Float32Array(count);
    for (let p = 0; p < count; p++) coverage[p] = data[p * 4 + 3] / 255;
    const blurredCoverage = boxBlur(coverage, width, height, radius);
    for (let p = 0; p < count; p++) {
      if (data[p * 4 + 3] < 200) continue;
      if (depth[p] > erode + radius) continue;
      if (blurredCoverage[p] < 0.5) continue;
      const local = planes.map((plane) => plane[p] / blurredCoverage[p]);
      const localLuma = local[0] * 0.299 + local[1] * 0.587 + local[2] * 0.114;
      if (pixelLuma(data, p) >= localLuma * 0.6) continue;
      const to = p * 4;
      for (let c = 0; c < 3; c++) {
        data[to + c] = Math.max(0, Math.min(255, Math.round(local[c])));
      }
    }
  }
}

/**
 * Measure the palette a sheet should read like. Run on the default pose, whose
 * frame 0 is also the idle art, so "the style the pet rests in" is literally
 * the target.
 */
async function measureStyle(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lumas = [];
  const sats = [];
  let nearBlack = 0;
  let subject = 0;
  for (let p = 0; p < info.width * info.height; p++) {
    if (data[p * 4 + 3] < 64) continue;
    subject++;
    const luma = pixelLuma(data, p);
    lumas.push(luma);
    sats.push(pixelSaturation(data, p));
    if (luma < 80) nearBlack++;
  }
  lumas.sort((a, b) => a - b);
  sats.sort((a, b) => a - b);
  return {
    lumas,
    meanSaturation: sats.reduce((sum, value) => sum + value, 0) / Math.max(1, sats.length),
    nearBlackShare: nearBlack / Math.max(1, subject),
  };
}

/** Piecewise-linear, monotone tone map from one sheet's quantiles to another's. */
function toneLut(from, to, strength) {
  const source = TONE_ANCHORS.map((q) => quantile(from.lumas, q));
  const target = TONE_ANCHORS.map((q) => quantile(to.lumas, q));
  const lut = new Uint8Array(256);
  for (let value = 0; value < 256; value++) {
    let mapped;
    if (value <= source[0]) {
      mapped = target[0] + (value - source[0]);
    } else if (value >= source[source.length - 1]) {
      mapped = target[target.length - 1] + (value - source[source.length - 1]);
    } else {
      let i = 0;
      while (i < source.length - 2 && value > source[i + 1]) i++;
      const span = Math.max(1, source[i + 1] - source[i]);
      const t = (value - source[i]) / span;
      mapped = target[i] + (target[i + 1] - target[i]) * t;
    }
    lut[value] = Math.max(0, Math.min(255, Math.round(value + (mapped - value) * strength)));
  }
  return lut;
}

/** Apply one sheet's tone map + saturation, so all 16 frames move together. */
function applyStyle(cells, lut, saturationGain) {
  for (const cell of cells) {
    if (!cell) continue;
    const { data } = cell;
    for (let p = 0; p < data.length / 4; p++) {
      const i = p * 4;
      if (data[i + 3] === 0) continue;
      const luma = pixelLuma(data, p);
      if (luma <= 0.5) continue;
      const target = lut[Math.min(255, Math.round(luma))];
      const scale = target / luma;
      const grey = target;
      for (let c = 0; c < 3; c++) {
        const lifted = data[i + c] * scale;
        data[i + c] = Math.max(0, Math.min(255, Math.round(grey + (lifted - grey) * saturationGain)));
      }
    }
  }
}

/**
 * A checkerboard plus row labels, for eyeballing a build. `labels` is indexed by
 * grid row; entries that are empty strings print nothing.
 */
function contactSheet({ height, rows, cols, labels, thumb, labelWidth }) {
  const width = labelWidth + cols * thumb;
  const lines = [];
  for (let i = 0; i < Math.ceil(width / 20); i++) {
    for (let j = 0; j < Math.ceil(height / 20); j++) {
      if ((i + j) % 2) lines.push(`<rect x="${i * 20}" y="${j * 20}" width="20" height="20" fill="#e6eaf0"/>`);
    }
  }
  for (let r = 0; r <= rows; r++) lines.push(`<line x1="0" y1="${r * thumb}" x2="${width}" y2="${r * thumb}" stroke="#c9d2de"/>`);
  labels.forEach((label, i) => {
    if (!label) return;
    lines.push(`<text x="12" y="${i * thumb + thumb / 2}" font-family="Segoe UI, sans-serif" font-size="15" fill="#3a4a5e">${label}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="100%" height="100%" fill="#f4f6f9"/>${lines.join('')}</svg>`;
}

/**
 * The walking row, rebuilt from its own sheet.
 *
 * Same shape as `actionFrames`: an opaque sheet is keyed from its borders, every
 * cell keeps only its subject, the cut edge is bled so no white fringe survives
 * compositing over a wallpaper, and all frames share one crop so the stride
 * inside the loop is not re-centred frame by frame. Walking is far wider than it
 * is tall, so it gets its own box instead of the action one.
 *
 * It also writes `bulu-walk-preview.png`: the sixteen source cells after keying,
 * left to right and top to bottom, which is exactly how `WALK_SOURCE.order`
 * indexes them.
 */
async function walkRow(reference) {
  const file = resolveActionSource(WALK_SOURCE.sheet);
  const { data: raw, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const opaqueShare = visibleBounds(raw, info.width, info.height).opaque / (info.width * info.height);
  let source = raw;
  if (opaqueShare > 0.97) {
    const cut = keyOutBackground(raw, info.width, info.height, WALK_KEY_TOLERANCE);
    if (cut.removed < cut.total * 0.05) {
      throw new Error(`${path.basename(file)}: the background keying removed almost nothing`);
    }
    source = cut.buffer;
  }

  const cells = gridCells(info.width, info.height, COLS, ROWS);
  const staged = [];
  for (const box of cells) {
    const { data, info: cellInfo } = await sharp(source, {
      raw: { width: info.width, height: info.height, channels: 4 },
    }).extract(box).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    keepLargestComponent(data, cellInfo.width, cellInfo.height);
    cleanSilhouette(data, cellInfo.width, cellInfo.height, WALK_ERODE, CONTOUR_FEATHER);
    staged.push({ data, info: cellInfo });
  }

  const chosen = WALK_SOURCE.order.map((index) => {
    const cell = staged[index];
    if (!cell) throw new Error(`${WALK_SOURCE.sheet}: there is no cell ${index}`);
    return cell;
  });
  let union = null;
  for (const cell of chosen) {
    const visible = visibleBounds(cell.data, cell.info.width, cell.info.height);
    if (visible.empty) throw new Error(`${WALK_SOURCE.sheet}: a chosen cell is empty`);
    const right = visible.left + visible.width - 1;
    const bottom = visible.top + visible.height - 1;
    union = {
      left: Math.min(union?.left ?? visible.left, visible.left),
      top: Math.min(union?.top ?? visible.top, visible.top),
      right: Math.max(union?.right ?? right, right),
      bottom: Math.max(union?.bottom ?? bottom, bottom),
    };
  }
  const cellWidth = Math.min(...cells.map((cell) => cell.width));
  const cellHeight = Math.min(...cells.map((cell) => cell.height));
  const crop = {
    left: Math.max(0, Math.min(union.left, cellWidth - 1)),
    top: Math.max(0, Math.min(union.top, cellHeight - 1)),
  };
  crop.width = Math.max(1, Math.min(union.right - crop.left + 1, cellWidth - crop.left));
  crop.height = Math.max(1, Math.min(union.bottom - crop.top + 1, cellHeight - crop.top));

  const frames = [];
  for (const cell of chosen) {
    frames.push(await sharp(cell.data, { raw: cell.info }).extract(crop)
      .resize({ width: WALK_ART_WIDTH, height: WALK_ART_HEIGHT, fit: 'inside', kernel: sharp.kernel.lanczos3 })
      .sharpen({ sigma: 0.7, m1: 0.4, m2: 1.5, x1: 2, y2: 12, y3: 20 })
      .raw().toBuffer({ resolveWithObject: true }));
  }

  // One tone map for the whole row, measured after keying, so the pet does not
  // change colour the moment it starts to walk.
  const lumas = [];
  const sats = [];
  for (const { data } of frames) {
    for (let p = 0; p < data.length / 4; p++) {
      if (data[p * 4 + 3] < 64) continue;
      lumas.push(pixelLuma(data, p));
      sats.push(pixelSaturation(data, p));
    }
  }
  lumas.sort((a, b) => a - b);
  const meanSaturation = sats.reduce((sum, value) => sum + value, 0) / Math.max(1, sats.length);
  applyStyle(frames, toneLut({ lumas }, reference, TONE_STRENGTH),
    1 + (reference.meanSaturation / Math.max(1e-3, meanSaturation) - 1) * SATURATION_STRENGTH);

  // The picker: every source cell, keyed and cropped to its own silhouette, laid
  // out in reading order so the stride (if the sheet really is one) is easy to
  // follow. `WALK_ORDER` indexes exactly this sequence.
  const thumb = 300;
  const previewCols = 8;
  const labelWidth = 90;
  const labels = Array.from({ length: Math.ceil(FRAMES / previewCols) }, (_, row) =>
    `#${row * previewCols}..${row * previewCols + previewCols - 1}`);
  const previewPieces = [{
    input: Buffer.from(contactSheet({
      height: labels.length * thumb, rows: labels.length, cols: previewCols, labels, thumb, labelWidth,
    })),
    left: 0,
    top: 0,
  }];
  for (const [index, cell] of staged.entries()) {
    const visible = visibleBounds(cell.data, cell.info.width, cell.info.height);
    if (visible.empty) continue;
    const small = await sharp(cell.data, { raw: cell.info })
      .extract({ left: visible.left, top: visible.top, width: visible.width, height: visible.height })
      .resize({ width: thumb - 16, height: thumb - 36, fit: 'inside' }).png().toBuffer();
    const meta = await sharp(small).metadata();
    previewPieces.push({
      input: small,
      left: labelWidth + (index % previewCols) * thumb + Math.floor((thumb - meta.width) / 2),
      top: Math.floor(index / previewCols) * thumb + 26,
    });
  }
  await sharp({ create: { width: labelWidth + previewCols * thumb, height: labels.length * thumb, channels: 4, background: '#00000000' } })
    .composite(previewPieces).png().toFile(walkPreview);

  const biggest = frames.reduce((size, { data, info: frameInfo }) => {
    const visible = visibleBounds(data, frameInfo.width, frameInfo.height);
    return { width: Math.max(size.width, visible.width), height: Math.max(size.height, visible.height) };
  }, { width: 0, height: 0 });
  console.log(`✓ ${path.relative(root, walkPreview)}  （${WALK_SOURCE.sheet} 的 ${FRAMES} 格，行优先编号；本行取 ${WALK_SOURCE.order.join(', ')}）`);
  console.log(`  走路帧: 裁切 ${crop.width}x${crop.height} → 最大 ${biggest.width}x${biggest.height} px（格 ${CELL}）`);
  return { frames };
}

// ---------- 1. the base sheet (idle / walk / sleep / click) ----------

async function buildSheet(reference) {
  // Sleep / click have no matching animation sources yet, so only those two
  // rows are carried over. Idle comes from the default pose, walking from its own
  // stride sheet.
  const previous = await sharp(sheetOutput).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const previousCell = Math.round(previous.info.width / COLS);
  const composites = [];
  for (let row = 2; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = await sharp(previous.data, { raw: previous.info })
        .extract({ left: col * previousCell, top: row * previousCell, width: previousCell, height: previousCell })
        .png().toBuffer();
      composites.push({
        input: await sharp(cell).resize(CELL, CELL, { kernel: sharp.kernel.lanczos3 }).png().toBuffer(),
        left: col * CELL,
        top: row * CELL,
      });
    }
  }

  // Row 1 is the walking cycle, which has a sheet of its own (see `walkRow`).
  const walk = await walkRow(reference);
  for (const [index, frame] of walk.frames.entries()) {
    composites.push({
      input: await sharp(frame.data, { raw: frame.info }).png().toBuffer(),
      left: index * CELL + Math.floor((CELL - frame.info.width) / 2),
      top: CELL + Math.max(0, CELL - WALK_BASELINE - frame.info.height),
    });
  }

  // Idle is a *still* pose: the pet must not move on its own, so all four frames
  // hold the same art (frame 0 of the default-pose sheet). Only walking — auto-walk
  // or dragging — plays an animation.
  const idleSheet = await sharp(resolveActionSource(IDLE_SHEET)).ensureAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  const cells = gridCells(idleSheet.info.width, idleSheet.info.height, COLS, ROWS);
  const first = cells[0];
  const { data, info: frameInfo } = await sharp(idleSheet.data, { raw: idleSheet.info })
    .extract(first).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  keepLargestComponent(data, frameInfo.width, frameInfo.height);
  const bounds = visibleBounds(data, frameInfo.width, frameInfo.height);
  if (bounds.empty) throw new Error(`${IDLE_SHEET}: frame 0 of the default pose is empty`);
  const posed = await sharp(data, { raw: frameInfo }).extract({
    left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
  }).png().toBuffer();
  const posedMeta = await sharp(posed).metadata();
  const scale = Math.min(
    (IDLE_HEIGHT_RATIO * CELL) / posedMeta.height,
    (CELL - PAD * 2) / posedMeta.width,
  );
  const width = Math.max(1, Math.round(posedMeta.width * scale));
  const height = Math.max(1, Math.round(posedMeta.height * scale));
  const idle = await sharp(posed).resize(width, height, { kernel: sharp.kernel.lanczos3 }).png().toBuffer();
  for (let col = 0; col < COLS; col++) {
    composites.push({ input: idle, left: col * CELL + Math.round((CELL - width) / 2), top: CELL - PAD - height });
  }

  mkdirSync(path.dirname(sheetOutput), { recursive: true });
  await sharp({ create: { width: CELL * COLS, height: CELL * ROWS, channels: 4, background: '#00000000' } })
    .composite(composites).png({ compressionLevel: 9 }).toFile(sheetOutput);
  const meta = await sharp(sheetOutput).metadata();
  if (meta.width !== CELL * COLS || meta.height !== CELL * ROWS || !meta.hasAlpha) {
    throw new Error(`Invalid Bulu base sheet: ${meta.width}x${meta.height}`);
  }
  console.log(`✓ ${path.relative(root, sheetOutput)}  (${meta.width}x${meta.height}, 每格 ${CELL}px, ` +
    `idle 静止帧 ${width}x${height}, ${statSync(sheetOutput).size} bytes)`);
}

// ---------- 2. the action atlas ----------

function resolveActionSource(name) {
  const hit = readdirSync(actionSourceDir).find((file) =>
    path.parse(file).name === name && /\.(png|jpe?g|webp)$/i.test(file));
  if (!hit) throw new Error(`Missing Bulu source sheet "${name}" in ${actionSourceDir}`);
  return path.join(actionSourceDir, hit);
}

async function actionFrames(file, label, reference) {
  const { data: raw, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const opaqueShare = visibleBounds(raw, info.width, info.height).opaque / (info.width * info.height);
  const keyed = opaqueShare > 0.97;
  let source = raw;
  if (keyed) {
    const cut = keyOutBackground(raw, info.width, info.height);
    // A failed keying looks like "almost nothing was removed".
    if (cut.removed < cut.total * 0.05) {
      throw new Error(`${path.basename(file)}: the background keying removed almost nothing`);
    }
    source = cut.buffer;
  }

  const cells = gridCells(info.width, info.height, COLS, ROWS);
  const erode = Math.max(3, Math.round(Math.min(...cells.map((cell) => cell.width)) * CONTOUR_ERODE_RATIO));
  const staged = [];
  const frames = [];
  let union = null;
  for (const box of cells) {
    const { data, info: cellInfo } = await sharp(source, {
      raw: { width: info.width, height: info.height, channels: 4 },
    }).extract(box).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // The model's own 4x4 layout drifts a little, so a cell can carry a piece of
    // the neighbouring pose; keep only the subject.
    keepLargestComponent(data, cellInfo.width, cellInfo.height);
    cleanSilhouette(data, cellInfo.width, cellInfo.height, erode, CONTOUR_FEATHER);
    const visible = visibleBounds(data, cellInfo.width, cellInfo.height);
    if (visible.empty) { staged.push(null); continue; }
    const right = visible.left + visible.width - 1;
    const bottom = visible.top + visible.height - 1;
    union = {
      left: Math.min(union?.left ?? visible.left, visible.left),
      top: Math.min(union?.top ?? visible.top, visible.top),
      right: Math.max(union?.right ?? right, right),
      bottom: Math.max(union?.bottom ?? bottom, bottom),
    };
    staged.push({ data, info: cellInfo });
  }
  if (!union) throw new Error(`${label}: every cell of the sheet is transparent`);

  // The sheet side is not divisible by four, so the last column / row is a pixel
  // narrower; one shared crop box has to fit inside the smallest cell.
  const cellWidth = Math.min(...cells.map((cell) => cell.width));
  const cellHeight = Math.min(...cells.map((cell) => cell.height));
  const crop = {
    left: Math.max(0, Math.min(union.left, cellWidth - 1)),
    top: Math.max(0, Math.min(union.top, cellHeight - 1)),
  };
  crop.width = Math.max(1, Math.min(union.right - crop.left + 1, cellWidth - crop.left));
  crop.height = Math.max(1, Math.min(union.bottom - crop.top + 1, cellHeight - crop.top));

  // Every frame uses the same crop and scale, so the motion inside the loop is
  // preserved instead of being re-centred frame by frame.
  for (const cell of staged) {
    if (!cell) {
      frames.push(null);
      continue;
    }
    frames.push(await sharp(cell.data, { raw: cell.info }).extract(crop)
      .resize({ width: ACTION_ART_WIDTH, height: ACTION_ART_HEIGHT, fit: 'inside', kernel: sharp.kernel.lanczos3 })
      .sharpen({ sigma: 0.7, m1: 0.4, m2: 1.5, x1: 2, y2: 12, y3: 20 })
      .raw().toBuffer({ resolveWithObject: true }));
  }

  // One tone map and one saturation gain for the whole sheet, measured after the
  // contour is gone, so the match sees the art the user will actually get.
  const live = frames.filter(Boolean);
  const lumas = [];
  const sats = [];
  for (const { data } of live) {
    for (let p = 0; p < data.length / 4; p++) {
      if (data[p * 4 + 3] < 64) continue;
      lumas.push(pixelLuma(data, p));
      sats.push(pixelSaturation(data, p));
    }
  }
  lumas.sort((a, b) => a - b);
  const meanSaturation = sats.reduce((sum, value) => sum + value, 0) / Math.max(1, sats.length);
  const lut = toneLut({ lumas }, reference, TONE_STRENGTH);
  const saturationGain = 1 + (reference.meanSaturation / Math.max(1e-3, meanSaturation) - 1) * SATURATION_STRENGTH;
  applyStyle(live, lut, saturationGain);

  const prepared = [];
  for (const cell of frames) {
    prepared.push(cell
      ? await sharp(cell.data, { raw: cell.info }).png().toBuffer()
      : await sharp({ create: { width: 1, height: 1, channels: 4, background: '#00000000' } }).png().toBuffer());
  }
  return { frames: prepared, keyed, crop, erode };
}

async function buildActions(reference) {
  if (!existsSync(actionSourceDir)) throw new Error(`Missing ${actionSourceDir}`);
  const rows = [];
  for (const action of ACTIONS) {
    const file = resolveActionSource(action.source);
    rows.push({ action, file, ...await actionFrames(file, action.id, reference) });
  }

  const pieces = [];
  for (const [row, { frames }] of rows.entries()) {
    for (const [index, frame] of frames.entries()) {
      const meta = await sharp(frame).metadata();
      pieces.push({
        input: frame,
        left: index * CELL + Math.floor((CELL - meta.width) / 2),
        top: row * CELL + CELL - ART_BASELINE - meta.height,
      });
    }
  }

  mkdirSync(path.dirname(actionOutput), { recursive: true });
  // Quality 94 rather than the old 88: the art is already soft from the source
  // renders, and lossy WebP on top of a dark contour was what read as "糊".
  await sharp({ create: { width: CELL * FRAMES, height: CELL * rows.length, channels: 4, background: '#00000000' } })
    .composite(pieces).webp({ quality: 94, effort: 6 }).toFile(actionOutput);

  const meta = await sharp(actionOutput).metadata();
  if (meta.width !== CELL * FRAMES || meta.height !== CELL * rows.length || !meta.hasAlpha) {
    throw new Error(`Invalid Bulu action atlas: ${meta.width}x${meta.height}`);
  }

  const thumb = 150;
  const labelWidth = 120;
  const sheetHeight = rows.length * COLS * thumb;
  // One label per action, printed on the second sub-row so it sits next to the grid.
  const labels = Array.from({ length: rows.length * COLS }, (_, sub) =>
    sub % COLS === 1 ? `${Math.floor(sub / COLS)}: ${rows[Math.floor(sub / COLS)].action.id}` : '');
  const svg = contactSheet({
    height: sheetHeight, rows: rows.length * COLS, cols: COLS, labels, thumb, labelWidth,
  });

  const previewPieces = [{ input: Buffer.from(svg), left: 0, top: 0 }];
  for (const [row, { frames }] of rows.entries()) {
    for (const [index, frame] of frames.entries()) {
      const small = await sharp(frame).resize({ width: thumb - 16, height: thumb - 16, fit: 'inside' }).png().toBuffer();
      const smallMeta = await sharp(small).metadata();
      previewPieces.push({
        input: small,
        left: labelWidth + (index % COLS) * thumb + Math.floor((thumb - smallMeta.width) / 2),
        top: (row * COLS + Math.floor(index / COLS)) * thumb + 8,
      });
    }
  }
  await sharp({ create: { width: labelWidth + COLS * thumb, height: sheetHeight, channels: 4, background: '#00000000' } })
    .composite(previewPieces).png().toFile(actionPreview);

  console.log(`✓ ${path.relative(root, actionOutput)}  (${meta.width}x${meta.height}, ` +
    `${FRAMES} 帧/动作, ${rows.length} 个动作, ${statSync(actionOutput).size} bytes)`);
  console.log(`  预览: ${path.relative(root, actionPreview)}  （每行一块 4x4，行顺序: ${ACTIONS.map((a) => a.id).join(' / ')}）`);
  console.log(`  基准风格: ${reference.source}  近黑占比 ${(reference.nearBlackShare * 100).toFixed(1)}%  ` +
    `平均饱和度 ${reference.meanSaturation.toFixed(3)}`);
  for (const [row, { action, file, keyed, crop, erode }] of rows.entries()) {
    console.log(`  row ${row} ${action.id.padEnd(8)} ${path.basename(file).padEnd(12)} ` +
      `抠图=${keyed ? 'yes' : 'no '}  裁切框 ${crop.width}x${crop.height}  削边 ${erode}px`);
  }
}

// The default pose doubles as the idle art, so it *is* the style to match.
const reference = { ...await measureStyle(resolveActionSource(IDLE_SHEET)), source: `${IDLE_SHEET}（默认状态）` };
await buildSheet(reference);
await buildActions(reference);
