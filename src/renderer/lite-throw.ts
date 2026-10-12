// ============================================================================
// 拖拽抛掷 / Throwing the pet — the flight model.
//
// Dragging itself is already native and is *not* reimplemented here: `drag_begin`
// / `drag_move` / `drag_end` in src-tauri/src/window.rs hold the cursor offset
// captured at mouse-down and move the window from the live cursor, so the pet
// follows the pointer with no per-move rounding error. This file answers only the
// three questions that come after the button is released:
//
//   1. how fast was the pet moving when the button came up?   `throwVelocity`
//   2. where is it one tick later, and did it hit a wall?     `throwStep`
//   3. which window positions keep it on screen?              `throwBounds`
//
// There is no physics engine and no gravity: what a throw needs is a velocity that
// decays with friction and reflects off the four sides of the work area. Gravity is
// one constant away (`THROW_GRAVITY`, default 0) — with it on, the pet falls, and
// the same `settled` rule lands it on the taskbar edge instead of in mid-air.
//
// A global script like lite-gait.ts / lite-care.ts: no imports, pure functions, so
// the whole flight can be unit-tested in Node without a window.
// ============================================================================

/** One sampled pointer position during the drag, in screen px and ms. */
interface ThrowSample {
  x: number;
  y: number;
  t: number;
}

/** Velocity in pixels per second. */
interface ThrowVelocity {
  vx: number;
  vy: number;
}

/** The pet's position and velocity — the whole state of a flight. */
interface ThrowState extends ThrowVelocity {
  x: number;
  y: number;
}

/** Window-position limits that keep the visible pet inside the work area. */
interface ThrowBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** What one tick did: the new state, which walls were touched, and whether it ended. */
interface ThrowStep extends ThrowState {
  hits: { left: boolean; right: boolean; top: boolean; bottom: boolean };
  speed: number;
  settled: boolean;
}

/**
 * How far back the release velocity looks.
 *
 * Only the tail of the gesture counts: if the pointer paused before the button came
 * up, the pet was being *put down*, not thrown, and averaging the whole drag would
 * read that pause as speed (and fling the pet anyway).
 */
const THROW_SAMPLE_MS = 120;

/** A velocity needs two points in time; one sample is a tap, not a throw. */
const THROW_MIN_SAMPLES = 2;

/** Ceiling on the launch speed, so one fast flick cannot teleport the pet. */
const THROW_MAX_SPEED = 2600;

/** Below this the gesture is a placement: the pet stays where it was dropped. */
const THROW_LAUNCH_SPEED = 140;

/** Velocity kept after one 60 fps frame — the friction that ends the flight. */
const THROW_FRICTION_PER_FRAME = 0.988;

/** How much of the impact speed comes back out of a wall. */
const THROW_BOUNCE = 0.62;

/** Under this speed the flight is over and the velocity is zeroed. */
const THROW_STOP_SPEED = 40;

/** The frame length the friction/bounce numbers were tuned against. */
const THROW_STEP_MS = 1000 / 60;

/** Longest tick the loop will integrate: a stalled frame must not tunnel a wall. */
const THROW_MAX_STEP_MS = 50;

/**
 * Downward acceleration, px/s². Zero = the flight the throw asks for (friction and
 * four walls); set it to ~2200 for a pet that arcs and comes to rest on the bottom
 * edge like a thrown object instead of stopping wherever it ran out of speed.
 */
const THROW_GRAVITY = 0;

/**
 * The velocity a gesture is released with, in px/s.
 *
 * Returns null when the gesture cannot be read as a throw at all (fewer than two
 * samples, or all of them at the same instant) — the caller then simply leaves the
 * pet where it was dropped. The magnitude is capped, but a slow release is
 * deliberately still returned: `throwCanLaunch` is what decides, so a test can see
 * the difference between "no gesture" and "a gentle placement".
 */
function throwVelocity(samples: ThrowSample[]): ThrowVelocity | null {
  if (!Array.isArray(samples) || samples.length < THROW_MIN_SAMPLES) return null;
  const last = samples[samples.length - 1];
  if (!last || !Number.isFinite(last.x) || !Number.isFinite(last.y) || !Number.isFinite(last.t)) return null;
  // The oldest sample still inside the window; a shorter window is fine (a fast
  // flick can have only two samples in 120 ms) and `samples[0]` is the fallback.
  const first = samples.find(sample => last.t - sample.t <= THROW_SAMPLE_MS) ?? samples[0];
  const dt = last.t - first.t;
  if (!(dt > 0)) return null;
  let vx = ((last.x - first.x) / dt) * 1000;
  let vy = ((last.y - first.y) / dt) * 1000;
  const speed = Math.hypot(vx, vy);
  if (!Number.isFinite(speed)) return null;
  if (speed > THROW_MAX_SPEED) {
    const scale = THROW_MAX_SPEED / speed;
    vx *= scale;
    vy *= scale;
  }
  return { vx, vy };
}

