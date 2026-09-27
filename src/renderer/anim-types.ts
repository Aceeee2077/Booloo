// ============================================================================
// Animation system types (动画 / 行为系统类型)
//
// Loaded as a global script like every other renderer file (no imports/exports),
// so `src/shared/types.ts`, `accessory-types.ts` and this file all share one
// declaration space.
//
// The layering this file describes:
//
//     PetStats ─┐
//               ├─► BehaviorScheduler ─► BehaviorController ─► AnimationPlayer
//     PetState ─┘         (decides)          (sequences)          (plays)
//                                                                     │
//                                          AnchorResolver ◄───────────┘
//                                          (one authoritative frame index)
//
// A *clip* is one sprite animation. A *behavior* is what the pet decides to do,
// expressed as clips (start → loop → end) plus movement, conditions and weight.
// Nothing outside the registry knows any animation by name.
// ============================================================================

/** What kind of animation this is — drives the browser's grouping and defaults. */
type AnimationCategory =
  | 'idle'
  | 'move'
  | 'sleep'
  | 'interaction'
  | 'emotion'
  | 'work'
  | 'special'
  | 'transition';

const ANIMATION_CATEGORIES: AnimationCategory[] = [
  'idle',
  'move',
  'sleep',
  'interaction',
  'emotion',
  'work',
  'special',
  'transition',
];

/**
 * Where a clip's frames come from.
 *
 * `board`  the generated 1024px pose boards (`action-boards/<skin>/<clip>.png`),
 *          optionally re-ordered / sub-selected through `frames`. This is what all
 *          built-in pets use today.
 * `sheet`  a row of the 4x4 sprite sheet (`sprites/<skin>.png`) — the pre-board
 *          fallback, kept so a skin without boards still animates.
 * `frames` loose PNGs in a folder, which is what the photo pipeline emits and what
 *          a hand-authored animation exported frame-by-frame looks like.
 */
type AnimationSource =
  | { type: 'board'; clip: string; frames?: number[] }
  | { type: 'sheet'; row: number }
  | { type: 'frames'; dir: string }
  | { type: 'petpack'; frames: number[] };

/**
 * Procedural transform curves layered on top of the frames.
 *
 * This is the vocabulary the old `actions.ts` catalogue used, kept verbatim so all
 * 51 existing actions keep their exact look after moving into the data files:
 * keyframes are evenly spaced over the clip and interpolated with smooth easing.
 * Curves are *additive* to whatever the sprite frames already do — a "stretch" is
 * the idle frames plus a upward scale curve.
 */
interface AnimationMotion {
  /** Degrees around the pet's feet. */
  rotate?: number[];
  /** `[x, y]` pairs or the flat `[x0, y0, x1, y1, …]` form. */
  translate?: number[] | [number, number][];
  /** Uniform size multiplier (1 = untouched). */
  scale?: number[];
  /** 0..1 opacity multiplier. */
  alpha?: number[];
  /** Non-uniform scale, when a squash/stretch needs to be lopsided. */
  scaleX?: number[];
  scaleY?: number[];
  /** Open-mouth amount 0..1 (the robot's yawn overlay). */
  mouth?: number[];
}

/** Something the clip wants to happen on one specific frame. */
interface AnimationFrameEvent {
  /** Clip-local frame index the event fires on. */
  frame: number;
  event: AnimationFrameEventName;
  /** Optional payload (a sound file, a particle kind, an accessory toggle). */
  value?: string;
}

type AnimationFrameEventName =
  | 'footstep'
  | 'play_sound'
  | 'spawn_particle'
  | 'accessory_toggle'
  | 'custom';

/** One playable animation. */
interface AnimationClipDefinition {
  /** Stable id referenced by behaviors and by the debug panel. */
  id: string;
  category: AnimationCategory;
  source: AnimationSource;
  /** Frames per second. Mutually exclusive with `frameDuration` (fps wins). */
  fps?: number;
  /** Seconds per frame, used when `fps` is absent. */
  frameDuration?: number;
  /** Loop forever, or play once and emit `animationEnd`. */
  loop?: boolean;
  /**
   * `mirror` (default) draws one set of frames and flips them for the other
   * facing; `separate` means the art is drawn both ways and must not be flipped.
   */
  directionMode?: 'mirror' | 'separate';
  /** Anchor table key (the clip folder the anchors were measured on). */
  anchorSet?: string;
  motion?: AnimationMotion;
  frameEvents?: AnimationFrameEvent[];
  /** Relative path of a sound played when the clip starts (audio is opt-in). */
  sound?: string;
  /** Sprite row to fall back to for the eye overlay / Zzz proxies. */
  petState?: PetState;
  /** Force the drawn eyes shut (robot overlay; sprite art bakes its own face). */
  eyesClosed?: boolean;
  tags?: string[];
  /** Author-facing note, shown in the animation browser. */
  note?: string;
  enabled?: boolean;
}

