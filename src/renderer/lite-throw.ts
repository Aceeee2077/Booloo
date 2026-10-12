// ============================================================================
// 拖拽抛掷 / Throwing the pet — the flight model.
//
// Dragging itself is already native and is *not* reimplemented here: `drag_begin`
// / `drag_move` / `drag_end` in src-tauri/src/window.rs hold the cursor offset
// captured at mouse-down and move the window from the live cursor, so the pet
// follows the pointer with no per-move rounding error. This file answers only the
// four questions that come after the button is released:
//
//   1. was that a throw at all, or a careful placement?       `throwRelease`
//      (which asks `throwPeak` how fast the hand got and `throwStillMoving` whether
//      it was still moving at the release, and returns `throwVelocity` when a throw)
//   2. where is it one tick later, and did it hit a wall?     `throwStep`
//   3. which window positions keep it on screen?              `throwBounds`
//   4. how much of the drag is worth keeping?                 `throwRemember`
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
 * How far back the release velocity and the gesture's fastest stretch are read.
 *
 * Shorter than it once was, for a reason the user can feel: a 120 ms window still
 * holds the last stretch of the *drag* when someone drags quickly, stops, and lets
 * go — the pet then hopped a little on every ordinary placement. The window is now
 * only as long as a flick takes, and `throwStillMoving` is what rejects the stop.
 */
const THROW_SAMPLE_MS = 100;

/** Two samples closer together than this cannot describe a direction. */
const THROW_MIN_SPAN_MS = 12;

/**
 * The stretch of motion that decides whether the gesture was a throw. See `throwPeak`.
 *
 * Judging the whole window by its *average* asked the hand to be fast for the entire
 * last 100 ms, and a real flick is not shaped like that: it is fastest in the middle
 * and already slowing when the button comes up, so the average read a few hundred
 * px/s below the speed the hand actually reached and the pet sat still unless it was
 * thrown deliberately hard.
 */
const THROW_PEAK_SPAN_MS = 30;

/**
 * The tail speed is measured across at least this much time — never between two
 * adjacent events.
 *
 * Mouse events arrive at the *mouse's* report rate: a gaming mouse reports every
 * millisecond, and one screen pixel of position quantisation is then 1000 px/s of
 * apparent jitter. Asking the last two events for 2 px of movement turned that into a
 * hidden floor of 2000 px/s, and the pet could not be thrown at all above 125 Hz
 * (measured; see the report-rate sweep in `scripts/test-lite.mjs`). A span makes the
 * judgement independent of the hardware.
 */
const THROW_TAIL_SPAN_MS = 12;

/** How recently the pointer has to have moved for the release to count as a flick. */
const THROW_TAIL_MS = 60;

/** A velocity needs two points in time; one sample is a tap, not a throw. */
const THROW_MIN_SAMPLES = 2;

/**
 * Below one whole pixel there is no position to measure, only a rounding error: the
 * speed floor is what decides the rest, over a span of at least `THROW_TAIL_SPAN_MS`.
 */
const THROW_MIN_TAIL_PX = 1;

/**
 * How much of the drag is kept for the judgement.
 *
 * The buffer is bounded by *time*, not by a sample count, because the count is a
 * function of the mouse: 24 samples is 190 ms on a 125 Hz mouse and 24 ms on a
 * 1000 Hz one, which is less than the window above — and the pet silently became
 * unthrowable on the fast mouse.
 */
const THROW_BUFFER_MS = 200;

/**
 * A ceiling as well, so an exotic report rate cannot grow the buffer without bound.
 * 240 samples is a full window at 1000 Hz and still more than the minimum span at
 * 4000 Hz, so the judgement stays the same gesture at every rate in between.
 */
const THROW_BUFFER_MAX = 240;

/** Ceiling on the launch speed, so one fast flick cannot teleport the pet. */
const THROW_MAX_SPEED = 2600;

/**
 * Speed the hand has to reach at its fastest, in px/s, for the gesture to be a throw
 * rather than a placement. 420 px/s is roughly "moved 7 px in a 16 ms mouse event",
 * which is faster than anything a person does while aiming at a spot to put the pet
 * down — this is the gate that keeps a careful drag-to-a-place from flying, and it is
 * applied to `throwPeak` rather than to the average over the window.
 */
const THROW_LAUNCH_SPEED = 420;

