// ============================================================================
// Petric pixel sprite generator (zero dependencies, pure Node implementation)
//
// Run: npm run sprites
// Output:
//   src/assets/sprites/{cat,dog,default,robot}.png  —— 128x128 sprite sheets
//     · Rows: idle(4 frames) / walking(4 frames) / sleeping(2 frames) / click(4 frames)
//     · Frame size: 32x32, canvas upscaled by a 3x integer factor (pixel-art style)
//     · Eyes/blinking/Zzz are drawn on top by the renderer (eyes follow the mouse)
//   src/assets/sprites/sprites.json          —— sprite sheet metadata (for docs)
//   src/assets/icon.png (512) / icon.ico / icon.icns / tray.png (32)
//
// All assets are procedurally generated, original resources of this project
// with no copyright issues. To add a new pet: duplicate the kind branch in
// PALETTES + drawPet, then register the skin in src/renderer/lite-app.ts.
// ============================================================================

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPRITE_DIR = join(ROOT, 'src', 'assets', 'sprites');
const ASSET_DIR = join(ROOT, 'src', 'assets');
mkdirSync(SPRITE_DIR, { recursive: true });
mkdirSync(ASSET_DIR, { recursive: true });

const FW = 32; // frame width
const FH = 32; // frame height
const COLS = 4; // max frames per row
const ROWS = 4; // idle / walking / sleeping / click

// Row, frame count and playback fps per state (keep in sync with the SHEET constants in the renderer)
const STATE_ROWS = { idle: 0, walking: 1, sleeping: 2, click: 3 };
const STATE_FPS = { idle: 6, walking: 12, sleeping: 2, click: 12 };

// Per-frame pose parameters for each state
const STATES = {
  idle: [
    { dy: 0, wag: 0 },
    { dy: -0.7, wag: 1 },
    { dy: 0, wag: 0 },
    { dy: -0.7, wag: -1 },
  ],
  walking: [
    { dy: -1, footLift: 1 },
    { dy: -2 },
    { dy: -1, footLift: 2 },
    { dy: 0 },
  ],
  sleeping: [
    { dy: 0, squash: 1.2, sleeping: true },
    { dy: -0.6, squash: 1.2, sleeping: true },
  ],
  click: [
    { dy: -1, squash: 0.7 },
    { dy: -3.5, stretch: 0.7 },
    { dy: -4.5, stretch: 1.0 },
    { dy: 0, squash: 0.8 },
  ],
};

// Four color palettes. NOTE: the skin IDs are kept for config compatibility —
// the 'dog' skin now renders a pixel FOX and 'default' renders a pixel RABBIT
// (output files keep the historical dog.png / default.png names).
const PALETTES = {
  cat: {
    body: [247, 155, 91, 255],
    light: [255, 241, 221, 255],
    pink: [247, 143, 176, 255],
    nose: [224, 93, 111, 255],
    whisker: [107, 74, 52, 255],
    outline: [67, 40, 31, 255],
  },
  dog: {
    // Pixel fox (skin id 'dog')
    body: [233, 121, 55, 255], // fox orange
    light: [255, 244, 230, 255], // cream muzzle / chest / tail tip
    ear: [255, 244, 230, 255],
    nose: [56, 44, 42, 255],
    whisker: [150, 84, 46, 255],
    outline: [104, 48, 20, 255],
    pink: [247, 143, 176, 255],
    dark: [70, 38, 24, 255], // ear tips
  },
  default: {
    // Pixel rabbit (skin id 'default')
    body: [228, 229, 238, 255], // soft gray-white
    light: [255, 255, 255, 255], // muzzle / belly / tail
    pink: [255, 173, 193, 255], // inner ears / blush
    nose: [255, 128, 150, 255], // pink nose
    whisker: [150, 150, 168, 255],
    outline: [98, 98, 124, 255],
  },
  robot: {
    body: [122, 136, 166, 255], // steel blue
    light: [206, 218, 236, 255], // screen / belly panel
    pink: [255, 118, 132, 255], // antenna light / accents
    nose: [255, 205, 112, 255], // power button
    whisker: [88, 100, 128, 255], // panel lines
    outline: [42, 48, 66, 255],
  },
};

// ============================ Mini RGBA canvas ============================

function makeCanvas(w, h) {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

function setPx(c, x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  c.data[i] = r;
  c.data[i + 1] = g;
  c.data[i + 2] = b;
  c.data[i + 3] = a;
}

function getPx(c, x, y) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return [0, 0, 0, 0];
  const i = (y * c.w + x) * 4;
  return [c.data[i], c.data[i + 1], c.data[i + 2], c.data[i + 3]];
}