/** How the pet gets from one place to another while a behavior runs. */
interface MovementDefinition {
  type: 'horizontal' | 'random' | 'toward' | 'away' | 'jump' | 'none';
  /** Pixels per second at petScale 1 (the existing `wanderSpeed` multiplies it). */
  speed?: number;
  /** Reserved: ramping is done by the main process's glide, which is constant. */
  acceleration?: number;
  /** How long to keep moving. Omitted = until the behavior ends. */
  duration?: { min: number; max: number };
  /** Stop (and report `edge`) when the pet reaches the side of the work area. */
  stopAtScreenEdge?: boolean;
  /** Hop height in px (`type: 'jump'`). */
  hopHeight?: number;
  /** Turn to face the cursor for the whole behavior. */
  faceCursor?: boolean;
}

/** Everything the scheduler may look at when deciding whether a behavior fits. */
interface BehaviorConditions {
  minMood?: number;
  maxMood?: number;
  minEnergy?: number;
  maxEnergy?: number;
  minHunger?: number;
  maxHunger?: number;
  minAffinity?: number;
  maxAffinity?: number;
  /** Minimum seconds since the user last touched the pet. */
  userIdleSeconds?: number;
  /** Maximum seconds since the last interaction (an "engaged" window). */
  maxUserIdleSeconds?: number;
  /** Only when the pet is at (or very near) a side of the work area. */
  nearScreenEdge?: boolean;
  facing?: 'left' | 'right';
  /** Only while the macro state is one of these. */
  states?: PetMacroState[];
  /** Never while the macro state is one of these. */
  notStates?: PetMacroState[];
  /** Reject a behavior that ran within its cooldown (default true). */
  requireCooldownReady?: boolean;
  /** Independent random gate, 0..1. */
  randomChance?: number;
  minCompanionDays?: number;
}

/** What kind of user action asks for a behavior. */
type InteractionTrigger =
  | 'click_head'
  | 'click_body'
  | 'double_click'
  | 'right_click'
  | 'drag_start'
  | 'drag_end'
  | 'drop'
  | 'idle_long'
  | 'action_menu';

/** A trigger → behavior mapping, so interaction is data too. */
interface BehaviorTriggerDefinition {
  trigger: InteractionTrigger;
  /** Behavior ids in preference order; the first whose conditions pass wins. */
  behaviors: string[];
  /** Higher wins when several mappings exist for the same trigger. */
  priority?: number;
}

/**
 * One behavior: what the pet decides to do.
 *
 * `start` / `loop` / `end` are clip ids and every one of them is optional —
 * a one-shot like `blink` is just `loop: 'blink'` with `loopCount: 1`, a long
 * sleep is `sleep_start` → `sleep_loop` × N → `sleep_end`.
 */
interface BehaviorDefinition {
  id: string;
  /** Free-form grouping used by the browser (`idle`, `move`, `sleep`, …). */
  category: string;
  /** 0..100. A higher-priority behavior may interrupt a lower-priority one. */
  priority: number;
  /** Relative chance of being picked by the idle scheduler (default 10). */
  weight?: number;
  /** Milliseconds before this behavior may be picked again automatically. */
  cooldown?: number;
  /**
   * May a *higher-priority* behavior cut this one short? `false` means the current
   * phase finishes first (no mid-animation pose jumps).
   */
  interruptible?: boolean;
  /** Lower bound on how long the behavior runs, in seconds. */
  minDuration?: number;
  /** Upper bound; the controller ends the behavior once it is reached. */
  maxDuration?: number;
  /** Clip played once before the loop phase. */
  start?: string;
  /**
   * Loop clip(s). An array means: pick one at random.
   *
   * Required — a behavior without a loop clip has nothing to play and is dropped
   * by the registry.
   */
  loop: string | string[];
  /** Clip played once after the loop phase. */
  end?: string;
  /**
   * How many times to play the loop clip (a range is resolved per run).
   * Omitted means "until something else ends it" for a looping clip.
   */
  loopCount?: number | { min: number; max: number };
  movement?: MovementDefinition;
  conditions?: BehaviorConditions;
  /** Mood/energy/hunger changes applied when the behavior finishes. */
  effects?: { mood?: number; energy?: number; hunger?: number };
  /** Behaviors the controller may hand over to when this one finishes. */
  next?: string[];
  /** Variant swaps, first match wins — how one behavior covers several emotions. */
  variants?: { when: BehaviorConditions; behavior: string }[];
  tags?: string[];
  /** Sound played when the behavior starts (audio opt-in). */
  sound?: string;
  /** Author-facing note shown in the browser. */
  note?: string;
  /** Hidden from the picker but still playable by id. */
  hidden?: boolean;
  enabled?: boolean;
}

