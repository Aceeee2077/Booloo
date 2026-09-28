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
  const refine = $<HTMLButtonElement>('refine-image');
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
  const updateVersion = $<HTMLSpanElement>('update-version');
  const updateStatus = $<HTMLSpanElement>('update-status');
  const updateProgressRow = $<HTMLElement>('update-progress-row');
  const updateProgressBar = $<HTMLElement>('update-progress-bar');
  const updateProgressText = $<HTMLSpanElement>('update-progress-text');
  const updateNotesBox = $<HTMLElement>('update-notes-box');
  const updateNotes = $<HTMLElement>('update-notes');
  const updateManual = $<HTMLParagraphElement>('update-manual');
  const updateAutoCheck = $<HTMLInputElement>('update-auto-check');
  const updateAutoDownload = $<HTMLInputElement>('update-auto-download');
  const checkUpdateButton = $<HTMLButtonElement>('btn-check-update');
  const downloadUpdateButton = $<HTMLButtonElement>('btn-download-update');
  const installUpdateButton = $<HTMLButtonElement>('btn-install-update');
  let candidate: HTMLImageElement | null = null;
  let current: AppConfig | null = null;
  let lastUpdate: UpdateState | null = null;

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

  /**
   * Paint one update snapshot. The main process pushes a new one for every step
   * (check → available → downloading N% → downloaded), so this is the only place
   * that decides what the buttons and the progress bar show.
   */
  function renderUpdate(state: UpdateState) {
    lastUpdate = state;
    const running = state.currentVersion ? `v${state.currentVersion}` : '—';
    // The `{v}` keys already spell the leading "v" ("发现新版本 v{v}"), so the
    // placeholders take the bare version.
    const offered = state.version ?? '';
    updateVersion.textContent = running;
    updateStatus.classList.toggle('err', state.status === 'error');
    // Only the error line carries a tooltip with the raw reason.
    updateStatus.title = '';
    switch (state.status) {
      case 'checking': updateStatus.textContent = liteT('settings.updateChecking'); break;
      case 'available':
        updateStatus.textContent = offered ? liteT('settings.updateAvailable', { v: offered }) : liteT('settings.updateIdle');
        break;
      case 'downloading':
        updateStatus.textContent = liteT('settings.updateDownloading', { p: Math.round(state.progress?.percent ?? 0) });
        break;
      case 'downloaded':
        updateStatus.textContent = offered ? liteT('settings.updateDownloaded', { v: offered }) : liteT('settings.updateIdle');
        break;
      case 'up-to-date': updateStatus.textContent = liteT('settings.updateUpToDate', { v: running }); break;
      case 'dev': updateStatus.textContent = liteT('settings.updateDev'); break;
      case 'unsupported': updateStatus.textContent = liteT('settings.updateUnsupported'); break;
      case 'error':
        updateStatus.textContent = liteT('settings.updateError');
        updateStatus.title = state.error || '';
        break;
      default: updateStatus.textContent = liteT('settings.updateIdle');
    }

    const percent = Math.min(100, Math.max(0, Math.round(state.progress?.percent ?? 0)));
    updateProgressRow.hidden = state.status !== 'downloading';
    updateProgressBar.style.width = `${percent}%`;
    updateProgressText.textContent = `${percent}%`;

    checkUpdateButton.disabled = state.status === 'checking' || state.status === 'downloading' ||
      state.status === 'dev' || state.status === 'unsupported';
    // The download button is only needed when the background download is off;
    // otherwise the check already started pulling the bytes.
    downloadUpdateButton.hidden = !(state.status === 'available' && !state.autoDownload);
    installUpdateButton.hidden = state.status !== 'downloaded';

    const notes = state.notes || '';
    updateNotesBox.hidden = !(notes && (state.status === 'available' || state.status === 'downloaded'));
    updateNotes.textContent = notes;

    const manual = state.manualUrl || '';
    const showManual = !!manual && (state.status === 'unsupported' || state.status === 'dev' || state.status === 'error');
    updateManual.hidden = !showManual;
    updateManual.textContent = showManual ? `${liteT('settings.updateManualHint')} ${manual}` : '';
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
    updateAutoCheck.checked = cfg.updateAutoCheck !== false;
    updateAutoDownload.checked = cfg.updateAutoDownload !== false;
    // The status line is built from the dictionary, so it is refreshed on every
    // paint — including the one that follows a language switch.
    if (lastUpdate) renderUpdate(lastUpdate);
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
  // The mask editor is a separate window; it reports back through the config
  // broadcast, so this panel only has to drop its own preview.
  refine.addEventListener('click', () => window.api.openMaskEditor());
  window.api.onCustomImageChanged(() => {
    candidate = null;
    preview.hidden = true;
    message(liteT('lite.image.applied'));
  });
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
  standInterval.addEventListener('change', () => {
    if (standInterval.value === 'custom') {
      // Selecting Custom only reveals the editor. Saving the old value here
      // broadcasts a config update that paints the preset back over it.
      standCustomLabel.hidden = false;
      standCustom.focus();
      standCustom.select();
      return;
    }
    saveStandReminder();
  });
  standCustom.addEventListener('change', saveStandReminder);
  hourlyChime.addEventListener('change', () => void window.api.setConfig({ hourlyChime: hourlyChime.checked }));
  checkUpdateButton.addEventListener('click', async () => {
    checkUpdateButton.disabled = true;
    renderUpdate(await window.api.updateCheck());
  });
  downloadUpdateButton.addEventListener('click', async () => {
    downloadUpdateButton.hidden = true;
    renderUpdate(await window.api.updateDownload());
  });
  installUpdateButton.addEventListener('click', async () => {
    installUpdateButton.disabled = true;
    try {
      await window.api.updateInstall();
    } catch (error) {
      updateStatus.classList.add('err');
      updateStatus.textContent = String(error);
      installUpdateButton.disabled = false;
    }
  });
  updateAutoCheck.addEventListener('change', () => void window.api.setConfig({ updateAutoCheck: updateAutoCheck.checked }));
  updateAutoDownload.addEventListener('change', () => void window.api.setConfig({ updateAutoDownload: updateAutoDownload.checked }));
  window.api.onUpdateState(renderUpdate);
  autoLaunch.addEventListener('change', () => void window.api.autoLaunchSet(autoLaunch.checked).then((enabled) => {
    autoLaunch.checked = enabled;
  }).catch((error) => message(liteT('lite.autoLaunch.failed', { error: String(error) }), true)));

  void (async () => {
    // Translate before the first paint so no key is ever painted on screen.
    await liteLoadDictionary().catch((error) => console.error('[lite-settings] i18n:', error));
    const [cfg, enabled] = await Promise.all([window.api.getConfig(), window.api.autoLaunchGet()]);
    paint(cfg);
    renderUpdate(await window.api.updateGetState());
    autoLaunch.checked = enabled;
    window.api.onConfigChanged(paint);
  })().catch((error) => message(liteT('lite.settings.loadFailed', { error: String(error) }), true));
})();
