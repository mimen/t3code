// Snooze with no wake time, shown as "Later". The server requires a future wake, so this
// is a wake far enough out that it never arrives; every snooze path then works unchanged.
export const SOMEDAY_SNOOZED_UNTIL = "9999-12-31T00:00:00.000Z";

const SOMEDAY_MS = Date.parse(SOMEDAY_SNOOZED_UNTIL);

export function isSomedaySnooze(snoozedUntil: string | null | undefined): boolean {
  return snoozedUntil != null && Date.parse(snoozedUntil) >= SOMEDAY_MS;
}

export const SOMEDAY_SNOOZE_PRESET = {
  id: "someday",
  label: "Later",
  whenLabel: "no wake",
  snoozedUntil: SOMEDAY_SNOOZED_UNTIL,
} as const;

// Later threads stay snoozed for every behavior; only the lists shelve them apart.
export function splitLaterSnoozes<T extends { readonly snoozedUntil?: string | null }>(
  snoozed: readonly T[],
): { readonly timed: T[]; readonly later: T[] } {
  const timed: T[] = [];
  const later: T[] = [];
  for (const thread of snoozed) (isSomedaySnooze(thread.snoozedUntil) ? later : timed).push(thread);
  return { timed, later };
}
