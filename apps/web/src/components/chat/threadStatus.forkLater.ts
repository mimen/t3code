import { isSomedaySnooze, snoozeWakeLabel } from "@t3tools/client-runtime/state/thread-settled";

// A Later snooze never wakes, so it gets a name, not a countdown; mobile shows the same copy.
export function snoozedStatusLabel(snoozedUntil: string | null, nowMinute: string): string {
  if (isSomedaySnooze(snoozedUntil)) return "Saved for later";
  // Same rounding as the sidebar's snoozed shelf, so both read the same hour.
  const wake = snoozedUntil ? snoozeWakeLabel(snoozedUntil, { now: `${nowMinute}:00.000Z` }) : null;
  return wake && wake !== "now" ? `Snoozed, ${wake} left` : "Snoozed";
}
