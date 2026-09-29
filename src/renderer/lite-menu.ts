/** Warm, lightweight replacement for the native dark context menu. */
(() => {
  if (!window.api) return;

  // The menu window is built per open, so loading the dictionary here is enough
  // to follow the locale that Settings just saved.
  void window.api.getI18n()
    .then(payload => liteSetLocaleData(payload.locale, payload.dict))
    .catch(error => console.error('[lite-menu] i18n:', error));

  // The affinity line is the only entry here that comes from the config; the rest
  // of the menu is fixed markup. It is filled once per open — the menu window is
  // rebuilt every time — and stays hidden if the config cannot be read.
  void window.api.getConfig().then((cfg) => {
    const line = document.getElementById('menu-affinity');
    if (!line) return;
    const value = Math.max(0, Number(cfg.affinity) || 0);
    line.textContent = liteT('affinity.badgeTitle', {
      value,
      level: affinityLevelName(affinityLevel(value)),
    });
    line.hidden = false;
  }).catch(() => undefined);

  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action]'))) {
    button.addEventListener('click', () => window.api.petMenuAction(button.dataset.action as string));
  }
  window.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!document.hasFocus()) window.api.closePetMenu();
    }, 80);
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') window.api.closePetMenu();
  });
  document.addEventListener('contextmenu', event => event.preventDefault());
})();
