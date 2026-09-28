// Prismoo brand icons: renders the candy-chrome cat once and writes all icon
// sizes/formats the app needs. Run after `npm run sprites` so the deterministic
// pixel-pet generator never overwrites the brand icon.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG = path.join(ROOT, 'src', 'assets', 'brand', 'prismoo-icon.svg');
const ASSET_DIR = path.join(ROOT, 'src', 'assets');
// The READMEs embed a PNG: repo images are served through GitHub's image proxy,
// which sanitises SVG and renders a namespace-less file as a broken image.
const README_PNG = path.join(ROOT, 'docs', 'brand', 'prismoo-icon.png');
// The bundler reads the app / installer icons from src-tauri/icons (see
// bundle.icon in tauri.conf.json). They are committed, so they have to be
// regenerated here too — otherwise a redrawn brand mark would update the tray and
// the README while the shipped installer kept the old artwork.
const BUNDLE_DIR = path.join(ROOT, 'src-tauri', 'icons');

// Windows shell (Start menu, taskbar, Explorer list/tiles) needs multiple icon
// sizes. A single 256px entry makes the Start menu fall back to a blank/default
// icon, so emit the full standard set.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function makeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(entries.length, 4); // number of images

  const parts = [header];
  let offset = 6 + entries.length * 16;
  for (const { size, buf } of entries) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 means 256)
    entry.writeUInt8(0, 2); // color palette count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buf.length, 8); // image data size
    entry.writeUInt32LE(offset, 12); // image data offset
    parts.push(entry);
    offset += buf.length;
  }
  for (const { buf } of entries) parts.push(buf);
  return Buffer.concat(parts);
}

function makeIcns(pngBuf) {
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + 8 + pngBuf.length, 4);
  const chunk = Buffer.alloc(8);
  chunk.write('ic09', 0, 'ascii');
  chunk.writeUInt32BE(8 + pngBuf.length, 4);
  return Buffer.concat([header, chunk, pngBuf]);
}

const svg = readFileSync(SVG, 'utf8');
const p512 = await sharp(Buffer.from(svg)).resize(512, 512).png().toBuffer();
const p32 = await sharp(Buffer.from(svg)).resize(32, 32).png().toBuffer();
const icoEntries = [];
for (const size of ICO_SIZES) {
  icoEntries.push({ size, buf: await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer() });
}

writeFileSync(path.join(ASSET_DIR, 'icon.png'), p512);
writeFileSync(path.join(ASSET_DIR, 'icon.ico'), makeIco(icoEntries));
writeFileSync(path.join(ASSET_DIR, 'icon.icns'), makeIcns(p512));
writeFileSync(path.join(ASSET_DIR, 'tray.png'), p32);

// README logo: 256 px so it stays crisp on HiDPI screens at the 128 px display size.
mkdirSync(path.dirname(README_PNG), { recursive: true });
writeFileSync(README_PNG, await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer());

// Keep the committed bundle icons in sync with the same source.
writeFileSync(path.join(BUNDLE_DIR, 'icon.png'), p512);
writeFileSync(path.join(BUNDLE_DIR, 'icon.ico'), makeIco(icoEntries));
for (const size of [32, 128, 256]) {
  writeFileSync(
    path.join(BUNDLE_DIR, `${size}x${size}.png`),
    await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer(),
  );
}

console.log('✓ Prismoo 品牌图标：src/assets/{icon.png,icon.ico,icon.icns,tray.png}、'
  + 'docs/brand/prismoo-icon.png（README 用）、src-tauri/icons/* 已生成');
