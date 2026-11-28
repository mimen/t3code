import { describe, expect, it } from "vite-plus/test";

import { splitLaterSnoozes, timedSnoozePresets } from "./forkSomedaySnooze.ts";
import { INDEFINITE_SNOOZE_UNTIL, resolveSnoozePresets, snoozeWakeLabel } from "./threadSettled.ts";

const NOW = "2026-10-23T12:00:00.000Z";
const LEGACY_SOMEDAY = "9999-12-31T00:00:00.000Z";

describe("later snooze", () => {
  it("is upstream's indefinite preset, kept out of the timed Snooze list", () => {
    const presets = resolveSnoozePresets(new Date(NOW));
    expect(presets.at(-1)?.snoozedUntil).toBe(INDEFINITE_SNOOZE_UNTIL);
    expect(timedSnoozePresets(presets).map((preset) => preset.id)).not.toContain("indefinite");
  });

  it("shows no countdown, while timed snoozes keep theirs", () => {
    expect(snoozeWakeLabel(INDEFINITE_SNOOZE_UNTIL, { now: NOW })).toBe("later");
    expect(snoozeWakeLabel(LEGACY_SOMEDAY, { now: NOW })).toBe("later");
    expect(snoozeWakeLabel("2026-10-30T12:00:00.000Z", { now: NOW })).toBe("7d");
  });

  it("shelves later threads apart from timed snoozes, keeping each order", () => {
    const soon = { id: "soon", snoozedUntil: "2026-10-24T09:00:00.000Z" };
    const laterA = { id: "a", snoozedUntil: INDEFINITE_SNOOZE_UNTIL };
    const week = { id: "week", snoozedUntil: "2026-10-30T09:00:00.000Z" };
    const laterB = { id: "b", snoozedUntil: LEGACY_SOMEDAY };
    expect(splitLaterSnoozes([soon, laterA, week, laterB])).toEqual({
      timed: [soon, week],
      later: [laterA, laterB],
    });
  });
});
