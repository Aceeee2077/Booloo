import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
// The renderer translates through the dictionary the backend hands it, so the
// tests build the same translations from the compiled src/shared/i18n.ts.
const { zhDict, enDict } = require(join(process.cwd(), 'dist', 'shared', 'i18n.js'));
const makeTranslate = (dict) => (key, params) => {
  const value = dict[key];
  if (typeof value !== 'string') return key;
  return params ? value.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? '')) : value;
};

const source = readFileSync(join(process.cwd(), 'src/renderer/lite-image.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
let raster = new Uint8ClampedArray();
const context = {
  document: { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      drawImage: () => undefined,
      getImageData: () => ({ data: new Uint8ClampedArray(raster) }),
      putImageData: ({ data }) => { raster = new Uint8ClampedArray(data); },
    }),
  }) },
  Uint8Array, Int32Array, Uint8ClampedArray, Math, Error,
  liteT: makeTranslate(zhDict),
};
vm.createContext(context);
vm.runInContext(js, context);

const image = { naturalWidth: 100, naturalHeight: 100 };
const pixel = (x, y, rgb, alpha = 255) => {
  const offset = (y * 100 + x) * 4;
  raster.set([rgb[0], rgb[1], rgb[2], alpha], offset);
};
const fill = (rgb, alpha = 255) => {
  raster = new Uint8ClampedArray(100 * 100 * 4);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) pixel(x, y, rgb, alpha);
};

fill([255, 255, 255]);
for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) pixel(x, y, [220, 90, 110]);
let result = context.litePrepareImage(image, true);
assert.equal(result.cutoutApplied, true);
assert.equal(result.visiblePixels, 1600);
assert.deepEqual(JSON.parse(JSON.stringify(result.bounds)), { x: 30, y: 30, width: 40, height: 40 });

fill([255, 255, 255]);
result = context.litePrepareImage(image, true);
assert.equal(result.cutoutRejected, true);
assert.equal(result.visiblePixels, 10000, 'a rejected cutout must leave the original visible');

fill([0, 0, 0], 0);
for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) pixel(x, y, [40, 50, 60]);
result = context.litePrepareImage(image, true);
assert.equal(result.cutoutApplied, false, 'already transparent art must not be keyed again');
assert.equal(result.visiblePixels, 3600);

fill([0, 0, 0], 0);
assert.throws(() => context.litePrepareImage(image, false), /完全透明/);
// Same failure, English dictionary: the messages follow config.locale.
context.liteT = makeTranslate(enDict);
assert.throws(() => context.litePrepareImage(image, false), /fully transparent/);
context.liteT = makeTranslate(zhDict);

const renderer = join(process.cwd(), 'dist', 'renderer');
const shippedScripts = readdirSync(renderer).filter(name => name.endsWith('.js')).sort();
assert.deepEqual(shippedScripts, ['lite-api.js', 'lite-app.js', 'lite-file-reaction.js', 'lite-i18n.js',
  'lite-image.js', 'lite-mask.js', 'lite-menu.js', 'lite-settings.js']);
const fileReaction = { liteT: makeTranslate(zhDict) };
vm.createContext(fileReaction);
vm.runInContext(readFileSync(join(renderer, 'lite-file-reaction.js'), 'utf8'), fileReaction);
assert.match(fileReaction.liteFileReaction(['C:\\work\\cat.PNG']), /照片/);
assert.match(fileReaction.liteFileReaction(['/tmp/report.pdf']), /工作/);
assert.match(fileReaction.liteFileReaction(['/tmp/archive.zip']), /礼物/);
assert.match(fileReaction.liteFileReaction(['/tmp/song.mp3']), /歌/);
assert.match(fileReaction.liteFileReaction(['/tmp/movie.mp4']), /电影/);
assert.match(fileReaction.liteFileReaction(['/tmp/mystery.bin']), /工资/);
assert.match(fileReaction.liteFileReaction(['/tmp/a.txt', '/tmp/b.txt']), /2 份工资/);
fileReaction.liteT = makeTranslate(enDict);
assert.match(fileReaction.liteFileReaction(['/tmp/cat.png']), /photo/);
assert.match(fileReaction.liteFileReaction(['/tmp/movie.mp4']), /Movie night/);
assert.match(fileReaction.liteFileReaction(['/tmp/a.txt', '/tmp/b.txt']), /2 paychecks/);

