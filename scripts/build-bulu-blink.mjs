#!/usr/bin/env node
// ============================================================================
// Bulu's blink frame.
//
// The idle row of src/assets/animated-pets/bulu.png holds four *identical* still
// poses — the renderer deliberately plays no idle motion, so column 3 would
// otherwise be a wasted copy. This script turns that column into the eyes-closed
// pose the pet shows for ~140 ms every few seconds (see `lite-app.ts`).
//
// Nothing here is drawn by hand: both eyes are cut out of the face and replaced
// with the fur that sits directly above them, then a lid line is laid on top
// using the eye's own darkest pixel as the colour. The source is always column 0,
// so re-running the script (or running it after `npm run bulu-art`) is safe.
//
//   npm run bulu-blink
//
// Nothing else in the sheet is touched: walk / sleep / click and the action atlas
// stay exactly as they are.
// ============================================================================
import { createRequire } from 'node:module';
import { renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sheetPath = path.join(root, 'src', 'assets', 'animated-pets', 'bulu.png');

const CELL = 192;
const COLS = 4;
const ROWS = 4;
/** The idle row, and which of its four still frames is the one to close. */
const IDLE_ROW = 0;
const BLINK_COLUMN = 3;
/** How many rows above an eye the replacement fur is sampled from. */
const FUR_BAND = 5;
/** Darkness below which a pixel counts as the eye rather than the face. */
const EYE_LUMA = 95;

/**
 * Both eye boxes, measured once on the shipped art (192 px cell): the dark ovals
 * sit at x 72..101 / 118..145 and y 54..65, so each box is padded by two pixels
 * on every side to swallow the antialiased rim.
 */
const EYES = [
  { x: 70, y: 52, w: 33, h: 16 },
  { x: 117, y: 52, w: 31, h: 16 },
];

const luma = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

/** Average colour of the opaque pixels in one column's band, or null. */
function columnColour(data, width, x, y0, y1) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    const i = (y * width + x) * 4;
    if (data[i + 3] <= 16) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

/**
 * Replace one eye with the fur above it and lay a closed lid on top.
 *
 * The fill borrows the colour *per column* rather than one flat value, so the
 * bright muzzle blending into the darker fur beside it keeps its gradient and
 * the patch does not read as a rectangle.
 */
function closeEye(data, width, box) {
  const { x, y, w, h } = box;
  const colours = [];
  for (let dx = 0; dx < w; dx++) {
    colours.push(columnColour(data, width, x + dx, y - FUR_BAND, y - 1));
  }
  // A column that was fully transparent above the eye inherits its neighbour's
  // fur instead of punching a hole in the face.
  for (let dx = 0; dx < w; dx++) {
    if (colours[dx]) continue;
    colours[dx] = colours[dx - 1] ?? colours.slice(dx).find(Boolean) ?? [180, 170, 160];
  }

  let darkest = null;
  let darkestLuma = 256;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const i = ((y + dy) * width + x + dx) * 4;
      const l = luma(data[i], data[i + 1], data[i + 2]);
      if (data[i + 3] <= 16 || l >= darkestLuma) continue;
      darkestLuma = l;
      darkest = [data[i], data[i + 1], data[i + 2]];
    }
  }
  const lid = darkest ?? [70, 60, 56];

  // 1. Fur: a gentle vertical shade plus a one-pixel blend into the old rim keeps
  // the patch from showing a seam against the face.
  for (let dy = 0; dy < h; dy++) {
    const shade = 1 - 0.05 * (dy / (h - 1));
    const edge = dy === 0 || dy === h - 1 ? 0.55 : dy === 1 || dy === h - 2 ? 0.85 : 1;
    for (let dx = 0; dx < w; dx++) {
      const i = ((y + dy) * width + x + dx) * 4;
      const [r, g, b] = colours[dx];
      data[i] = Math.round(data[i] * (1 - edge) + r * shade * edge);
      data[i + 1] = Math.round(data[i + 1] * (1 - edge) + g * shade * edge);
      data[i + 2] = Math.round(data[i + 2] * (1 - edge) + b * shade * edge);
    }
  }

  // 2. The lid: a shallow downward curve spanning the eye, two pixels thick in
  // the middle and one at the corners so it tapers like a drawn eyelid.
  const centre = x + (w - 1) / 2;
  const half = w / 2;
  const lidY = y + Math.round(h * 0.55);
  for (let dx = 0; dx < w; dx++) {
    const px = x + dx;
    const t = (px - centre) / half;
    const curve = Math.max(0, 2 * (1 - t * t));
    const dy = Math.round(curve);
    const thickness = Math.abs(t) > 0.78 ? 1 : 2;
    for (let k = 0; k < thickness; k++) {
      const py = lidY + dy + k;
      if (py < y || py >= y + h) continue;
      const i = (py * width + px) * 4;
      data[i] = lid[0];
      data[i + 1] = lid[1];
      data[i + 2] = lid[2];
    }
  }
}

/**
 * How many eye-dark pixels a box holds outside the lid rows. Used both to prove
 * the original eyes were there and that the closed pose left nothing behind.
 */
function darkCount(data, width, box, skip = null) {
  let count = 0;
  for (let dy = 0; dy < box.h; dy++) {
    if (skip && dy >= skip[0] && dy <= skip[1]) continue;
    for (let dx = 0; dx < box.w; dx++) {
      const i = ((box.y + dy) * width + box.x + dx) * 4;
      if (data[i + 3] > 16 && luma(data[i], data[i + 1], data[i + 2]) < EYE_LUMA) count++;
    }
  }
  return count;
}

