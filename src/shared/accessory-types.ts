// ============================================================================
// Accessory system types (配饰系统类型定义)
//
// Loaded as a global script exactly like src/shared/types.ts: no imports and no
// exports, so the pet window, the settings window and the plain-<script> load
// order all share one declaration space.
//
// Everything here is *data*. The renderer never special-cases an accessory id:
// it reads a definition, resolves an anchor, applies a transform and paints the
// layers. Adding a new hat is a PNG + one metadata entry (see
// src/assets/accessories/accessories.json).
// ============================================================================

/**
 * Wearable slot. One ordinary slot holds a single item; `effect` is a list so a
 * pet can wear sparkles *and* a halo at the same time.
 */
type AccessorySlot =
  | 'head'
  | 'eyes'
  | 'face'
  | 'neck'
  | 'body'
  | 'back'
  | 'hand'
  | 'tail'
  | 'effect';

/** Every slot, in the order the wardrobe UI lists them. */
const ACCESSORY_SLOTS: AccessorySlot[] = [
  'head',
  'eyes',
  'face',
  'neck',
  'body',
  'back',
  'hand',
  'tail',
  'effect',
];

/** Slots a user-imported accessory may be assigned to. */
const ACCESSORY_CATEGORIES = [
  'All',
  'Hats',
  'Glasses',
  'Face',
  'Neck',
  'Body',
  'Back',
  'Hand',
  'Tail',
  'Effects',
] as const;

type AccessoryCategory = (typeof ACCESSORY_CATEGORIES)[number];

/**
 * Mount point names an accessory can attach to.
 *
 * The first block is the accessory-system vocabulary (what metadata authors
 * write); the second block is the anchor vocabulary this repo already had in
 * `pet-anchors.ts`, kept as aliases so both spellings resolve.
 */
type AccessoryAnchorName =
  | 'head'
  | 'eyes'
  | 'face'
  | 'neck'
  | 'body'
  | 'back'
  | 'hand_left'
  | 'hand_right'
  | 'tail'
  | 'effect'
  // ---- aliases / legacy spellings (resolved through ACCESSORY_ANCHOR_ALIASES) ----
  | 'head_top'
  | 'face_center'
  | 'chest'
  | 'hand'
  | 'hip'
  | 'foot';

const ACCESSORY_ANCHOR_NAMES: AccessoryAnchorName[] = [
  'head',
  'eyes',
  'face',
  'neck',
  'body',
  'back',
  'hand_left',
  'hand_right',
  'tail',
  'effect',
];

/**
 * Canonical mount points, as a *default* when no anchor data resolves at all.
 *
 * Coordinates are normalized to the pet's own drawn frame (0..1 of the frame
 * cell), so they scale with the pet for free. They are the last resort in the
 * resolver chain — real anchor data always wins.
 */
const ACCESSORY_DEFAULT_ANCHORS: Record<AccessoryAnchorName, { x: number; y: number }> = {
  head: { x: 0.5, y: 0.08 },
  head_top: { x: 0.5, y: 0.02 },
  eyes: { x: 0.5, y: 0.34 },
  face: { x: 0.5, y: 0.42 },
  face_center: { x: 0.5, y: 0.34 },
  neck: { x: 0.5, y: 0.56 },
  chest: { x: 0.5, y: 0.66 },
  body: { x: 0.5, y: 0.68 },
  back: { x: 0.5, y: 0.64 },
  hand_left: { x: 0.2, y: 0.76 },
  hand_right: { x: 0.8, y: 0.76 },
  hand: { x: 0.82, y: 0.74 },
  hip: { x: 0.5, y: 0.8 },
  tail: { x: 0.86, y: 0.72 },
  foot: { x: 0.5, y: 0.98 },
  effect: { x: 0.5, y: 0.4 },
};

