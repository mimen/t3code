import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type BotThread,
  resolveBotsSection,
  botRowState,
  splitBotThreads,
} from "./Sidebar.forkBots.logic";
import { createSidebarSortingStrategy } from "./Sidebar.drag";
import {
  resolveSidebarDropTarget,
  sidebarListItemId,
  sidebarMarkerId,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "./Sidebar.logic";

const environmentId = EnvironmentId.make("env");
const completedAt = "2026-11-23T10:05:00.000Z";

function bot(title: string, overrides: Partial<BotThread> = {}): BotThread {
  return {
    environmentId,
    id: ThreadId.make(title),
    title,
    botId: title.toLowerCase(),
    settledOverride: null,
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    pendingGuestMessageCount: 0,
    interactionMode: "default",
    runtime: null,
    lastVisitedAt: completedAt,
    latestRun: {
      runId: "run" as never,
      status: "completed",
      assistantMessageId: null,
      requestedAt: "2026-11-23T10:00:00.000Z",
      startedAt: "2026-11-23T10:00:00.000Z",
      completedAt,
    },
    ...overrides,
  } as BotThread;
}

const unread = bot("Unread", {
  lastVisitedAt: "2026-11-23T09:00:00.000Z",
  latestRun: { ...bot("x").latestRun!, status: "failed" },
});
const completed = bot("Completed");
const settled = bot("Settled", { settledOverride: "settled" });
const working = bot("Working", {
  runtime: {
    status: "running",
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: null,
    lastError: null,
    updatedAt: completedAt,
  },
});
const keyOf = (thread: BotThread) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
const titles = (section: ReturnType<typeof resolveBotsSection<BotThread>>) =>
  section.rows.map(({ thread, dimmed }) => `${thread.title}${dimmed ? " (dim)" : ""}`);
const all = [working, settled, unread, completed];
const closed = { expanded: true, showAll: false, routeThreadKey: null };

describe("botRowState", () => {
  it("needs the user when unread, even if the run failed", () => {
    expect(botRowState(unread)).toBe("needs-you");
  });

  it("needs the user when its latest run completed, read or not", () => {
    expect(botRowState(completed)).toBe("needs-you");
  });

  it("is quiet once settled, and working while it runs", () => {
    expect(botRowState(settled)).toBe("quiet");
    expect(botRowState(working)).toBe("working");
  });
});

describe("resolveBotsSection", () => {
  it("lists only bots that need the user, counts them, and flags a working bot", () => {
    const section = resolveBotsSection(all, closed);
    expect(titles(section)).toEqual(["Completed", "Unread"]);
    expect(section.needsYouCount).toBe(2);
    expect(section.working).toBe(true);
  });

  it("reveals quiet and working bots dimmed under show all", () => {
    expect(titles(resolveBotsSection(all, { ...closed, showAll: true }))).toEqual([
      "Completed",
      "Settled (dim)",
      "Unread",
      "Working (dim)",
    ]);
  });

  it("gives each row the state its one status slot shows", () => {
    const states = resolveBotsSection(all, { ...closed, showAll: true }).rows.map(
      ({ thread, state }) => [thread.title, state],
    );
    expect(states).toEqual([
      ["Completed", "needs-you"],
      ["Settled", "quiet"],
      ["Unread", "needs-you"],
      ["Working", "working"],
    ]);
  });

  it("keeps the routed bot visible while hidden or collapsed", () => {
    expect(titles(resolveBotsSection(all, { ...closed, routeThreadKey: keyOf(settled) }))).toEqual([
      "Completed",
      "Settled (dim)",
      "Unread",
    ]);
    expect(
      titles(
        resolveBotsSection(all, { ...closed, expanded: false, routeThreadKey: keyOf(working) }),
      ),
    ).toEqual(["Working (dim)"]);
  });

  it("collapses to its header when no bot needs the user", () => {
    const section = resolveBotsSection([settled, working], closed);
    expect(section.rows).toEqual([]);
    expect(section.needsYouCount).toBe(0);
  });
});

describe("splitBotThreads", () => {
  it("takes settled and pinned bots out of every other section", () => {
    const pinned = { ...bot("Pinned"), pinnedAt: completedAt };
    const plainSettled = { ...bot("Plain", { settledOverride: "settled" }), botId: null };
    const { bots, others } = splitBotThreads([settled, pinned, plainSettled]);
    expect(bots).toEqual([settled, pinned]);
    expect(others).toEqual([plainSettled]);
  });
});

describe("bots block while dragging", () => {
  const marker = (name: SidebarListMarker): SidebarListItem => ({ kind: "marker", marker: name });
  const row = (key: string, section: SidebarSection): SidebarListItem => ({
    kind: "thread",
    key,
    section,
  });
  const items = [
    marker("bots-header"),
    row("bot", "bots"),
    marker("bots-end"),
    marker("pinned-header"),
    row("pinned", "pinned"),
    marker("pinned-divider"),
    marker("active-placeholder"),
    row("active", "active"),
    row("other", "active"),
    marker("settled-header"),
    marker("settled-placeholder"),
  ];

  it("takes no drops and keeps bot rows out of the pinned order", () => {
    expect(resolveSidebarDropTarget(items, "active", "bot")).toBeNull();
    expect(resolveSidebarDropTarget(items, "active", "bots-header")).toBeNull();
    expect(resolveSidebarDropTarget(items, "active", "bots-end")).toBeNull();
    expect(resolveSidebarDropTarget(items, "active", "pinned")).toMatchObject({
      section: "pinned",
      pinnedOrder: ["active", "pinned"],
    });
  });

  it("holds the bots block in place while a row moves to Pinned", () => {
    let top = 0;
    const rects = items.map((item) => {
      const height = item.kind === "thread" ? (item.section === "bots" ? 54 : 82) : 32;
      const rect = { top, height, bottom: top + height, left: 0, right: 260, width: 260 };
      top += height + 1;
      return rect;
    });
    const strategy = createSidebarSortingStrategy({
      items,
      settledOrder: [],
      settledExpanded: false,
    });
    const activeIndex = items.findIndex((item) => sidebarListItemId(item) === "active");
    const args = {
      activeIndex,
      overIndex: items.findIndex((item) => sidebarListItemId(item) === "pinned"),
      activeNodeRect: rects[activeIndex]!,
      rects,
    };
    const transform = (id: string) =>
      strategy({ ...args, index: items.findIndex((item) => sidebarListItemId(item) === id) });
    expect(transform(sidebarMarkerId("bots-header"))).toMatchObject({ y: 0, scaleY: 1 });
    expect(transform("bot")).toMatchObject({ y: 0, scaleY: 1 });
    expect(transform(sidebarMarkerId("bots-end"))).toMatchObject({ y: 0, scaleY: 1 });
    expect(transform("pinned")?.y).toBeGreaterThan(0);
  });
});
