// ============================================================================
// Regenerates the README screenshots in docs/screenshots/.
//
// The pet window and the settings panel are Tauri webviews, and the panel is
// plain HTML + CSS, so rendering the shipped page against a stub backend is an
// honest picture of the UI — including its zh / en switch, which is why every
// image exists twice. The desktop picture is a simulated desktop (the pet is a
// transparent always-on-top window; a real screen capture would need a DWM
// composition pass).
//
// Usage:
//   npm run screenshots            # both languages
//   npm run screenshots -- en      # English only
//   npm run screenshots -- zh      # Chinese only
//
// Needs `npm run build` first (it renders dist/renderer/*) and a local Chrome or
// Edge; set PRISMOO_CHROME to point at one explicitly.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RENDERER = join(ROOT, 'dist', 'renderer');
const OUT = join(ROOT, 'docs', 'screenshots');
const I18N = join(ROOT, 'src-tauri', 'resources', 'i18n.json');

const CANDIDATES = [
  process.env.PRISMOO_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const browser = CANDIDATES.find((candidate) => existsSync(candidate));
if (!browser) {
  console.error('No Chrome or Edge found. Set PRISMOO_CHROME to the executable.');
  process.exit(1);
}
if (!existsSync(join(RENDERER, 'settings.html'))) {
  console.error('dist/renderer is missing — run `npm run build` first.');
  process.exit(1);
}

const requested = process.argv.slice(2).filter((arg) => arg === 'zh' || arg === 'en');
const languages = requested.length ? requested : ['zh', 'en'];
const dictionary = JSON.parse(readFileSync(I18N, 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'prismoo-shots-'));

/** A screenshot of `file` at exactly `width`x`height`, written to `target`. */
function shoot(file, width, height, target) {
  // Chrome refuses to share a profile between runs, so every shot gets its own.
  const profile = `profile-${target.slice(target.lastIndexOf('\\') + 1).replace(/[^\w.-]/g, '_')}`;
  execFileSync(browser, [
    '--headless=new',
    // Chrome's own sandbox cannot start inside every CI/agent shell.
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${join(scratch, profile)}`,
    '--virtual-time-budget=2500',
    `--window-size=${width},${height}`,
    `--screenshot=${target}`,
    `file:///${file.replace(/\\/g, '/')}`,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  return target;
}

/** The DOM after the page settles — used to prove the right language rendered. */
function settledDom(file) {
  return execFileSync(browser, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${join(scratch, 'profile-dom')}`,
    '--virtual-time-budget=2500',
    '--dump-dom',
    `file:///${file.replace(/\\/g, '/')}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * The stub backend: lite-api.ts talks to `window.__TAURI__.core.invoke`, so the
 * pages run their real code paths against a fixed config + the real dictionary.
 */
function stubSource(locale) {
  const config = {
    skin: 'cat',
    currentPetId: 'cat',
    petScale: 1,
    opacity: 0.95,
    autoMove: true,
    fileDropReactions: true,
    standReminderEnabled: true,
    standReminderMinutes: 10,
    hourlyChime: true,
    locale,
  };
  return `window.__TAURI__ = (() => {
  let config = ${JSON.stringify(config)};
  const dict = ${JSON.stringify(dictionary)};
  const results = {
    config_get: () => config,
    config_set: ({ patch }) => (config = { ...config, ...patch }),
    i18n_get: () => ({ locale: config.locale, dict: dict[config.locale] || dict.zh }),
    autolaunch_get: () => config.autoLaunch === true,
    autolaunch_set: ({ enabled }) => (config.autoLaunch = enabled),
    custom_get: () => ({ ok: false }),
  };
  return {
    core: {
      convertFileSrc: (path) => path,
      invoke: async (name, args) => (results[name] ? results[name](args || {}) : null),
    },
    event: { listen: async () => () => {} },
  };
})();
`;
}

function settingsPage(locale) {
  const page = join(scratch, `settings-${locale}.html`);
  const html = readFileSync(join(RENDERER, 'settings.html'), 'utf8');
  // The stub has to win the race against the first `getI18n` call.
  writeFileSync(page, html.replace('<script src="./lite-i18n.js"></script>',
    '<script src="./stub.js"></script>\n  <script src="./lite-i18n.js"></script>'), 'utf8');
  return page;
}

/** A simulated desktop: wallpaper, a window, the taskbar and the pet on top. */
function desktopPage(locale) {
  const greeting = (dictionary[locale] || {})['bubble.greeting'] || 'Prismoo';
  const html = `<!doctype html>
<html lang="${locale === 'en' ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 900px; height: 520px; overflow: hidden;
    font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
  body { background: linear-gradient(135deg, #f2f6fb 0%, #e2eaf4 52%, #d3dfee 100%); }
  .window { position: absolute; left: 52px; top: 34px; width: 656px; height: 386px;
    background: #fff; border-radius: 14px;
    box-shadow: 0 20px 48px rgba(58, 78, 108, .16), 0 2px 6px rgba(58, 78, 108, .07); }
  .titlebar { display: flex; align-items: center; gap: 7px; height: 36px; padding: 0 16px;
    border-bottom: 1px solid #eef1f6; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #e4e9f0; }
  .dot.a { background: #f2c4c1; } .dot.b { background: #f5e0b9; } .dot.c { background: #c9e6cf; }
  .body { display: flex; gap: 26px; padding: 22px 26px; }
  .lines { flex: 1; display: flex; flex-direction: column; gap: 12px; }
  .bar { height: 10px; border-radius: 5px; background: #eef1f6; }
  .art { width: 208px; height: 208px; border-radius: 12px; background: #f3f6fa; }
  .taskbar { position: absolute; left: 0; bottom: 0; display: flex; align-items: center;
    gap: 12px; width: 100%; height: 46px; padding: 0 20px;
    background: rgba(255, 255, 255, .78); border-top: 1px solid rgba(255, 255, 255, .95); }
  .icon { width: 26px; height: 26px; border-radius: 8px; background: #e6ecf4; }
  .icon.cat { background: #f7dcc8; } .icon.warm { background: #f9e6d3; }
  .bubble { position: absolute; left: 402px; top: 176px; max-width: 268px;
    padding: 13px 17px; border-radius: 16px; background: #fff; color: #513a2c;
    font-size: 16px; line-height: 1.35;
    box-shadow: 0 12px 30px rgba(58, 78, 108, .15); }
  .bubble::after { content: ""; position: absolute; right: 46px; bottom: -8px;
    width: 18px; height: 18px; border-radius: 3px; background: #fff; transform: rotate(45deg); }
  .pet { position: absolute; left: 556px; top: 286px; width: 196px; height: 196px;
    background-image: url(./pet.png); background-size: 400% 400%; background-position: 0 0;
    filter: drop-shadow(0 14px 18px rgba(40, 60, 90, .26)); }
</style></head><body>
  <div class="window">
    <div class="titlebar"><span class="dot a"></span><span class="dot b"></span><span class="dot c"></span></div>
    <div class="body">
      <div class="lines">
        <div class="bar" style="width: 74%"></div>
        <div class="bar" style="width: 92%"></div>
        <div class="bar" style="width: 58%"></div>
        <div class="bar" style="width: 83%"></div>
        <div class="bar" style="width: 40%"></div>
      </div>
      <div class="art"></div>
    </div>
  </div>
  <div class="taskbar">
    <span class="icon cat"></span><span class="icon"></span><span class="icon warm"></span>
    <span class="icon"></span><span class="icon"></span>
  </div>
  <div class="bubble">${greeting}</div>
  <div class="pet"></div>
</body></html>`;
  const page = join(scratch, `desktop-${locale}.html`);
  writeFileSync(page, html, 'utf8');
  return page;
}

copyFileSync(join(ROOT, 'src', 'assets', 'animated-pets', 'cat.png'), join(scratch, 'pet.png'));
for (const asset of ['lite-i18n.js', 'lite-api.js', 'lite-image.js', 'lite-settings.js', 'lite-settings.css']) {
  copyFileSync(join(RENDERER, asset), join(scratch, asset));
}

const checks = {
  zh: { expect: ['选择桌宠', '宠物大小', '透明度', '站立提醒'], reject: ['Pet size', 'Opacity'] },
  en: { expect: ['Choose your pet', 'Pet size', 'Opacity', 'Standing reminder'], reject: ['选择桌宠', '宠物大小'] },
};

/**
 * How tall the settings panel really is, so the screenshot is neither clipped nor
 * mostly empty padding. The panel grew past 780 px once the language selector was
 * added — a fixed height silently cut the last row off.
 */
async function panelHeight(file, width) {
  const probe = join(scratch, `probe-${Math.random().toString(36).slice(2)}.png`);
  shoot(file, width, 1400, probe);
  const { data, info } = await sharp(probe).raw().toBuffer({ resolveWithObject: true });
  let last = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      const [r, g, b] = [data[offset], data[offset + 1], data[offset + 2]];
      // Anything that is not the panel's #fff8f2 background.
      if (!(r > 243 && g > 234 && b > 226)) { last = y; break; }
    }
  }
  unlinkSync(probe);
  return Math.max(520, Math.min(1400, last + 18));
}

mkdirSync(OUT, { recursive: true });
for (const locale of languages) {
  writeFileSync(join(scratch, 'stub.js'), stubSource(locale), 'utf8');
  const suffix = locale === 'en' ? '-en' : '';

  const settingsFile = settingsPage(locale);
  const dom = settledDom(settingsFile);
  for (const text of checks[locale].expect) {
    if (!dom.includes(text)) throw new Error(`settings page did not render "${text}" for ${locale}`);
  }
  for (const text of checks[locale].reject) {
    if (dom.includes(text)) throw new Error(`settings page leaked "${text}" into ${locale}`);
  }
  const height = await panelHeight(settingsFile, 680);
  console.log(`✓ docs/screenshots/lightweight-settings${suffix}.png (${locale})`,
    shoot(settingsFile, 680, height, join(OUT, `lightweight-settings${suffix}.png`)));

  console.log(`✓ docs/screenshots/lightweight-pet${suffix}.png (${locale})`,
    shoot(desktopPage(locale), 900, 520, join(OUT, `lightweight-pet${suffix}.png`)));
}

console.log(`\nDone — rendered with ${browser}`);
console.log(`Scratch files kept in ${scratch}`);
