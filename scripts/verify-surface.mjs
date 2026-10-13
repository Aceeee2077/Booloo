// ============================================================================
// Dead-surface gate: every config key and every UI string needs a reader.
//
// The lightweight rewrite dropped whole features (AI chat, weather, sound, a
// click sound, the photo-pet eye overlay) but kept their storage in the config
// defaults and their strings in the dictionary. Nothing can see that from the
// outside: an unused config key is valid JSON and an unused string is a valid
// string, so the app ships a schema nobody reads and text nobody renders.
//
// This uses the same idea as verify-comments.mjs — a source-level check with no
// dependencies — and it also enforces the two invariants the runtime relies on:
// the Rust defaults and the TypeScript `AppConfig` must list the same keys, and
// both dictionaries must list the same strings. `src-tauri/src/i18n.rs` only
// proves that for the *generated* resources/i18n.json; this checks the source.
//
// Usage: node scripts/verify-surface.mjs
//   --list   print the unused keys but exit 0 (for looking around)
// ============================================================================

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST_ONLY = process.argv.includes('--list');

// Files that *declare* a surface rather than use it. `config.rs` holds the
// defaults and the migrations, `types.ts` the config shape, `i18n.ts` the
// dictionary, and the two "-types" files are design documents for systems this
// build does not implement yet (docs/accessory-system.md, docs/animation-system.md).
const DECLARATIONS = new Set([
  'src-tauri/src/config.rs',
  'src/shared/types.ts',
  'src/shared/i18n.ts',
  'src/shared/accessory-types.ts',
  'src/renderer/anim-types.ts',
]);

// Reserved for a documented, not-yet-built system. Keep this list short and name
// the document: an entry here is a promise about future work, not an escape
// hatch for a dead key.
const RESERVED_CONFIG_KEYS = new Set(['equippedAccessories', 'accessoryDebug']);
const RESERVED_I18N_PREFIXES = ['wardrobe.']; // docs/accessory-system.md

// Keys the code builds at runtime, so no literal of them exists anywhere:
// lite-affinity.ts composes `affinity.level${n}` and lite-settings.ts
// `lite.care.level.${full|ok|hungry|starving}`.
const DYNAMIC_I18N_KEYS = [/^affinity\.level[1-5]$/, /^lite\.care\.level\.[a-z]+$/];

/** Every file whose contents count as "this surface is read". */
const READER_EXTENSIONS = ['.ts', '.html', '.css', '.rs', '.mjs', '.json'];
const READER_ROOTS = ['src', 'src-tauri/src', 'scripts'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (READER_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

/**
 * Drop comment-only lines before looking for a reader.
 *
 * "The affinity model:" in a comment is not a read of `AppConfig.model`, and the
 * keys are ordinary English words often enough (model, theme, sound, action) that
 * prose would otherwise keep a dead key alive. Only whole comment lines go: a
 * trailing `// …` after code stays, because cutting a URL inside a string would
 * hide the code behind it and report a live key as dead.
 */
function stripCommentLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|#|\*|\/\*|<!--)/.test(line))
    .join('\n');
}

const readers = [];
for (const dir of READER_ROOTS) {
  for (const file of walk(join(ROOT, dir))) {
    const id = relative(ROOT, file).replace(/\\/g, '/');
    if (DECLARATIONS.has(id) || id === 'scripts/verify-surface.mjs') continue;
    readers.push({ id, text: stripCommentLines(readFileSync(file, 'utf8')) });
  }
}

const read = (id) => readFileSync(join(ROOT, id), 'utf8');

// ---------- the config surface ----------

/** Top-level keys of the `defaults()` JSON object: the level the app reads. */
function configDefaults() {
  const lines = read('src-tauri/src/config.rs').split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes('pub fn defaults'));
  const keys = [];
  // The object runs from the `json!({` line to the `})` that closes it at the
  // function's own indentation — the same shape `cargo fmt` keeps.
  let i = lines.findIndex((line, index) => index > start && line.includes('json!({'));
  for (i++; i < lines.length; i++) {
    const line = lines[i];
    if (/^    \}\)/.test(line)) break;
    const match = /^        "([A-Za-z0-9_]+)":/.exec(line);
    if (match) keys.push(match[1]);
  }
  return keys;
}

/** Field names of `interface AppConfig` in src/shared/types.ts. */
function configFields() {
  const lines = read('src/shared/types.ts').split(/\r?\n/);
  const start = lines.findIndex((line) => /^interface AppConfig\b/.test(line));
  const keys = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\}/.test(lines[i])) break;
    const match = /^ {2}([A-Za-z_][A-Za-z0-9_]*)\??:/.exec(lines[i]);
    if (match) keys.push(match[1]);
  }
  return keys;
}