/** The lid's own rows inside a box, which are dark on purpose. */
function lidRows(box) {
  const lidY = box.y + Math.round(box.h * 0.55);
  return [lidY - box.y - 1, lidY - box.y + 4];
}

/**
 * Copy one cell out of the sheet.
 *
 * The sheet rows are `COLS * CELL` wide, so a cell is a strided slice rather than
 * a contiguous run of bytes.
 */
function readCell(data, sheetWidth, column, row) {
  const cell = Buffer.alloc(CELL * CELL * 4);
  for (let y = 0; y < CELL; y++) {
    const from = (((row * CELL + y) * sheetWidth) + column * CELL) * 4;
    data.copy(cell, y * CELL * 4, from, from + CELL * 4);
  }
  return cell;
}

/** Small text proof of the patched band, so a run can be checked without a viewer. */
function eyeBand(data, width, x0, x1, y0, y1) {
  const ramp = '@%#*+=-:. ';
  const lines = [];
  for (let y = y0; y <= y1; y++) {
    let line = '';
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const l = luma(data[i], data[i + 1], data[i + 2]);
      line += data[i + 3] <= 16 ? ' ' : ramp[Math.min(9, Math.floor(l / 28))];
    }
    lines.push(String(y).padStart(3) + ' ' + line);
  }
  return lines.join('\n');
}

const sheet = await sharp(sheetPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (sheet.info.width !== CELL * COLS || sheet.info.height !== CELL * ROWS) {
  throw new Error(`bulu.png is ${sheet.info.width}x${sheet.info.height}, expected ${CELL * COLS}x${CELL * ROWS}`);
}

// The blink pose is rebuilt from the untouched idle frame (column 0) every time,
// so the pass is idempotent even though it overwrites column 3 in place.
const blink = readCell(sheet.data, CELL * COLS, 0, IDLE_ROW);
const before = EYES.map(box => darkCount(sheet.data, CELL * COLS, box));
for (const box of EYES) closeEye(blink, CELL, box);
const after = EYES.map(box => darkCount(blink, CELL, box, lidRows(box)));
console.log(`  眼部暗像素 ${before.join('/')} → ${after.join('/')}`);
console.log(eyeBand(blink, CELL, 66, 152, 48, 70));

const next = Buffer.from(sheet.data);
// Row by row: the cell is 192 px wide but the sheet row is 768 px wide, so a
// single contiguous copy would smear the pose across its neighbours.
for (let row = 0; row < CELL; row++) {
  const from = row * CELL * 4;
  const to = ((IDLE_ROW * CELL + row) * CELL * COLS + BLINK_COLUMN * CELL) * 4;
  blink.copy(next, to, from, from + CELL * 4);
}

for (const [index, box] of EYES.entries()) {
  // 40 is far below the ~150 px each oval occupies and far above the stray
  // shading on bare fur: failing it means the art moved and the boxes are stale.
  if (before[index] < 40) throw new Error(`no eye found in ${JSON.stringify(box)} — the art changed`);
  if (after[index] > 2) throw new Error(`leftover dark pixels in ${JSON.stringify(box)}: ${after[index]}`);
}

const tmp = `${sheetPath}.tmp.png`;
await sharp(next, { raw: sheet.info }).png({ compressionLevel: 9 }).toFile(tmp);
const meta = await sharp(tmp).metadata();
if (meta.width !== CELL * COLS || meta.height !== CELL * ROWS || !meta.hasAlpha) {
  throw new Error(`Invalid Bulu sheet after the blink pass: ${meta.width}x${meta.height}`);
}
// Read the written file back and prove the pass only touched the blink cell:
// every other frame of the sheet — walk, sleep, click, the other idle columns —
// has to be byte-identical, or the pet's other poses would silently drift.
const written = await sharp(tmp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let y = 0; y < CELL * ROWS; y++) {
  for (let x = 0; x < CELL * COLS; x++) {
    const i = (y * CELL * COLS + x) * 4;
    const same = written.data[i] === sheet.data[i] && written.data[i + 1] === sheet.data[i + 1] &&
      written.data[i + 2] === sheet.data[i + 2] && written.data[i + 3] === sheet.data[i + 3];
    if (same) continue;
    const inBlink = Math.floor(y / CELL) === IDLE_ROW && Math.floor(x / CELL) === BLINK_COLUMN;
    if (!inBlink) throw new Error(`the blink pass changed a pixel outside its cell at ${x},${y}`);
  }
}

// Compare the new pose against the idle pose it was built from (not against the
// file, which may already carry a previous run): two closed eyes have to move
// several hundred pixels or the pass did nothing.
const idleCell = readCell(sheet.data, CELL * COLS, 0, IDLE_ROW);
let eyesMoved = 0;
for (let i = 0; i < blink.length; i += 4) {
  if (blink[i] !== idleCell[i] || blink[i + 1] !== idleCell[i + 1] ||
      blink[i + 2] !== idleCell[i + 2] || blink[i + 3] !== idleCell[i + 3]) eyesMoved++;
}
if (eyesMoved < 200) throw new Error(`only ${eyesMoved} pixels differ from the open-eye pose — the blink frame looks empty`);
renameSync(tmp, sheetPath);
console.log(`✓ ${path.relative(root, sheetPath)}  (${meta.width}x${meta.height}, ${statSync(sheetPath).size} bytes)`);
console.log(`  闭眼帧写入 idle 行第 ${BLINK_COLUMN + 1} 格，相对睁眼帧改动 ${eyesMoved} 像素，其余帧未变`);
