import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";

import { hasUnseenCompletion, type SidebarListItem } from "./Sidebar.logic";

export type BotThread = Parameters<typeof hasUnseenCompletion>[0] &
  Parameters<typeof isThreadWorking>[0] &
  Pick<EnvironmentThreadShell, "environmentId" | "id" | "title" | "botId" | "settledOverride">;

/** "asking" waits on the user's answer or approval, so it outranks everything. */
export type BotRowState = "asking" | "needs-you" | "working" | "quiet";

/** A bot the user should look at: shown, undimmed, counted, and docked. */
export function botWantsYou(state: BotRowState): boolean {
  return state === "asking" || state === "needs-you";
}

/** What a bot's dot says, colored by the kind of notice rather than by the bot. */
export type BotNotice = "asking" | "failed" | "done";

export function botNotice(
  state: BotRowState,
  thread: Pick<BotThread, "latestRun">,
): BotNotice | null {
  if (state === "asking") return "asking";
  if (state !== "needs-you") return null;
  return thread.latestRun?.status === "failed" ? "failed" : "done";
}

export function botRowState(thread: BotThread): BotRowState {
  if (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.pendingSubagentRequest != null ||
    (thread.interactionMode === "plan" &&
      thread.hasActionableProposedPlan &&
      !isThreadWorking(thread))
  ) {
    return "asking";
  }
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
    .toSorted(
      (left, right) =>
        Number(right.state === "asking") - Number(left.state === "asking") ||
        left.thread.title.localeCompare(right.thread.title),
    );
  const isRoute = (thread: T) =>
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === input.routeThreadKey;
  const rows = states
    .filter(
      ({ thread, state }) =>
        isRoute(thread) || (input.expanded && (input.showAll || botWantsYou(state))),
    )
    .map(({ thread, state }) => ({ thread, state, dimmed: !botWantsYou(state) }));
  const needsYou = states.filter(({ state }) => botWantsYou(state)).map(({ thread }) => thread);
  return {
    rows,
    needsYou,
    needsYouCount: needsYou.length,
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
