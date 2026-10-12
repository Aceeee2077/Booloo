// ============================================================================
// The week's company — "陪伴周报".
//
// Everything here is read out of the per-day counters the pet already keeps
// (`config.dailyStats`): clicks, the three health-plan reminders and the
// affinity earned that day. Nothing new is recorded, so the report costs no
// storage and cannot disagree with the click heatmap: both read the same buckets,
// keyed by the local calendar day (lite-day.ts).
//
// The window is "this week so far" — Monday up to today — because that is the
// thing a person can still act on. A partial week is never compared against a
// full one, so there is no "best week" arithmetic to get subtly wrong.
//
// A global script like lite-day.ts / lite-care.ts: no imports, and the wording
// lives in the dictionary (the headline is returned as a *key*, not a sentence).
// ============================================================================

/** Everything one week of companionship adds up to. */
interface SummaryTotals {
  /** First day of the window (a Monday), `YYYY-MM-DD`. */
  from: string;
  /** Last day of the window (today). */
  to: string;
  /** Days in the window with any recorded activity. */
  days: number;
  clicks: number;
  stand: number;
  eye: number;
  water: number;
  affinity: number;
  /** The busiest day of the window by clicks, or null when nothing happened. */
  best: { date: string; clicks: number } | null;
}

/**
 * Monday of the week `day` falls in.
 *
 * Monday because that is the heatmap's row order (`liteDayWeekday`), and a report
 * whose week starts somewhere else than the calendar it sits next to would be a
 * quiet bug.
 */
function summaryWeekStart(day: string): string {
  return liteDayShift(day, -liteDayWeekday(day));
}

/** The seven day keys of `day`'s week, Monday first. */
function summaryWeekKeys(day: string): string[] {
  const start = summaryWeekStart(day);
  return Array.from({ length: 7 }, (_, index) => liteDayShift(start, index));
}

/** Read one day's bucket without trusting the shape of the config file. */
function summaryDay(stats: Record<string, DailyStat> | undefined, day: string): DailyStat | null {
  const entry = stats?.[day];
  return entry && typeof entry === 'object' ? entry : null;
}

/** Whether a day bucket holds anything worth counting as "time together". */
function summaryDayHasActivity(entry: DailyStat | null): boolean {
  if (!entry) return false;
  return ['clicks', 'stand', 'eye', 'water', 'affinity'].some(kind =>
    (Number(entry[kind as keyof DailyStat]) || 0) > 0);
}

/**
 * Totals over an inclusive range of local days.
 *
 * `to` is clamped to `from` so a reversed range reports an empty week rather than
 * a negative one, and a range that crosses a year boundary costs nothing special:
 * the walk is by whole local days (liteDayShift), the same helper the heatmap uses.
 */
function summaryTotals(
  stats: Record<string, DailyStat> | undefined,
  from: string,
  to: string,
): SummaryTotals {
  const span = liteDayDiff(from, to);
  const totals: SummaryTotals = {
    from, to, days: 0, clicks: 0, stand: 0, eye: 0, water: 0, affinity: 0, best: null,
  };
  if (span < 0) return totals;
  for (let offset = 0; offset <= span; offset++) {
    const day = liteDayShift(from, offset);
    const entry = summaryDay(stats, day);
    if (!summaryDayHasActivity(entry)) continue;
    totals.days += 1;
    totals.clicks += Number(entry?.clicks) || 0;
    totals.stand += Number(entry?.stand) || 0;
    totals.eye += Number(entry?.eye) || 0;
    totals.water += Number(entry?.water) || 0;
    totals.affinity += Number(entry?.affinity) || 0;
    const clicks = Number(entry?.clicks) || 0;
    if (clicks > 0 && (!totals.best || clicks > totals.best.clicks)) totals.best = { date: day, clicks };
  }
  return totals;
}

/**
 * Days in a row, ending today, that were spent together.
 *
 * A quiet *today* does not break the streak: before the first click of the day
 * there is nothing to record yet, and a counter that resets every midnight until
 * it is touched would read as "you lost it". The walk therefore starts at
 * yesterday when today is still empty.
 */
function summaryStreak(stats: Record<string, DailyStat> | undefined, day: string): number {
  let cursor = summaryDayHasActivity(summaryDay(stats, day)) ? day : liteDayShift(day, -1);
  let streak = 0;
  // The pet prunes its buckets to roughly a year; the cap only bounds the loop.
  while (streak < 400 && summaryDayHasActivity(summaryDay(stats, cursor))) {
    streak += 1;
    cursor = liteDayShift(cursor, -1);
  }
  return streak;
}

/** The week's one-line verdict, as dictionary keys (never a literal sentence). */
const SUMMARY_HEADLINES = {
  /** Nothing was recorded at all. */
  quiet: 'lite.summary.quiet',
  /** Some company, but not a week of it. */
  steady: 'lite.summary.steady',
  /** Five days or more. */
  warm: 'lite.summary.warm',
} as const;

/** Pick the verdict key for a week's totals. */
function summaryHeadlineKey(totals: SummaryTotals): string {
  if (totals.days === 0) return SUMMARY_HEADLINES.quiet;
  return totals.days >= 5 ? SUMMARY_HEADLINES.warm : SUMMARY_HEADLINES.steady;
}