// ---------- the string surface ----------

/** Every key of one dictionary in src/shared/i18n.ts. */
function dictionaryKeys(name) {
  const lines = read('src/shared/i18n.ts').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`export const ${name}`));
  const keys = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\};/.test(lines[i])) break;
    const quoted = /^ {2}'([^']+)':/.exec(lines[i]);
    const bare = /^ {2}([A-Za-z_][A-Za-z0-9_]*):/.exec(lines[i]);
    if (quoted) keys.push(quoted[1]);
    else if (bare) keys.push(bare[1]);
  }
  return keys;
}

// ---------- usage ----------

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Is this config key read anywhere?
 *
 * The match is deliberately access-shaped (`.key`, `"key"`, `key:`) instead of a
 * bare word: half these names are ordinary English ("model", "theme", "sound"),
 * so a word-boundary search finds prose in a comment and reports a dead key as
 * live. The cost is the opposite risk, a CSS property named like a key keeping
 * it alive — which errs towards keeping code, not deleting it.
 */
function configKeyUsed(key) {
  const k = escape(key);
  const pattern = new RegExp(`\\.${k}\\b|["'\`]${k}["'\`]|\\b${k}\\s*:`, 'm');
  return readers.some(({ text }) => pattern.test(text));
}

/** Is this string key referenced anywhere (quoted, in markup or in a template)? */
function i18nKeyUsed(key) {
  const k = escape(key);
  const pattern = new RegExp(`["'\`]${k}["'\`]`, 'm');
  return readers.some(({ text }) => pattern.test(text));
}

// ---------- the check ----------

const problems = [];

const fromRust = configDefaults();
const fromTypes = configFields();
const onlyRust = fromRust.filter((key) => !fromTypes.includes(key));
const onlyTypes = fromTypes.filter((key) => !fromRust.includes(key));
if (onlyRust.length || onlyTypes.length) {
  problems.push(
    'config defaults() and interface AppConfig disagree:\n' +
      `  only in src-tauri/src/config.rs: ${onlyRust.join(', ') || '(none)'}\n` +
      `  only in src/shared/types.ts:   ${onlyTypes.join(', ') || '(none)'}`,
  );
}

const zhKeys = dictionaryKeys('zhDict');
const enKeys = dictionaryKeys('enDict');
const onlyZh = zhKeys.filter((key) => !enKeys.includes(key));
const onlyEn = enKeys.filter((key) => !zhKeys.includes(key));
if (onlyZh.length || onlyEn.length) {
  problems.push(
    'the two dictionaries disagree:\n' +
      `  only in zhDict: ${onlyZh.join(', ') || '(none)'}\n` +
      `  only in enDict: ${onlyEn.join(', ') || '(none)'}`,
  );
}

const isReserved = (key) => RESERVED_CONFIG_KEYS.has(key);
const isReservedString = (key) => RESERVED_I18N_PREFIXES.some((prefix) => key.startsWith(prefix));

const deadConfigKeys = fromRust.filter((key) => !isReserved(key) && !configKeyUsed(key));
const deadStrings = zhKeys.filter(
  (key) => !isReservedString(key) && !DYNAMIC_I18N_KEYS.some((p) => (p instanceof RegExp ? p.test(key) : p === key)) && !i18nKeyUsed(key),
);

if (deadConfigKeys.length) {
  problems.push(
    `config keys with no reader (${deadConfigKeys.length}) — delete the key from ` +
      `src-tauri/src/config.rs and src/shared/types.ts, and add it to the retired list in ` +
      `src-tauri/src/config.rs so existing files are cleaned up:\n  ${deadConfigKeys.join(', ')}`,
  );
}
if (deadStrings.length) {
  const byNamespace = new Map();
  for (const key of deadStrings) {
    const ns = `${key.split('.')[0]}.`;
    byNamespace.set(ns, (byNamespace.get(ns) ?? 0) + 1);
  }
  const summary = [...byNamespace].sort((a, b) => b[1] - a[1]).map(([ns, n]) => `${ns}${n}`).join(' ');
  problems.push(
    `UI strings no reader renders (${deadStrings.length} of ${zhKeys.length}, both locales) ` +
      `— delete them from zhDict and enDict in src/shared/i18n.ts:\n  by namespace: ${summary}\n  ${deadStrings.join(', ')}`,
  );
}

const counts = `checked ${fromRust.length} config keys and ${zhKeys.length} strings against ${readers.length} files`;
if (problems.length) {
  console.error(`✗ dead surface found (${counts})\n`);
  for (const problem of problems) console.error(`${problem}\n`);
  if (!LIST_ONLY) process.exit(1);
} else {
  console.log(`✓ no dead surface (${counts})`);
}
