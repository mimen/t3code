// @effect-diagnostics globalDate:off -- resolveSnoozePresets takes a local Date.
import { describe, expect, it } from "vite-plus/test";

import { SOMEDAY_SNOOZED_UNTIL, splitLaterSnoozes } from "./forkSomedaySnooze.ts";
import { resolveSnoozePresets, snoozeWakeLabel } from "./threadSettled.ts";

const NOW = "2026-10-23T12:00:00.000Z";

describe("later snooze", () => {
  it("is offered last, after the timed presets", () => {
    const preset = resolveSnoozePresets(new Date(NOW)).at(-1);
    expect(preset?.label).toBe("Later");
    expect(preset?.snoozedUntil).toBe(SOMEDAY_SNOOZED_UNTIL);
  });

  it("shows no countdown, while timed snoozes keep theirs", () => {
    expect(snoozeWakeLabel(SOMEDAY_SNOOZED_UNTIL, { now: NOW })).toBe("later");
    expect(snoozeWakeLabel("2026-10-30T12:00:00.000Z", { now: NOW })).toBe("7d");
  });

  it("shelves later threads apart from timed snoozes, keeping each order", () => {
    const soon = { id: "soon", snoozedUntil: "2026-10-24T09:00:00.000Z" };
    const laterA = { id: "a", snoozedUntil: SOMEDAY_SNOOZED_UNTIL };
    const week = { id: "week", snoozedUntil: "2026-10-30T09:00:00.000Z" };
    const laterB = { id: "b", snoozedUntil: SOMEDAY_SNOOZED_UNTIL };
    expect(splitLaterSnoozes([soon, laterA, week, laterB])).toEqual({
      timed: [soon, week],
      later: [laterA, laterB],
    });
  });
});
