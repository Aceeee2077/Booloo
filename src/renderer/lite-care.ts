// ============================================================================
// Care — the feeding tray and the cat teaser.
//
// Two small loops that give the pet something to want:
//
//   hunger  0…100, one point hungrier every four minutes. It lives in
//           `config.petStats.hunger`, the needs snapshot the full-featured
//           edition reserved (`mood` / `energy` / `hunger`). It only drifts
//           while the pet is running — closing the app for a night does not
//           starve it — and a treat takes it back down.
//   toy     a wand swings over the pet's head, the pet lunges at it, and every
//           catch is worth a point of affection.
//
// Only arithmetic and geometry live here, so the pet window (which draws and
// animates) and the settings panel (which prints the same numbers) can never
// disagree about a food's effect or about where a treat sits.
//
// A global script like lite-day.ts: loaded after lite-i18n.js (the food names
// come from the dictionary) and before lite-app.js.
// ============================================================================

/** The three treats the tray offers. */
type CareFoodId = 'fish' | 'can' | 'milk';

interface CareFood {
  id: CareFoodId;
  /**
   * An emoji rather than a food sprite: one glyph, no new asset to keep in sync
   * with the atlas, and it matches the bubbles that already use emoji.
   */
  icon: string;
  nameKey: string;
  lineKey: string;
  /** Hunger taken off (hunger counts up: 0 is full, 100 is starving). */
  hunger: number;
  mood: number;
  energy: number;
  /** Affection paid for the treat. */
  affinity: number;
}

const CARE_FOODS: CareFood[] = [
  {
    id: 'fish', icon: '🐟',
    nameKey: 'lite.care.food.fish', lineKey: 'lite.care.eat.fish',
    hunger: 25, mood: 4, energy: 2, affinity: 1,
  },
  {
    id: 'can', icon: '🥫',
    nameKey: 'lite.care.food.can', lineKey: 'lite.care.eat.can',
    hunger: 45, mood: 8, energy: 4, affinity: 2,
  },
  {
    id: 'milk', icon: '🥛',
    nameKey: 'lite.care.food.milk', lineKey: 'lite.care.eat.milk',
    hunger: 15, mood: 2, energy: 8, affinity: 1,
  },
];

/** Hunger's ceiling, and the scale `petStats.hunger` is documented with. */
const CARE_HUNGER_MAX = 100;
/** A point of hunger every four minutes: a full day costs 360, so it takes
 *  about 6.5 hours of company to go from full to starving. */
const CARE_HUNGER_PER_MINUTE = 1 / 4;
/** From here the pet mentions it, and the badge appears. */
const CARE_HUNGRY_AT = 75;
/** A second, more dramatic line once it is really empty. */
const CARE_STARVING_AT = 95;
/** Below this it turns a treat down instead of eating again. */
const CARE_FULL_AT = 12;
/** How often the pet is willing to bring up being hungry. */
const CARE_HUNGRY_GAP_MS = 25 * 60_000;

// ---------- the tray ----------

/** Where the treat bubbles sit, in the canvas' 300×300 CSS space. The row is
 *  above the pet's head, leaving the speech bubble's band (≈111-145) alone. */
const CARE_TRAY_Y = 48;
const CARE_TRAY_RADIUS = 25;
const CARE_TRAY_GAP = 72;
/** The tray puts itself away if nothing is picked. */
const CARE_TRAY_LIFETIME_MS = 9000;

interface CareTraySlot {
  x: number;
  y: number;
  r: number;
  food: CareFood;
}

interface CareTray {
  openedAt: number;
}

/** The pet's needs, mirrored into `config.petStats`. */
interface CareNeeds {
  mood: number;
  energy: number;
  hunger: number;
}

const CARE_NEEDS_DEFAULT: CareNeeds = { mood: 70, energy: 80, hunger: 20 };

function careClamp(value: number) {
  return Math.max(0, Math.min(CARE_HUNGER_MAX, value));
}

/** A 0…100 need read from the config; a missing or broken value falls back. */
function careStat(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? careClamp(number) : fallback;
}

/** Hunger after `minutes` of company; it never drifts back down on its own. */
function careAdvanceHunger(hunger: number, minutes: number) {
  return careClamp(hunger + Math.max(0, minutes) * CARE_HUNGER_PER_MINUTE);
}

function careIsHungry(hunger: number) {
  return hunger >= CARE_HUNGRY_AT;
}

/** Which of the four status lines the settings panel should print. */
function careHungerLevel(hunger: number): 'full' | 'ok' | 'hungry' | 'starving' {
  if (hunger >= CARE_STARVING_AT) return 'starving';
  if (hunger >= CARE_HUNGRY_AT) return 'hungry';
  return hunger <= CARE_FULL_AT ? 'full' : 'ok';
}

/** Whether the pet is willing to eat at all. */
function careWillEat(hunger: number) {
  return hunger > CARE_FULL_AT;
}

/** Hunger after a treat. */
function careEat(food: CareFood, hunger: number) {
  return careClamp(hunger - food.hunger);
}

function careFoodById(id: string): CareFood | null {
  return CARE_FOODS.find(food => food.id === id) ?? null;
}