/**
 * Legacy / alternate spellings folded onto a canonical mount point.
 *
 * Built from the canonical names first so every canonical name is guaranteed to
 * resolve to itself — an alias table that only listed the *alternate* spellings
 * silently sent `head` to the fallback mount point, which put hats on the chest.
 */
const ACCESSORY_ANCHOR_ALIASES: Record<string, AccessoryAnchorName> = (() => {
  const map: Record<string, AccessoryAnchorName> = {};
  for (const name of ACCESSORY_ANCHOR_NAMES) map[name] = name;
  // Alternate / descriptive spellings, including the ones pet-anchors.ts uses.
  map.head_top = 'head';
  map.top = 'head';
  map.hat = 'head';
  map.face_center = 'face';
  map.glasses = 'eyes';
  map.scarf = 'neck';
  map.chest = 'body';
  map.torso = 'body';
  map.hand = 'hand_right';
  map.hip = 'body';
  map.foot = 'body';
  map.fx = 'effect';
  return map;
})();

/** One mount point on the pet, in normalized frame coordinates. */
interface AnchorTransform {
  /** Horizontal position, 0..1 across the pet's drawn frame. */
  x: number;
  /** Vertical position, 0..1 down the pet's drawn frame. */
  y: number;
  /** Extra rotation in degrees applied to anything mounted here. */
  rotation: number;
  /** Extra scale applied to anything mounted here (1 = unchanged). */
  scale: number;
}

/** Anchors that exist for one animation frame. */
type FrameAnchorSet = Partial<Record<AccessoryAnchorName, Partial<AnchorTransform>>>;

/** Anchors for one action: per-frame entries plus an action-wide default. */
interface ActionAnchorTable {
  /** Playback rate of the clip this table was measured against (documentation). */
  fps?: number;
  /** Frame count the `frames` keys were measured on. */
  frameCount?: number;
  /** Used when the requested frame has no entry. */
  default?: FrameAnchorSet;
  /** Frame index (as a string, matching the JSON) → anchors. */
  frames?: Record<string, FrameAnchorSet>;
}

/**
 * Anchor table for one character.
 *
 * The `character` field matches the pet skin id (`cat`, `robot`, `custom`, …);
 * `custom` is used for user-imported pictures and for the frame-clip pipeline.
 */
interface CharacterAnchorTable {
  character: string;
  /** Human note shown in the debug overlay / docs. */
  note?: string;
  /** Size the normalized coordinates were measured against. */
  imageSize?: { width: number; height: number };
  /** Character-wide fallbacks (used when an action has no entry at all). */
  default?: FrameAnchorSet;
  /** action name → anchor table (`idle`, `walk`, `sleep`, …). */
  actions?: Record<string, ActionAnchorTable>;
}

/** Per-item transform, applied on top of the resolved anchor. */
interface AccessoryTransform {
  /** Pixels at the pet's base size (128px tall), before the pet scale is applied. */
  offsetX: number;
  offsetY: number;
  /** Degrees. */
  rotation: number;
  /** Multiplier on the accessory's natural drawn size. */
  scale: number;
  /** Horizontal mirror of the art itself (independent of the pet's facing). */
  flipX?: boolean;
}

/** Lightweight spring used by dangling / trailing accessories. */
interface AccessoryPhysicsConfig {
  enabled: boolean;
  /** How hard the spring pulls back to the anchor (0..1 per frame at 60fps). */
  stiffness: number;
  /** Velocity retained each frame (0..1; lower = stops faster). */
  damping: number;
  /** Hard cap on the lag, in base-pixel units, so nothing detaches. */
  maxOffset: number;
  /** Hard cap on physics-induced rotation, in degrees. */
  maxRotation: number;
  /** How strongly the pet's horizontal window speed / facing change pushes it. */
  inertia: number;
}

