// ============================================================================
// Build helper: copy the renderer's HTML/CSS and assets into dist/ (tsc only
// compiles .ts)
// ============================================================================

import { cpSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

mkdirSync(join(ROOT, 'dist', 'renderer'), { recursive: true });

const files = [
  'index.html',
  'settings.html',
  'mask.html',
  'menu.html',
  'lite.css',
  'lite-settings.css',
  'lite-mask.css',
  'lite-menu.css',
];
for (const f of files) {
  cpSync(join(ROOT, 'src', 'renderer', f), join(ROOT, 'dist', 'renderer', f));
}
// Compile the legacy modules for source compatibility, but ship only the scripts
// loaded by the lightweight pages.
const runtimeScripts = new Set(['lite-i18n.js', 'lite-day.js', 'lite-affinity.js', 'lite-care.js', 'lite-api.js', 'lite-image.js', 'lite-file-reaction.js', 'lite-app.js', 'lite-settings.js', 'lite-mask.js', 'lite-menu.js']);
for (const file of readdirSync(join(ROOT, 'dist', 'renderer'))) {
  if (file.endsWith('.js') && !runtimeScripts.has(file)) unlinkSync(join(ROOT, 'dist', 'renderer', file));
}
mkdirSync(join(ROOT, 'dist', 'assets', 'animated-pets'), { recursive: true });
// Bulu is the only built-in character; every other look is an imported picture.
for (const file of ['bulu.png', 'bulu-actions.webp']) {
  cpSync(join(ROOT, 'src', 'assets', 'animated-pets', file), join(ROOT, 'dist', 'assets', 'animated-pets', file));
}

console.log('✓ 已拷贝渲染层页面与资源到 dist/');