/** Whether a gesture was fast enough to throw the pet rather than place it. */
function throwCanLaunch(velocity: ThrowVelocity | null): boolean {
  if (!velocity) return false;
  return Math.hypot(velocity.vx, velocity.vy) >= THROW_LAUNCH_SPEED;
}

/**
 * Advance a flight by `dtMs` and bounce it off the four sides of `bounds`.
 *
 * Semi-implicit Euler: friction is applied to the velocity first, then the
 * position is integrated with the *decayed* velocity. Friction is defined per
 * 60 fps frame but applied as a power of the real elapsed time, so a machine
 * drawing at 30 fps does not glide twice as far per second as one at 60.
 *
 * The pet is treated as a point that must stay inside `bounds` — those limits are
 * already expressed in window coordinates *for its visible box*, computed in Rust
 * from the work area and the renderer's silhouette (see `window_flight_bounds`), so
 * the transparent padding around the art can hang over the edge exactly as it does
 * when the pet walks into the corner.
 */
function throwStep(state: ThrowState, dtMs: number, bounds: ThrowBounds): ThrowStep {
  const dt = Math.min(Math.max(Number(dtMs) || 0, 0), THROW_MAX_STEP_MS) / 1000;
  let { x, y, vx, vy } = state;

  const decay = Math.pow(THROW_FRICTION_PER_FRAME, (dt * 1000) / THROW_STEP_MS);
  vy += THROW_GRAVITY * dt;
  vx *= decay;
  vy *= decay;
  x += vx * dt;
  y += vy * dt;

  const hits = { left: false, right: false, top: false, bottom: false };
  if (x < bounds.minX) { x = bounds.minX; vx = Math.abs(vx) * THROW_BOUNCE; hits.left = true; }
  else if (x > bounds.maxX) { x = bounds.maxX; vx = -Math.abs(vx) * THROW_BOUNCE; hits.right = true; }
  if (y < bounds.minY) { y = bounds.minY; vy = Math.abs(vy) * THROW_BOUNCE; hits.top = true; }
  else if (y > bounds.maxY) { y = bounds.maxY; vy = -Math.abs(vy) * THROW_BOUNCE; hits.bottom = true; }

  // The flight ends on speed, not on a timer: after enough bounces the remaining
  // velocity rounds to nothing, and zeroing it here is what stops the pet from
  // shivering against a wall. `settled` is also how the caller knows to hand the
  // window back to the ordinary walk/idle logic.
  const speed = Math.hypot(vx, vy);
  const settled = speed < THROW_STOP_SPEED;
  if (settled) { vx = 0; vy = 0; }
  return { x, y, vx, vy, hits, speed, settled };
}

/**
 * The bounce box, or null when the backend could not answer.
 *
 * A null answer means "do not fly": guessing a box here would either trap the pet
 * against an invisible wall or let it leave the screen, and the caller can just
 * leave the pet where it was dropped instead.
 */
function throwBounds(raw: Partial<ThrowBounds> & { ok?: boolean } | null | undefined): ThrowBounds | null {
  if (!raw || raw.ok !== true) return null;
  const { minX, minY, maxX, maxY } = raw;
  if (![minX, minY, maxX, maxY].every(value => Number.isFinite(value))) return null;
  // A window larger than the work area gives a reversed box; collapse it to a point
  // rather than letting `throwStep` clamp to an impossible range.
  return {
    minX: minX as number,
    minY: minY as number,
    maxX: Math.max(minX as number, maxX as number),
    maxY: Math.max(minY as number, maxY as number),
  };
}

/**
 * How far the pet leans while flying, in radians.
 *
 * Cosmetic, and derived from the velocity: throwing it to the right tilts it to the
 * right. 900 px/s is roughly a firm flick, so the lean saturates just before the
 * launch speed cap.
 */
function throwTilt(vx: number): number {
  const ratio = Math.max(-1, Math.min(1, (Number(vx) || 0) / 900));
  return ratio * 0.34;
}
