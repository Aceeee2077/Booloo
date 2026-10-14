// ============================================================================
// The pet's small clocks: the hourly chime's next slot and the minute bounds
// the reminder switches share.
//
// Both are pure arithmetic on the arguments they are given — the chime reads the
// wall clock from the caller, and the bounds never consult config — so the pet
// loop can call them without any state of its own.
//
// A global script like lite-day.ts: the pet page calls litePetNextLocalHour() and
// litePetClampMinutes() directly, with no imports and no bundler.
// ============================================================================

/** The top of the next local hour after `now`, as a timestamp. */
function litePetNextLocalHour(now: number): number {
  const next = new Date(now);
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return next.getTime();
}

/** A whole number of minutes within 1…240, or `fallback` when `value` is not one. */
function litePetClampMinutes(value: unknown, fallback: number): number {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 240 ? minutes : fallback;
}
