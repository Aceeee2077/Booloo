// ============================================================================
// Drives the Settings update panel against a fake DOM. The interesting part of
// the feature is the state machine (idle → checking → available → downloading →
// downloaded) and the buttons / progress bar it drives, which no Rust test can
// see. The backend side is covered by the app self-check (real window, real
// `update_get_state`).
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { zhDict, enDict } = require(join(process.cwd(), 'dist', 'shared', 'i18n.js'));

const RELEASES = 'https://github.com/Aceeee2077/Prismoo/releases/latest';
const events = new Map();
const elements = new Map();
const calls = { getState: 0, check: 0, download: 0, install: 0, patches: [] };
let locale = 'zh';
let updateState = () => {};
let configChanged = () => {};
let pendingCheck = null;

function makeElement(id) {
  return {
    id, value: '', checked: false, disabled: false, hidden: false, textContent: '', title: '', style: {},
    focus() { this.focused = true; }, select() { this.selected = true; },
    classList: { err: false, toggle(name, on) { if (name === 'err') this.err = !!on; }, add(name) { if (name === 'err') this.err = true; }, remove() {}, contains: () => false },
    addEventListener(name, callback) { events.set(`${id}:${name}`, callback); },
    querySelectorAll: () => [],
  };
}
const element = (id) => {
  if (!elements.has(id)) elements.set(id, makeElement(id));
  return elements.get(id);
};

const config = {
  skin: 'cat', currentPetId: 'cat', locale: 'zh', petScale: 1, opacity: 1, autoMove: false,
  fileDropReactions: true, standReminderEnabled: true, standReminderMinutes: 5, hourlyChime: true,
  autoLaunch: false, updateAutoCheck: true, updateAutoDownload: true, updateChannel: 'stable',
};
const api = {
  getI18n: async () => ({ locale, dict: locale === 'en' ? enDict : zhDict }),
  getConfig: async () => config,
  setConfig: async (patch) => {
    calls.patches.push(patch);
    Object.assign(config, patch);
    queueMicrotask(() => configChanged({ ...config }));
    return { ...config };
  },
  autoLaunchGet: async () => false,
  autoLaunchSet: async () => false,
  onConfigChanged: (callback) => { configChanged = callback; },
  onCustomImageChanged: () => {},
  onUpdateState: (callback) => { updateState = callback; },
  updateGetState: async () => {
    calls.getState++;
    return { status: 'idle', currentVersion: '0.6.5', manualUrl: RELEASES, autoCheck: true, autoDownload: true, channel: 'stable' };
  },
  updateCheck: async () => {
    calls.check++;
    // Held open so the test can observe the in-flight button state.
    return new Promise(resolve => { pendingCheck = resolve; });
  },
  updateDownload: async () => {
    calls.download++;
    return { status: 'downloaded', currentVersion: '0.6.5', version: '0.6.6',
      autoCheck: true, autoDownload: false, channel: 'stable' };
  },
  updateInstall: async () => { calls.install++; },
  closeSettings: () => {},
};

