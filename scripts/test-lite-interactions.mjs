import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { zhDict, enDict } = require(join(process.cwd(), 'dist', 'shared', 'i18n.js'));

let clock = 0;
let wallClock = 0;
let locale = 'zh';
let configChanged;
let actionReceived;
let updateState;
let frame;
let lastDraw;
const intervals = [];
const moves = [];
const canvasEvents = new Map();
/** Every pixel the pet window looked up while hit-testing, in backing-store px. */
const hitSamples = [];
let speechCount = 0;
const speech = { hidden: true, style: {}, get textContent() { return this.line || ''; }, set textContent(value) { this.line = value; speechCount++; } };
const hearts = { hidden: true, style: {}, offsetWidth: 20 };
const dream = { hidden: true, style: {}, textContent: '' };
class FakeDate extends Date {
  constructor(value = wallClock) { super(value); }
  static now() { return wallClock; }
}
const drawing = {
  clearRect() {}, save() {}, restore() {}, drawImage(...args) { lastDraw = args; }, translate() {}, scale() {},
  getImageData: (x, y) => { hitSamples.push([x, y]); return { data: [0, 0, 0, 255] }; },
};
const canvas = {
  style: {}, getContext: () => drawing,
  addEventListener: (name, callback) => canvasEvents.set(name, callback),
};
const api = {
  getConfig: async () => ({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false,
    standReminderEnabled: true, standReminderMinutes: 5, hourlyChime: true }),
  getI18n: async () => ({ locale, dict: locale === 'en' ? enDict : zhDict }),
  onConfigChanged: callback => { configChanged = callback; },
  onPetAction: callback => { actionReceived = callback; },
  onFileDrop: () => () => {},
  setClickThrough() {}, autoMoveStop() {}, autoMoveStart() {},
  dragBegin() {}, dragMove() {}, dragEnd() {},
  getWindowPosition: async () => [100, 100],
  getWindowCenterTarget: async () => [810, 294],
  moveWindowTo: async (x, y) => { moves.push([x, y]); },
  windowEdgeGaps: async () => null,
  updateCheck: async () => ({ status: 'available', currentVersion: '0.6.5', version: '0.6.6',
    autoCheck: true, autoDownload: true, channel: 'stable' }),
  updateDownload: async () => ({ status: 'downloaded', currentVersion: '0.6.5', version: '0.6.6',
    autoCheck: true, autoDownload: true, channel: 'stable' }),
  onUpdateState: callback => { updateState = callback; },
};
const browser = {
  // A non-1 ratio on purpose: the canvas backing store is 300*dpr while every
  // hit test is fed CSS coordinates, and mixing the two broke dragging and the
  // right-click menu on any scaled display.
  api, devicePixelRatio: 2,
  setInterval: callback => { intervals.push(callback); return intervals.length; },
  setTimeout: (callback, delay) => {
    if (delay === 32) { clock += 125; queueMicrotask(callback); }
    return 1;
  },
  clearTimeout() {}, addEventListener() {},
};
const context = {
  window: browser, document: {
    body: { style: {} },
    documentElement: {},
    querySelectorAll: () => [],
    getElementById: id => ({ 'pet-canvas': canvas, 'pet-speech': speech, 'pet-hearts': hearts, 'pet-dream': dream })[id],
  },
  // The atlas is 16 frames wide at 192 px per frame (see scripts/build-bulu-actions.mjs).
  Image: class { complete = true; naturalWidth = 512; set src(url) { if (url.includes('bulu-actions')) this.naturalWidth = 16 * 192; } },
  performance: { now: () => clock }, Date: FakeDate,
  requestAnimationFrame(callback) { frame = callback; }, queueMicrotask, Math, Number, Promise, console,
};
vm.createContext(context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-i18n.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-app.js'), 'utf8'), context);
await new Promise(resolve => setImmediate(resolve));

for (const x of [110, 135, 115, 140]) {
  clock += 50;
  canvasEvents.get('mousemove')({ offsetX: x, offsetY: 175, buttons: 0 });
}
assert.equal(speech.textContent, '好舒服呀～');
assert.equal(hearts.hidden, false);

// Regression: the pet is click-through unless the hit test finds its pixels. The
// backing store is 300*dpr while the hit test receives CSS coordinates, so the
// lookup has to be scaled — otherwise dragging and the right-click menu die on
// every display that is not at 100%.
assert.ok(hitSamples.length > 0, 'moving the pointer should hit-test the pet');
assert.ok(hitSamples.some(([x, y]) => x === 140 * 2 && y === 175 * 2),
  `hit test must read device pixels, got ${JSON.stringify(hitSamples.slice(0, 4))}`);

// Switching config.locale must swap the dictionary the pet speaks from.
clock += 3300; // clear the petting cooldown
locale = 'en';
configChanged({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false, locale: 'en',
  standReminderEnabled: true, standReminderMinutes: 5, hourlyChime: true });
await new Promise(resolve => setImmediate(resolve));
for (const x of [110, 135, 115, 140]) {
  clock += 50;
  canvasEvents.get('mousemove')({ offsetX: x, offsetY: 175, buttons: 0 });
}
assert.equal(speech.textContent, 'That feels nice~');
locale = 'zh';
configChanged({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false, locale: 'zh',
  standReminderEnabled: true, standReminderMinutes: 5, hourlyChime: true });
await new Promise(resolve => setImmediate(resolve));
assert.equal(context.liteCurrentLocale(), 'zh');

wallClock = 300_001;
intervals[0]();
await new Promise(resolve => setImmediate(resolve));
assert.ok(moves.length > 2, 'standing reminder should move through intermediate positions');
assert.deepEqual(moves.at(-1), [810, 294]);
assert.equal(speech.textContent, '老板，该站起来活动活动了！');

configChanged({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false,
  standReminderEnabled: true, standReminderMinutes: 7 });
const beforeCustom = moves.length;
wallClock += 6 * 60_000;
intervals[0]();
assert.equal(moves.length, beforeCustom, 'custom interval must wait the full duration');
wallClock += 60_001;
intervals[0]();
await new Promise(resolve => setImmediate(resolve));
assert.ok(moves.length > beforeCustom, 'custom interval should trigger a new reminder');

configChanged({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false,
  standReminderEnabled: false, standReminderMinutes: 5 });
const moveCount = moves.length;
wallClock += 1_000_000;
intervals[0]();
assert.equal(moves.length, moveCount, 'disabled reminders should not move the pet');

speech.hidden = true;
frame(clock += 91_000);
assert.equal(dream.hidden, true, 'dream should wait until the pet settles to sleep');
frame(clock += 1300);
assert.equal(dream.hidden, false, 'sleeping pet should display a dream bubble');
assert.ok(dream.textContent, 'dream bubble should contain an icon');
canvasEvents.get('mousedown')({ button: 0, offsetX: 120, offsetY: 175, screenX: 100, screenY: 100 });
canvasEvents.get('mousemove')({ offsetX: 120, offsetY: 175, screenX: 100, screenY: 100, buttons: 0 });
frame(clock += 20);
assert.equal(dream.hidden, true, 'interaction should dismiss the dream bubble');

wallClock = 3_600_050;
intervals[0]();
assert.equal(speech.textContent, `现在是 ${new Date(wallClock).getHours()} 点啦～`);
const chimed = speechCount;
wallClock += 10_000;
intervals[0]();
assert.equal(speechCount, chimed, 'hourly announcement should happen once');
configChanged({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false,
  standReminderEnabled: false, standReminderMinutes: 5, hourlyChime: false });
wallClock = 7_200_050;
intervals[0]();
assert.equal(speechCount, chimed, 'disabled hourly announcement should stay silent');
configChanged({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false,
  standReminderEnabled: false, standReminderMinutes: 5, hourlyChime: true });
wallClock = 10_900_000;
intervals[0]();
assert.equal(speechCount, chimed, 'a missed hour after suspension should not announce late');

configChanged({ skin: 'bulu', petScale: 1, opacity: 1, autoMove: false,
  standReminderEnabled: false, standReminderMinutes: 5, hourlyChime: false });
actionReceived('wave');
frame(clock += 100);
assert.equal(lastDraw[3], 192, 'Bulu actions should use the dedicated action cell size');
frame(clock += 600);
// 700 ms into a 2100 ms clip lands on frame 5 of the 16-frame animation.
assert.equal(lastDraw[1], 5 * 192, 'wave should advance through its frames');
actionReceived('groom');
frame(clock += 1100);
assert.equal(lastDraw[2], 1 * 192, 'groom should use its own action row');
// The fifth action (scratch) lives on the last row of the atlas.
actionReceived('scratch');
frame(clock += 1100);
assert.equal(lastDraw[2], 4 * 192, 'scratch should use the fifth pose row');
actionReceived('unknown');
assert.equal(browser.__prismooLiteState().action, 'scratch', 'unknown actions should be ignored');
frame(clock += 2600);
assert.equal(browser.__prismooLiteState().action, null, 'action should return to normal playback');

canvasEvents.get('mousedown')({ button: 0, offsetX: 120, offsetY: 175, screenX: 100, screenY: 100 });
canvasEvents.get('mousemove')({ offsetX: 140, offsetY: 175, screenX: 126, screenY: 100, buttons: 1 });
frame(clock += 125);
assert.equal(lastDraw[2], 128, 'dragging should use the walking sprite row');

// An update is announced once per status change; the per-chunk download progress
// events must not re-trigger the bubble.
const update = (status, extra = {}) => updateState({ status, currentVersion: '0.6.5',
  autoCheck: true, autoDownload: true, channel: 'stable', ...extra });
update('available', { version: '0.9.0', autoDownload: false });
assert.equal(speech.textContent, '✨ 发现新版本 v0.9.0，去设置里就能下载～');
const announced = speechCount;
update('downloading', { version: '0.9.0', progress: { percent: 12, transferred: 1, total: 10, bytesPerSecond: 0 } });
update('downloading', { version: '0.9.0', progress: { percent: 64, transferred: 6, total: 10, bytesPerSecond: 0 } });
assert.equal(speechCount, announced, 'download progress must not repeat the bubble');
update('downloaded', { version: '0.9.0' });
assert.equal(speech.textContent, '✅ v0.9.0 已下载完成，重启后生效');

console.log('Petting, dreams, actions, reminders, language switch and update notice: passed');
