// ============================================================================
// The walking gait — one clock for the legs, the body and the ground covered.
//
// A walk used to be three independent numbers: the sprite frame came from the
// absolute clock (`floor(now / 125) % 4`), the body bob had its own sine, and the
// window slid at a hard-coded 48 px/s. Three clocks, so the parts only agreed at
// the moment they were tuned — and the pet always started its walk on whatever
// frame the clock happened to be on, which reads as a stutter rather than a step.
//
// Here a walk has a phase: `rate` (the user's animation speed) says how fast the
// legs run, and everything else is derived from that one phase — the frame, the
// bob, and the distance the window has to cover for the feet to stay planted.
// Changing the speed therefore cannot make the pet moonwalk, and `petScale`
// scales the step with the body instead of leaving a big pet taking tiny steps.
//
// A global script like lite-day.ts / lite-care.ts: loaded straight from a
// `<script>` tag, no imports, callable from the pet page and from Node tests.
// ============================================================================

/**
 * How long one walking frame stays on screen at rate 1. The walk row is four
 * frames, so a complete stride (both diagonal steps) is four of these.
 */
const GAIT_FRAME_MS = 125;

/** Frames in one stride — the walk row of the atlas. */
const GAIT_FRAMES = 4;

/** Ground covered by one complete stride, in canvas px at petScale 1. */
const GAIT_STRIDE_PX = 24;

/** Deepest the body sinks below its resting line, in canvas px. */
const GAIT_BOB_PX = 5;

/**
 * On-screen pet size multiplier.
 *
 * The one clamp the whole renderer uses: the drawn art, the gait's stride length
 * and the accessory scale all have to agree on it, or a resized pet walks with
 * steps that no longer match its legs.
 */
function gaitSize(petScale: unknown): number {
  return Math.max(0.65, Math.min(1.6, Number(petScale) || 1));
}

/** Animation-speed multiplier for the whole gait (config.animSpeed, clamped). */
function gaitRate(animSpeed: unknown): number {
  return Math.max(0.5, Math.min(2, Number(animSpeed) || 1));
}

/** How long one walking frame is on screen at this rate, in ms. */
function gaitFrameMs(rate: number = 1): number {
  return GAIT_FRAME_MS / gaitRate(rate);
}

/** How long a complete four-frame stride takes at this rate, in ms. */
function gaitStrideMs(rate: number = 1): number {
  return gaitFrameMs(rate) * GAIT_FRAMES;
}

/**
 * Walking frames per second at this rate.
 *
 * The built-in pet's legs run at 8 fps; an imported pack declares its own, so
 * this is what that number is compared against when a pack has to move at the
 * speed its own animation claims (see `litePackWalkFps`).
 */
function gaitFps(rate: number = 1): number {
  return 1000 / gaitFrameMs(rate);
}

/**
 * Distance the pet has to travel per stride for the feet to stay planted.
 *
 * The art is scaled as a whole, so a bigger pet takes longer steps; the stride
 * therefore scales with `petScale`. This is the number that keeps the legs and
 * the window in agreement, and it is the only place the walking speed comes from.
 */
function gaitStridePx(petScale: unknown = 1): number {
  return GAIT_STRIDE_PX * gaitSize(petScale);
}

/** Walking speed in canvas px per second — derived, never hand-tuned. */
function gaitSpeed(rate: number = 1, petScale: unknown = 1): number {
  return gaitStridePx(petScale) / (gaitStrideMs(rate) / 1000);
}

/**
 * Position in the stride, in frames: 0 at the start of the walk.
 *
 * Anchored to the walk's own start rather than to the wall clock, so every walk
 * begins on frame 0 — a contact pose — instead of mid-cycle.
 */
function gaitPhase(elapsedMs: number, rate: number = 1): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return (elapsedMs * gaitRate(rate)) / GAIT_FRAME_MS;
}

/** Which of the four walking frames is on screen. */
function gaitFrame(elapsedMs: number, rate: number = 1): number {
  return Math.floor(gaitPhase(elapsedMs, rate)) % GAIT_FRAMES;
}

/**
 * How far the body sinks, in canvas px: two dips per stride, one per step.
 *
 * The curve is the one that was tuned against the art by eye — it is only
 * re-expressed in terms of the walk's own phase. Reading it from the same phase
 * the legs use is what stopped it drifting through them.
 */
function gaitBob(elapsedMs: number, rate: number = 1): number {
  return (0.5 - Math.abs(Math.sin((Math.PI * gaitPhase(elapsedMs, rate)) / 2))) * GAIT_BOB_PX;
}
