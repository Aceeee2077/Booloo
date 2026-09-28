#!/usr/bin/env node
// ============================================================================
// Bulu's atlas, rebuilt from the authoring renders in docs/pet-sources/:
//
//   bulu-actions.webp   16 frames x 6 rows, 192 px cells — the five right-click
//                       actions (rows 0-4) and the idle animation (row 5), each
//                       assembled from a 4x4 sheet of 16 frames in
//                       docs/pet-sources/bulu-actions/.
//
// Why 192: the pet is drawn at 132 CSS px (x devicePixelRatio, up to ~1.6x with
// the size setting), so a 64 px frame would be stretched 2.6-4.1x and look soft.
//
// bulu.png (walk / sleep / click) is deliberately NOT rebuilt here: it is still the
// original 256 px sheet — 64 px per frame — because the 4x4 board it was cut from
// is gone and no surviving render matches those rows. Its idle row is superseded by
// row 5 of the atlas; the other three states stay soft until their sources exist.
// Drop a 4x4 board (or one 4x4 sheet per state) into docs/pet-sources/ and this
// script can rebuild them at 192 px exactly the way it builds the atlas.
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

/**
 * Atlas rows, in the order the renderer indexes them. Keep in sync with
 * `actionRows` (rows 0-4) and `IDLE_ATLAS_ROW` (row 5) in src/renderer/lite-app.ts.
 *
 * The idle animation is appended *after* the five actions on purpose: it is not a
 * right-click action, and appending keeps the action row indices unchanged.
 */
const ACTIONS = [
  { id: 'wave', source: '挥爪子' },
  { id: 'groom', source: '舔爪子' },
  { id: 'stretch', source: '伸懒腰' },
  { id: 'yawn', source: '打哈欠' },
  { id: 'scratch', source: '挠头' },
];
/** The static default pose, taken from frame 0 of this 4x4 sheet. */
const IDLE_SHEET = '默认状态';

const COLS = 4;
const ROWS = 4;
const FRAMES = COLS * ROWS;
const CELL = 192;
/** Cell padding, proportional to the old 3 px on a 64 px cell. */
const PAD = 10;
/**
 * How much of a cell the idle art filled in the original 64 px sheet. The rebuild
 * matches it so the pet does not change size (and does not shrink next to the
 * carried-over walk row). Measured once; not read back from the sheet we replace.
 */
const IDLE_HEIGHT_RATIO = 0.906;
const ACTION_ART_WIDTH = 176;
const ACTION_ART_HEIGHT = 178;
/** Distance from the cell bottom the action art sits on, so poses do not jump. */
const ART_BASELINE = 4;

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

// ---------- 1. the base sheet (idle / walk / sleep / click) ----------

async function buildSheet() {
  // Rows 1-3 (walk / sleep / click) are carried over from the 64 px sheet — their
  // sources are gone, so a 3x lanczos resample into the bigger cells is as far as
  // this can go. Row 0 (idle) is rebuilt from the static default pose.
  const previous = await sharp(sheetOutput).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const previousCell = Math.round(previous.info.width / COLS);
  const composites = [];
  for (let row = 1; row < ROWS; row++) {
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

  // Idle is a *still* pose: the pet must not move on its own, so all four frames
  // hold the same art (frame 0 of the default-pose sheet). Only walking — auto-walk
  // or dragging — plays an animation.
  const idleSheet = await sharp(resolveActionSource(IDLE_SHEET)).ensureAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  const first = gridCells(idleSheet.info.width, idleSheet.info.height, COLS, ROWS)[0];
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

async function actionFrames(file, label) {
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
  const frames = [];
  let union = null;
  for (const box of cells) {
    const { data, info: cellInfo } = await sharp(source, {
      raw: { width: info.width, height: info.height, channels: 4 },
    }).extract(box).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // The model's own 4x4 layout drifts a little, so a cell can carry a piece of
    // the neighbouring pose; keep only the subject.
    keepLargestComponent(data, cellInfo.width, cellInfo.height);
    const visible = visibleBounds(data, cellInfo.width, cellInfo.height);
    if (visible.empty) { frames.push({ buffer: null, empty: true }); continue; }
    const right = visible.left + visible.width - 1;
    const bottom = visible.top + visible.height - 1;
    union = {
      left: Math.min(union?.left ?? visible.left, visible.left),
      top: Math.min(union?.top ?? visible.top, visible.top),
      right: Math.max(union?.right ?? right, right),
      bottom: Math.max(union?.bottom ?? bottom, bottom),
    };
    frames.push({ buffer: await sharp(data, { raw: cellInfo }).png().toBuffer(), empty: false });
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

  const prepared = [];
  for (const frame of frames) {
    if (frame.empty) {
      prepared.push(await sharp({ create: { width: 1, height: 1, channels: 4, background: '#00000000' } }).png().toBuffer());
      continue;
    }
    // Every frame uses the same crop and scale, so the motion inside the loop is
    // preserved instead of being re-centred frame by frame.
    prepared.push(await sharp(frame.buffer).extract(crop)
      .resize({ width: ACTION_ART_WIDTH, height: ACTION_ART_HEIGHT, fit: 'inside', kernel: sharp.kernel.lanczos3 })
      .png().toBuffer());
  }
  return { frames: prepared, keyed, crop };
}

async function buildActions() {
  if (!existsSync(actionSourceDir)) throw new Error(`Missing ${actionSourceDir}`);
  const rows = [];
  for (const action of ACTIONS) {
    const file = resolveActionSource(action.source);
    rows.push({ action, file, ...await actionFrames(file, action.id) });
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
  await sharp({ create: { width: CELL * FRAMES, height: CELL * rows.length, channels: 4, background: '#00000000' } })
    .composite(pieces).webp({ quality: 88, effort: 5 }).toFile(actionOutput);

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
  for (const [row, { action, file, keyed, crop }] of rows.entries()) {
    console.log(`  row ${row} ${action.id.padEnd(8)} ${path.basename(file).padEnd(12)} ` +
      `抠图=${keyed ? 'yes' : 'no '}  裁切框 ${crop.width}x${crop.height}`);
  }
}

await buildSheet();
await buildActions();
