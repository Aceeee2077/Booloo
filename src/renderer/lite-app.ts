/** The lightweight desktop pet: one canvas, five built-in skins, or one photo. */
(() => {
  const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
  const speech = document.getElementById('pet-speech') as HTMLDivElement;
  const hearts = document.getElementById('pet-hearts') as HTMLDivElement;
  const dream = document.getElementById('pet-dream') as HTMLDivElement;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const sources: Record<string, string> = {
    cat: '../assets/animated-pets/cat.png', dog: '../assets/animated-pets/fox.png',
    default: '../assets/animated-pets/rabbit.png', bulu: '../assets/animated-pets/bulu.png',
    robot: '../assets/sprites/robot.png',
  };
  const sheets: Record<string, HTMLImageElement> = {};
  for (const [skin, url] of Object.entries(sources)) {
    const image = new Image(); image.src = url; sheets[skin] = image;
  }
  const buluActions = new Image();
  buluActions.src = '../assets/animated-pets/bulu-actions.webp';
  type PetAction = 'wave' | 'groom' | 'stretch' | 'yawn';
  const actionRows: Record<PetAction, number> = { wave: 0, groom: 1, stretch: 2, yawn: 3 };
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
    if (walkUntil) stopWalking();
  }

  function say(line: string, duration = 3600) {
    if (speechTimer !== null) window.clearTimeout(speechTimer);
    speech.textContent = line;
    speech.hidden = false;
    speechTimer = window.setTimeout(() => { speech.hidden = true; speechTimer = null; }, duration);
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
  }

  function petHeadMove(x: number, y: number, buttons: number) {
    const now = performance.now();
    const head = y >= visibleRect.y && y <= visibleRect.y + visibleRect.h * 0.55 &&
      x >= visibleRect.x + visibleRect.w * 0.1 && x <= visibleRect.x + visibleRect.w * 0.9;
    if (buttons || pressed || dragging || reminderRunning || now < pettingCooldownUntil || !head || !hit(x, y)) {
      resetPetting();
      return;
    }
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
    resetPetting();
    pettingCooldownUntil = now + 3200;
    activity();
    clickUntil = now + 900;
    hearts.style.left = `${Math.min(245, visibleRect.x + visibleRect.w * 0.67)}px`;
    hearts.style.top = `${Math.max(35, visibleRect.y)}px`;
    hearts.hidden = false;
    hearts.style.animation = 'none';
    void hearts.offsetWidth;
    hearts.style.animation = '';
    if (heartsTimer !== null) window.clearTimeout(heartsTimer);
    heartsTimer = window.setTimeout(() => { hearts.hidden = true; heartsTimer = null; }, 1300);
    say(liteT('lite.pet.petting'), 2000);
  }

  async function runStandReminder() {
    if (reminderRunning || pressed || dragging || config?.standReminderEnabled === false) return;
    const runId = ++reminderRunId;
    reminderRunning = true;
    clickUntil = 0;
    activity();
    try {
      const [start, target] = await Promise.all([
        window.api.getWindowPosition(), window.api.getWindowCenterTarget(visibleRect),
      ]);
      if (runId !== reminderRunId) return;
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
      (window as unknown as Record<string, unknown>).__petError = `stand reminder: ${String(error)}`;
      if (runId === reminderRunId) window.api.resetPosition();
    } finally {
      if (runId === reminderRunId) {
        reminderRunning = false;
        clickUntil = performance.now() + 1100;
        say(liteT('lite.pet.standReminder'), 6500);
      }
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

  window.setInterval(() => { checkStandReminder(); checkHourlyChime(); }, 1000);

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

  function currentState(now: number): 'idle' | 'walk' | 'sleep' | 'click' {
    if (reminderRunning) return 'walk';
    if (activeAction && now < activeAction.started + activeAction.duration) return 'click';
    if (clickUntil > now) return 'click';
    if (walkUntil > now) return 'walk';
    if (now < sleepUntil) return 'sleep';
    if (now >= nextSleep) {
      sleepUntil = now + 20_000;
      nextSleep = now + 120_000;
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
    if (!config.autoMove || walkUntil || now < nextWalk || currentState(now) === 'sleep') return;
    facing = Math.random() < 0.5 ? -1 : 1;
    walkUntil = now + 1600 + Math.random() * 1800;
    window.api.autoMoveStart(facing, 48);
  }

  function draw(now: number) {
    ctx.clearRect(0, 0, 300, 300);
    const state = dragging ? 'walk' : currentState(now);
    const action = activeAction && now < activeAction.started + activeAction.duration ? activeAction : null;
    const sizeScale = Math.max(0.65, Math.min(1.6, Number(config?.petScale) || 1));
    const bob = action ? 0 : state === 'idle' ? Math.sin(now / 430) * 1.4 : state === 'walk' ? Math.sin(now / 100) * 2.5 : state === 'click' ? -Math.abs(Math.sin(now / 90)) * 3 : 0;
    const target = config?.skin === 'custom' && custom ? 'custom' : config?.skin && sheets[config.skin] ? config.skin : 'cat';

    ctx.save();
    ctx.globalAlpha = state === 'sleep' ? 0.78 : 1;
    if (target === 'bulu' && action && buluActions.complete && buluActions.naturalWidth) {
      const cell = buluActions.naturalWidth / 4;
      const column = Math.min(3, Math.floor((now - action.started) / action.duration * 4));
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
        const column = target === 'bulu' && state === 'idle' && frame === 3 ? 1 : frame;
        const row = action ? action.kind === 'yawn' ? 2 : 3 : state === 'walk' ? 1 : state === 'sleep' ? 2 : state === 'click' ? 3 : 0;
        const size = (target === 'robot' ? 106 : 132) * sizeScale;
        const x = 150 - size / 2, y = 293 - size + bob;
        ctx.imageSmoothingEnabled = false;
        if (facing < 0 && target !== 'bulu' || facing > 0 && target === 'bulu') {
          ctx.translate(300, 0); ctx.scale(-1, 1);
        }
        ctx.drawImage(image, column * cell, row * cell, cell, cell, x, y, size, size);
        visibleRect = { x, y, w: size, h: size };
      }
    }
    ctx.restore();
    updateDream(state, now);
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
      update(now);
      void pollEdge(now);
      draw(now);
    } catch (error) {
      (window as unknown as Record<string, unknown>).__petError = `draw: ${String(error)}`;
    }
    requestAnimationFrame(frame);
  }

  function hit(x: number, y: number) {
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= 300 || py >= 300) return false;
    try { return ctx.getImageData(px, py, 1, 1).data[3] > 24; }
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
    petHeadMove(event.offsetX, event.offsetY, event.buttons);
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
    activity(); window.api.dragBegin(visibleRect);
  });
  function release() {
    if (!pressed) return;
    if (!dragging) { clickUntil = performance.now() + 580; activity(); }
    window.api.dragEnd(visibleRect);
    pressed = false; dragging = false; canvas.style.cursor = 'grab';
  }
  window.addEventListener('mouseup', release);
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (hit(event.offsetX, event.offsetY)) window.api.showContextMenu();
  });

  void window.api.getConfig().then((cfg) => {
    applyConfig(cfg);
    window.api.onConfigChanged(applyConfig);
    requestAnimationFrame(frame);
  }).catch((error) => {
    (window as unknown as Record<string, unknown>).__petError = `config: ${String(error)}`;
    requestAnimationFrame(frame);
  });
})();