/** The three bubbles, laid out around the middle of the canvas. */
function careTraySlots(): CareTraySlot[] {
  const middle = (CARE_FOODS.length - 1) / 2;
  return CARE_FOODS.map((food, index) => ({
    x: 150 + (index - middle) * CARE_TRAY_GAP,
    y: CARE_TRAY_Y,
    r: CARE_TRAY_RADIUS,
    food,
  }));
}

/** The slot a tap landed in, or null. Used by the hit test and by `mousedown`. */
function careFoodAt(x: number, y: number): CareFood | null {
  for (const slot of careTraySlots()) {
    if (Math.hypot(x - slot.x, y - slot.y) <= slot.r + 4) return slot.food;
  }
  return null;
}

/** Where a treat lands: just under the muzzle, one lane per food, so the pet
 *  reads as taking it from its front paws rather than from its own belly. */
function careEatSpot(food: CareFood) {
  const middle = (CARE_FOODS.length - 1) / 2;
  const index = Math.max(0, CARE_FOODS.findIndex(item => item.id === food.id));
  return { x: 150 + (index - middle) * 30, y: 234, r: CARE_TRAY_RADIUS * 0.8 };
}

// ---------- eating ----------

interface CareEating {
  food: CareFood;
  /** Where the treat fell from — the tray slot, or above the head when the tray
   *  was already closed (feeding from the settings panel). */
  from: { x: number; y: number };
  startedAt: number;
}

/** The treat falls for this long, then the pet chews. */
const CARE_EAT_DROP_MS = 380;
/** Whole sequence: fall + chewing. */
const CARE_EAT_DURATION_MS = 2400;

/** 0…1 eased fall from the tray to the chest. */
function careEatDrop(elapsed: number) {
  const t = Math.max(0, Math.min(1, elapsed / CARE_EAT_DROP_MS));
  return 1 - (1 - t) ** 3;
}

/** 1 = untouched, 0 = finished. Only shrinks once the treat has landed. */
function careEatBite(elapsed: number) {
  const t = Math.max(0, Math.min(1,
    (elapsed - CARE_EAT_DROP_MS) / (CARE_EAT_DURATION_MS - CARE_EAT_DROP_MS)));
  return 1 - t;
}

/** Height of the food while it is still on its way down. */
function careEatPosition(eating: CareEating, elapsed: number) {
  const spot = careEatSpot(eating.food);
  const t = careEatDrop(elapsed);
  return { x: eating.from.x + (spot.x - eating.from.x) * t, y: eating.from.y + (spot.y - eating.from.y) * t };
}

/** The pet's head dips in time with the chewing (px, 0 while the food falls). */
function careChewDip(elapsed: number) {
  if (elapsed <= CARE_EAT_DROP_MS) return 0;
  const t = Math.max(0, Math.min(1,
    (elapsed - CARE_EAT_DROP_MS) / (CARE_EAT_DURATION_MS - CARE_EAT_DROP_MS)));
  return Math.abs(Math.sin(t * Math.PI * 5)) * 5;
}

// ---------- the cat teaser ----------

/** The wand is held off-canvas at the bottom-right and reaches in over the pet. */
const CARE_TOY_GRIP = { x: 290, y: 288 };
const CARE_TOY_SESSION_MS = 20_000;
/** The session also ends after this many catches. */
const CARE_TOY_CATCH_LIMIT = 4;
/** One lunge: the pet jumps, swats, and settles back. */
const CARE_TOY_POUNCE_MS = 720;
const CARE_TOY_FIRST_POUNCE_MS = 1000;
const CARE_TOY_GAP_MIN_MS = 1300;
const CARE_TOY_GAP_MAX_MS = 2200;
/** The feather head, and how close to the string still counts as the wand. */
const CARE_TOY_HEAD_RADIUS = 25;
const CARE_TOY_STRING_RADIUS = 7;

interface CarePounce {
  startedAt: number;
  until: number;
  /** Where the wand was when the pet jumped at it. */
  at: { x: number; y: number };
}

interface CareToySession {
  startedAt: number;
  endsAt: number;
  nextPounceAt: number;
  catches: number;
  pounce: CarePounce | null;
}

/**
 * Where the feather head is, `elapsedMs` into the session. A slow figure-eight
 * over the pet's head: it stays in the upper band so a lunge never has to reach
 * further than the pet's own jump.
 */
function careToySwing(elapsedMs: number) {
  const t = Math.max(0, elapsedMs) / 1000;
  return {
    x: 150 + Math.sin(t * 1.55) * 76,
    y: 76 + Math.sin(t * 2.4 + 1.2) * 32,
  };
}

/** 0…1 lunge curve: fast up, brief hold, back down. */
function carePounceAmount(now: number, pounce: CarePounce | null) {
  if (!pounce || pounce.until <= pounce.startedAt) return 0;
  const t = Math.max(0, Math.min(1, (now - pounce.startedAt) / (pounce.until - pounce.startedAt)));
  return Math.sin(Math.PI * Math.min(1, t * 1.1));
}

/** True for the pixels the wand owns, so the pet's window can stay click-through
 *  over a prop that is only there to look at. */
function careToyHits(x: number, y: number, head: { x: number; y: number }) {
  if (Math.hypot(x - head.x, y - head.y) <= CARE_TOY_HEAD_RADIUS) return true;
  return careDistanceToSegment(x, y, CARE_TOY_GRIP.x, CARE_TOY_GRIP.y, head.x, head.y) <= CARE_TOY_STRING_RADIUS;
}

function careDistanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