function fillEllipse(c, cx, cy, rx, ry, col) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPx(c, x, y, col);
    }
  }
}

function fillRect(c, x0, y0, x1, y1, col) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPx(c, x, y, col);
}

function fillTriangle(c, pts, col) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.floor(Math.min(...xs));
  const maxX = Math.ceil(Math.max(...xs));
  const minY = Math.floor(Math.min(...ys));
  const maxY = Math.ceil(Math.max(...ys));
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const pt = [x + 0.5, y + 0.5];
      const d1 = sign(pt, pts[0], pts[1]);
      const d2 = sign(pt, pts[1], pts[2]);
      const d3 = sign(pt, pts[2], pts[0]);
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(hasNeg && hasPos)) setPx(c, x, y, col);
    }
  }
}

function line(c, x0, y0, x1, y1, col) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  let dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPx(c, x0, y0, col);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// Add an outline stroke around opaque shapes (outer silhouette only)
function outlinePass(c, col) {
  const { w, h, data } = c;
  const mark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) {
        const near =
          (x > 0 && data[(y * w + x - 1) * 4 + 3] > 0) ||
          (x < w - 1 && data[(y * w + x + 1) * 4 + 3] > 0) ||
          (y > 0 && data[((y - 1) * w + x) * 4 + 3] > 0) ||
          (y < h - 1 && data[((y + 1) * w + x) * 4 + 3] > 0);
        if (near) mark[y * w + x] = 1;
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (mark[i]) {
      data[i * 4] = col[0];
      data[i * 4 + 1] = col[1];
      data[i * 4 + 2] = col[2];
      data[i * 4 + 3] = col[3] ?? 255;
    }
  }
}

// ============================ Pet drawing ============================

