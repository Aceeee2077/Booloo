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
/** Patches the pet window wrote back, in order (reminder bookkeeping). */
const configPatches = [];
/** What the pet window believes the config is, kept in step with the patches. */
let currentConfig = {};
/** Local day key of a timestamp, mirroring src/renderer/lite-day.ts. */
const dayKeyOf = (time) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
/** What the (stubbed) backend answers for `system_load`. */
let loadState = { available: false, cpu: null, memory: null, batteryPercent: null, charging: false };
/** Every drawImage the pet window issued, so a single frame can be asserted on. */
const drawHistory = [];
const transforms = [];
const intervals = [];
const moves = [];
const canvasEvents = new Map();
const windowEvents = new Map();
/** Every pixel the pet window looked up while hit-testing, in backing-store px. */
const hitSamples = [];
let speechCount = 0;
const speech = { hidden: true, style: {}, get textContent() { return this.line || ''; }, set textContent(value) { this.line = value; speechCount++; } };
const hearts = { hidden: true, style: {}, offsetWidth: 20 };
const dream = { hidden: true, style: {}, textContent: '' };
const sign = { hidden: true, style: {}, textContent: '' };
const mood = { hidden: true, style: {}, textContent: '' };
class FakeDate extends Date {
  constructor(value = wallClock) { super(value); }
  static now() { return wallClock; }
}
const drawing = {
  clearRect() {}, save() {}, restore() {}, translate() {}, scale(...args) { transforms.push(args); },
  drawImage(...args) { lastDraw = args; drawHistory.push(args); },
  getImageData: (x, y) => { hitSamples.push([x, y]); return { data: [0, 0, 0, 255] }; },
};
const canvas = {
  style: {}, getContext: () => drawing,
  addEventListener: (name, callback) => canvasEvents.set(name, callback),
};
const api = {
  getConfig: async () => ({ ...currentConfig }),
  getI18n: async () => ({ locale, dict: locale === 'en' ? enDict : zhDict }),
  // Any broadcast — from a patch or from the test — records what the pet will
  // believe, exactly like the real `config-changed` event does.
  onConfigChanged: callback => {
    configChanged = (cfg) => { currentConfig = { ...cfg }; callback(cfg); };
  },
  onPetAction: callback => { actionReceived = callback; },
  onFileDrop: () => () => {},
  setClickThrough() {}, autoMoveStop() {}, autoMoveStart() {},
  dragBegin() {}, dragMove() {}, dragEnd() {},
  getWindowPosition: async () => [100, 100],
  getWindowCenterTarget: async () => [810, 294],
  moveWindowTo: async (x, y) => { moves.push([x, y]); },
  windowEdgeGaps: async () => null,
  getSystemLoad: async () => loadState,
  // Mirrors the real backend: the patch is merged, persisted and broadcast back,
  // which is what makes the daily counters accumulate across batches.
  setConfig: async (patch) => {
    configPatches.push(patch);
    currentConfig = { ...currentConfig, ...patch };
    queueMicrotask(() => configChanged?.({ ...currentConfig }));
    return currentConfig;
  },
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
  clearTimeout() {}, addEventListener: (name, callback) => windowEvents.set(name, callback),
};
const context = {
  window: browser, document: {
    body: { style: {} },
    documentElement: {},
    querySelectorAll: () => [],
    getElementById: id => ({
      'pet-canvas': canvas, 'pet-speech': speech, 'pet-hearts': hearts, 'pet-dream': dream,
      'pet-sign': sign, 'pet-mood': mood,
    })[id],
  },
  // The atlas is 16 frames wide at 192 px per frame (see scripts/build-bulu-actions.mjs).
  Image: class { complete = true; naturalWidth = 512; set src(url) { if (url.includes('bulu-actions')) this.naturalWidth = 16 * 192; } },
  performance: { now: () => clock }, Date: FakeDate,
  requestAnimationFrame(callback) { frame = callback; }, queueMicrotask, Math, Number, Promise, console,
};
vm.createContext(context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-i18n.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-day.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-app.js'), 'utf8'), context);
await new Promise(resolve => setImmediate(resolve));

// The first drawn frame is the resting state: it comes from the base sheet's idle
// row (cell 128 px in this harness, row 0) and is a still pose.
frame(clock += 16);
assert.ok(drawHistory.some(args => args[3] === 128 && args[2] === 0),
  'the idle state should draw the base sheet idle row');

// The resting pose blinks: the sheet's fourth idle cell is the closed-eye frame
// scripts/build-bulu-blink.mjs bakes in, and it has to appear every few seconds
// without turning the pet into a metronome.
drawHistory.length = 0;
for (let i = 0; i < 240; i++) frame(clock += 50);
const idleFrames = drawHistory.filter(args => args[2] === 0);
const blinkFrames = idleFrames.filter(args => args[1] === 3 * 128);
assert.ok(blinkFrames.length > 0, 'the resting pet should blink every few seconds');
assert.ok(blinkFrames.length < idleFrames.length / 4,
  `blinking must stay occasional, got ${blinkFrames.length}/${idleFrames.length} frames`);
assert.ok(idleFrames.every(args => args[1] === 0 || args[1] === 3 * 128),
  'the idle row only contains the open pose and the baked blink pose');

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

// ---------- part-aware interaction ----------
// One tap answers from the region it landed on, a quick second tap is read as
// affection, and a hold that never becomes a drag makes the pet ask for mercy.
const config = (extra = {}) => {
  currentConfig = {
    skin: 'bulu', petScale: 1, opacity: 1, autoMove: false, locale: 'zh',
    standReminderEnabled: true, standReminderMinutes: 5, hourlyChime: true,
    fileDropReactions: true, ...extra,
  };
  configChanged(currentConfig);
};
const tap = (x, y) => {
  canvasEvents.get('mousedown')({ button: 0, offsetX: x, offsetY: y, screenX: 100, screenY: 100 });
  canvasEvents.get('mousemove')({ offsetX: x, offsetY: y, screenX: 100, screenY: 100, buttons: 0 });
};
config();
clock += 400; // clear the petting cooldown and the double-tap window
tap(120, 175);
assert.equal(speech.textContent, '喵？叫我干嘛～', 'a tap on the head should answer as the head');
clock += 400;
tap(120, 270);
assert.equal(speech.textContent, '痒痒的，别戳啦～', 'a tap on the body should answer as the body');

clock += 400;
tap(120, 175);
clock += 100;
tap(120, 175);
assert.equal(speech.textContent, '嘿嘿，我也喜欢你！', 'two quick taps should be read as affection');
assert.equal(hearts.hidden, false, 'a double tap should show hearts');
assert.equal(browser.__prismooLiteState().action, 'wave', 'a double tap should wave');
frame(clock += 2600);

canvasEvents.get('mousedown')({ button: 0, offsetX: 120, offsetY: 175, screenX: 100, screenY: 100 });
frame(clock += 800);
assert.equal(speech.textContent, '摸够了吗…爪子都麻了', 'holding the pet should make it complain');
assert.equal(browser.__prismooLiteState().action, 'scratch', 'the hold reaction is the fifth pose row');
windowEvents.get('mouseup')();
frame(clock += 2600);

// Stroking the back is a different gesture from stroking the head: the pet
// settles down and grooms itself instead of just melting.
clock += 400;
for (const x of [110, 135, 115, 140]) {
  clock += 50;
  canvasEvents.get('mousemove')({ offsetX: x, offsetY: 270, buttons: 0 });
}
assert.equal(speech.textContent, '呼噜噜……背上也舒服～', 'stroking the back should purr');
assert.equal(browser.__prismooLiteState().action, 'groom', 'a stroked back makes the pet groom');
frame(clock += 2600);

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
transforms.length = 0;
frame(clock += 125);
assert.equal(lastDraw[2], 128, 'dragging should use the walking sprite row');
assert.equal(transforms.some(([x]) => x < 0), true, 'dragging right should mirror the left-facing walking art');
canvasEvents.get('mousemove')({ offsetX: 110, offsetY: 175, screenX: 96, screenY: 100, buttons: 1 });
transforms.length = 0;
frame(clock += 125);
assert.equal(transforms.some(([x]) => x < 0), false, 'dragging left should show the original walking art');
windowEvents.get('mouseup')();
canvasEvents.get('mousedown')({ button: 0, offsetX: 120, offsetY: 175, screenX: 100, screenY: 100 });
canvasEvents.get('mousemove')({ offsetX: 140, offsetY: 175, screenX: 126, screenY: 100, buttons: 1 });
transforms.length = 0;
frame(clock += 125);
assert.equal(transforms.some(([x]) => x < 0), true, 'the first rightward drag move must reset a previous left facing');

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

// ---------- the user's own reminders ----------
// A due reminder is taken out of the config and held up on the sign; one that
// came due while the machine was asleep is dropped without a word.
const tick = () => new Promise(resolve => setImmediate(resolve));
const quiet = { standReminderEnabled: false, hourlyChime: false };
// The drag test above left the pointer down; a pet being dragged is not free to
// walk over with a reminder until it is let go.
windowEvents.get('mouseup')();
config({ ...quiet, reminders: [{ id: 'r-due', text: '交周报', at: wallClock - 1000 }] });
intervals[0]();
await tick();
await tick();
assert.equal(sign.hidden, false, 'a due reminder should raise the sign');
assert.equal(sign.textContent, '⏰ 交周报');
// The counter batches land whenever they land, so look at the reminder patch
// itself rather than at whatever was written last.
assert.deepEqual(configPatches.filter(patch => patch.reminders).at(-1).reminders, [],
  'a fired reminder leaves the config');

frame(clock += 16);
tap(150, 175);
assert.equal(sign.hidden, true, 'touching the pet acknowledges the reminder');

config({ ...quiet, reminders: [{ id: 'r-stale', text: '昨天的蛋糕', at: wallClock - 3 * 60 * 60_000 }] });
intervals[0]();
await tick();
assert.deepEqual(configPatches.filter(patch => patch.reminders).at(-1).reminders, [],
  'a reminder missed by hours is dropped');
assert.equal(sign.hidden, true, 'a stale reminder is never announced');

// ---------- load awareness ----------
// One hot reading is noise; two in a row make the pet sweat. A nearly empty
// battery brings the badge and a nudge, and the charger wakes it up.
loadState = { available: true, cpu: 96, memory: 72, batteryPercent: 90, charging: true };
clock += 5000;
intervals[0]();
await tick();
clock += 5000;
intervals[0]();
await tick();
frame(clock += 16);
assert.equal(mood.textContent, '💦', 'a pinned CPU should make the pet sweat');
assert.equal(mood.hidden, false, 'the sweat badge stays on screen while it is hot');
assert.equal(speech.textContent, '有点热…我歇一会儿');

loadState = { available: true, cpu: 10, memory: 40, batteryPercent: 12, charging: false };
clock += 5000;
intervals[0]();
await tick();
frame(clock += 16);
assert.equal(mood.textContent, '🪫', 'a low battery should switch the badge');
assert.equal(speech.textContent, '电量不多了，记得插电哦');

loadState = { available: true, cpu: 10, memory: 40, batteryPercent: 25, charging: true };
clock += 5000;
intervals[0]();
await tick();
frame(clock += 16);
assert.equal(mood.textContent, '⚡', 'plugging in should show the power badge');
assert.equal(speech.textContent, '来电啦！精神了 ⚡');

// A platform that cannot answer leaves the pet alone instead of guessing.
loadState = { available: false, cpu: null, memory: null, batteryPercent: null, charging: false };
clock += 5000;
intervals[0]();
await tick();
frame(clock += 16);
assert.equal(mood.textContent, '⚡', 'an unavailable reading must not clear the last badge on its own');

// ---------- daily counters behind the click heatmap ----------
// Taps are batched and merged into the config, so the settings panel's heatmap
// reads one growing bucket per local day.
config({ ...quiet });
const todayKey = dayKeyOf(wallClock);
clock += 400;
tap(120, 175);
clock += 6000; // past the 5 s batch window
intervals[0]();
await tick();
assert.equal(configPatches.at(-1).dailyStats?.[todayKey]?.clicks, 1,
  'a tap should be counted for today');
clock += 400;
tap(120, 175);
clock += 6000;
intervals[0]();
await tick();
assert.equal(configPatches.at(-1).dailyStats?.[todayKey]?.clicks, 2,
  'later taps add to the same day rather than replacing it');

// ---------- health plan ----------
// The standing reminder the pet already had, plus the look-away and water
// nudges: each keeps its own countdown and each counts towards today.
config({ ...quiet, standReminderEnabled: true, standReminderMinutes: 5 });
wallClock += 5 * 60_000 + 1000;
intervals[0]();
await tick();
await tick();
intervals[0]();
await tick();
assert.equal(configPatches.at(-1).dailyStats?.[todayKey]?.stand, 1,
  'standing up counts towards today');

config({ ...quiet, eyeRestEnabled: true, eyeRestMinutes: 20, waterEnabled: true, waterMinutes: 45 });
const beforeHealth = configPatches.length;
wallClock += 5 * 60_000;
intervals[0]();
assert.equal(configPatches.length, beforeHealth, 'the look-away nudge waits its full interval');
wallClock += 15 * 60_000 + 1000;
intervals[0]();
await tick();
assert.match(speech.textContent, /看会儿远处/, 'the look-away nudge should speak up');
intervals[0]();
await tick();
assert.equal(configPatches.at(-1).dailyStats?.[todayKey]?.eye, 1,
  'a delivered look-away nudge is counted');

wallClock += 25 * 60_000;
intervals[0]();
await tick();
assert.match(speech.textContent, /喝口水/, 'the water nudge should speak up');
intervals[0]();
await tick();
assert.equal(configPatches.at(-1).dailyStats?.[todayKey]?.water, 1,
  'a delivered water nudge is counted');

// Turning an item off means it never fires again, whatever the interval.
config({ ...quiet, eyeRestEnabled: false, eyeRestMinutes: 20, waterEnabled: false, waterMinutes: 45 });
speech.textContent = '';
const afterDisable = configPatches.length;
wallClock += 2 * 60 * 60_000;
intervals[0]();
await tick();
assert.equal(configPatches.length, afterDisable, 'disabled habits count nothing');
assert.equal(speech.textContent, '', 'disabled habits stay quiet');

console.log('Petting, taps, holds, blinking, reminders, load reactions, daily counters, ' +
  'health plan, dreams, actions, language switch and update notice: passed');
