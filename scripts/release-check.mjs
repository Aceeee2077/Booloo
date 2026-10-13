// ============================================================================
// Release pre-flight: the things a maintainer forgets at 1 a.m.
//
// Five checks, all offline:
//   1. every file that carries the version agrees (package.json, package-lock,
//      tauri.conf.json, Cargo.toml) — the release workflow's own comments say
//      "they have to agree", which is a rule a human has to remember today;
//   2. CHANGELOG.md has an entry for that version, so a release cannot ship
//      without saying what changed — when the file is there at all, because this
//      repository keeps the changelog out of Git (.gitignore:144) as the
//      maintainer's own release notes;
//   3. the tag being built matches it (`--tag vX.Y.Z`, passed by release.yml);
//   4. no signing key material is inside the repository — the updater's private
//      key once lived in a stray `~/.tauri/` folder in the working copy, created
//      by a shell that did not expand `~`. It was gitignored, which only means
//      Git would not have caught it; a zip of that folder would have leaked it;
//   5. the working tree is clean (skipped with --no-git).
//
// Usage:  npm run release:check
//         node scripts/release-check.mjs --no-git
//         node scripts/release-check.mjs --tag v0.6.23 --no-git
// ============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const checkGit = !args.includes('--no-git');
const tag = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : null;

const problems = [];
/** Checks that did not apply here, reported so a CI log is not silently thinner. */
const notes = [];
const read = (id) => readFileSync(join(ROOT, id), 'utf8');
const readJson = (id) => JSON.parse(read(id));

// ---------- 1. one version, four files ----------

const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const tauri = readJson('src-tauri/tauri.conf.json');
// `version` appears in [dependencies] too, so only the [package] table counts.
const cargoPackage = (() => {
  const lines = read('src-tauri/Cargo.toml').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '[package]');
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\[/.test(lines[i])) break;
    const match = /^version\s*=\s*"([^"]+)"/.exec(lines[i]);
    if (match) return match[1];
  }
  return null;
})();

const version = pkg.version;
const carriers = [
  ['package-lock.json', lock.version],
  ['package-lock.json packages."".version', lock.packages?.['']?.version],
  ['src-tauri/tauri.conf.json', tauri.version],
  ['src-tauri/Cargo.toml [package]', cargoPackage],
];
for (const [file, found] of carriers) {
  if (found !== version) {
    problems.push(`version drift: ${file} says ${found}, package.json says ${version}`);
  }
}
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  problems.push(`package.json version ${version} is not a plain x.y.z semver`);
}

// ---------- 2. the changelog entry ----------

// CHANGELOG.md is deliberately not in the repository: it is the maintainer's local
// record (the same call that keeps release.md out — see commit 226d602). So the
// check belongs to the machine that writes it, which is the one that tags a release,
// and a CI runner that was never given the file is told so instead of failing.
if (existsSync(join(ROOT, 'CHANGELOG.md'))) {
  const changelog = read('CHANGELOG.md');
  if (!new RegExp(`^## \\[${String(version).replace(/\./g, '\\.')}\\]`, 'm').test(changelog)) {
    problems.push(`CHANGELOG.md has no "## [${version}]" section — write one before tagging`);
  }
  if (!/^## \[Unreleased\]/m.test(changelog)) {
    problems.push('CHANGELOG.md is missing its "## [Unreleased]" section');
  }
} else {
  notes.push('CHANGELOG.md is not in this checkout (it is a local file) — the changelog check is skipped');
}

// ---------- 3. the tag ----------

if (tag && tag !== `v${version}`) {
  problems.push(`the tag being built (${tag}) does not match the version (v${version})`);
}

// ---------- 4. no key material inside the tree ----------

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', '.npm-cache', 'pet_output']);
const KEY_FILE = /\.(key|pem|p12|pfx)$/i;
/** A minisign key file names itself in its first line. */
const SECRET_CONTENT = /untrusted comment:\s*minisign encrypted secret key/i;

function scanKeys(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanKeys(full, found);
      continue;
    }
    const where = relative(ROOT, full).replace(/\\/g, '/');
    if (KEY_FILE.test(entry.name)) {
      found.push(`${where} — a private key file does not belong in the repository`);
    } else if (statSync(full).size < 4096 && SECRET_CONTENT.test(readFileSync(full, 'utf8'))) {
      found.push(`${where} — holds a minisign secret key`);
    }
  }
  return found;
}
const strayKeys = scanKeys(ROOT);
if (strayKeys.length) {
  problems.push(
    'signing key material inside the working tree:\n  ' +
      strayKeys.join('\n  ') +
      '\n  Keep it outside the checkout (normally ~/.tauri/) or in the CI secret\n' +
      '  TAURI_SIGNING_PRIVATE_KEY only.',
  );
}

// ---------- 5. the tree is what is about to be tagged ----------

if (checkGit) {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (status) {
    problems.push(`uncommitted changes — a release is cut from a committed tree:\n  ${status.split('\n').join('\n  ')}`);
  }
}

if (problems.length) {
  console.error(`✗ release check failed for v${version}\n`);
  for (const problem of problems) console.error(`- ${problem}\n`);
  for (const note of notes) console.error(`note: ${note}\n`);
  process.exit(1);
}

console.log(`✓ release check: v${version} is the version in package.json, the lockfile, tauri.conf.json and Cargo.toml; no key material in the tree${notes.length ? '' : '; the changelog has it'}`);
for (const note of notes) console.log(`  note: ${note}`);
console.log(`  next: git add -A && git commit -m "release version v${version}" && git tag -a v${version} -m "release version v${version}"`);
