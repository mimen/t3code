import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";

import { hasUnseenCompletion, type SidebarListItem } from "./Sidebar.logic";

export type BotThread = Parameters<typeof hasUnseenCompletion>[0] &
  Parameters<typeof isThreadWorking>[0] &
  Pick<EnvironmentThreadShell, "environmentId" | "id" | "title" | "botId" | "settledOverride">;

export type BotRowState = "needs-you" | "working" | "quiet";

export function botRowState(thread: BotThread): BotRowState {
  if (isThreadWorking(thread)) return "working";
  if (thread.settledOverride === "settled") return "quiet";
  return hasUnseenCompletion(thread) || thread.latestRun?.status === "completed"
    ? "needs-you"
    : "quiet";
}

/** Bot threads leave every other section, so settling or pinning a bot never moves it. */
export function splitBotThreads<T extends Pick<EnvironmentThreadShell, "botId">>(
  threads: readonly T[],
) {
  const bots: T[] = [];
  const others: T[] = [];
  for (const thread of threads) (thread.botId ? bots : others).push(thread);
  return { bots, others };
}

export function resolveBotsSection<T extends BotThread>(
  bots: readonly T[],
  input: {
    readonly expanded: boolean;
    readonly showAll: boolean;
    readonly routeThreadKey: string | null;
  },
) {
  const states = bots
    .map((thread) => ({ thread, state: botRowState(thread) }))
    .toSorted((left, right) => left.thread.title.localeCompare(right.thread.title));
  const isRoute = (thread: T) =>
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === input.routeThreadKey;
  const rows = states
    .filter(
      ({ thread, state }) =>
        isRoute(thread) || (input.expanded && (input.showAll || state === "needs-you")),
    )
    .map(({ thread, state }) => ({ thread, dimmed: state !== "needs-you" }));
  return {
    rows,
    needsYouCount: states.filter(({ state }) => state === "needs-you").length,
    working: states.some(({ state }) => state === "working"),
  };
}

/** The drag projection rebuilds from the Pinned header down; the bots block above it stays put. */
export function botsBlock(items: readonly SidebarListItem[]): SidebarListItem[] {
  const pinnedAt = items.findIndex(
    (item) => item.kind === "marker" && item.marker === "pinned-header",
  );
  return pinnedAt === -1 ? [] : items.slice(0, pinnedAt);
}