const browser = {
  api,
  addEventListener() {},
  setTimeout: (callback) => { queueMicrotask(callback); return 1; },
  clearTimeout() {},
};
const context = {
  window: browser,
  document: {
    documentElement: {},
    getElementById: element,
    querySelectorAll: (selector) => (selector === '#skins button' ? [] : []),
  },
  Math, Number, String, Promise, Error, Array, console,
};
vm.createContext(context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist', 'renderer', 'lite-i18n.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist', 'renderer', 'lite-settings.js'), 'utf8'), context);
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
await settle();

const version = element('update-version');
const status = element('update-status');
const progressRow = element('update-progress-row');
const progressBar = element('update-progress-bar');
const progressText = element('update-progress-text');
const notesBox = element('update-notes-box');
const manual = element('update-manual');
const checkButton = element('btn-check-update');
const downloadButton = element('btn-download-update');
const installButton = element('btn-install-update');
const click = (id) => events.get(`${id}:click`)();
const change = (id) => events.get(`${id}:change`)();

// Opening Settings shows the running version and an honest "not checked yet".
assert.equal(calls.getState, 1, 'the panel asks for a snapshot on open');
assert.equal(version.textContent, 'v0.6.5');
assert.equal(status.textContent, '尚未检查');
assert.equal(downloadButton.hidden, true, 'no download button before a check');
assert.equal(installButton.hidden, true);
assert.equal(progressRow.hidden, true);

// Choosing Custom must leave its number editor open. A premature save of the
// old 5-minute value broadcasts a config repaint that hides the editor.
const interval = element('stand-interval');
const customMinutes = element('stand-custom');
const customLabel = element('stand-custom-label');
interval.value = 'custom';
change('stand-interval');
await settle();
assert.equal(customLabel.hidden, false);
assert.equal(customMinutes.focused, true);
assert.equal(calls.patches.length, 0, 'selecting Custom must wait for a new value');
customMinutes.value = '7';
change('stand-custom');
await settle();
assert.equal(calls.patches.at(-1).standReminderMinutes, 7);
assert.equal(interval.value, 'custom');
calls.patches.length = 0;

// Checking offers the new version, its release notes and a download button
// (auto-download is off in this snapshot).
click('btn-check-update');
assert.equal(checkButton.disabled, true, 'no second check while one is in flight');
pendingCheck({ status: 'available', currentVersion: '0.6.5', version: '0.6.6', notes: '· 修复了若干问题',
  manualUrl: RELEASES, autoCheck: true, autoDownload: false, channel: 'stable' });
await settle();
assert.equal(calls.check, 1);
assert.equal(status.textContent, '发现新版本 v0.6.6');
assert.equal(downloadButton.hidden, false);
assert.equal(notesBox.hidden, false);
assert.equal(element('update-notes').textContent, '· 修复了若干问题');
assert.equal(checkButton.disabled, false, 'the button comes back once the check answered');

// Downloading drives the progress bar from the pushed events.
updateState({ status: 'downloading', currentVersion: '0.6.5', version: '0.6.6',
  progress: { percent: 42, transferred: 420, total: 1000, bytesPerSecond: 0 },
  autoCheck: true, autoDownload: false, channel: 'stable' });
assert.equal(progressRow.hidden, false);
assert.equal(progressBar.style.width, '42%');
assert.equal(progressText.textContent, '42%');
assert.equal(status.textContent, '正在下载… 42%');

// The finished download swaps the download button for the restart button.
updateState({ status: 'downloaded', currentVersion: '0.6.5', version: '0.6.6',
  autoCheck: true, autoDownload: false, channel: 'stable' });
assert.equal(progressRow.hidden, true);
assert.equal(downloadButton.hidden, true);
assert.equal(installButton.hidden, false);
assert.equal(status.textContent, 'v0.6.6 已就绪');
click('btn-install-update');
await settle();
assert.equal(calls.install, 1, 'the restart button installs the downloaded update');

// A manual download button appears when auto-download is off, and it asks the
// backend for the same download the background path would have started.
updateState({ status: 'available', currentVersion: '0.6.5', version: '0.6.6',
  autoCheck: true, autoDownload: false, channel: 'stable' });
assert.equal(downloadButton.hidden, false);
click('btn-download-update');
await settle();
assert.equal(calls.download, 1);

// Builds that cannot update themselves still point at the release page.
updateState({ status: 'unsupported', currentVersion: '0.6.5', manualUrl: RELEASES,
  autoCheck: true, autoDownload: true, channel: 'stable' });
assert.equal(manual.hidden, false);
assert.match(manual.textContent, /Prismoo\/releases\/latest/);
assert.equal(checkButton.disabled, true, 'an unsupported build cannot check');
assert.equal(status.textContent, '当前版本无法自动更新，请手动下载新版本');

// The preference toggles persist through config.
element('update-auto-check').checked = false;
change('update-auto-check');
element('update-auto-download').checked = false;
change('update-auto-download');
await settle();
// The patches are built inside the VM realm, so compare their shape, not their
// prototype.
assert.deepEqual(JSON.parse(JSON.stringify(calls.patches)),
  [{ updateAutoCheck: false }, { updateAutoDownload: false }]);

// A language switch re-translates the status line built from the dictionary.
locale = 'en';
configChanged({ ...config, locale: 'en' });
await settle();
assert.equal(status.textContent, 'This build cannot update itself — download new versions manually');

console.log('Settings update panel: status machine, progress and preferences: passed');