function drawPet(c, pal, pose, kind) {
  const dy = typeof pose.dy === 'number' ? pose.dy : 0;
  const squash = typeof pose.squash === 'number' ? pose.squash : 0;
  const stretch = typeof pose.stretch === 'number' ? pose.stretch : 0;
  const footLift = typeof pose.footLift === 'number' ? pose.footLift : 0;
  const sleeping = pose.sleeping === true;
  const wag = typeof pose.wag === 'number' ? pose.wag : 0;

  // ---------- Icon mode: only the big head ----------
  if (pose.icon === true) {
    const hcy = 18;
    if (kind === 'cat') {
      fillTriangle(c, [[8.5, 14.5], [11, 8], [14, 13.5]], pal.body);
      fillTriangle(c, [[23.5, 14.5], [21, 8], [18, 13.5]], pal.body);
      fillTriangle(c, [[9.8, 13.5], [11, 9.9], [12.5, 13.1]], pal.pink);
      fillTriangle(c, [[22.2, 13.5], [21, 9.9], [19.5, 13.1]], pal.pink);
    } else if (kind === 'dog') {
      // Fox: tall pointy ears, cream inner, dark tips
      fillTriangle(c, [[7.6, 13.5], [11, 5.4], [14.6, 12.8]], pal.body);
      fillTriangle(c, [[24.4, 13.5], [21, 5.4], [17.4, 12.8]], pal.body);
      fillTriangle(c, [[9.2, 11.6], [11, 7.4], [13.2, 11.4]], pal.light);
      fillTriangle(c, [[22.8, 11.6], [21, 7.4], [18.8, 11.4]], pal.light);
      fillTriangle(c, [[10.2, 8.4], [11, 6.0], [12.1, 8.4]], pal.dark);
      fillTriangle(c, [[21.8, 8.4], [21, 6.0], [19.9, 8.4]], pal.dark);
    } else if (kind === 'robot') {
      // Side antenna stubs + top antenna with a light
      fillRect(c, 5, 10, 8, 13, pal.outline);
      fillRect(c, 6, 11, 7, 12, pal.body);
      fillRect(c, 24, 10, 27, 13, pal.outline);
      fillRect(c, 25, 11, 26, 12, pal.body);
      line(c, 16, 10.2, 16, 5.2, pal.outline);
      fillEllipse(c, 16, 4.6, 1.3, 1.3, pal.pink);
    } else {
      // Rabbit: two long upright ears with pink inner
      fillEllipse(c, 12.2, 7.2, 2.2, 5.4, pal.body);
      fillEllipse(c, 19.8, 7.2, 2.2, 5.4, pal.body);
      fillEllipse(c, 12.2, 7.6, 1.0, 3.6, pal.pink);
      fillEllipse(c, 19.8, 7.6, 1.0, 3.6, pal.pink);
    }
    fillEllipse(c, 16, hcy, 8.5, 7.5, pal.body);
    outlinePass(c, pal.outline);

    // Eyes (included in the icon itself)
    fillEllipse(c, 12.5, 17.8, 1.7, 1.7, [47, 42, 38, 255]);
    fillEllipse(c, 19.5, 17.8, 1.7, 1.7, [47, 42, 38, 255]);
    fillEllipse(c, 12.9, 17.2, 0.6, 0.6, [255, 255, 255, 255]);
    fillEllipse(c, 19.9, 17.2, 0.6, 0.6, [255, 255, 255, 255]);

    // Snout
    if (kind === 'dog') {
      // Fox: slender cream muzzle + small dark nose
      fillEllipse(c, 16, 22.2, 3.4, 2.4, pal.light);
      fillEllipse(c, 16, 20.7, 1.5, 1.1, pal.nose);
    } else if (kind === 'cat') {
      fillEllipse(c, 16, 20.8, 3.2, 2.4, pal.light);
      fillTriangle(c, [[15.2, 19.2], [16.8, 19.2], [16, 20.4]], pal.nose);
    } else if (kind === 'robot') {
      // Screen face with "digital" eyes (covers the generic eyes underneath)
      fillEllipse(c, 16, 19.6, 5.6, 4.4, pal.light);
      fillEllipse(c, 12.8, 18.8, 1.3, 2, [78, 88, 110, 255]);
      fillEllipse(c, 19.2, 18.8, 1.3, 2, [78, 88, 110, 255]);
    } else {
      // Rabbit: white muzzle + pink nose
      fillEllipse(c, 16, 21.4, 3.6, 2.6, pal.light);
      fillTriangle(c, [[15.3, 19.6], [16.7, 19.6], [16, 20.8]], pal.nose);
    }
    line(c, 16, kind === 'cat' ? 20.4 : kind === 'dog' ? 20.8 : 20.7, 14.6, 21.9, pal.whisker);
    line(c, 16, kind === 'cat' ? 20.4 : kind === 'dog' ? 20.8 : 20.7, 17.4, 21.9, pal.whisker);
    if (kind !== 'dog' && kind !== 'robot') {
      line(c, 12.4, 20.2, 6.8, 18.8, pal.whisker);
      line(c, 12.4, 21.4, 6.8, 22.6, pal.whisker);
      line(c, 19.6, 20.2, 25.2, 18.8, pal.whisker);
      line(c, 19.6, 21.4, 25.2, 22.6, pal.whisker);
    }
    fillEllipse(c, 10.2, 22.6, 1.7, 1.2, pal.pink);
    fillEllipse(c, 21.8, 22.6, 1.7, 1.2, pal.pink);
    return;
  }

  // ---------- Regular poses ----------
  const bodyRx = 9 - stretch * 0.8 + squash * 1.6;
  const bodyRy = 9 + stretch * 1.3 - squash * 1.5;
  const bodyCy = 31 - bodyRy + dy; // bottom sits on the ground (y≈31)
  const headCy = 13 + dy + (sleeping ? 1.6 : 0);

  // Tail (drawn behind the body)
  if (kind === 'cat') {
    line(c, 23, 23 + dy, 26 + wag, 15 + dy, pal.outline);
    line(c, 23.5, 23 + dy, 26.5 + wag, 15.2 + dy, pal.body);
    fillEllipse(c, 27 + wag, 15.5 + dy, 1.3, 1.3, pal.body);
  } else if (kind === 'dog') {
    // Bushy two-tone fox tail (wags in idle)
    fillEllipse(c, 24.3 + wag, 20 + dy, 1.9, 3.4, pal.body);
    fillEllipse(c, 25.6 + wag, 23 + dy, 1.7, 3.2, pal.body);
    fillEllipse(c, 26.4 + wag, 26 + dy, 1.5, 2.4, pal.body);
    fillEllipse(c, 26.5 + wag, 28 + dy, 1.2, 1.6, pal.light); // white tip
  } else if (kind === 'default') {
    // Fluffy round rabbit tail
    fillEllipse(c, 25 + wag, 27 + dy, 1.8, 1.8, pal.body);
    fillEllipse(c, 25 + wag, 27 + dy, 1.1, 1.1, pal.light);
  }

  // Feet (lifted alternately while walking)
  const footY = 30.5 + dy;
  fillEllipse(c, 12, footLift === 1 ? footY - 2.6 : footY, 2.2, footLift === 1 ? 1.1 : 1.7, pal.light);
  fillEllipse(c, 20, footLift === 2 ? footY - 2.6 : footY, 2.2, footLift === 2 ? 1.1 : 1.7, pal.light);

  // Body + belly
  fillEllipse(c, 16, bodyCy, bodyRx, bodyRy, pal.body);
  fillEllipse(c, 16, bodyCy + bodyRy * 0.25, bodyRx * 0.55, bodyRy * 0.55, pal.light);

  // Ears
  if (kind === 'cat') {
    fillTriangle(c, [[8.5, 9 + dy], [11, 2.5 + dy], [14, 8 + dy]], pal.body);
    fillTriangle(c, [[23.5, 9 + dy], [21, 2.5 + dy], [18, 8 + dy]], pal.body);
    fillTriangle(c, [[9.8, 8 + dy], [11, 4.4 + dy], [12.5, 7.6 + dy]], pal.pink);
    fillTriangle(c, [[22.2, 8 + dy], [21, 4.4 + dy], [19.5, 7.6 + dy]], pal.pink);
  } else if (kind === 'dog') {
    // Fox: tall pointy ears, cream inner, dark tips
    fillTriangle(c, [[8.2, 9 + dy], [11, 1.6 + dy], [14.2, 8.2 + dy]], pal.body);
    fillTriangle(c, [[23.8, 9 + dy], [21, 1.6 + dy], [17.8, 8.2 + dy]], pal.body);
    fillTriangle(c, [[9.4, 7.6 + dy], [11, 3.6 + dy], [13.2, 7.4 + dy]], pal.light);
    fillTriangle(c, [[22.6, 7.6 + dy], [21, 3.6 + dy], [18.8, 7.4 + dy]], pal.light);
    fillTriangle(c, [[10.0, 4.6 + dy], [11, 2.0 + dy], [12.0, 4.4 + dy]], pal.dark);
    fillTriangle(c, [[22.0, 4.6 + dy], [21, 2.0 + dy], [20.0, 4.4 + dy]], pal.dark);
  } else if (kind === 'robot') {
    // Side antenna stubs (stick out past the head) + top antenna with a light
    // fillRect needs integer coordinates (typed-array indexing drops fractional indices)
    const rdy = Math.round(dy);
    fillRect(c, 5, 9 + rdy, 8, 12 + rdy, pal.outline);
    fillRect(c, 6, 10 + rdy, 7, 11 + rdy, pal.body);
    fillRect(c, 24, 9 + rdy, 27, 12 + rdy, pal.outline);
    fillRect(c, 25, 10 + rdy, 26, 11 + rdy, pal.body);
    line(c, 16, 6 + dy, 16, 2 + dy, pal.outline);
    fillEllipse(c, 16, 1.6 + dy, 1.2, 1.2, pal.pink);
  } else {
    // Rabbit: two long upright ears with pink inner
    fillEllipse(c, 12.4, 4.6 + dy, 2.2, 4.8, pal.body);
    fillEllipse(c, 19.6, 4.6 + dy, 2.2, 4.8, pal.body);
    fillEllipse(c, 12.4, 5.0 + dy, 1.0, 3.4, pal.pink);
    fillEllipse(c, 19.6, 5.0 + dy, 1.0, 3.4, pal.pink);
  }

  // Head
  fillEllipse(c, 16, headCy, 8, 7, pal.body);

  // Outline stroke
  outlinePass(c, pal.outline);

  // Snout (details drawn on top of the outline)
  if (kind === 'dog') {
    // Fox: slender cream muzzle + small dark nose
    fillEllipse(c, 16, 17.4 + dy, 3.2, 2.5, pal.light);
    fillEllipse(c, 16, 15.4 + dy, 1.5, 1.1, pal.nose);
  } else if (kind === 'cat') {
    fillEllipse(c, 16, 16.2 + dy, 3.2, 2.4, pal.light);
    fillTriangle(c, [[15.2, 14.7 + dy], [16.8, 14.7 + dy], [16, 15.9 + dy]], pal.nose);
  } else if (kind === 'robot') {
    // Screen face — the eyes are overlaid by the renderer (eye tracking), so no eyes here.
    // The generic "w" mouth below lands on the screen as a smile.
    fillEllipse(c, 16, 13.2 + dy, 5.6, 4.6, pal.light);
    // Belly panel + power button on the body
    line(c, 11, 22.6 + dy, 21, 22.6 + dy, pal.whisker);
    fillEllipse(c, 16, 21.2 + dy, 1.1, 1.1, pal.nose);
  } else {
    // Rabbit: white muzzle + pink nose
    fillEllipse(c, 16, 17.2 + dy, 3.4, 2.6, pal.light);
    fillTriangle(c, [[15.2, 15.5 + dy], [16.8, 15.5 + dy], [16, 16.8 + dy]], pal.nose);
  }

  // Small "w" mouth (not drawn while sleeping)
  if (!sleeping) {
    const my = kind === 'cat' ? 15.9 : kind === 'dog' ? 16.4 : 16.2;
    line(c, 16, my + dy, 14.6, 17.4 + dy, pal.whisker);
    line(c, 16, my + dy, 17.4, 17.4 + dy, pal.whisker);
  }

  // Whiskers
  if (kind !== 'dog' && kind !== 'robot') {
    line(c, 12.4, 15.6 + dy, 6.8, 14.2 + dy, pal.whisker);
    line(c, 12.4, 16.8 + dy, 6.8, 18 + dy, pal.whisker);
    line(c, 19.6, 15.6 + dy, 25.2, 14.2 + dy, pal.whisker);
    line(c, 19.6, 16.8 + dy, 25.2, 18 + dy, pal.whisker);
  }

  // Blush
  fillEllipse(c, 10.2, 18 + dy, 1.7, 1.2, pal.pink);
  fillEllipse(c, 21.8, 18 + dy, 1.7, 1.2, pal.pink);
}

