// @effect-diagnostics globalDate:off -- resolveSnoozePresets takes a local Date.
import { describe, expect, it } from "vite-plus/test";

import { SOMEDAY_SNOOZED_UNTIL } from "./forkSomedaySnooze.ts";
import { resolveSnoozePresets, snoozeWakeLabel } from "./threadSettled.ts";

const NOW = "2026-10-23T12:00:00.000Z";

describe("someday snooze", () => {
  it("is offered last, after the timed presets", () => {
    expect(resolveSnoozePresets(new Date(NOW)).at(-1)?.snoozedUntil).toBe(SOMEDAY_SNOOZED_UNTIL);
  });

  it("shows no countdown, while timed snoozes keep theirs", () => {
    expect(snoozeWakeLabel(SOMEDAY_SNOOZED_UNTIL, { now: NOW })).toBe("someday");
    expect(snoozeWakeLabel("2026-10-30T12:00:00.000Z", { now: NOW })).toBe("7d");
  });
});
