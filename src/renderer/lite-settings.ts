/** Minimal settings with a non-destructive image import preview. */
(() => {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const status = $<HTMLParagraphElement>('image-status');
  const preview = $<HTMLElement>('import-preview');
  const originalCanvas = $<HTMLCanvasElement>('original-preview');
  const resultCanvas = $<HTMLCanvasElement>('result-preview');
  const note = $<HTMLParagraphElement>('preview-note');
  const cutout = $<HTMLInputElement>('remove-background');
  const confirm = $<HTMLButtonElement>('confirm-image');
  const language = $<HTMLSelectElement>('language');
  const size = $<HTMLInputElement>('pet-size');
  const opacity = $<HTMLInputElement>('opacity');
  const autoMove = $<HTMLInputElement>('auto-move');
  const fileDropReactions = $<HTMLInputElement>('file-drop-reactions');
  const standReminder = $<HTMLInputElement>('stand-reminder');
  const standInterval = $<HTMLSelectElement>('stand-interval');
  const standCustom = $<HTMLInputElement>('stand-custom');
  const standCustomLabel = $<HTMLLabelElement>('stand-custom-label');
  const standStatus = $<HTMLParagraphElement>('stand-status');
  const hourlyChime = $<HTMLInputElement>('hourly-chime');
  const autoLaunch = $<HTMLInputElement>('auto-launch');
  let candidate: HTMLImageElement | null = null;
  let current: AppConfig | null = null;

  function message(value: string, error = false) {
    status.textContent = value;
    status.classList.toggle('error', error);
  }

  function paintCanvas(canvas: HTMLCanvasElement, source: CanvasImageSource, bounds: { x: number; y: number; width: number; height: number }) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(160 / bounds.width, 160 / bounds.height);
    const w = bounds.width * scale, h = bounds.height * scale;
    ctx.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height,
      (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }

  function updatePreview() {
    if (!candidate) return;
    try {
      const original = litePrepareImage(candidate, false);
      const result = litePrepareImage(candidate, cutout.checked);
      paintCanvas(originalCanvas, original.canvas, { x: 0, y: 0, width: candidate.naturalWidth, height: candidate.naturalHeight });
      paintCanvas(resultCanvas, result.canvas, result.bounds);
      note.textContent = result.cutoutRejected
        ? liteT('lite.image.cutoutRejected')
        : result.cutoutApplied ? liteT('lite.image.confirmHint') : liteT('lite.image.transparentNote');
      confirm.disabled = result.visiblePixels === 0;
    } catch (error) {
      confirm.disabled = true;
      note.textContent = String(error);
    }
  }

  async function chooseImage() {
    candidate = null;
    preview.hidden = true;
    await window.api.discardCustomImage().catch(() => undefined);
    message(liteT('lite.image.choosing'));
    try {
      const selected = await window.api.previewCustomImage();
      if (!selected.ok || !selected.url) {
        message(selected.error || liteT('lite.image.cancelled'));
        return;
      }
      candidate = await liteLoadImage(selected.url);
      cutout.checked = false;
      preview.hidden = false;
      updatePreview();
      message(liteT('lite.image.previewHint'));
    } catch (error) {
      candidate = null;
      preview.hidden = true;
      message(liteT('lite.image.previewFailed', { error: String(error) }), true);
      await window.api.discardCustomImage().catch(() => undefined);
    }
  }

  async function cancelImage() {
    candidate = null;
    preview.hidden = true;
    await window.api.discardCustomImage().catch(() => undefined);
    message(liteT('lite.image.cancelled'));
  }

  async function confirmImage() {
    if (!candidate || confirm.disabled) return;
    confirm.disabled = true;
    try {
      const saved = await window.api.commitCustomImage(cutout.checked);
      if (!saved.ok) throw new Error(saved.error || liteT('lite.image.saveFailed'));
      candidate = null;
      preview.hidden = true;
      current = await window.api.getConfig();
      paint(current);
      message(liteT('lite.image.applied'));
    } catch (error) {
      message(liteT('lite.image.notApplied', { error: String(error) }), true);
      confirm.disabled = false;
    }
  }

  /** The minutes actually in effect, clamped the same way the pet window clamps. */
  function reminderMinutes(cfg: AppConfig) {
    const value = Number(cfg.standReminderMinutes);
    return Number.isInteger(value) && value >= 1 && value <= 240 ? value : 5;
  }

  function standSummary(minutes: number) {
    return standReminder.checked ? liteT('lite.reminder.on', { n: minutes }) : liteT('lite.reminder.off');
  }

  function paint(cfg: AppConfig) {
    // A language switch replaces the dictionary asynchronously, so the strings
    // built from it are refreshed by one more paint once it has arrived.
    const localeChanged = !!current && current.locale !== cfg.locale;
    current = cfg;
    language.value = cfg.locale === 'en' ? 'en' : 'zh';
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#skins button'))) {
      button.classList.toggle('active', button.dataset.skin === cfg.skin);
    }
    size.value = String(cfg.petScale || 1);
    opacity.value = String(cfg.opacity || 1);
    $<HTMLOutputElement>('size-value').textContent = `${Math.round(Number(size.value) * 100)}%`;
    $<HTMLOutputElement>('opacity-value').textContent = `${Math.round(Number(opacity.value) * 100)}%`;
    autoMove.checked = !!cfg.autoMove;
    fileDropReactions.checked = cfg.fileDropReactions !== false;
    const minutes = reminderMinutes(cfg);
    standReminder.checked = cfg.standReminderEnabled !== false;
    standInterval.value = [5, 10, 20, 30].includes(minutes) ? String(minutes) : 'custom';
    standCustom.value = String(minutes);
    standCustomLabel.hidden = standInterval.value !== 'custom';
    standStatus.textContent = standSummary(minutes);
    hourlyChime.checked = cfg.hourlyChime !== false;
    if (localeChanged) {
      // Any half-finished status line is in the previous language; drop it.
      message('');
      void liteLoadDictionary()
        .then(() => paint(current as AppConfig))
        .catch(error => console.error('[lite-settings] i18n:', error));
    }
  }

  function saveStandReminder() {
    standCustomLabel.hidden = standInterval.value !== 'custom';
    const minutes = standInterval.value === 'custom' ? Number(standCustom.value) : Number(standInterval.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      standStatus.textContent = liteT('lite.reminder.invalid');
      return;
    }
    standStatus.textContent = standSummary(minutes);
    void window.api.setConfig({ standReminderEnabled: standReminder.checked, standReminderMinutes: minutes })
      .catch(error => { standStatus.textContent = liteT('lite.reminder.failed', { error: String(error) }); });
  }

  $<HTMLButtonElement>('close').addEventListener('click', () => window.api.closeSettings());
  $<HTMLButtonElement>('choose-image').addEventListener('click', () => void chooseImage());
  $<HTMLButtonElement>('cancel-image').addEventListener('click', () => void cancelImage());
  confirm.addEventListener('click', () => void confirmImage());
  cutout.addEventListener('change', updatePreview);
  $<HTMLButtonElement>('reset-position').addEventListener('click', () => window.api.resetPosition());
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#skins button'))) {
    button.addEventListener('click', async () => {
      const skin = button.dataset.skin as PetSkin;
      if (skin === 'custom') {
        const image = await window.api.getCustomImage();
        if (!image.ok) { await chooseImage(); return; }
      }
      await window.api.setConfig({ skin, currentPetId: skin });
    });
  }
  size.addEventListener('input', () => { $<HTMLOutputElement>('size-value').textContent = `${Math.round(Number(size.value) * 100)}%`; });
  size.addEventListener('change', () => void window.api.setConfig({ petScale: Number(size.value) }));
  opacity.addEventListener('input', () => { $<HTMLOutputElement>('opacity-value').textContent = `${Math.round(Number(opacity.value) * 100)}%`; });
  opacity.addEventListener('change', () => void window.api.setConfig({ opacity: Number(opacity.value) }));
  language.addEventListener('change', () => void window.api.setConfig({ locale: language.value === 'en' ? 'en' : 'zh' }));
  autoMove.addEventListener('change', () => void window.api.setConfig({ autoMove: autoMove.checked }));
  fileDropReactions.addEventListener('change', () => void window.api.setConfig({ fileDropReactions: fileDropReactions.checked }));
  standReminder.addEventListener('change', saveStandReminder);
  standInterval.addEventListener('change', saveStandReminder);
  standCustom.addEventListener('change', saveStandReminder);
  hourlyChime.addEventListener('change', () => void window.api.setConfig({ hourlyChime: hourlyChime.checked }));
  autoLaunch.addEventListener('change', () => void window.api.autoLaunchSet(autoLaunch.checked).then((enabled) => {
    autoLaunch.checked = enabled;
  }).catch((error) => message(liteT('lite.autoLaunch.failed', { error: String(error) }), true)));

  void (async () => {
    // Translate before the first paint so no key is ever painted on screen.
    await liteLoadDictionary().catch((error) => console.error('[lite-settings] i18n:', error));
    const [cfg, enabled] = await Promise.all([window.api.getConfig(), window.api.autoLaunchGet()]);
    paint(cfg);
    autoLaunch.checked = enabled;
    window.api.onConfigChanged(paint);
  })().catch((error) => message(liteT('lite.settings.loadFailed', { error: String(error) }), true));
})();