/**
 * …but the *release itself* only has to be moving, not fast.
 *
 * Demanding the full launch speed between the last two samples asked a person to be
 * still accelerating at the instant the button came up, and a real flick does not
 * end that way: the hand has usually begun to slow by the time the button releases.
 * Holding this at the same 420 px/s made the pet unthrowable (nothing at all
 * happened), so the tail is only asked to prove the pointer had not *stopped* —
 * which is what a placement looks like, and what made the pet hop on every ordinary
 * drop before.
 */
const THROW_TAIL_MIN_SPEED = 90;

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
 * Least-squares velocity through a run of samples, in px/s, or null when they cannot
 * describe one (fewer than two points, or all of them at the same instant).
 *
 * Least squares rather than "last minus first": one jittery sample at either end
 * would otherwise decide the whole throw, and mouse events arrive unevenly.
 */
function throwFit(points: ThrowSample[]): ThrowVelocity | null {
  const n = Array.isArray(points) ? points.length : 0;
  if (n < THROW_MIN_SAMPLES) return null;
  const first = points[0];
  let sumT = 0, sumTT = 0, sumX = 0, sumTx = 0, sumY = 0, sumTy = 0;
  for (const sample of points) {
    const t = sample.t - first.t;
    sumT += t; sumTT += t * t;
    sumX += sample.x; sumTx += t * sample.x;
    sumY += sample.y; sumTy += t * sample.y;
  }
  const spread = n * sumTT - sumT * sumT;
  if (!(Math.abs(spread) > 1e-6)) return null;
  const vx = ((n * sumTx - sumT * sumX) / spread) * 1000;
  const vy = ((n * sumTy - sumT * sumY) / spread) * 1000;
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;
  return { vx, vy };
}

/** Whether one sample is usable: every field has to be a real number. */
function throwUsable(sample: ThrowSample | undefined): boolean {
  return !!sample && Number.isFinite(sample.x) && Number.isFinite(sample.y) && Number.isFinite(sample.t);
}

/**
 * The samples inside the release window, or an empty list when there is no gesture.
 *
 * Falls back to the last two samples when the window itself is too thin to describe
 * a direction: a fast flick can have only two events in 100 ms.
 */
function throwWindow(samples: ThrowSample[]): ThrowSample[] {
  if (!Array.isArray(samples) || samples.length < THROW_MIN_SAMPLES) return [];
  const last = samples[samples.length - 1];
  if (!throwUsable(last)) return [];
  const usable = samples.filter(sample => throwUsable(sample));
  const windowed = usable.filter(sample => (last as ThrowSample).t - sample.t <= THROW_SAMPLE_MS);
  return windowed.length >= THROW_MIN_SAMPLES ? windowed : usable.slice(-THROW_MIN_SAMPLES);
}

/**
 * The velocity the pet is launched with: how the pointer was travelling as the
 * button came up, in px/s.
 *
 * Returns null when the gesture cannot be read at all (fewer than two samples, or all
 * of them at the same instant) — the caller then simply leaves the pet where it was
 * dropped. A slow release is deliberately still returned: `throwRelease` is what
 * decides, so a test can see the difference between "no gesture" and "a placement".
 */
function throwVelocity(samples: ThrowSample[]): ThrowVelocity | null {
  const usable = throwWindow(samples);
  const last = usable[usable.length - 1];
  if (!last || !(last.t - usable[0].t >= THROW_MIN_SPAN_MS)) return null;
  const fitted = throwFit(usable);
  if (!fitted) return null;
  let { vx, vy } = fitted;
  const speed = Math.hypot(vx, vy);
  if (speed > THROW_MAX_SPEED) {
    const scale = THROW_MAX_SPEED / speed;
    vx *= scale;
    vy *= scale;
  }
  return { vx, vy };
}

/**
 * The fastest *sustained* motion in the release window, in px/s: the largest
 * least-squares speed over any stretch of at least `THROW_PEAK_SPAN_MS`.
 *
 * This is the "did you mean it?" number, and it is deliberately not the window
 * average — see `THROW_PEAK_SPAN_MS`. Each stretch starts where the previous one did
 * and is grown only until it spans the minimum, so the flick is never averaged
 * together with the slower drag that led into it.
 */
