// ============================================================================
// Local calendar days, shared by the pet window and the settings panel.
//
// The daily counters (clicks, health-plan completions) are bucketed by the local
// calendar day, so both windows have to agree on where a day starts and how a day
// is spelled. There is deliberately no network time here: the same clock the user
// reads on their taskbar is the one that decides, and every helper takes the date
// it should look at, so nothing is cached across a midnight or a timezone change —
// the next call simply lands in the new day's bucket.
//
// A global script like lite-i18n.ts / lite-image.ts: the other lite pages call
// liteDayKey() directly, with no imports and no bundler.
// ============================================================================

/** `2026-09-29` for the local calendar day the given moment falls in. */
function liteDayKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Local midnight that starts `key`, or null when the key is not a day. */
function liteDayStart(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // `new Date(2026, 12, 40)` rolls over instead of failing, so the round trip is
  // what proves the key was a real day.
  return liteDayKey(date) === key ? date : null;
}

/** `key` moved by whole local days. */
function liteDayShift(key: string, days: number): string {
  const start = liteDayStart(key);
  if (!start) return key;
  return liteDayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + days));
}

/**
 * Whole days from `a` to `b` (negative when `b` is earlier).
 *
 * The difference is rounded rather than divided exactly: a daylight-saving jump
 * makes a day 23 or 25 hours long, and truncating that would report the wrong
 * number of days across the change.
 */
function liteDayDiff(a: string, b: string): number {
  const start = liteDayStart(a);
  const end = liteDayStart(b);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** Day of the week, 0 = Monday … 6 = Sunday (the heatmap's row order). */
function liteDayWeekday(key: string): number {
  const start = liteDayStart(key);
  if (!start) return 0;
  return (start.getDay() + 6) % 7;
}
