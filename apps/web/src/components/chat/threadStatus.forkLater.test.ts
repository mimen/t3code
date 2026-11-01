import { describe, expect, it } from "vite-plus/test";

import { snoozedStatusLabel } from "./threadStatus.forkLater";

// The wake a Later snooze stores (forkSomedaySnooze.ts).
const LATER = "9999-12-31T00:00:00.000Z";

describe("snoozedStatusLabel", () => {
  it("names a Later snooze instead of counting down to it", () => {
    expect(snoozedStatusLabel(LATER, "2026-11-01T10:00")).toBe("Saved for later");
  });

  it("counts down to a timed wake", () => {
    expect(snoozedStatusLabel("2026-11-01T12:00:00.000Z", "2026-11-01T10:00")).toBe(
      "Snoozed, 2h left",
    );
    expect(snoozedStatusLabel("2026-11-01T09:00:00.000Z", "2026-11-01T10:00")).toBe("Snoozed");
    expect(snoozedStatusLabel(null, "2026-11-01T10:00")).toBe("Snoozed");
  });
});
