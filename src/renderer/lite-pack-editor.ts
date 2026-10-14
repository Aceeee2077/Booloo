// ============================================================================
// The pet-pack editor — the form behind `#pack-editor` in settings.html.
//
// A pack is a folder the Rust side owns (src-tauri/src/petpack.rs): a
// PetDefinition plus the sheet it points at. This script is the visual half of
// authoring one: it copies a sheet into the app's draft folder, lets the author
// describe the frame grid by clicking it, and wires frames into named
// animations — then hands the finished manifest to `pet_save`, which validates
// it and swaps it into `pets/<id>`.
//
// A global script like lite-pack.ts / lite-settings.ts, so it calls liteT() and
// the frame arithmetic in lite-pack.ts directly. It is loaded on every settings
// open but touches no DOM until `open()` is called — the host panel decides when
// the editor appears (a card's "Edit…" or "New pet pack…"), which also keeps this
// file loadable without a document.
// ============================================================================
(() => {
  interface EditorUi {
    panel: HTMLDetailsElement;
    name: HTMLInputElement;
    id: HTMLInputElement;
    author: HTMLInputElement;
    version: HTMLInputElement;
    description: HTMLTextAreaElement;
    canvas: HTMLCanvasElement;
    pick: HTMLButtonElement;
    sheetInfo: HTMLElement;
    frameWidth: HTMLInputElement;
    frameHeight: HTMLInputElement;
    columns: HTMLInputElement;
    rows: HTMLInputElement;
    scale: HTMLInputElement;
    gridWarning: HTMLElement;
    animSelect: HTMLSelectElement;
    animName: HTMLInputElement;
    animAdd: HTMLButtonElement;
    animRemove: HTMLButtonElement;
    animFps: HTMLInputElement;
    animLoop: HTMLInputElement;
    frames: HTMLElement;
    framePlay: HTMLButtonElement;
    framesClear: HTMLButtonElement;
    preview: HTMLCanvasElement;
    save: HTMLButtonElement;
    cancel: HTMLButtonElement;
    status: HTMLElement;
  }

  /** The draft sheet on screen: where to draw it from, and how big it really is. */
  interface DraftSheet {
    url: string;
    width: number;
    height: number;
  }

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  /** Built once and kept: the markup is static and only its values change. */
  let ui: EditorUi | null = null;
  /** The manifest being edited; null when the editor is closed. */
  let manifest: PetDefinition | null = null;
  /** True when an installed pack is open, which locks its id. */
  let editing = false;
  let onSaved: ((pet?: LitePetPackEntry) => void) | null = null;
  let sheet: DraftSheet | null = null;
  /** The decoded sheet, or null while it loads / when it failed. */
  let image: HTMLImageElement | null = null;
  /** Where the sheet was last drawn on the canvas, in canvas pixels. */
  let placement = { x: 0, y: 0, w: 0, h: 0 };
  let current: string | null = null;
  let playing = false;
  let frame = 0;
  let playStart = 0;

  // ---------------------------------------------------------------- canvas ----

  /**
   * Fit the sheet inside the canvas, then lay the frame grid over it.
   *
   * The grid is only a guide — never a crop — so a sheet whose size does not
   * divide evenly still draws whole, and the mismatch is reported in words
   * beside the canvas rather than by silently hiding the art that falls outside
   * the last cell.
   */
  function drawSheet(): void {
    if (!ui) return;
    const ctx = ui.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    if (!manifest || !image || !image.complete || !image.naturalWidth) {
      placement = { x: 0, y: 0, w: 0, h: 0 };
      return;
    }
    const margin = 8;
    const fit = Math.min(
      (ui.canvas.width - margin * 2) / image.naturalWidth,
      (ui.canvas.height - margin * 2) / image.naturalHeight,
    );
    const w = image.naturalWidth * fit;
    const h = image.naturalHeight * fit;
    const x = (ui.canvas.width - w) / 2;
    const y = (ui.canvas.height - h) / 2;
    placement = { x, y, w, h };
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, x, y, w, h);
    const { columns, rows } = manifest.sprite;
    ctx.strokeStyle = 'rgba(234, 119, 59, .9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let column = 1; column < columns; column++) {
      const gx = Math.round(x + (w / columns) * column) + 0.5;
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + h);
    }
    for (let row = 1; row < rows; row++) {
      const gy = Math.round(y + (h / rows) * row) + 0.5;
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
    }
    ctx.stroke();
  }

  /** A click on the sheet adds the cell under the cursor to the open animation. */
  function onCanvasClick(event: MouseEvent): void {
    if (!ui || !manifest || !image || !placement.w) return;
    const rect = ui.canvas.getBoundingClientRect();
    // The canvas is laid out at CSS size, so a click has to be scaled back to
    // the drawing-buffer pixels the placement is measured in.
    const px = (event.clientX - rect.left) * (ui.canvas.width / rect.width);
    const py = (event.clientY - rect.top) * (ui.canvas.height / rect.height);
    const { x, y, w, h } = placement;
    if (px < x || py < y || px >= x + w || py >= y + h) return;
    const { columns, rows } = manifest.sprite;
    const column = Math.min(columns - 1, Math.floor(((px - x) / w) * columns));
    const row = Math.min(rows - 1, Math.floor(((py - y) / h) * rows));
    addFrame(row * columns + column);
  }

  // -------------------------------------------------------------- animation ----

  /** Push a cell number onto the open animation. */
  function addFrame(slot: number): void {
    const animation = currentAnimation();
    if (!animation) return;
    animation.frames.push(slot);
    paintFrames();
    paintPreview();
  }

  function currentAnimation(): PetPackAnimation | null {
    return manifest && current ? manifest.animations[current] ?? null : null;
  }

  /** Rebuild the animation picker, keeping the open one selected. */
  function paintAnimations(): void {
    if (!ui || !manifest) return;
    const names = Object.keys(manifest.animations);
    if (!current || !manifest.animations[current]) current = names[0] ?? null;
    ui.animSelect.textContent = '';
    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      ui.animSelect.append(option);
    }
    if (current) ui.animSelect.value = current;
    paintAnimator();
  }

  /** Paint the open animation's own fields and its list of frames. */
  function paintAnimator(): void {
    if (!ui) return;
    const animation = currentAnimation();
    const frames = ui.frames;
    frames.textContent = '';
    if (!animation) {
      ui.animFps.value = '';
      ui.animLoop.checked = true;
      appendNote(frames, liteT('lite.editor.framesEmpty'));
      return;
    }
    ui.animFps.value = String(animation.fps);
    ui.animLoop.checked = animation.loop !== false;
    if (!animation.frames.length) {
      appendNote(frames, liteT('lite.editor.framesEmpty'));
      return;
    }
    animation.frames.forEach((slot, index) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'editor-framechip';
      chip.textContent = String(slot);
      chip.title = liteT('lite.editor.frameRemove');
      chip.dataset.frameIndex = String(index);
      frames.append(chip);
    });
  }

  function appendNote(parent: HTMLElement, text: string): void {
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = text;
    parent.append(note);
  }

  /** The frames ARE the chips, so painting is just the frame list. */
  function paintFrames(): void {
    paintAnimator();
  }

  function selectAnimation(name: string): void {
    if (!manifest || !manifest.animations[name]) return;
    current = name;
    stopPlay();
    paintAnimator();
    paintPreview();
  }

  function addAnimation(name: string): void {
    if (!ui || !manifest) return;
    const trimmed = name.trim();
    if (!trimmed) { setStatus(liteT('lite.editor.emptyName'), true); return; }
    if (manifest.animations[trimmed]) {
      setStatus(liteT('lite.editor.duplicateAnimation', { name: trimmed }), true);
      return;
    }
    manifest.animations[trimmed] = { frames: [], fps: 8, loop: true };
    ui.animName.value = '';
    current = trimmed;
    setStatus('');
    paintAnimations();
    paintPreview();
  }

  function removeAnimation(): void {
    if (!ui || !manifest || !current) return;
    const names = Object.keys(manifest.animations);
    // A pack with no animation at all cannot be saved, so the last one stays.
    if (names.length <= 1) { setStatus(liteT('lite.editor.noAnimations'), true); return; }
    delete manifest.animations[current];
    current = Object.keys(manifest.animations)[0] ?? null;
    setStatus('');
    paintAnimations();
    paintPreview();
  }

  // ---------------------------------------------------------------- preview ----

  /** Draw one frame of `animation` into the little preview canvas. */
  function drawPreviewFrame(animation: PetPackAnimation, index: number): void {
    if (!ui || !manifest || !image || !image.complete || !image.naturalWidth) return;
    const ctx = ui.preview.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, ui.preview.width, ui.preview.height);
    const slot = animation.frames[Math.max(0, Math.min(index, animation.frames.length - 1))];
    if (slot === undefined) return;
    const rect = litePackFrameRect(manifest, slot);
    const fit = Math.min(ui.preview.width / rect.w, ui.preview.height / rect.h);
    const w = rect.w * fit;
    const h = rect.h * fit;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      rect.x, rect.y, rect.w, rect.h,
      (ui.preview.width - w) / 2, (ui.preview.height - h) / 2, w, h,
    );
  }

  /** The still first frame, shown whenever playback is not running. */
  function paintPreview(): void {
    const animation = currentAnimation();
    if (!animation || !animation.frames.length) { clearPreview(); return; }
    drawPreviewFrame(animation, 0);
  }

  function clearPreview(): void {
    if (!ui) return;
    const ctx = ui.preview.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, ui.preview.width, ui.preview.height);
  }

  function togglePlay(): void {
    if (playing) { stopPlay(); return; }
    const animation = currentAnimation();
    if (!ui || !animation || !animation.frames.length) return;
    playing = true;
    ui.framePlay.classList.add('active');
    playStart = performance.now();
    const step = () => {
      if (!playing) return;
      const open = currentAnimation();
      if (!open || !open.frames.length) { stopPlay(); return; }
      // The same clock the pet window uses, so what is previewed here is what
      // the pet will actually play.
      drawPreviewFrame(open, litePackFrameIndex(open, performance.now() - playStart));
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
  }

  function stopPlay(): void {
    playing = false;
    if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
    if (ui) ui.framePlay.classList.remove('active');
  }

  // ------------------------------------------------------------------ sheet ----

  /**
   * Adopt `name` as the pack's sheet and load it for drawing.
   *
   * `guess` is for a freshly picked file: a manifest that still describes a
   * single 1×1 cell is almost certainly "one picture", so the whole image is
   * offered as one frame before the author narrows the grid.
   */
  function setSheet(name: string, url: string, width: number, height: number, guess: boolean): void {
    if (!manifest) return;
    manifest.assets.spritesheet = name;
    sheet = { url, width, height };
    image = null;
    if (url) {
      const loaded = new Image();
      image = loaded;
      loaded.onload = () => {
        if (image !== loaded || !sheet || !manifest) return;
        sheet.width = loaded.naturalWidth || sheet.width;
        sheet.height = loaded.naturalHeight || sheet.height;
        if (guess && manifest.sprite.columns === 1 && manifest.sprite.rows === 1) {
          manifest.sprite.frameWidth = sheet.width;
          manifest.sprite.frameHeight = sheet.height;
          if (ui) {
            ui.frameWidth.value = String(sheet.width);
            ui.frameHeight.value = String(sheet.height);
          }
        }
        updateSheetInfo();
        applyGrid();
      };
      loaded.onerror = () => { if (image === loaded) applyGrid(); };
      loaded.src = url;
    }
    updateSheetInfo();
    applyGrid();
  }

  function updateSheetInfo(): void {
    if (!ui) return;
    if (!sheet || (!sheet.width && !sheet.height)) {
      ui.sheetInfo.textContent = liteT('lite.editor.noSheet');
      return;
    }
    ui.sheetInfo.textContent = liteT('lite.editor.sheetSize', { width: sheet.width, height: sheet.height });
  }

  // ------------------------------------------------------------------- grid ----

  /** A whole number ≥ 1 from a box, or the model's own value when the box is junk. */
  function wholeNumber(input: HTMLInputElement, fallback: number): number {
    const value = Math.floor(Number(input.value));
    return Number.isFinite(value) && value >= 1 ? value : fallback;
  }

  /**
   * Fold the grid boxes back into the manifest, then redraw.
   *
   * Read on `change` (blur or Enter) rather than on every keystroke, so a
   * half-typed number never becomes the grid; a value that does not survive the
   * fold is written back from the model, so a box and the grid cannot disagree.
   */
  function applyGrid(): void {
    if (!ui || !manifest) return;
    const sprite = manifest.sprite;
    sprite.frameWidth = wholeNumber(ui.frameWidth, sprite.frameWidth);
    sprite.frameHeight = wholeNumber(ui.frameHeight, sprite.frameHeight);
    sprite.columns = wholeNumber(ui.columns, sprite.columns);
    sprite.rows = wholeNumber(ui.rows, sprite.rows);
    const scale = Number(ui.scale.value);
    if (Number.isFinite(scale) && scale > 0) sprite.scale = scale;
    ui.frameWidth.value = String(sprite.frameWidth);
    ui.frameHeight.value = String(sprite.frameHeight);
    ui.columns.value = String(sprite.columns);
    ui.rows.value = String(sprite.rows);
    ui.scale.value = String(sprite.scale);
    drawSheet();
    updateGridWarning();
  }

  /**
   * Say out loud whether the grid covers the sheet exactly.
   *
   * This is the mistake every hand-authored pack makes once, and `pet_save`
   * refuses it — so it is worth catching here, while the numbers are still on
   * screen, rather than as a failed save.
   */
  function updateGridWarning(): void {
    if (!ui) return;
    if (!manifest || !sheet) {
      ui.gridWarning.textContent = '';
      ui.gridWarning.classList.remove('error');
      return;
    }
    const { frameWidth, frameHeight, columns, rows } = manifest.sprite;
    const expectedWidth = frameWidth * columns;
    const expectedHeight = frameHeight * rows;
    const matches = sheet.width === expectedWidth && sheet.height === expectedHeight;
    ui.gridWarning.classList.toggle('error', !matches);
    ui.gridWarning.textContent = matches
      ? liteT('lite.editor.gridOk', { cells: columns * rows })
      : liteT('lite.editor.gridMismatch', {
        expected: `${expectedWidth}×${expectedHeight}`,
        width: sheet.width,
        height: sheet.height,
      });
  }

  // ------------------------------------------------------------------ draft ----

  function newManifest(): PetDefinition {
    return {
      schemaVersion: 1,
      id: '',
      displayName: '',
      assets: { spritesheet: '' },
      sprite: { frameWidth: 32, frameHeight: 32, columns: 1, rows: 1, scale: 1 },
      // One animation to start from, so the frame picker has somewhere to put
      // the first click.
      animations: { idle: { frames: [], fps: 8, loop: true } },
      source: 'imported',
    };
  }

  /** Fill in anything a hand-trimmed manifest left out, so the form has values. */
  function normalize(base: PetDefinition): PetDefinition {
    return {
      ...base,
      schemaVersion: 1,
      assets: { spritesheet: base.assets?.spritesheet ?? '' },
      sprite: {
        frameWidth: base.sprite?.frameWidth ?? 32,
        frameHeight: base.sprite?.frameHeight ?? 32,
        columns: base.sprite?.columns ?? 1,
        rows: base.sprite?.rows ?? 1,
        scale: base.sprite?.scale ?? 1,
        anchorX: base.sprite?.anchorX,
        anchorY: base.sprite?.anchorY,
      },
      animations: { ...(base.animations ?? {}) },
      source: base.source ?? 'imported',
    };
  }

  /** Load `id` into the form — an installed pack, or a blank new one. */
  async function loadDraft(id: string): Promise<void> {
    if (!ui) return;
    ui.save.disabled = false;
    setStatus('');
    let result: PetEditorDraftResult;
    try {
      result = await window.api.petEditorOpen(id);
    } catch (error) {
      setStatus(liteT('lite.editor.openFailed', { error: String(error) }), true);
      return;
    }
    if (!result.ok) {
      setStatus(liteT('lite.editor.openFailed', { error: result.error ?? '' }), true);
      return;
    }
    editing = !!result.manifest;
    manifest = result.manifest ? normalize(result.manifest) : newManifest();
    ui.name.value = manifest.displayName ?? '';
    ui.id.value = manifest.id ?? '';
    // The id is the folder name: editing keeps it, so a save overwrites the pack
    // in place instead of orphaning whichever pet is wearing it.
    ui.id.readOnly = editing;
    ui.author.value = manifest.author ?? '';
    ui.version.value = manifest.version ?? '';
    ui.description.value = manifest.description ?? '';
    ui.frameWidth.value = String(manifest.sprite.frameWidth);
    ui.frameHeight.value = String(manifest.sprite.frameHeight);
    ui.columns.value = String(manifest.sprite.columns);
    ui.rows.value = String(manifest.sprite.rows);
    ui.scale.value = String(manifest.sprite.scale);
    sheet = null;
    image = null;
    if (result.sheet) {
      setSheet(result.sheet, result.url ?? '', result.width ?? 0, result.height ?? 0, false);
    } else {
      updateSheetInfo();
      applyGrid();
    }
    current = Object.keys(manifest.animations)[0] ?? null;
    paintAnimations();
    paintPreview();
  }

  async function pickSheet(): Promise<void> {
    if (!ui) return;
    setStatus('');
    let result: PetEditorDraftResult;
    try {
      result = await window.api.petEditorPick();
    } catch (error) {
      setStatus(liteT('lite.editor.openFailed', { error: String(error) }), true);
      return;
    }
    if (result.cancelled) return;
    if (!result.ok || !result.sheet) {
      setStatus(liteT('lite.editor.openFailed', { error: result.error ?? '' }), true);
      return;
    }
    setSheet(result.sheet, result.url ?? '', result.width ?? 0, result.height ?? 0, true);
  }

  /**
   * The manifest as the form currently reads it.
   *
   * Animations with no frames are dropped rather than refused: an author who
   * names a clip before filling it in has not made a mistake, and the backend
   * rejects the whole pack over one empty clip.
   */
  function buildManifest(): PetDefinition | null {
    if (!ui || !manifest) return null;
    const animations: Record<string, PetPackAnimation> = {};
    for (const [name, animation] of Object.entries(manifest.animations)) {
      if (!animation.frames.length) continue;
      animations[name] = { ...animation, frames: animation.frames.slice() };
    }
    const name = ui.name.value.trim();
    const id = (ui.id.value.trim() || name || manifest.id).trim();
    const author = ui.author.value.trim();
    const version = ui.version.value.trim();
    const description = ui.description.value.trim();
    return {
      ...manifest,
      schemaVersion: 1,
      id,
      displayName: name || manifest.displayName || id,
      author: author || undefined,
      version: version || undefined,
      description: description || undefined,
      assets: { ...manifest.assets },
      sprite: { ...manifest.sprite },
      animations,
      source: 'imported',
    };
  }

  async function save(): Promise<void> {
    if (!ui || !manifest) return;
    if (!sheet) { setStatus(liteT('lite.editor.noSheet'), true); return; }
    const payload = buildManifest();
    if (!payload) return;
    if (!Object.keys(payload.animations).length) {
      setStatus(liteT('lite.editor.noAnimations'), true);
      return;
    }
    ui.save.disabled = true;
    setStatus('');
    try {
      const result = await window.api.petSave(payload);
      if (!result.ok) {
        setStatus(liteT('lite.editor.saveFailed', { error: result.error ?? '' }), true);
        return;
      }
      // A successful save deletes the draft, so the editor must close with it —
      // but keep the callback, which close() clears.
      const callback = onSaved;
      close();
      callback?.(result.pet);
    } catch (error) {
      setStatus(liteT('lite.editor.saveFailed', { error: String(error) }), true);
    } finally {
      if (ui) ui.save.disabled = false;
    }
  }

  // ------------------------------------------------------------------ wiring ----

  function setStatus(text: string, error = false): void {
    if (!ui) return;
    ui.status.textContent = text;
    ui.status.classList.toggle('error', error);
  }

  function close(): void {
    stopPlay();
    if (ui) {
      ui.panel.hidden = true;
      ui.panel.open = false;
      ui.save.disabled = false;
    }
    manifest = null;
    sheet = null;
    image = null;
    current = null;
    editing = false;
    onSaved = null;
    placement = { x: 0, y: 0, w: 0, h: 0 };
  }

  /** The form's elements, built and wired once. */
  function refs(): EditorUi {
    if (ui) return ui;
    const editor: EditorUi = {
      panel: $<HTMLDetailsElement>('pack-editor'),
      name: $<HTMLInputElement>('editor-name'),
      id: $<HTMLInputElement>('editor-id'),
      author: $<HTMLInputElement>('editor-author'),
      version: $<HTMLInputElement>('editor-version'),
      description: $<HTMLTextAreaElement>('editor-description'),
      canvas: $<HTMLCanvasElement>('editor-canvas'),
      pick: $<HTMLButtonElement>('editor-pick'),
      sheetInfo: $<HTMLElement>('editor-sheet-info'),
      frameWidth: $<HTMLInputElement>('editor-frame-width'),
      frameHeight: $<HTMLInputElement>('editor-frame-height'),
      columns: $<HTMLInputElement>('editor-columns'),
      rows: $<HTMLInputElement>('editor-rows'),
      scale: $<HTMLInputElement>('editor-scale'),
      gridWarning: $<HTMLElement>('editor-grid-warning'),
      animSelect: $<HTMLSelectElement>('editor-anim-select'),
      animName: $<HTMLInputElement>('editor-anim-name'),
      animAdd: $<HTMLButtonElement>('editor-anim-add'),
      animRemove: $<HTMLButtonElement>('editor-anim-remove'),
      animFps: $<HTMLInputElement>('editor-anim-fps'),
      animLoop: $<HTMLInputElement>('editor-anim-loop'),
      frames: $<HTMLElement>('editor-frames'),
      framePlay: $<HTMLButtonElement>('editor-frame-play'),
      framesClear: $<HTMLButtonElement>('editor-frames-clear'),
      preview: $<HTMLCanvasElement>('editor-preview'),
      save: $<HTMLButtonElement>('editor-save'),
      cancel: $<HTMLButtonElement>('editor-cancel'),
      status: $<HTMLElement>('editor-status'),
    };
    ui = editor;
    editor.canvas.addEventListener('click', onCanvasClick);
    editor.pick.addEventListener('click', () => void pickSheet());
    for (const box of [editor.frameWidth, editor.frameHeight, editor.columns, editor.rows, editor.scale]) {
      box.addEventListener('change', applyGrid);
    }
    editor.animSelect.addEventListener('change', () => selectAnimation(editor.animSelect.value));
    editor.animAdd.addEventListener('click', () => addAnimation(editor.animName.value));
    editor.animRemove.addEventListener('click', removeAnimation);
    editor.animFps.addEventListener('change', () => {
      const animation = currentAnimation();
      if (!animation) return;
      animation.fps = wholeNumber(editor.animFps, animation.fps);
      editor.animFps.value = String(animation.fps);
    });
    editor.animLoop.addEventListener('change', () => {
      const animation = currentAnimation();
      if (animation) animation.loop = editor.animLoop.checked;
    });
    editor.frames.addEventListener('click', (event) => {
      const chip = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-frame-index]');
      const animation = currentAnimation();
      if (!chip || !animation) return;
      const index = Number(chip.dataset.frameIndex);
      if (!Number.isInteger(index)) return;
      animation.frames.splice(index, 1);
      paintFrames();
      paintPreview();
    });
    editor.framesClear.addEventListener('click', () => {
      const animation = currentAnimation();
      if (!animation) return;
      animation.frames = [];
      stopPlay();
      paintFrames();
      paintPreview();
    });
    editor.framePlay.addEventListener('click', togglePlay);
    editor.save.addEventListener('click', () => void save());
    editor.cancel.addEventListener('click', close);
    return editor;
  }

  /** Show the editor on `id` (blank for a new pack) and load its draft. */
  function open(id: string, callback?: (pet?: LitePetPackEntry) => void): void {
    const editor = refs();
    onSaved = callback ?? null;
    editor.panel.hidden = false;
    editor.panel.open = true;
    editor.panel.scrollIntoView({ block: 'nearest' });
    void loadDraft(id);
  }

  window.litePackEditor = { open };
})();
