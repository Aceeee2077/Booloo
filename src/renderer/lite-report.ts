// ============================================================================
// The year's company — "年度回顾".
//
// The same per-day counters the weekly summary and the heatmap read
// (`config.dailyStats`), taken a whole year at a time: how many days we were
// together, the clicks, the three health-plan reminders, the affection earned,
// the longest run and the busiest day. Nothing new is recorded.
//
// Only the current year is ever shown: the pet prunes its buckets to roughly a
// year, so there is nothing older to report on anyway, and a rolling window that
// never has a full year to compare against keeps the arithmetic honest.
//
// A global script like lite-summary.ts: no imports, all top-level, and the
// wording stays in the dictionary.
// ============================================================================

/** Everything one year of companionship adds up to. */
interface YearReport {
  year: number;
  /** First day of the window, always January 1st. */
  from: string;
  /** Last day of the window — today, or December 31st for a finished year. */
  to: string;
  /** Days in the window with any recorded activity. */
  days: number;
  clicks: number;
  stand: number;
  eye: number;
  water: number;
  affinity: number;
  /** Longest run of days in a row with activity, measured inside the year. */
  streak: number;
  /** The busiest day of the year by clicks, or null when nothing happened. */
  busiest: { date: string; clicks: number } | null;
  /** First day of the year with any activity, or null for a silent year. */
  first: string | null;
}

/**
 * The part of `year` that has happened: January 1st to today, or to December 31st
 * once the year is over (which is only ever reached for a past year).
 */
function reportYearWindow(year: number): { from: string; to: string } {
  const from = `${year}-01-01`;
  const last = `${year}-12-31`;
  const today = liteDayKey();
  return { from, to: liteDayDiff(today, last) >= 0 ? today : last };
}

/** Longest run of days in a row with activity, measured inside `year`. */
function reportLongestStreak(stats: Record<string, DailyStat> | undefined, year: number): number {
  const { from, to } = reportYearWindow(year);
  const span = liteDayDiff(from, to);
  let longest = 0;
  let run = 0;
  for (let offset = 0; offset <= span; offset++) {
    const entry = summaryDay(stats, liteDayShift(from, offset));
    run = summaryDayHasActivity(entry) ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return longest;
}

/**
 * The first day of `year` with any recorded activity, or null.
 *
 * The plainest read of "when we met this year": the earliest bucket the year
 * holds that is not empty. The earliest bucket is compared as a string — the
 * keys are zero-padded `YYYY-MM-DD`, so the lexical order is the calendar order.
 */
function reportFirstDay(stats: Record<string, DailyStat> | undefined, year: number): string | null {
  const prefix = `${year}-`;
  let first: string | null = null;
  for (const day of Object.keys(stats ?? {})) {
    if (!day.startsWith(prefix)) continue;
    if (!summaryDayHasActivity(summaryDay(stats, day))) continue;
    if (first === null || day < first) first = day;
  }
  return first;
}

/** This year so far, out of the same buckets the heatmap draws. */
function yearReport(stats: Record<string, DailyStat> | undefined, year: number): YearReport {
  const { from, to } = reportYearWindow(year);
  const totals = summaryTotals(stats, from, to);
  return {
    year,
    from: totals.from,
    to: totals.to,
    days: totals.days,
    clicks: totals.clicks,
    stand: totals.stand,
    eye: totals.eye,
    water: totals.water,
    affinity: totals.affinity,
    streak: reportLongestStreak(stats, year),
    busiest: totals.best,
    first: reportFirstDay(stats, year),
  };
}
