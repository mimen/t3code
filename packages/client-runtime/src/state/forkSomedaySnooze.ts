// Upstream's indefinite snooze is the fork's Later. The threshold sits below upstream's
// INDEFINITE_SNOOZE_UNTIL so threads snoozed with the fork's earlier value still count.
const LEGACY_SOMEDAY_MS = Date.parse("9999-12-31T00:00:00.000Z");

export function isSomedaySnooze(snoozedUntil: string | null | undefined): boolean {
  return snoozedUntil != null && Date.parse(snoozedUntil) >= LEGACY_SOMEDAY_MS;
}

const SOMEDAY_SNOOZE_PRESET_ID = "indefinite";

export function splitLaterSnoozes<T extends { readonly snoozedUntil?: string | null }>(
  snoozed: readonly T[],
): { readonly timed: T[]; readonly later: T[] } {
  const timed: T[] = [];
  const later: T[] = [];
  for (const thread of snoozed) (isSomedaySnooze(thread.snoozedUntil) ? later : timed).push(thread);
  return { timed, later };
}

export function timedSnoozePresets<T extends { readonly id: string }>(
  presets: ReadonlyArray<T>,
): T[] {
  return presets.filter((preset) => preset.id !== SOMEDAY_SNOOZE_PRESET_ID);
}