// ============================ PNG encoding ============================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

function writePng(file, c) {
  writeFileSync(file, encodePng(c.w, c.h, c.data));
}

// Nearest-neighbor integer upscale (keeps the pixel-art look)
function upscale(c, factor) {
  const out = makeCanvas(c.w * factor, c.h * factor);
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const px = getPx(c, x, y);
      for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) setPx(out, x * factor + dx, y * factor + dy, px);
    }
  }
  return out;
}

// ICO (single entry embedding a 256x256 PNG)
function writeIco(file, pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0; // 256 -> 0
  entry[1] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12);
  writeFileSync(file, Buffer.concat([header, entry, pngBuf]));
}

// ICNS (ic09 = 512x512 PNG chunk)
function writeIcns(file, pngBuf) {
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + 8 + pngBuf.length, 4);
  const chunk = Buffer.alloc(8);
  chunk.write('ic09', 0, 'ascii');
  chunk.writeUInt32BE(8 + pngBuf.length, 4);
  writeFileSync(file, Buffer.concat([header, chunk, pngBuf]));
}

// ============================ Main flow ============================

function buildSheet(kind, pal) {
  const canvas = makeCanvas(FW * COLS, FH * ROWS);
  const states = {};
  for (const [stateName, poses] of Object.entries(STATES)) {
    const row = STATE_ROWS[stateName];
    poses.forEach((pose, i) => {
      const cell = makeCanvas(FW, FH);
      drawPet(cell, pal, pose, kind);
      for (let y = 0; y < FH; y++) {
        for (let x = 0; x < FW; x++) {
          setPx(canvas, i * FW + x, row * FH + y, getPx(cell, x, y));
        }
      }
    });
    states[stateName] = { row, frames: poses.length, fps: STATE_FPS[stateName] };
  }
  return { canvas, states };
}

