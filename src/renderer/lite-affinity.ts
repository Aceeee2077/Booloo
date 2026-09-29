// ============================================================================
// Affinity — the relationship score with the pet.
//
// The config keys (`affinity`, `affinityHistory`, `statsDays`…) and the strings
// (`affinity.level1`…`affinity.maxed`) came from the full-featured edition; this
// is the shared model behind them. It lives in one global script because three
// pages need the same answer: the pet awards the points, the settings panel draws
// the bar and the right-click menu prints the level.
//
// A global script like lite-day.ts / lite-i18n.ts: loaded after lite-i18n.js (the
// level names come from the dictionary) and before the page scripts.
// ============================================================================

/** Points at which each level starts, 1 → 5. */
const AFFINITY_LEVELS = [0, 60, 200, 500, 1000];
/** The score's ceiling: the last level is also the end of the line. */
const AFFINITY_MAX = AFFINITY_LEVELS[AFFINITY_LEVELS.length - 1];
/**
 * How much can be earned in one local day.
 *
 * Without it a bored evening could take a brand-new pet straight to 挚友; the cap
 * makes the score reflect days spent together rather than one long click session.
 */
const AFFINITY_DAILY_CAP = 40;
/** The first interaction of a day is worth extra — coming back is the point. */
const AFFINITY_FIRST_HELLO = 5;

/** 0-based level index for a score. */
function affinityLevel(value: number) {
  let level = 0;
  for (let index = 0; index < AFFINITY_LEVELS.length; index++) {
    if (value >= AFFINITY_LEVELS[index]) level = index;
  }
  return level;
}

/** Translated name of a 0-based level ("陌生" … "挚友"). */
function affinityLevelName(level: number) {
  return liteT(`affinity.level${level + 1}`);
}

/** Score at which the next level starts, or null once the last one is reached. */
function affinityNextAt(value: number) {
  const level = affinityLevel(value);
  return level + 1 < AFFINITY_LEVELS.length ? AFFINITY_LEVELS[level + 1] : null;
}

/** How far the bar should be filled: 0..1 towards the next level, 1 when maxed. */
function affinityProgress(value: number) {
  const level = affinityLevel(value);
  const next = affinityNextAt(value);
  if (next === null) return 1;
  const floor = AFFINITY_LEVELS[level];
  return Math.max(0, Math.min(1, (value - floor) / (next - floor)));
}
