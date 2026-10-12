// ============================================================================
// Pet packs — a user-imported character, drawn from its own sprite sheet.
//
// A pack is one folder: `petpack.json` (the PetDefinition in
// src/shared/petpack-types.ts) plus the sheet it points at. Rust installs and
// validates it (src-tauri/src/petpack.rs); this file is only the arithmetic the
// pet window needs every frame — which animation a state means, which slot of
// that animation is on screen, and which rectangle of the sheet that slot is.
//
// Pure and unit-testable: a global script like lite-gait.ts / lite-summary.ts.
// A pack that does not answer (no `idle`, an empty frame list, art that failed to
// load) has to fall back to Bulu rather than draw nothing, so every function here
// returns null or a sane default instead of throwing.
// ============================================================================

/** Which animation a pet state wants, before the pack's own fallback chain. */
function litePackStateName(state: string): string {
  return state === 'walk' ? 'walk' : state === 'sleep' ? 'sleep' : state === 'click' ? 'click' : 'idle';
}

/** One animation of a pack, or null when the pack does not declare it. */
function litePackAnimation(pack: PetDefinition | null | undefined, name: string): PetPackAnimation | null {
  const animation = pack?.animations?.[name];
  if (!animation || !Array.isArray(animation.frames) || !animation.frames.length) return null;
  return animation;
}

/**
 * The animation a pack can actually play for `name`.
 *
 * Falls back to `idle` and then to the first declared animation: a pack that only
 * ships a walk cycle still shows something while it naps, which beats an empty
 * window. Returns null only when the pack declares no usable animation at all.
 */
function litePackAnimationName(pack: PetDefinition | null | undefined, name: string): string | null {
  if (litePackAnimation(pack, name)) return name;
  if (litePackAnimation(pack, 'idle')) return 'idle';
  const declared = Object.keys(pack?.animations ?? {}).find(entry => !!litePackAnimation(pack, entry));
  return declared ?? null;
}

/**
 * Which entry of `anim.frames` is on screen after `elapsedMs` of this animation.
 *
 * `elapsedMs` is measured from the moment the animation started, so a walk starts
 * on its own first frame rather than wherever a wall clock happened to be — the
 * same rule the gait uses for the built-in pet.
 */
function litePackFrameIndex(anim: PetPackAnimation, elapsedMs: number): number {
  const frames = anim.frames.length;
  if (frames <= 1) return 0;
  const fps = Number(anim.fps) > 0 ? Number(anim.fps) : 8;
  const ticks = Math.max(0, Number(elapsedMs) || 0) / 1000 * fps;
  const step = Math.floor(ticks);
  return anim.loop === false ? Math.min(step, frames - 1) : step % frames;
}

/**
 * Source rectangle of one frame of the sheet.
 *
 * Frame numbers run left to right, then top to bottom (`columns` per row), the
 * same reading order the built-in atlases use.
 */
function litePackFrameRect(
  pack: PetDefinition,
  slot: number,
): { x: number; y: number; w: number; h: number } {
  const { frameWidth, frameHeight, columns } = pack.sprite;
  const perRow = Math.max(1, Math.floor(columns));
  const index = Math.max(0, Math.floor(slot));
  return {
    x: (index % perRow) * frameWidth,
    y: Math.floor(index / perRow) * frameHeight,
    w: frameWidth,
    h: frameHeight,
  };
}

/**
 * Fps of a pack's walk animation, or 0 when it has none.
 *
 * The window has to move at the speed the legs claim to cover, so the glide speed
 * is derived from this rather than from Bulu's hard-coded stride: a pack whose
 * walk runs at 12 fps walks one and a half times as fast as the built-in 8 fps.
 */
function litePackWalkFps(pack: PetDefinition | null | undefined): number {
  const walk = litePackAnimation(pack, 'walk');
  if (!walk) return 0;
  return Number(walk.fps) > 0 ? Number(walk.fps) : 8;
}