function throwPeak(samples: ThrowSample[]): number {
  const usable = throwWindow(samples);
  if (usable.length < THROW_MIN_SAMPLES) return 0;
  // A gesture shorter than the minimum span — a very quick flick, or a clock the
  // webview has coarsened — has nothing longer to measure, so the whole of it is the
  // stretch: 72 px in 20 ms is a flick whatever the span would ideally be.
  if (usable[usable.length - 1].t - usable[0].t < THROW_PEAK_SPAN_MS) {
    const fitted = throwFit(usable);
    return fitted ? Math.hypot(fitted.vx, fitted.vy) : 0;
  }
  let best = 0;
  for (let start = 0; start < usable.length - 1; start++) {
    let end = start + 1;
    while (end < usable.length - 1 && usable[end].t - usable[start].t < THROW_PEAK_SPAN_MS) end++;
    // No stretch beginning here or later can span the minimum any more.
    if (usable[end].t - usable[start].t < THROW_PEAK_SPAN_MS) break;
    const fitted = throwFit(usable.slice(start, end + 1));
    if (fitted) best = Math.max(best, Math.hypot(fitted.vx, fitted.vy));
  }
  return best;
}

/** Whether the hand ever moved fast enough for this gesture to be a throw. */
function throwCanLaunch(peakSpeed: number): boolean {
  return Number.isFinite(peakSpeed) && peakSpeed >= THROW_LAUNCH_SPEED;
}

/**
 * Whether the pointer was *still moving* when the button came up.
 *
 * This gate exists only to catch a pointer that has *stopped*: the gesture can have
 * been fast (that is `throwPeak`'s business) and still end in a deliberate placement,
 * and the release is what tells the two apart. Its speed floor is deliberately low
 * (THROW_TAIL_MIN_SPEED) — a flick does not end at full speed.
 *
 * The speed is measured across at least `THROW_TAIL_SPAN_MS`, walking back to the
 * first sample that is that old (two events can share a millisecond, and a 1000 Hz
 * mouse reports faster than a hand can move a pixel). Two adjacent events are never
 * asked for a speed of their own — see `THROW_TAIL_SPAN_MS`.
 */
function throwStillMoving(samples: ThrowSample[]): boolean {
  if (!Array.isArray(samples) || samples.length < THROW_MIN_SAMPLES) return false;
  const last = samples[samples.length - 1];
  if (!throwUsable(last)) return false;
  for (let index = samples.length - 2; index >= 0; index--) {
    const previous = samples[index];
    if (!throwUsable(previous)) continue;
    const dt = last.t - previous.t;
    // The span is what makes this fair to every mouse: the first sample old enough to
    // measure a speed against is the one used, so a burst of same-millisecond events
    // and a 1000 Hz report rate read the same as a 125 Hz one.
    if (!(dt >= THROW_TAIL_SPAN_MS)) continue;
    // Anything older than this is not "the pointer was moving at the release".
    if (dt > THROW_TAIL_MS) return false;
    const distance = Math.hypot(last.x - previous.x, last.y - previous.y);
    if (distance < THROW_MIN_TAIL_PX) return false;
    // Only "had not stopped" — see THROW_TAIL_MIN_SPEED for why this is not the
    // launch speed.
    return (distance / dt) * 1000 >= THROW_TAIL_MIN_SPEED;
  }
  return false;
}

/**
 * Remember one pointer position, keeping the buffer bounded.
 *
 * Bounded by time first (THROW_BUFFER_MS) and by count second, because the count is
 * the mouse's report rate in disguise: a fixed number of samples is a long history on
 * a slow mouse and a few milliseconds on a fast one.
 */
function throwRemember(samples: ThrowSample[], x: number, y: number, t: number): void {
  if (!Array.isArray(samples) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) return;
  samples.push({ x, y, t });
  while (
    samples.length > THROW_BUFFER_MAX
    || (samples.length > THROW_MIN_SAMPLES && t - samples[0].t > THROW_BUFFER_MS)
  ) {
    samples.shift();
  }
}

/**
 * The one entry point the pet window uses: the velocity to launch with, or null
 * when this gesture was a placement.
 *
 * Two independent questions, and both have to answer yes, because either one alone is
 * a bad judge: the gesture has to have been *fast* somewhere in the window (that is
 * the throw, and a careful drag never gets there), and the pointer has to have been
 * *moving* when the button came up (that is what separates a flick from a placement,
 * however quick the drag that led to it).
 */
function throwRelease(samples: ThrowSample[]): ThrowVelocity | null {
  const velocity = throwVelocity(samples);
  if (!velocity) return null;
  if (!throwCanLaunch(throwPeak(samples))) return null;
  if (!throwStillMoving(samples)) return null;
  return velocity;
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