for (const page of ['index.html', 'settings.html', 'mask.html']) {
  const html = readFileSync(join(renderer, page), 'utf8');
  assert.match(html, /lite-api\.js/);
  assert.match(html, /lite-i18n\.js/);
  assert.doesNotMatch(html, /chat\.js|wardrobe\.js|pet-library\.js|anim-debug\.js/);
}
assert.match(readFileSync(join(renderer, 'menu.html'), 'utf8'), /lite-menu\.js/);
assert.match(readFileSync(join(renderer, 'menu.html'), 'utf8'), /lite-i18n\.js/);

// The cutout mask editor is a third page: it must ship its own script and the
// controls the brush logic binds to, and the settings panel has to offer a way in.
const maskPage = readFileSync(join(renderer, 'mask.html'), 'utf8');
assert.match(maskPage, /lite-mask\.js/);
assert.match(maskPage, /lite-api\.js/);
for (const id of ['stage', 'mask-view', 'tool-erase', 'tool-restore', 'brush-size', 'brush-hardness',
  'cutout-strength', 'cutout-feather', 'rerun', 'undo', 'redo', 'fit', 'show-original',
  'before-preview', 'after-preview', 'apply']) {
  assert.match(maskPage, new RegExp(`id="${id}"`), `mask.html is missing #${id}`);
}
assert.match(readFileSync(join(renderer, 'lite-mask.js'), 'utf8'), /destination-out/,
  'the erase brush has to cut through the mask alpha');
assert.match(readFileSync(join(renderer, 'lite-mask.css'), 'utf8'), /repeating-conic-gradient/,
  'the stage needs a checkerboard so erased pixels are visible');
assert.match(readFileSync(join(renderer, 'settings.html'), 'utf8'), /id="refine-image"/,
  'Settings needs the "refine the cutout" entry point');

// Software updates: the panel that drives src-tauri/src/updater.rs.
const settingsHtml = readFileSync(join(renderer, 'settings.html'), 'utf8');
for (const id of ['update-panel', 'update-version', 'update-status', 'update-progress-row', 'update-progress-bar',
  'update-progress-text', 'btn-check-update', 'btn-download-update', 'btn-install-update',
  'update-auto-check', 'update-auto-download', 'update-notes-box', 'update-notes', 'update-manual']) {
  assert.match(settingsHtml, new RegExp(`id="${id}"`), `settings.html is missing #${id}`);
}
const liteApi = readFileSync(join(renderer, 'lite-api.js'), 'utf8');
for (const command of ['update_get_state', 'update_check', 'update_download', 'update_install']) {
  assert.match(liteApi, new RegExp(command), `lite-api is missing the ${command} bridge`);
}

// The auto-updater chain was silently dropped once: `updater.rs` stayed on disk
// but was gitignored and no longer compiled, while the workflow kept publishing
// releases. Every link is asserted here so that cannot happen quietly again.
assert.doesNotMatch(readFileSync(join(process.cwd(), '.gitignore'), 'utf8'),
  /^\/src-tauri\/src\/updater\.rs$/m, 'updater.rs must not be gitignored');
