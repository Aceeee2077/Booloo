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
let frame;
let lastDraw;
const intervals = [];
const moves = [];
const canvasEvents = new Map();
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
  getImageData: () => ({ data: [0, 0, 0, 255] }),
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
};
const browser = {
  api, devicePixelRatio: 1,
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
  Image: class { complete = true; naturalWidth = 512; set src(url) { if (url.includes('bulu-actions')) this.naturalWidth = 1024; } },
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
assert.equal(lastDraw[3], 256, 'Bulu action should use the dedicated 256px action frames');
frame(clock += 600);
assert.equal(lastDraw[1], 256, 'wave should advance to its raised-paw frame');
actionReceived('groom');
frame(clock += 1100);
assert.equal(lastDraw[2], 256, 'groom should use its own action row');
actionReceived('unknown');
assert.equal(browser.__prismooLiteState().action, 'groom', 'unknown actions should be ignored');
frame(clock += 2500);
assert.equal(browser.__prismooLiteState().action, null, 'action should return to normal playback');

canvasEvents.get('mousedown')({ button: 0, offsetX: 120, offsetY: 175, screenX: 100, screenY: 100 });
canvasEvents.get('mousemove')({ offsetX: 140, offsetY: 175, screenX: 126, screenY: 100, buttons: 1 });
frame(clock += 125);
assert.equal(lastDraw[2], 128, 'dragging should use the walking sprite row');

console.log('Petting, dreams, actions, hourly announcement, standing reminder, and language switch: passed');
