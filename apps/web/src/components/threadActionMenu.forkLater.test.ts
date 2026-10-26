import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const state: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: resolveSnoozePresets(new Date("2026-10-26T12:00:00Z")),
};

describe("Later menu item", () => {
  it("sits right after Snooze, and Snooze lists only timed presets", () => {
    const items = buildThreadActionMenuItems(state);
    const at = items.findIndex((item) => item.id === "snooze");
    expect(items[at + 1]).toMatchObject({ id: "snooze:someday", label: "Later" });
    expect(items[at]?.children?.map((child) => child.id)).not.toContain("snooze:someday");
  });

  it("gives way to Wake on a snoozed thread", () => {
    const ids = buildThreadActionMenuItems({ ...state, isSnoozed: true }).map((item) => item.id);
    expect(ids).toContain("unsnooze");
    expect(ids).not.toContain("snooze:someday");
  });
});