for (const [file, pattern] of [
  ['src-tauri/src/lib.rs', /mod updater;/],
  ['src-tauri/src/lib.rs', /tauri_plugin_updater::Builder::new\(\)\.build\(\)/],
  ['src-tauri/src/lib.rs', /updater::update_check/],
  ['src-tauri/Cargo.toml', /tauri-plugin-updater/],
  ['src-tauri/tauri.conf.json', /"createUpdaterArtifacts": true/],
  ['src-tauri/tauri.conf.json', /"pubkey": "RWT\//],
  ['src-tauri/tauri.conf.json', /Aceeee2077\/Prismoo\/releases\/latest\/download\/latest\.json/],
  ['.github/workflows/release.yml', /tauri-apps\/tauri-action@v1/],
]) {
  assert.match(readFileSync(join(process.cwd(), file), 'utf8'), pattern, `${file} lost its updater wiring`);
}

// macOS support. Every one of these is invisible on Windows: transparency needs
// the private API in two places (config flag + cargo feature), the bundler needs
// a real multi-size .icns, and the menu bar needs its monochrome template icon.
// They would only blow up on a Mac, which is exactly why they are asserted here.
const tauriConfig = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'));
assert.equal(tauriConfig.app.macOSPrivateApi, true, 'macOS transparency needs app.macOSPrivateApi');
assert.match(readFileSync(join(process.cwd(), 'src-tauri', 'Cargo.toml'), 'utf8'), /"macos-private-api"/,
  'the config flag also needs the tauri cargo feature');
assert.ok(tauriConfig.bundle.icon.includes('icons/icon.icns'), 'the macOS bundler needs icons/icon.icns');
const icns = readFileSync(join(process.cwd(), 'src-tauri', 'icons', 'icon.icns'));
assert.equal(icns.toString('ascii', 0, 4), 'icns', 'icon.icns must be a real icns file');
assert.equal(icns.readUInt32BE(4), icns.length, 'the icns length field must match the file size');
for (const [file, pattern] of [
  ['src-tauri/src/tray.rs', /tray-mac\.png/],
  ['src-tauri/src/tray.rs', /icon_as_template\(true\)/],
  ['src-tauri/src/lib.rs', /ActivationPolicy::Accessory/],
  ['.github/workflows/release.yml', /aarch64-apple-darwin/],
  ['.github/workflows/release.yml', /x86_64-apple-darwin/],
]) {
  assert.match(readFileSync(join(process.cwd(), file), 'utf8'), pattern, `${file} lost its macOS wiring`);
}
assert.ok(existsSync(join(process.cwd(), 'src', 'assets', 'tray-mac.png')), 'the macOS tray template is missing');
assert.ok(existsSync(join(process.cwd(), '.github', 'workflows', 'build-check.yml')),
  'the release-free build check workflow is missing');

// A typo in a key renders as the key itself, so both sides of the lookup are checked.
for (const page of ['index.html', 'settings.html', 'mask.html', 'menu.html']) {
  const html = readFileSync(join(renderer, page), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-label|-title)?="([^"]+)"/g)].map(match => match[1]);
  assert.ok(keys.length > 0, `${page} should mark its static text for translation`);
  for (const key of keys) {
    assert.equal(typeof zhDict[key], 'string', `${page}: zh is missing ${key}`);
    assert.equal(typeof enDict[key], 'string', `${page}: en is missing ${key}`);
  }
}
const scriptKeys = new Set();
for (const name of readdirSync(join(process.cwd(), 'src', 'renderer'))) {
  if (!name.startsWith('lite-') || !name.endsWith('.ts')) continue;
  const source = readFileSync(join(process.cwd(), 'src', 'renderer', name), 'utf8');
  for (const match of source.matchAll(/liteT\('([^']+)'/g)) scriptKeys.add(match[1]);
}
assert.ok(scriptKeys.size > 10, `the lite scripts should translate through liteT (found ${scriptKeys.size})`);
for (const key of scriptKeys) {
  assert.equal(typeof zhDict[key], 'string', `zh is missing ${key}`);
  assert.equal(typeof enDict[key], 'string', `en is missing ${key}`);
}

assert.match(readFileSync(join(renderer, 'lite-menu.css'), 'utf8'), /#fff8f2/);
assert.match(readFileSync(join(renderer, 'lite-settings.css'), 'utf8'), /header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/);

// The two READMEs ship their own screenshots: the English one pointed at the
// Chinese panel for a while, which is exactly what this guards against.
for (const [readme, expected] of [
  ['README.md', ['docs/screenshots/lightweight-pet.png', 'docs/screenshots/lightweight-settings.png']],
  ['README-EN.md', ['docs/screenshots/lightweight-pet-en.png', 'docs/screenshots/lightweight-settings-en.png']],
]) {
  const markdown = readFileSync(join(process.cwd(), readme), 'utf8');
  const images = [...markdown.matchAll(/!\[[^\]]*\]\((docs\/screenshots\/[^)]+)\)/g)].map(match => match[1]);
  assert.deepEqual(images, expected, `${readme} should embed the ${readme.includes('-EN') ? 'English' : 'Chinese'} screenshots`);
  for (const image of images) assert.ok(existsSync(join(process.cwd(), image)), `${image} is missing`);
}

