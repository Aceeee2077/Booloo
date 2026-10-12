#!/usr/bin/env node
// ============================================================================
// Bulu's airborne wriggle — the pose set the pet plays while it is flying.
//
// A thrown pet used to replay the *walk* row (row 1 of bulu.png) at double speed,
// which read as "walking in mid-air". This script builds a separate, four-frame
// strip for it, so the walking animation and its sheet are not touched at all:
// `bulu.png` is only ever *read* here.
//
// Nothing is drawn by hand. Each frame is one of the walking poses, rotated about
// the pet's feet, lightly squashed and drawn in a scrambled order, which is what
// makes it read as limbs flailing rather than as a stride. The live lean the
// renderer adds on top (from the flight's horizontal speed) then points the whole
// wobble in the direction of travel.
//
//   npm run bulu-airborne        (also part of npm run bulu-art)
//
// Output: src/assets/animated-pets/bulu-airborne.png — 4 x 1 cells of 192 px,
// exactly the cell size the other Bulu atlases use.
// ============================================================================
import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'src', 'assets', 'animated-pets', 'bulu.png');
const outputPath = path.join(root, 'src', 'assets', 'animated-pets', 'bulu-airborne.png');

const CELL = 192;
const COLS = 4;
const ROWS = 4;
/** Where the poses come from: row 1 is the walk cycle, and it stays untouched. */
const WALK_ROW = 1;

/**
 * The four airborne frames.
 *
 * `from` picks a walking pose out of order (0 → 2 → 1 → 3) so the legs do not read
 * as a stride, `angle` leans it about the feet and alternates around zero so the
 * loop wobbles rather than spins, and `dy` lifts it a few pixels — the pet is
 * airborne, not standing on the sheet.
 */
const FRAMES = [
  { from: 0, lean: -1, dy: -4 },
  { from: 2, lean: -1 / 3, dy: 0 },
  { from: 1, lean: 1 / 3, dy: 0 },
  { from: 3, lean: 1, dy: -4 },
];

/**
 * The one scale the whole loop is drawn at, fixed rather than searched.
 *
 * Bulu's poses fill their cell edge to edge, so a rotation would slice the head
 * unless the pose is pulled in first — and the loop has to share *one* scale, because
 * a per-frame fit came out as 0.97 / 0.97 / 0.99 / 0.90 and a pet that changes size
 * by 9% between frames reads as pumping rather than flailing. With the scale fixed,
 * the script instead searches the *angle* it can get away with (below), and the
 * renderer draws the strip 1/0.91 larger (`AIRBORNE_DRAW_SCALE`) so the pet stays
 * the same size on screen. The two numbers are checked against each other by the
 * test suite; change one and the other has to follow.
 */
const FIT_SCALE = 0.91;

/** Largest lean the strip is allowed to use, tried first, in degrees. */
const MAX_LEAN = 8;
/** Smallest lean worth building with — below this the wobble is invisible. */
const MIN_LEAN = 4;

/** Copy one cell out of a sheet row (rows are `COLS * CELL` wide). */
function readCell(data, sheetWidth, column, row) {
  const cell = Buffer.alloc(CELL * CELL * 4);
  for (let y = 0; y < CELL; y++) {
    const from = (((row * CELL + y) * sheetWidth) + column * CELL) * 4;
    data.copy(cell, y * CELL * 4, from, from + CELL * 4);
  }
  return cell;
}

/**
 * Bilinear sample of one RGBA cell, in premultiplied space.
 *
 * Premultiplying matters at the silhouette: sampling straight RGBA would pull the
 * transparent neighbours' black into the edge and leave a dark rim around a rotated
 * pose that was never in the original art.
 */
function sample(cell, x, y) {
  if (x < 0 || y < 0 || x > CELL - 1 || y > CELL - 1) return [0, 0, 0, 0];
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (const [sx, sy, weight] of [
    [x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)],
    [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy],
  ]) {
    if (weight <= 0) continue;
    const px = Math.min(CELL - 1, Math.max(0, sx));
    const py = Math.min(CELL - 1, Math.max(0, sy));
    const i = (py * CELL + px) * 4;
    const alpha = cell[i + 3] / 255;
    r += cell[i] * alpha * weight;
    g += cell[i + 1] * alpha * weight;
    b += cell[i + 2] * alpha * weight;
    a += alpha * weight;
  }
  if (a <= 0.0001) return [0, 0, 0, 0];
  return [r / a, g / a, b / a, a * 255];
}

/**
 * Rotate a cell about the pet's feet and drop it onto an empty one.
 *
 * The pivot is the bottom centre — a thrown cat pivots near its base, not around a
 * point floating in its middle — which also keeps the head's swing (about 26 px at
 * 10°) well inside the cell.
 */
