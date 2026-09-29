/** The lightweight desktop pet: one canvas, five built-in skins, or one photo. */
(() => {
  const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
  const speech = document.getElementById('pet-speech') as HTMLDivElement;
  const hearts = document.getElementById('pet-hearts') as HTMLDivElement;
  const dream = document.getElementById('pet-dream') as HTMLDivElement;
  // The reminder sign and the load badge are optional elements: a harness (or an
  // older page) without them must not take the whole pet loop down.
  const sign = document.getElementById('pet-sign') as HTMLDivElement | undefined;
  const mood = document.getElementById('pet-mood') as HTMLDivElement | undefined;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  // Every Mac is Retina and Windows machines frequently sit at 125–150%, while the
  // pet is pixel art: the backing store has to match the device pixels or the
  // compositor stretches it into a blur. All drawing stays in 300x300 CSS units;
  // only the bitmap and the base transform scale.
  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.round(300 * dpr);
  canvas.height = Math.round(300 * dpr);
  ctx.scale(dpr, dpr);

  /** Dragging the pet onto a display with another scale changes the ratio live. */
  function syncPixelRatio() {
    const next = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (next === dpr) return;
    dpr = next;
    // Assigning the bitmap size resets the context, so the transform is reapplied.
    canvas.width = Math.round(300 * next);
    canvas.height = Math.round(300 * next);
    ctx.scale(next, next);
  }

  // Bulu is the only built-in character; anything else on screen is the user's
  // own imported picture (see `loadCustom`).
  const sources: Record<string, string> = { bulu: '../assets/animated-pets/bulu.png' };
  const sheets: Record<string, HTMLImageElement> = {};
  for (const [skin, url] of Object.entries(sources)) {
    const image = new Image(); image.src = url; sheets[skin] = image;
  }
  const buluActions = new Image();
  buluActions.src = '../assets/animated-pets/bulu-actions.webp';
// Row order must match ACTIONS in scripts/build-bulu-art.mjs.
type PetAction = 'wave' | 'groom' | 'stretch' | 'yawn' | 'scratch';
/** Which half of the pet a pointer landed on: the head, or everything below it. */
type PetRegion = 'head' | 'body';
const actionRows: Record<PetAction, number> = { wave: 0, groom: 1, stretch: 2, yawn: 3, scratch: 4 };
/** Each atlas row is one action's whole sheet: 4x4 source frames in a row. */
const ACTION_FRAMES = 16;
/**
 * Bulu's blink. The idle row's last cell is a closed-eye pose baked into
 * bulu.png by scripts/build-bulu-blink.mjs; the pet holds it for BLINK_MS and
 * then waits BLINK_GAP +/- jitter before the next one, so the resting pose
 * breathes without turning into a twitch.
 */
const BLINK_COLUMN = 3;
const BLINK_MS = 150;
const BLINK_GAP_MS = 3200;
const BLINK_JITTER_MS = 5200;
  let activeAction: { kind: PetAction; started: number; duration: number } | null = null;
  let config: AppConfig | null = null;
  let custom: LitePreparedImage | null = null;
  let loadSerial = 0;
  let facing: -1 | 1 = 1;
  let dragging = false;
  let pressed = false;
  let pressAt = { x: 0, y: 0 };
  let lastDragScreenX = 0;
  let nextSleep = performance.now() + 90_000;
  let sleepUntil = 0;
  let walkUntil = 0;
  let nextWalk = performance.now() + 5000;
  let clickUntil = 0;
  let speechTimer: number | null = null;
  let heartsTimer: number | null = null;
  let nextReminderAt = 0;
  let nextHourAt = 0;
  let nextDreamAt = 0;
  let dreamUntil = 0;
  let dreamIndex = 0;
  let reminderRunning = false;
  let reminderRunId = 0;
  let pettingDistance = 0;
  let pettingTurns = 0;
  let pettingDirection = 0;
  let pettingLastX: number | null = null;
  let pettingLastAt = 0;
  let pettingCooldownUntil = 0;
  /** Which half of the pet the current stroke started on (head vs body). */
  let pettingRegion: PetRegion | null = null;
  /** Where the pointer went down, so a tap can be answered from its own region. */
  let pressRegion: PetRegion = 'body';
  let pressStartedAt = 0;
  let longPressFired = false;
  let lastTapAt = 0;
  let nextBlinkAt = 0;
  let blinkUntil = 0;
  let signTimer: number | null = null;
  /** Reminder ids already handed to the sign; the config update lands a tick later. */
  const handledReminders = new Set<string>();
  let load: SystemLoad | null = null;
  /** Consecutive polls above the "busy" threshold — one hot reading is noise. */
  let hotPolls = 0;
  /** -Infinity, not 0: the first hot streak has to be announced too. */
  let lastTiredAt = Number.NEGATIVE_INFINITY;
  let lowBatteryAnnounced = false;
  let wasCharging: boolean | null = null;
  let moodIcon = '';
  let moodUntil = 0;
  /** Health plan: when the look-away / drink-water nudges are next due. */
  let nextEyeRestAt = 0;
  let nextWaterAt = 0;
  /**
   * Daily counters that have not been written to the config yet. Clicking is
   * cheap and frequent, so the write is batched (see `flushDailyStats`) instead
   * of rewriting the config file on every tap.
   */
  const pendingStats: Record<string, DailyStat> = {};
  let statsFlushAt = 0;
  let lastEdgePoll = 0;
  let visibleRect: PetBox = { x: 86, y: 140, w: 128, h: 150 };
  let lastHover = false;
  (window as unknown as Record<string, unknown>).__prismooLiteState = () => ({
    skin: config?.skin ?? null,
    customReady: !!custom,
    cutoutRejected: !!custom?.cutoutRejected,
    bounds: visibleRect,
    action: activeAction?.kind ?? null,
  });

  function stopWalking() {
    if (!walkUntil) return;
    walkUntil = 0;
    window.api.autoMoveStop();
    nextWalk = performance.now() + 4000 + Math.random() * 6000;
  }

  function activity() {
    activeAction = null;
    nextSleep = performance.now() + 90_000;
    sleepUntil = 0;
    dream.hidden = true;
    nextDreamAt = 0;
    dreamUntil = 0;
    hideSign();
    if (walkUntil) stopWalking();
  }

  function say(line: string, duration = 3600) {
    if (speechTimer !== null) window.clearTimeout(speechTimer);
    speech.textContent = line;
    speech.hidden = false;
    speechTimer = window.setTimeout(() => { speech.hidden = true; speechTimer = null; }, duration);
  }

  // ---------- the reminder sign ----------
  // A reminder is announced with a card above the pet rather than a speech
  // bubble: it holds a whole sentence, and it stays up until the user
  // acknowledges it by touching the pet (or after SIGN_HOLD_MS).
  const SIGN_HOLD_MS = 25_000;

  function hideSign() {
    if (signTimer !== null) { window.clearTimeout(signTimer); signTimer = null; }
    if (sign && !sign.hidden) sign.hidden = true;
  }

  function showSign(text: string) {
    // Without the element (a trimmed page) the line still has to reach the user.
    if (!sign) { say(liteT('lite.pet.reminder', { text }), 8000); return; }
    speech.hidden = true;
    sign.textContent = liteT('lite.pet.reminder', { text });
    sign.hidden = false;
    if (signTimer !== null) window.clearTimeout(signTimer);
    signTimer = window.setTimeout(() => { sign.hidden = true; signTimer = null; }, SIGN_HOLD_MS);
  }

  // ---------- where on the pet a pointer landed ----------
  // The head band is the same one the original petting check used: the body
  // starts slightly before the halfway line so a stroke that drifts across the
  // boundary keeps counting as one stroke rather than restarting.
  const HEAD_BOTTOM = 0.55;
  const BODY_TOP = 0.45;

  function regionAt(x: number, y: number): PetRegion | null {
    if (!hit(x, y)) return null;
    if (x < visibleRect.x + visibleRect.w * 0.1 || x > visibleRect.x + visibleRect.w * 0.9) {
      // The edges are tail / whiskers: touchable, but not strokeable.
      return y <= visibleRect.y + visibleRect.h * HEAD_BOTTOM ? null : 'body';
    }
    if (y <= visibleRect.y + visibleRect.h * HEAD_BOTTOM) return 'head';
    return y >= visibleRect.y + visibleRect.h * BODY_TOP ? 'body' : null;
  }

  function showHearts() {
    hearts.style.left = `${Math.min(245, visibleRect.x + visibleRect.w * 0.67)}px`;
    hearts.style.top = `${Math.max(35, visibleRect.y)}px`;
    hearts.hidden = false;
    hearts.style.animation = 'none';
    void hearts.offsetWidth;
    hearts.style.animation = '';
    if (heartsTimer !== null) window.clearTimeout(heartsTimer);
    heartsTimer = window.setTimeout(() => { hearts.hidden = true; heartsTimer = null; }, 1300);
  }

  // ---------- blinking ----------
  /**
   * Which idle column to draw. Only the resting pose blinks: while the pet
   * walks, sleeps or plays an action its eyes are part of that pose, and a blink
   * is scheduled from wherever it settles down again instead of piling up.
   */
  function blinkColumn(now: number, state: string, acting: boolean): number {
    const resting = state === 'idle' && !acting;
    if (!resting) {
      if (nextBlinkAt < now) nextBlinkAt = now + 1500;
      return 0;
    }
    if (!nextBlinkAt) nextBlinkAt = now + 2200 + Math.random() * 1800;
    if (now >= nextBlinkAt) {
      blinkUntil = now + BLINK_MS;
      nextBlinkAt = now + BLINK_GAP_MS + Math.random() * BLINK_JITTER_MS;
    }
    return now < blinkUntil ? BLINK_COLUMN : 0;
  }

  // ---------- software updates ----------
  // The pet is the messenger; the check itself and the buttons live in
  // src-tauri/src/updater.rs and the settings panel. Only status *changes* are
  // announced — a download emits a progress event per chunk.
  let announcedUpdate: UpdateState['status'] | null = null;

  function announceUpdate(state: UpdateState) {
    if (state.status === announcedUpdate) return;
    announcedUpdate = state.status;
    const version = state.version ?? '';
    if (state.status === 'available' && version) {
      const key = state.autoDownload ? 'update.available' : 'update.availableManual';
      say(liteT(key, { v: version }), 5200);
    } else if (state.status === 'downloaded' && version) {
      say(liteT('update.downloadedNotice', { v: version }), 5200);
    }
  }

  async function checkForUpdates() {
    try {
      const state = await window.api.updateCheck();
      announceUpdate(state);
      // Auto-download follows the check, so the pet can hand over the "ready"
      // notice instead of making the user press a second button.
      if (state.status === 'available' && state.autoDownload) {
        announceUpdate(await window.api.updateDownload());
      }
    } catch (error) {
      // Offline or rate-limited: stay quiet, the settings panel can retry.
      console.error('[lite-app] update check:', error);
    }
  }

  function playAction(name: string) {
    if (!config || pressed || dragging || reminderRunning || !(name in actionRows)) return;
    const kind = name as PetAction;
    activity();
    clickUntil = 0;
    speech.hidden = true;
    activeAction = { kind, started: performance.now(), duration: kind === 'stretch' ? 2500 : 2100 };
  }

  function resetPetting() {
    pettingDistance = 0;
    pettingTurns = 0;
    pettingDirection = 0;
    pettingLastX = null;
    pettingRegion = null;
  }

  /**
   * A back-and-forth stroke over the pet. The head and the body answer
   * differently — a stroked head just melts, a stroked back makes the pet settle
   * down and groom itself — so the straight-line distance and the number of
   * direction changes are tracked per region.
   */
  function petStrokeMove(x: number, y: number, buttons: number) {
    const now = performance.now();
    const region = buttons || pressed || dragging || reminderRunning || now < pettingCooldownUntil
      ? null
      : regionAt(x, y);
    if (!region) {
      resetPetting();
      return;
    }
    // Crossing from the head to the back restarts the count instead of adding a
    // second, unrelated stroke to the first one.
    if (pettingRegion && pettingRegion !== region) resetPetting();
    pettingRegion = region;
    if (now - pettingLastAt > 900) resetPetting();
    if (pettingLastX !== null) {
      const dx = x - pettingLastX;
      if (Math.abs(dx) >= 2 && Math.abs(dx) <= 40) {
        const direction = Math.sign(dx);
        if (pettingDirection && direction !== pettingDirection && pettingDistance >= 12) pettingTurns++;
        pettingDirection = direction;
        pettingDistance += Math.abs(dx);
      }
    }
    pettingLastX = x;
    pettingLastAt = now;
    if (pettingDistance < 55 || pettingTurns < 1) return;
    const stroked = region;
    resetPetting();
    pettingCooldownUntil = now + 3200;
    activity();
    clickUntil = now + 900;
    showHearts();
    if (stroked === 'head') {
      say(liteT('lite.pet.petting'), 2000);
    } else {
      // A groomed back reads as "that was good": the pet answers by grooming.
      playAction('groom');
      // After the action, because starting one clears whatever bubble was up.
      say(liteT('lite.pet.purring'), 2200);
    }
  }

  /**
   * Run the pet to the middle of its screen. Shared by the standing reminder and
   * the user's own reminders — both need the pet to come over and be noticed.
   * A press or a new call cancels it mid-flight; the result says whether this run
   * was the one that arrived.
   */
  async function walkToCenter(): Promise<boolean> {
    const runId = ++reminderRunId;
    try {
      const [start, target] = await Promise.all([
        window.api.getWindowPosition(), window.api.getWindowCenterTarget(visibleRect),
      ]);
      if (runId !== reminderRunId) return false;
      facing = target[0] < start[0] ? -1 : 1;
      const distance = Math.hypot(target[0] - start[0], target[1] - start[1]);
      const duration = Math.max(450, Math.min(2600, distance / 550 * 1000));
      const began = performance.now();
      while (runId === reminderRunId && !pressed && !dragging) {
        const fraction = Math.min(1, (performance.now() - began) / duration);
        const eased = 1 - (1 - fraction) ** 2;
        await window.api.moveWindowTo(
          start[0] + (target[0] - start[0]) * eased,
          start[1] + (target[1] - start[1]) * eased,
        );
        if (fraction >= 1) break;
        await new Promise(resolve => window.setTimeout(resolve, 32));
      }
    } catch (error) {
      (window as unknown as Record<string, unknown>).__petError = `walk to center: ${String(error)}`;
      if (runId === reminderRunId) window.api.resetPosition();
    }
    return runId === reminderRunId;
  }

  async function runStandReminder() {
    if (reminderRunning || pressed || dragging || config?.standReminderEnabled === false) return;
    reminderRunning = true;
    clickUntil = 0;
    activity();
    let arrived = false;
    try {
      arrived = await walkToCenter();
    } finally {
      reminderRunning = false;
      // Being picked up cancels the walk, and the newer interaction owns the
      // bubble: saying "stand up" to someone holding the pet reads as a bug.
      if (!arrived) return;
      clickUntil = performance.now() + 1100;
      say(liteT('lite.pet.standReminder'), 6500);
      bumpDaily('stand', true);
    }
  }

  /** Bring the pet over and hold up the reminder until the user touches it. */
  async function runReminder(text: string) {
    if (reminderRunning) return;
    reminderRunning = true;
    clickUntil = 0;
    activity();
    try {
      await walkToCenter();
    } finally {
      reminderRunning = false;
      clickUntil = performance.now() + 900;
      // Shown even when the walk was interrupted: the reminder has already been
      // taken out of the config, and touching the pet is how it is acknowledged.
      showSign(text);
    }
  }

  function checkStandReminder() {
    if (!config || config.standReminderEnabled === false || !nextReminderAt || Date.now() < nextReminderAt) return;
    if (pressed || dragging || reminderRunning) return;
    const minutes = Math.max(1, Math.min(240, Number(config.standReminderMinutes) || 5));
    nextReminderAt = Date.now() + minutes * 60_000;
    void runStandReminder();
  }

  function nextLocalHour(now: number) {
    const next = new Date(now);
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return next.getTime();
  }

  function checkHourlyChime() {
    if (!config || config.hourlyChime === false || !nextHourAt) return;
    const now = Date.now();
    if (now < nextHourAt) return;
    const overdue = now - nextHourAt;
    nextHourAt = nextLocalHour(now);
    if (overdue > 60_000 || pressed || dragging || reminderRunning) return;
    activity();
    clickUntil = performance.now() + 650;
    say(liteT('lite.pet.hourlyChime', { h: new Date(now).getHours() }), 3200);
  }

  // ---------- the user's own reminders ----------
  // A reminder that came due while the machine was asleep is dropped the same way
  // a missed hourly chime is: nobody wants yesterday's "take the cake out" now.
  const REMINDER_GRACE_MS = 10 * 60_000;

  // ---------- daily counters ----------
  // Clicks and health-plan completions, bucketed by local calendar day (see
  // lite-day.ts). The heatmap in Settings reads the very same buckets.
  const STATS_FLUSH_MS = 5000;
  /** More than the heatmap draws; older days are dropped so the config stays small. */
  const STATS_KEEP_DAYS = 400;

  function clampMinutes(value: unknown, fallback: number) {
    const minutes = Number(value);
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= 240 ? minutes : fallback;
  }

  /**
   * Count something for today.
   *
   * The day is looked up on every call rather than remembered, so a running pet
   * crosses midnight into a fresh bucket on its own — no timer, no date sync.
   */
  function bumpDaily(kind: keyof DailyStat, flushNow = false) {
    const day = liteDayKey();
    const entry = pendingStats[day] ?? (pendingStats[day] = {});
    entry[kind] = (Number(entry[kind]) || 0) + 1;
    const at = performance.now() + (flushNow ? 0 : STATS_FLUSH_MS);
    statsFlushAt = statsFlushAt ? Math.min(statsFlushAt, at) : at;
  }

  function pruneDailyStats(stats: Record<string, DailyStat>) {
    const days = Object.keys(stats).sort();
    if (days.length <= STATS_KEEP_DAYS) return stats;
    const keep = new Set(days.slice(days.length - STATS_KEEP_DAYS));
    const pruned: Record<string, DailyStat> = {};
    for (const day of days) if (keep.has(day)) pruned[day] = stats[day];
    return pruned;
  }

  /** Merge the buffered counts into the config and write them once. */
  function flushDailyStats() {
    if (!config) return;
    const days = Object.keys(pendingStats);
    if (!days.length) return;
    const merged: Record<string, DailyStat> = { ...(config.dailyStats ?? {}) };
    for (const day of days) {
      const target = merged[day] ?? (merged[day] = {});
      for (const [kind, value] of Object.entries(pendingStats[day])) {
        const key = kind as keyof DailyStat;
        target[key] = (Number(target[key]) || 0) + (Number(value) || 0);
      }
      delete pendingStats[day];
    }
    void window.api.setConfig({ dailyStats: pruneDailyStats(merged) })
      .catch(error => console.error('[lite-app] daily stats:', error));
  }

  // ---------- the health plan ----------
  /**
   * Three independent timers: the standing reminder the pet already had, plus a
   * look-away nudge and a drink-water nudge. Each is armed from `applyConfig`,
   * so changing the interval restarts that item's countdown and unchecking it
   * disarms it — the same contract the standing reminder has always had.
   */
  function checkHealthPlan() {
    if (!config) return;
    // A reminder is not worth interrupting a drag or another announcement for;
    // the timer stays armed and fires on the next tick instead.
    if (pressed || dragging || reminderRunning) return;
    const now = Date.now();
    if (config.eyeRestEnabled === true && nextEyeRestAt && now >= nextEyeRestAt) {
      nextEyeRestAt = now + clampMinutes(config.eyeRestMinutes, 20) * 60_000;
      announceEyeRest();
    }
    if (config.waterEnabled === true && nextWaterAt && now >= nextWaterAt) {
      nextWaterAt = now + clampMinutes(config.waterMinutes, 45) * 60_000;
      announceWater();
    }
  }

  function announceEyeRest() {
    activity();
    clickUntil = performance.now() + 700;
    playAction('stretch');
    // After the action: starting one clears whatever bubble was on screen.
    say(liteT('lite.pet.eyeRest'), 6000);
    bumpDaily('eye', true);
  }

  function announceWater() {
    activity();
    clickUntil = performance.now() + 900;
    say(liteT('lite.pet.water'), 6000);
    bumpDaily('water', true);
  }

  function checkReminders() {
    if (!config) return;
    const list = Array.isArray(config.reminders) ? config.reminders : [];
    if (!list.length) {
      handledReminders.clear();
      return;
    }
    // An id that has left the config finished its round trip; the pet is free to
    // notice the same id again if the user re-creates it.
    for (const id of Array.from(handledReminders)) {
      if (!list.some(item => item?.id === id)) handledReminders.delete(id);
    }
    const now = Date.now();
    const stale = list.filter(item => now - Number(item?.at) > REMINDER_GRACE_MS);
    const due = list.filter(item => {
      const at = Number(item?.at);
      return !!item?.text && at > 0 && at <= now && now - at <= REMINDER_GRACE_MS &&
        !handledReminders.has(item.id);
    });
    // Only the newest due reminder is announced; older ones in the same batch
    // would just queue up behind it.
    const next = due[due.length - 1];
    const free = !pressed && !dragging && !reminderRunning;
    const drop = new Set(stale.map(item => item.id));
    if (next && free) drop.add(next.id);
    if (drop.size) {
      void window.api.setConfig({ reminders: list.filter(item => !drop.has(item?.id)) })
        .catch(error => console.error('[lite-app] reminders:', error));
    }
    if (!next || !free) return;
    handledReminders.add(next.id);
    void runReminder(next.text);
  }

  // ---------- load awareness ----------
  // The pet mirrors the machine: a pinned CPU makes it sweat, a nearly empty
  // battery makes it nap, and plugging in wakes it right up. Everything here is
  // driven by `config.loadAwareness`, which is on by default and read-only in
  // the sense that nothing is ever sent back.
  const HOT_CPU = 85;
  const LOW_BATTERY = 20;
  const LOAD_POLL_MS = 4000;
  let lastLoadPoll = 0;

  function isLowBattery() {
    return !!load && load.available && load.batteryPercent !== null &&
      load.batteryPercent <= LOW_BATTERY && !load.charging;
  }

  function showMood(icon: string, until: number) {
    moodIcon = icon;
    moodUntil = Math.max(moodUntil, until);
    if (mood) mood.textContent = icon;
  }

  function reactToLoad(now: number) {
    if (!load || !load.available) return;
    // One hot reading is noise (a build step, a page load); two in a row is a
    // machine that is actually busy.
    hotPolls = load.cpu !== null && load.cpu >= HOT_CPU ? hotPolls + 1 : 0;
    if (hotPolls >= 2) {
      showMood('💦', now + LOAD_POLL_MS * 2);
      if (now - lastTiredAt > 5 * 60_000) {
        lastTiredAt = now;
        say(liteT('lite.pet.tired'), 3200);
      }
    }
    if (isLowBattery()) {
      showMood('🪫', now + LOAD_POLL_MS * 3);
      if (!lowBatteryAnnounced) {
        lowBatteryAnnounced = true;
        say(liteT('lite.pet.lowBattery'), 4000);
      }
    }
    if (load.batteryPercent === null) return;
    if (wasCharging === false && load.charging) {
      lowBatteryAnnounced = false;
      showMood('⚡', now + LOAD_POLL_MS * 2);
      say(liteT('lite.pet.pluggedIn'), 3200);
    }
    wasCharging = load.charging;
  }

  async function pollLoad() {
    if (!config || config.loadAwareness === false) {
      load = null;
      hotPolls = 0;
      moodIcon = '';
      moodUntil = 0;
      return;
    }
    try {
      load = await window.api.getSystemLoad();
    } catch (error) {
      // An older backend without the command (or a platform that cannot answer)
      // simply means no reactions.
      load = null;
      console.error('[lite-app] system load:', error);
      return;
    }
    reactToLoad(performance.now());
  }

  window.setInterval(() => {
    checkStandReminder();
    checkHealthPlan();
    checkHourlyChime();
    checkReminders();
    const now = performance.now();
    if (statsFlushAt && now >= statsFlushAt) {
      statsFlushAt = 0;
      flushDailyStats();
    }
    if (now - lastLoadPoll >= LOAD_POLL_MS) {
      lastLoadPoll = now;
      void pollLoad();
    }
  }, 1000);

  async function loadCustom() {
    const serial = ++loadSerial;
    custom = null;
    if (config?.skin !== 'custom') return;
    try {
      const record = await window.api.getCustomImage();
      if (!record.ok || !record.url) throw new Error(liteT('lite.image.missing'));
      const image = await liteLoadImage(record.url);
      const prepared = litePrepareImage(image, !!config?.autoCutout);
      if (serial !== loadSerial) return;
      custom = prepared;
      (window as unknown as Record<string, unknown>).__petError = prepared.cutoutRejected ? 'cutout rejected; original shown' : null;
    } catch (error) {
      if (serial !== loadSerial) return;
      // Always show the built-in cat if the custom image cannot be decoded.
      (window as unknown as Record<string, unknown>).__petError = `custom image: ${String(error)}`;
    }
  }

  function applyConfig(next: AppConfig) {
    const reload = !config || config.skin !== next.skin || config.customImagePath !== next.customImagePath ||
      config.customImageRevision !== next.customImageRevision ||
      config.autoCutout !== next.autoCutout;
    const reminderChanged = !config || config.standReminderEnabled !== next.standReminderEnabled ||
      config.standReminderMinutes !== next.standReminderMinutes;
    const chimeChanged = !config || config.hourlyChime !== next.hourlyChime;
    const healthChanged = !config || config.eyeRestEnabled !== next.eyeRestEnabled ||
      config.eyeRestMinutes !== next.eyeRestMinutes ||
      config.waterEnabled !== next.waterEnabled || config.waterMinutes !== next.waterMinutes;
    const loadChanged = !config || config.loadAwareness !== next.loadAwareness;
    // Strings come from the backend dictionary, so a language switch re-fetches it.
    const localeChanged = !config || config.locale !== next.locale;
    config = next;
    document.body.style.opacity = String(Math.max(0.5, Math.min(1, Number(next.opacity) || 1)));
    if (!next.autoMove) stopWalking();
    if (localeChanged) void liteLoadDictionary().catch(error => console.error('[lite-app] i18n:', error));
    if (reminderChanged) {
      reminderRunId++;
      reminderRunning = false;
      const minutes = Math.max(1, Math.min(240, Number(next.standReminderMinutes) || 5));
      nextReminderAt = next.standReminderEnabled === false ? 0 : Date.now() + minutes * 60_000;
    }
    if (chimeChanged) nextHourAt = next.hourlyChime === false ? 0 : nextLocalHour(Date.now());
    if (healthChanged) {
      // Opt-in habits: a config that predates them (no key at all) arms nothing,
      // and only an explicit `true` starts a countdown.
      nextEyeRestAt = next.eyeRestEnabled === true ? Date.now() + clampMinutes(next.eyeRestMinutes, 20) * 60_000 : 0;
      nextWaterAt = next.waterEnabled === true ? Date.now() + clampMinutes(next.waterMinutes, 45) * 60_000 : 0;
    }
    // Reading the machine is cheap but not free, so it happens on that switch and
    // on the poll timer — never per frame.
    if (loadChanged) void pollLoad();
    if (reload) void loadCustom();
  }

  function updateDream(state: 'idle' | 'walk' | 'sleep' | 'click', now: number) {
    if (state !== 'sleep') {
      dream.hidden = true;
      nextDreamAt = 0;
      dreamUntil = 0;
      return;
    }
    if (!nextDreamAt) nextDreamAt = now + 1200;
    if (now >= nextDreamAt && speech.hidden) {
      const dreams = ['🐟', '⭐', '💤', '🧶'];
      dream.textContent = dreams[dreamIndex++ % dreams.length];
      dreamUntil = now + 1700;
      nextDreamAt = now + 5000;
    }
    dream.hidden = now >= dreamUntil || !speech.hidden;
    dream.style.left = `${Math.min(250, visibleRect.x + visibleRect.w * 0.68)}px`;
    dream.style.top = `${Math.max(6, visibleRect.y - 36)}px`;
  }

  /** Keep the load badge pinned above the pet's left shoulder while it is up. */
  function updateMood(now: number) {
    if (!mood) return;
    const visible = moodIcon !== '' && now < moodUntil;
    mood.hidden = !visible;
    if (!visible) return;
    mood.style.left = `${Math.max(6, visibleRect.x + visibleRect.w * 0.08)}px`;
    mood.style.top = `${Math.max(14, visibleRect.y - 28)}px`;
  }

  /** True while a reminder sign is on screen (the pet stays put for it). */
  function signVisible() {
    return !!sign && !sign.hidden;
  }

  function currentState(now: number): 'idle' | 'walk' | 'sleep' | 'click' {
    if (reminderRunning) return 'walk';
    if (activeAction && now < activeAction.started + activeAction.duration) return 'click';
    if (clickUntil > now) return 'click';
    if (walkUntil > now) return 'walk';
    if (now < sleepUntil) return 'sleep';
    if (now >= nextSleep) {
      // A machine running out of battery drags the pet down with it: it naps
      // more often and for longer until the charger shows up.
      const low = isLowBattery();
      sleepUntil = now + (low ? 32_000 : 20_000);
      nextSleep = now + (low ? 55_000 : 120_000);
      return 'sleep';
    }
    return 'idle';
  }

  function update(now: number) {
    if (!config || dragging || reminderRunning) return;
    if (activeAction) {
      if (now < activeAction.started + activeAction.duration) return;
      activeAction = null;
    }
    if (walkUntil && now >= walkUntil) stopWalking();
    // A pet holding up a reminder stays where the user can read it.
    if (!config.autoMove || walkUntil || now < nextWalk || signVisible() || currentState(now) === 'sleep') return;
    facing = Math.random() < 0.5 ? -1 : 1;
    walkUntil = now + 1600 + Math.random() * 1800;
    window.api.autoMoveStart(facing, 48);
  }

  function draw(now: number) {
    syncPixelRatio();
    ctx.clearRect(0, 0, 300, 300);
    const state = dragging ? 'walk' : currentState(now);
    const action = activeAction && now < activeAction.started + activeAction.duration ? activeAction : null;
    const sizeScale = Math.max(0.65, Math.min(1.6, Number(config?.petScale) || 1));
    // The resting state is deliberately motionless: the pet only animates while it
    // walks (auto-walk or dragging), clicks or sleeps.
    const bob = action ? 0 : state === 'walk' ? Math.sin(now / 100) * 2.5 : state === 'click' ? -Math.abs(Math.sin(now / 90)) * 3 : 0;
    // An unknown skin (an install from before the line-up was trimmed) rides the
    // Bulu art rather than leaving the window blank.
    const target = config?.skin === 'custom' && custom ? 'custom' : config?.skin && sheets[config.skin] ? config.skin : 'bulu';

    ctx.save();
    ctx.globalAlpha = state === 'sleep' ? 0.78 : 1;
    if (target === 'bulu' && action && buluActions.complete && buluActions.naturalWidth) {
      const cell = buluActions.naturalWidth / ACTION_FRAMES;
      const progress = (now - action.started) / action.duration;
      const column = Math.min(ACTION_FRAMES - 1, Math.max(0, Math.floor(progress * ACTION_FRAMES)));
      const size = 132 * sizeScale;
      const x = 150 - size / 2, y = 293 - size;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(buluActions, column * cell, actionRows[action.kind] * cell, cell, cell, x, y, size, size);
      visibleRect = { x, y, w: size, h: size };
    } else if (target === 'custom' && custom) {
      const bounds = custom.bounds;
      const fit = Math.min(145 / bounds.width, 148 / bounds.height) * sizeScale;
      const progress = action ? (now - action.started) / action.duration : 0;
      const pulse = action ? Math.sin(Math.PI * progress) : 0;
      const heightScale = action?.kind === 'stretch' ? 1 + pulse * 0.08 : action?.kind === 'yawn' ? 1 - pulse * 0.05 : 1;
      const lift = action?.kind === 'wave' || action?.kind === 'groom' ? Math.abs(Math.sin(progress * Math.PI * 4)) * 3 : 0;
      const width = bounds.width * fit, height = bounds.height * fit * heightScale;
      const x = 150 - width / 2, y = 293 - height + bob - lift;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(custom.canvas, bounds.x, bounds.y, bounds.width, bounds.height, x, y, width, height);
      visibleRect = { x, y, w: width, h: height };
    } else {
      const image = sheets[target];
      if (image?.complete && image.naturalWidth) {
        const cell = image.naturalWidth / 4;
        const frame = Math.floor(now / (state === 'walk' ? 125 : 220)) % 4;
        // Bulu's resting pose blinks; walking, sleeping and the click answer play
        // their own frames. The blink cell only exists in the bundled sheet, so an
        // imported picture is never asked for one.
        const blink = target === 'bulu' ? blinkColumn(now, state, !!action) : 0;
        const column = target === 'bulu' && state === 'idle' ? blink : frame;
        const row = action ? action.kind === 'yawn' ? 2 : 3 : state === 'walk' ? 1 : state === 'sleep' ? 2 : state === 'click' ? 3 : 0;
        const size = 132 * sizeScale;
        const x = 150 - size / 2, y = 293 - size + bob;
        // Bulu is a drawn illustration: smoothing preserves the fur details
        // when the 192 px poses are scaled to the on-screen size.
        ctx.imageSmoothingEnabled = true;
        // The original default sheet faces left in every row. Mirror it when
        // the pet moves right, including its walking row.
        if (facing > 0) {
          ctx.translate(300, 0); ctx.scale(-1, 1);
        }
        ctx.drawImage(image, column * cell, row * cell, cell, cell, x, y, size, size);
        visibleRect = { x, y, w: size, h: size };
      }
    }
    ctx.restore();
    updateDream(state, now);
    updateMood(now);
    // The sign follows the pet instead of being pinned to wherever it arrived.
    if (signVisible()) sign!.style.bottom = `${Math.min(248, 300 - visibleRect.y + 44)}px`;
    if (!speech.hidden) speech.style.bottom = `${Math.min(240, 300 - visibleRect.y + 6)}px`;
  }

  async function pollEdge(now: number) {
    if (!walkUntil || now - lastEdgePoll < 260) return;
    lastEdgePoll = now;
    const gaps = await window.api.windowEdgeGaps(visibleRect).catch(() => null);
    if (gaps && (facing < 0 ? gaps.left : gaps.right) < 16) stopWalking();
  }

  function frame(now: number) {
    try {
      checkLongPress(now);
      update(now);
      void pollEdge(now);
      draw(now);
    } catch (error) {
      (window as unknown as Record<string, unknown>).__petError = `draw: ${String(error)}`;
    }
    requestAnimationFrame(frame);
  }

  // ---------- taps, double taps and holds ----------
  /** Long enough to read as a deliberate hold, short enough not to feel stuck. */
  const LONG_PRESS_MS = 700;
  const DOUBLE_TAP_MS = 320;

  function isAsleep(now: number) {
    return sleepUntil > now;
  }

  /** One tap: a word from the spot that was touched, or a sleepy complaint. */
  function tapReaction(region: PetRegion, now: number) {
    if (isAsleep(now)) {
      // Woken up on purpose: the pet sits up first, then grumbles.
      sleepUntil = 0;
      nextSleep = now + 120_000;
      dream.hidden = true;
      say(liteT('lite.pet.sleepPoke'), 2400);
      return;
    }
    say(liteT(region === 'head' ? 'lite.pet.pokeHead' : 'lite.pet.pokeBody'), 2200);
  }

  /**
   * A hold that never turned into a drag. Checked from the frame loop rather than
   * a timer: while the pointer rests on the pet no pointer event arrives to
   * notice it, and the loop is already running anyway.
   */
  function checkLongPress(now: number) {
    if (!pressed || dragging || longPressFired || reminderRunning || !config) return;
    if (now - pressStartedAt < LONG_PRESS_MS) return;
    longPressFired = true;
    // Held too long: the pet stops enjoying it, scratches its head and asks.
    activity();
    activeAction = { kind: 'scratch', started: now, duration: 2100 };
    say(liteT('lite.pet.longPress'), 2600);
  }

  function hit(x: number, y: number) {
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= 300 || py >= 300) return false;
    // `getImageData` reads backing-store pixels and ignores the context transform,
    // while every caller here passes CSS (0-300) coordinates — so the lookup has
    // to move with the pixel ratio. Reading CSS pixels straight was what made the
    // pet stay click-through on any scaled display: no dragging, no right-click
    // menu, because both are gated on this test.
    try { return ctx.getImageData(Math.round(px * dpr), Math.round(py * dpr), 1, 1).data[3] > 24; }
    catch { return px >= visibleRect.x && px <= visibleRect.x + visibleRect.w && py >= visibleRect.y && py <= visibleRect.y + visibleRect.h; }
  }
  (window as unknown as { __prismooHitTest: (x: number, y: number) => boolean }).__prismooHitTest = hit;
  (window as unknown as { __prismooVisualBounds: () => PetBox }).__prismooVisualBounds = () => visibleRect;

  window.api.onFileDrop(({ paths, position }) => {
    if (config?.fileDropReactions === false || !Array.isArray(paths) || paths.length === 0 ||
        !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const scale = window.devicePixelRatio || 1;
    if (!hit(position.x / scale, position.y / scale)) return;
    activity();
    clickUntil = performance.now() + 1100;
    say(liteFileReaction(paths));
  });
  window.api.onPetAction(playAction);

  canvas.addEventListener('mousemove', (event) => {
    petStrokeMove(event.offsetX, event.offsetY, event.buttons);
    const over = dragging || pressed || hit(event.offsetX, event.offsetY);
    if (over !== lastHover) {
      lastHover = over;
      window.api.setClickThrough(!over);
      canvas.style.cursor = over ? 'grab' : 'default';
    }
    if (!pressed) return;
    if (event.buttons === 0) { release(); return; }
    if (!dragging && Math.hypot(event.screenX - pressAt.x, event.screenY - pressAt.y) > 5) {
      dragging = true; activity(); canvas.style.cursor = 'grabbing';
      const initialDx = event.screenX - pressAt.x;
      if (Math.abs(initialDx) >= 2) facing = initialDx < 0 ? -1 : 1;
      lastDragScreenX = event.screenX;
    }
    if (dragging) {
      const dx = event.screenX - lastDragScreenX;
      if (Math.abs(dx) >= 2) facing = dx < 0 ? -1 : 1;
      lastDragScreenX = event.screenX;
      window.api.dragMove();
    }
  });
  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !hit(event.offsetX, event.offsetY)) return;
    reminderRunId++;
    reminderRunning = false;
    resetPetting();
    pressed = true; pressAt = { x: event.screenX, y: event.screenY };
    pressRegion = regionAt(event.offsetX, event.offsetY) ?? 'body';
    pressStartedAt = performance.now();
    longPressFired = false;
    activity(); window.api.dragBegin(visibleRect);
  });
  function release() {
    if (!pressed) return;
    const wasDragging = dragging;
    window.api.dragEnd(visibleRect);
    pressed = false; dragging = false; canvas.style.cursor = 'grab';
    if (wasDragging) return;
    // A tap answers from where the pet was touched; two taps in quick succession
    // are read as affection rather than as two pokes.
    const now = performance.now();
    // Every tap counts towards the day's heatmap square, whether the pet was
    // asleep, happy about it or not.
    bumpDaily('clicks');
    clickUntil = now + 580;
    activity();
    const double = now - lastTapAt < DOUBLE_TAP_MS;
    lastTapAt = now;
    if (!double) {
      tapReaction(pressRegion, now);
      return;
    }
    activity();
    showHearts();
    playAction('wave');
    // After the action: starting one clears whatever bubble was on screen.
    say(liteT('lite.pet.doubleTap'), 2400);
  }
  window.addEventListener('mouseup', release);
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (hit(event.offsetX, event.offsetY)) window.api.showContextMenu();
  });

  void window.api.getConfig().then((cfg) => {
    applyConfig(cfg);
    window.api.onConfigChanged(applyConfig);
    window.api.onUpdateState(announceUpdate);
    // Let the pet settle on screen before it talks to the network.
    window.setTimeout(() => {
      if (config?.updateAutoCheck === false) return;
      void checkForUpdates();
    }, 9000);
    requestAnimationFrame(frame);
  }).catch((error) => {
    (window as unknown as Record<string, unknown>).__petError = `config: ${String(error)}`;
    requestAnimationFrame(frame);
  });
})();