const actionAtlas = join(process.cwd(), 'dist', 'assets', 'animated-pets', 'bulu-actions.webp');
const actionMeta = await sharp(actionAtlas).metadata();
assert.equal(actionMeta.width, 1024);
assert.equal(actionMeta.height, 1024);
assert.equal(actionMeta.hasAlpha, true);
for (let row = 0; row < 4; row++) {
  const frames = [];
  for (let col = 0; col < 4; col++) {
    const frame = await sharp(actionAtlas).extract({ left: col * 256, top: row * 256, width: 256, height: 256 })
      .ensureAlpha().raw().toBuffer();
    let opaque = 0;
    for (let pixel = 3; pixel < frame.length; pixel += 4) if (frame[pixel] > 16) opaque++;
    assert.ok(opaque > 1000, `Bulu action row ${row}, frame ${col} is empty`);
    frames.push(frame);
  }
  assert.notDeepEqual(frames[0], frames[1], `Bulu action row ${row} does not move`);
}

// Both dictionaries are handed to the renderer as one JSON payload, so a key
// that only exists in one of them would silently render as its own name.
assert.deepEqual(Object.keys(enDict).sort(), Object.keys(zhDict).sort(), 'zh/en dictionaries must stay in sync');
const liteKeys = Object.keys(zhDict).filter(key => key.startsWith('lite.'));
assert.ok(liteKeys.length > 40, `the lightweight pages need their own keys (found ${liteKeys.length})`);

// The renderer runtime: translate, fill {params}, and rewrite the marked-up DOM.
const textNode = { dataset: { i18n: 'lite.pet.petting' }, textContent: '' };
const labelNode = { dataset: { i18nLabel: 'lite.pet.canvas' }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
const dom = {
  documentElement: {},
  querySelectorAll: (selector) => selector === '[data-i18n]' ? [textNode]
    : selector === '[data-i18n-label]' ? [labelNode] : [],
};
const i18n = { window: { api: { getI18n: async () => ({ locale: 'en', dict: enDict }) } }, document: dom, console };
vm.createContext(i18n);
vm.runInContext(readFileSync(join(renderer, 'lite-i18n.js'), 'utf8'), i18n);
assert.equal(i18n.liteT('lite.drop.other'), 'lite.drop.other', 'before the dictionary arrives, keys fall back to themselves');
assert.equal(i18n.liteT('lite.drop.multiple', { n: 3 }), 'lite.drop.multiple');
await i18n.liteLoadDictionary();
assert.equal(i18n.liteCurrentLocale(), 'en');
assert.equal(dom.documentElement.lang, 'en');
assert.equal(textNode.textContent, enDict['lite.pet.petting']);
assert.equal(labelNode.attributes['aria-label'], enDict['lite.pet.canvas']);
assert.equal(i18n.liteT('lite.drop.multiple', { n: 3 }), 'Whoa, 3 paychecks? I am rich!');

console.log('Lightweight image validation and cutout fallback: passed');
console.log('Lightweight package contents: passed');
console.log('File-drop reactions by type: passed');
console.log('Language switching (zh / en): passed');