function airborneFrame(source, { angle, scale, dy }) {
  const out = Buffer.alloc(CELL * CELL * 4);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const pivotX = CELL / 2, pivotY = CELL;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      // Inverse map: undo the lift, the rotation and the squash, in that order.
      const ox = x + 0.5 - pivotX;
      const oy = y + 0.5 - pivotY - dy;
      const sx = (ox * cos + oy * sin) / scale + pivotX - 0.5;
      const sy = (-ox * sin + oy * cos) / scale + pivotY - 0.5;
      const [r, g, b, a] = sample(source, sx, sy);
      const i = (y * CELL + x) * 4;
      out[i] = Math.round(r);
      out[i + 1] = Math.round(g);
      out[i + 2] = Math.round(b);
      out[i + 3] = Math.round(a);
    }
  }
  return out;
}

/** Opaque bounding box of a cell, or null when nothing is drawn. */
function opaqueBox(cell) {
  let minX = CELL, minY = CELL, maxX = -1, maxY = -1;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      if (cell[(y * CELL + x) * 4 + 3] <= 16) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** How many pixels survived the rotation — a pose that lost its body fails here. */
function opaqueCount(cell) {
  let count = 0;
  for (let i = 3; i < cell.length; i += 4) if (cell[i] > 16) count++;
  return count;
}

/** Whether a rotated pose keeps a pixel of margin inside its cell. */
function fits(cell) {
  const box = opaqueBox(cell);
  if (!box) return false;
  return box.minX > 0 && box.minY > 0 && box.maxX < CELL - 1 && box.maxY < CELL - 1;
}

const sheet = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (sheet.info.width !== CELL * COLS || sheet.info.height !== CELL * ROWS) {
  throw new Error(`bulu.png is ${sheet.info.width}x${sheet.info.height}, expected ${CELL * COLS}x${CELL * ROWS}`);
}

const strip = Buffer.alloc(CELL * COLS * CELL * 4);
const sources = FRAMES.map(frame => readCell(sheet.data, CELL * COLS, frame.from, WALK_ROW));
// With the scale fixed, walk the lean down until all four poses fit inside their
// cells. The loop keeps one lean for all frames, so the wobble stays symmetric.
let lean = 0;
let cells = [];
for (lean = MAX_LEAN; lean >= MIN_LEAN; lean -= 0.5) {
  cells = FRAMES.map((frame, index) => airborneFrame(sources[index], {
    angle: frame.lean * lean, scale: FIT_SCALE, dy: frame.dy,
  }));
  if (cells.every(fits)) break;
}
if (!cells.every(fits)) {
  throw new Error(`cannot fit a ${MAX_LEAN}° lean into a ${CELL}px cell at scale ${FIT_SCALE} — ` +
    'lower FIT_SCALE (and AIRBORNE_DRAW_SCALE in src/renderer/lite-app.ts with it)');
}

const report = cells.map((cell, index) => {
  const opaque = opaqueCount(cell);
  if (opaque < 3000) throw new Error(`airborne frame ${index} kept only ${opaque} pixels — the rotation is wrong`);
  for (let y = 0; y < CELL; y++) {
    cell.copy(strip, ((y * CELL * COLS) + index * CELL) * 4, y * CELL * 4, (y + 1) * CELL * 4);
  }
  const box = opaqueBox(cell);
  const angle = (FRAMES[index].lean * lean).toFixed(1);
  return `#${index} ← walk${FRAMES[index].from} ${FRAMES[index].lean > 0 ? '+' : ''}${angle}° ` +
    `bbox ${box.minX},${box.minY}..${box.maxX},${box.maxY}，${opaque} px 不透明`;
});
report.push(`统一缩放 ${FIT_SCALE}、最大倾角 ±${lean}°（四帧共用一个缩放，循环时不会忽大忽小）`);

await sharp(strip, { raw: { width: CELL * COLS, height: CELL, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

const meta = await sharp(outputPath).metadata();
if (meta.width !== CELL * COLS || meta.height !== CELL || !meta.hasAlpha) {
  throw new Error(`invalid airborne strip: ${meta.width}x${meta.height}`);
}

// The promise this script makes: bulu.png is read, never written. Re-read it and
// prove every byte still matches what went in, so the walking animation cannot be
// changed by a build of the airborne strip.
const reread = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (Buffer.compare(reread.data, sheet.data) !== 0) {
  throw new Error('bulu.png changed during the build — the airborne pass must only read it');
}

// …and prove the pass did something: every airborne frame has to differ from the
// walking pose it was built from, or the row is a copy that would look like walking.
const written = await sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (const [index, frame] of FRAMES.entries()) {
  const source = readCell(sheet.data, CELL * COLS, frame.from, WALK_ROW);
  const baked = readCell(written.data, CELL * COLS, index, 0);
  if (Buffer.compare(source, baked) === 0) {
    throw new Error(`airborne frame ${index} is a copy of walking pose ${frame.from} — nothing transformed`);
  }
}

report.forEach(line => console.log(`  ${line}`));
console.log(`✓ ${path.relative(root, outputPath)}  (${meta.width}x${meta.height}, ${statSync(outputPath).size} bytes)`);
console.log('  空中帧由走路姿势旋转/压扁而来；bulu.png 只读未写，走路动画未改动');
