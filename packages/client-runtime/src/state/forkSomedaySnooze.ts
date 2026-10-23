// Snooze with no wake time. The server requires a future wake, so "someday" is a
// wake far enough out that it never arrives; every snooze path then works unchanged.
export const SOMEDAY_SNOOZED_UNTIL = "9999-12-31T00:00:00.000Z";

const SOMEDAY_MS = Date.parse(SOMEDAY_SNOOZED_UNTIL);

export function isSomedaySnooze(snoozedUntil: string | null | undefined): boolean {
  return snoozedUntil != null && Date.parse(snoozedUntil) >= SOMEDAY_MS;
}

export const SOMEDAY_SNOOZE_PRESET = {
  id: "someday",
  label: "Someday",
  whenLabel: "no wake",
  snoozedUntil: SOMEDAY_SNOOZED_UNTIL,
} as const;