/** One drawable piece of an accessory. */
interface AccessoryLayerDef {
  /** Path (relative to the asset root) or absolute `asset:` URL of the art. */
  asset: string;
  /** Painter's-algorithm key; the character itself is ACCESSORY_CHARACTER_Z. */
  zIndex: number;
  /** Attachment point inside this layer's art, 0..1. Default [0.5, 0.5]. */
  pivot?: [number, number];
  /**
   * Per-layer transform nudge, added to the accessory transform. Lets a
   * back-of-the-scarf layer sit a few pixels differently from the front one.
   */
  transform?: Partial<AccessoryTransform>;
}

/**
 * A complete accessory. This is the shape of one entry in
 * `src/assets/accessories/accessories.json` and of one imported accessory's
 * `accessory.json`.
 */
interface AccessoryDefinition {
  /** Stable id, referenced from `equippedAccessories` and from saved settings. */
  id: string;
  /** Display name (never a translation key — user imports carry free text). */
  name: string;
  /**
   * Optional i18n key for the display name. Built-ins use it so the wardrobe
   * reads in both languages; user imports leave it out and fall back to `name`.
   */
  nameKey?: string;
  /** Wardrobe category; must be one of ACCESSORY_CATEGORIES (unknown → 'All'). */
  category: AccessoryCategory;
  slot: AccessorySlot;
  /** Mount point this item attaches to. */
  anchor: AccessoryAnchorName;
  /** English/Chinese description shown on the card tooltip. */
  description?: string;
  /** Small preview image; falls back to the first layer's asset. */
  thumbnail?: string;
  /** Single-layer art, if `layers` is not used. */
  asset?: string;
  /** Multi-layer art, drawn back-to-front by zIndex. */
  layers?: AccessoryLayerDef[];
  /** Placement inside the anchor. */
  transform: AccessoryTransform;
  /** Per-action placement overrides (`sleep`, `run`, `jump`, …). */
  actionOverrides?: Record<string, Partial<AccessoryTransform>>;
  /** Optional spring behaviour. */
  physics?: Partial<AccessoryPhysicsConfig>;
  /** Whether the art mirrors with the pet's facing (default true). */
  followFlip?: boolean;
  /** Whether the item is offered in the wardrobe at all. */
  enabled: boolean;
  /** Small badge on the card, e.g. ⭐ for built-ins. */
  badge?: string;
  /** Where the definition came from. */
  source: 'builtin' | 'user';
  /** Absolute path of a user import's own metadata + art (user items only). */
  dir?: string;
  /** Creation timestamp (user items only). */
  createdAt?: number;
}

/** A user-imported accessory as returned by the Rust backend. */
interface UserAccessoryDefinition extends AccessoryDefinition {
  source: 'user';
}

/** What the pet is currently wearing. Persisted in AppConfig. */
interface EquippedAccessories {
  head?: string;
  eyes?: string;
  face?: string;
  neck?: string;
  body?: string;
  back?: string;
  hand?: string;
  tail?: string;
  /** `effect` is the one slot that accepts several items. */
  effects?: string[];
}

/** One accessory resolved to canvas coordinates for the current frame. */
interface ResolvedAccessory {
  id: string;
  slot: AccessorySlot;
  layerIndex: number;
  /** Source image (null when the art failed to load — callers must skip). */
  image: HTMLImageElement | null;
  /** Top-left corner the art is drawn at, before rotation. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees; already mirrored for the pet's facing. */
  rotation: number;
  /** Effective zIndex of this layer. */
  zIndex: number;
  /** Attachment point inside the art, 0..1. */
  pivot: [number, number];
  /** Whether this layer's art is drawn mirrored (independent of pet facing). */
  flipX: boolean;
}

/** The character occupies this z-index; accessories sort against it. */
const ACCESSORY_CHARACTER_Z = 20;

/**
 * Reference pet height, in design pixels.
 *
 * Every offset / anchor measurement is expressed against a 128px-tall pet, so
 * the same metadata works for the 96px robot, the 128px illustrated animals and
 * any imported picture. `unit = petArtHeight / ACCESSORY_BASE_SIZE` is the one
 * number the whole accessory transform is scaled by, which is why a hat can
 * never stay at 100% while the pet grows.
 */