/** Macro states. Deliberately far fewer than the number of behaviors. */
type PetMacroState =
  | 'Idle'
  | 'Moving'
  | 'Sleeping'
  | 'Dragging'
  | 'Interacting'
  | 'Working'
  | 'Eating'
  | 'Playing'
  | 'Special';

const PET_MACRO_STATES: PetMacroState[] = [
  'Idle',
  'Moving',
  'Sleeping',
  'Dragging',
  'Interacting',
  'Working',
  'Eating',
  'Playing',
  'Special',
];

/** Which legacy pose enum each macro state maps to (eye overlay / sprite rows). */
const MACRO_STATE_POSE: Record<PetMacroState, PetState> = {
  Idle: 'idle',
  Moving: 'walking',
  Sleeping: 'sleeping',
  Dragging: 'walking',
  Interacting: 'click',
  Working: 'idle',
  Eating: 'idle',
  Playing: 'click',
  Special: 'idle',
};

/** Pet condition values the scheduler and conditions read. */
interface PetStatsSnapshot {
  /** 0..100 — rises with interaction, falls when ignored. */
  mood: number;
  /** 0..100 — drains while awake, refills while asleep. */
  energy: number;
  /** 0..100 — rises over time; feeding behaviors lower it. */
  hunger: number;
}

/** Phase a behavior is currently in. */
type BehaviorPhase = 'start' | 'loop' | 'end' | 'done';

/** One entry of the scheduler's "what happened recently" memory. */
interface BehaviorHistoryEntry {
  id: string;
  at: number;
}

/** Everything the scheduler needs to know about right now. */
interface SchedulerContext {
  state: PetMacroState;
  stats: PetStatsSnapshot;
  /** Seconds since the user last interacted with the pet. */
  userIdleSeconds: number;
  /** True while the user is dragging the pet. */
  dragging: boolean;
  /** True while the pet is within `ANIM_EDGE_MARGIN` px of a screen side. */
  nearScreenEdge: boolean;
  facing: 'left' | 'right';
  affinity: number;
  companionDays: number;
  /** Autonomous behaviour may only start while this is true. */
  allowAutonomous: boolean;
}

/** A resolved behavior run, as handed to the controller. */
interface BehaviorRun {
  behavior: BehaviorDefinition;
  /** Ordered clips: start (optional) → loop → end (optional). */
  startClip: AnimationClipDefinition | null;
  loopClip: AnimationClipDefinition;
  endClip: AnimationClipDefinition | null;
  loopTarget: number;
}

/** Reasons a behavior can end, reported to the controller's `next` step. */
type BehaviorEndReason = 'completed' | 'interrupted' | 'edge' | 'no-loop-clip';

/** Where the pet is along the screen, for edge-aware behavior. */
interface ScreenPositionInfo {
  /** Window x/y from the main process (undefined until the first poll). */
  x: number;
  y: number;
  /** Work-area width/height of the current display. */
  workWidth: number;
  workHeight: number;
  /** Distance from the pet's visible box to the left/right work-area edge. */
  leftGap: number;
  rightGap: number;
}

/** Distance from a work-area side that counts as "at the edge". */
const ANIM_EDGE_MARGIN = 24;

/** Where a behavior came from — drives cooldown bookkeeping and the debug panel. */
type BehaviorSource = 'scheduler' | 'user' | 'trigger' | 'queue' | 'debug';

/**
 * The app-side callbacks the controller needs.
 *
 * The controller owns sequencing and knows nothing about the canvas or the window,
 * so "a behavior started" (set the macro state), "a behavior ended" (reset the
 * state) and "read the user's speed setting" are injected from app.ts.
 */
interface BehaviorControllerHooks {
  onBehaviorStart(def: BehaviorDefinition, source: BehaviorSource): void;
  /** Every run ends here, including interrupts — used to release the macro state. */
  onBehaviorEnd(id: string | null, reason: BehaviorEndReason): void;
  /** A completed run: the app may hand over through the behavior's `next` list. */
  onBehaviorFinished(id: string, reason: BehaviorEndReason): void;
  /** The user's `wanderSpeed` multiplier, applied to authored movement speeds. */
  speedScale?(): number;
}

/** Default priority bands, so the data files read meaningfully. */
const BEHAVIOR_PRIORITY = {
  /** Dragging / dropped. Nothing overrides the user holding the pet. */
  drag: 100,
  /** A direct user interaction (click, double click, head pat). */
  interaction: 90,
  /** Emergency reactions (startled, hurt, wake up). */
  urgent: 80,
  /** Needs-driven long behaviors. */
  need: 60,
  /** Movement. */
  move: 40,
  /** Idle flourishes. */
  idle: 20,
  /** Pure transitions, never picked on their own. */
  transition: 5,
} as const;
