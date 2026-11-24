import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";
import { forkBotMenuAction } from "./threadActionMenu.forkBots";

const list = {
  directory: "/bots",
  bots: [
    { id: "needs-you", name: "Needs you", path: "/bots/needs-you.md" },
    { id: "coordinator", name: "Coordinator", path: "/bots/coordinator.md" },
  ],
};
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
  snoozePresets: resolveSnoozePresets(new Date("2026-11-23T12:00:00Z")),
  forkBots: { current: null, list },
};
const botItem = (overrides: Partial<ThreadActionMenuState>) =>
  buildThreadActionMenuItems({ ...state, ...overrides }).find((item) => item.id === "bot");

describe("Bot menu item", () => {
  it("lists every bot and, for a thread with no bot, offers to make it one", () => {
    expect(botItem({})?.children).toEqual([
      { id: "bot:set:needs-you", label: "Needs you", checked: false },
      { id: "bot:set:coordinator", label: "Coordinator", checked: false },
      { id: "bot:make", label: "Make this thread a bot…", separatorBefore: true },
    ]);
  });

  it("offers to make the first bot when the directory is empty", () => {
    expect(botItem({ forkBots: { current: null, list: { ...list, bots: [] } } })).toMatchObject({
      children: [{ id: "bot:make", separatorBefore: false }],
    });
  });

  it("checks the current bot and offers No bot", () => {
    const children = botItem({ forkBots: { current: "coordinator", list } })?.children ?? [];
    expect(children.filter((child) => child.checked).map((child) => child.id)).toEqual([
      "bot:set:coordinator",
    ]);
    expect(children.at(-1)).toMatchObject({ id: "bot:none", label: "No bot" });
  });

  it("is disabled with a hint while loading, or without a bots directory or permission", () => {
    expect(botItem({ forkBots: { current: null, list: null } })).toMatchObject({
      disabled: true,
      detail: "Loading bots…",
    });
    expect(
      botItem({ forkBots: { current: null, list: { directory: null, bots: [] } } }),
    ).toMatchObject({ disabled: true, detail: "Set a bots directory in Settings" });
    const readOnly = botItem({ canOperate: false });
    expect(readOnly?.disabled).toBe(true);
    expect(readOnly?.children?.every((child) => child.disabled)).toBe(true);
  });

  it("is absent when the caller supplies no bot state", () => {
    const { forkBots: _, ...withoutBots } = state;
    expect(
      buildThreadActionMenuItems(withoutBots).find((item) => item.id === "bot"),
    ).toBeUndefined();
  });
});

describe("forkBotMenuAction", () => {
  it("reads a bot, No bot, make a bot, or nothing", () => {
    expect(forkBotMenuAction("bot:set:needs-you")).toEqual({ kind: "set", botId: "needs-you" });
    expect(forkBotMenuAction("bot:none")).toEqual({ kind: "set", botId: null });
    expect(forkBotMenuAction("bot:make")).toEqual({ kind: "make" });
    expect(forkBotMenuAction("snooze:custom")).toBeUndefined();
  });
});