const ACCESSORY_BASE_SIZE = 128;

/**
 * Built-in art is exported at twice its design size (see
 * scripts/generate-accessories.mjs), so a PNG has to be halved before it is
 * scaled by `unit`. Keeping this explicit is what lets the art stay crisp at
 * petScale 1.5 and on hi-dpi displays.
 */
const ACCESSORY_ART_REFERENCE = 256;

/** `unit`-independent art constant: drawn = natural * unit * ACCESSORY_ART_UNIT. */
const ACCESSORY_ART_UNIT = ACCESSORY_BASE_SIZE / ACCESSORY_ART_REFERENCE;

/** Default spring parameters, per slot — hats barely move, tail trinkets swing. */
const ACCESSORY_SLOT_PHYSICS: Record<AccessorySlot, AccessoryPhysicsConfig> = {
  head: { enabled: true, stiffness: 0.16, damping: 0.78, maxOffset: 3, maxRotation: 4, inertia: 0.25 },
  eyes: { enabled: false, stiffness: 0, damping: 0.8, maxOffset: 0, maxRotation: 0, inertia: 0 },
  face: { enabled: false, stiffness: 0, damping: 0.8, maxOffset: 0, maxRotation: 0, inertia: 0 },
  neck: { enabled: true, stiffness: 0.12, damping: 0.82, maxOffset: 6, maxRotation: 9, inertia: 0.7 },
  body: { enabled: true, stiffness: 0.1, damping: 0.84, maxOffset: 5, maxRotation: 6, inertia: 0.5 },
  back: { enabled: true, stiffness: 0.22, damping: 0.86, maxOffset: 3, maxRotation: 4, inertia: 0.45 },
  hand: { enabled: true, stiffness: 0.14, damping: 0.8, maxOffset: 6, maxRotation: 12, inertia: 0.8 },
  tail: { enabled: true, stiffness: 0.11, damping: 0.8, maxOffset: 7, maxRotation: 14, inertia: 0.9 },
  effect: { enabled: false, stiffness: 0.1, damping: 0.85, maxOffset: 4, maxRotation: 6, inertia: 0.3 },
};

/** i18n key for a slot's display name. */
function accessorySlotKey(slot: AccessorySlot): string {
  return `wardrobe.slot.${slot}`;
}

/** Whether a value is a known slot. */
function isAccessorySlot(value: unknown): value is AccessorySlot {
  return typeof value === 'string' && (ACCESSORY_SLOTS as string[]).includes(value);
}

/** Whether a value is a known category. */
function isAccessoryCategory(value: unknown): value is AccessoryCategory {
  return typeof value === 'string' && (ACCESSORY_CATEGORIES as readonly string[]).includes(value);
}

/** Fold a legacy / alternate anchor spelling onto its canonical name. */
function canonicalAnchorName(name: string): AccessoryAnchorName {
  const alias = ACCESSORY_ANCHOR_ALIASES[name];
  if (alias) return alias;
  // Defensive second chance: a canonical name always resolves to itself, so a gap
  // in the alias table can never silently redirect an anchor to `effect`.
  return (ACCESSORY_ANCHOR_NAMES as string[]).includes(name) ? (name as AccessoryAnchorName) : 'effect';
}

/** Slot an accessory belongs to, derived from its category when meta is missing. */
function slotForCategory(category: AccessoryCategory): AccessorySlot {
  switch (category) {
    case 'Hats':
      return 'head';
    case 'Glasses':
      return 'eyes';
    case 'Face':
      return 'face';
    case 'Neck':
      return 'neck';
    case 'Body':
      return 'body';
    case 'Back':
      return 'back';
    case 'Hand':
      return 'hand';
    case 'Tail':
      return 'tail';
    case 'Effects':
      return 'effect';
    default:
      return 'head';
  }
}