const sheetMeta = {};
for (const [kind, pal] of Object.entries(PALETTES)) {
  const { canvas, states } = buildSheet(kind, pal);
  writePng(join(SPRITE_DIR, `${kind}.png`), canvas);
  sheetMeta[kind] = states;
  console.log(`✓ 精灵表 ${kind}.png (${canvas.w}x${canvas.h})`);
}

writeFileSync(
  join(SPRITE_DIR, 'sprites.json'),
  JSON.stringify({ frameW: FW, frameH: FH, cols: COLS, rows: ROWS, skins: sheetMeta }, null, 2),
);
console.log('✓ 元信息 sprites.json');

// Icons: head avatars for the pets + app/tray icons (the cat is used as the default icon)
for (const [kind, pal] of Object.entries(PALETTES)) {
  const head = makeCanvas(32, 32);
  drawPet(head, pal, { icon: true }, kind);
  writePng(join(ASSET_DIR, `icon-${kind}.png`), upscale(head, 16));
}

const catHead = makeCanvas(32, 32);
drawPet(catHead, PALETTES.cat, { icon: true }, 'cat');
writePng(join(ASSET_DIR, 'icon.png'), upscale(catHead, 16)); // 512x512
writePng(join(ASSET_DIR, 'tray.png'), catHead); // 32x32
writeIco(join(ASSET_DIR, 'icon.ico'), encodePng(256, 256, upscale(catHead, 8).data));
writeIcns(join(ASSET_DIR, 'icon.icns'), encodePng(512, 512, upscale(catHead, 16).data));
console.log('✓ 图标 icon.png / icon.ico / icon.icns / tray.png / icon-{cat,dog,default}.png');
console.log('完成！');
