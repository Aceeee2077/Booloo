// ============================================================================
// A white silhouette of a picture, stamped around it as a sticker outline.
//
// An imperfect cutout reads as ragged on a busy desktop; tracing it makes the
// edge look deliberate instead of accidental. Opt-in via `config.customOutline`.
//
// A global script like lite-day.ts: the pet page calls litePetOutline() directly,
// with no imports and no bundler. Only the canvas is touched, so the caller keeps
// owning the config switch that decides whether to ask for it at all.
// ============================================================================

/** The same picture, recoloured to a flat white silhouette on a fresh canvas. */
function litePetOutline(source: HTMLCanvasElement): HTMLCanvasElement {
  const outline = document.createElement('canvas');
  outline.width = source.width;
  outline.height = source.height;
  const ctx = outline.getContext('2d');
  if (ctx) {
    ctx.drawImage(source, 0, 0);
    // Keep the picture's own silhouette and recolour it.
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outline.width, outline.height);
  }
  return outline;
}
