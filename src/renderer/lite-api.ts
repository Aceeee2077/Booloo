/** Small Tauri bridge used by the lightweight pet and settings pages. */
(() => {
  type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  type Listen = (name: string, callback: (event: { payload: unknown }) => void) => Promise<() => void>;
  const tauri = (window as unknown as {
    __TAURI__?: { core?: { invoke?: Invoke; convertFileSrc?: (path: string) => string }; event?: { listen?: Listen } };
  }).__TAURI__;
  const invoke = tauri?.core?.invoke;
  const call = <T>(name: string, args?: Record<string, unknown>) =>
    invoke ? invoke(name, args) as Promise<T> : Promise.reject(new Error('Tauri unavailable'));
  const send = (name: string, args?: Record<string, unknown>) => {
    void call(name, args).catch(error => console.error(`[lite-api] ${name}:`, error));
  };
  const urlOf = (path?: string) => path && tauri?.core?.convertFileSrc ? tauri.core.convertFileSrc(path) : undefined;
  const bounds = () => (window as unknown as { __prismooVisualBounds?: () => PetBox }).__prismooVisualBounds?.();

  function subscribe<T>(name: string, callback: (value: T) => void) {
    let stop: (() => void) | null = null;
    let closed = false;
    void tauri?.event?.listen?.(name, event => callback(event.payload as T)).then(unlisten => {
      if (closed) unlisten(); else stop = unlisten;
    }).catch(error => console.error(`[lite-api] ${name}:`, error));
    return () => { closed = true; stop?.(); };
  }

  let moveTimer: number | null = null;
  function autoMoveStop() {
    if (moveTimer !== null) window.clearInterval(moveTimer);
    moveTimer = null;
  }
  function autoMoveStart(direction: number, speed: number) {
    autoMoveStop();
    let previous = performance.now();
    moveTimer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      send('window_move', { dx: Math.round(direction * speed * dt), dy: 0, visualBounds: bounds() });
    }, 16);
  }

  let reentry: number | null = null;
  function setClickThrough(enabled: boolean) {
    send('set_click_through', { enabled });
    if (reentry !== null) { window.clearInterval(reentry); reentry = null; }
    if (!enabled) return;
    let failures = 0;
    reentry = window.setInterval(() => {
      const test = (window as unknown as { __prismooHitTest?: (x: number, y: number) => boolean }).__prismooHitTest;
      if (!test) return;
      void call<[number, number] | null>('cursor_in_window').then(point => {
        failures = 0;
        if (point && test(point[0], point[1])) setClickThrough(false);
      }).catch(() => { if (++failures >= 5) setClickThrough(false); });
    }, 70);
  }

  const api = {
    getConfig: () => call<AppConfig>('config_get'),
    setConfig: (patch: Partial<AppConfig>) => call<AppConfig>('config_set', { patch }),
    getI18n: () => call<I18nPayload>('i18n_get'),
    onConfigChanged: (callback: (cfg: AppConfig) => void) => subscribe<AppConfig>('config-changed', callback),
    onFileDrop: (callback: (drop: PetFileDrop) => void) => subscribe<PetFileDrop>('tauri://drag-drop', callback),
    onPetAction: (callback: (action: string) => void) => subscribe<string>('pet-action', callback),
    getCustomImage: async () => {
      const result = await call<CustomImageResult>('custom_get');
      return { ...result, url: result.url ?? urlOf(result.path) };
    },
    previewCustomImage: async () => {
      const result = await call<CustomImageResult>('custom_pick_preview');
      return { ...result, url: result.url ?? urlOf(result.path) };
    },
    commitCustomImage: async (removeBackground: boolean) => {
      const result = await call<CustomImageResult>('custom_commit', { removeBackground });
      return { ...result, url: result.url ?? urlOf(result.path) };
    },
    discardCustomImage: () => call<void>('custom_discard'),
    dragBegin: (visualBounds?: PetBox) => send('drag_begin', { visualBounds: visualBounds ?? bounds() }),
    dragMove: () => send('drag_move'),
    dragEnd: (visualBounds?: PetBox) => send('drag_end', { visualBounds: visualBounds ?? bounds() }),
    getWindowPosition: () => call<[number, number]>('window_position'),
    moveWindowTo: (x: number, y: number) => call<void>('window_move_to', { x: Math.round(x), y: Math.round(y), visualBounds: bounds() }),
    getWindowCenterTarget: (visualBounds?: PetBox) => call<[number, number]>('window_center_target', { visualBounds: visualBounds ?? bounds() }),
    autoMoveStart,
    autoMoveStop,
    windowEdgeGaps: (visualBounds?: PetBox | null) => call<WindowEdgeGaps>('window_edge_gaps', { visual: visualBounds ?? bounds() ?? null }),
    setClickThrough,
    showContextMenu: () => send('show_pet_menu'),
    petMenuAction: (action: string) => send('pet_menu_action', { action }),
    closePetMenu: () => send('close_pet_menu'),
    resetPosition: () => send('window_center_here'),
    closeSettings: () => send('close_settings'),
    autoLaunchGet: () => call<boolean>('autolaunch_get'),
    autoLaunchSet: (enabled: boolean) => call<boolean>('autolaunch_set', { enabled }),
  };
  window.api = api as unknown as PetApi;
  if (document.getElementById('pet-canvas')) {
    setClickThrough(true);
    send('show_pet_window');
  }
})();
