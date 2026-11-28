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

/** A bot file's grouping fields, looked up for each bot thread. */
export interface BotGrouping {
  readonly group?: string | undefined;
  readonly lead?: boolean | undefined;
}

/** The live count a bot keeps in its title, as in `Needs you · 81`. */
function botTitleCount(title: string): number {
  const match = /\s·\s*(\d+)\s*$/.exec(title);
  return match ? Number(match[1]) : 0;
}

export interface BotGroupView<T> {
  readonly name: string;
  readonly open: boolean;
  /** The lead, or the first member when the group has none. */
  readonly iconThread: T;
  readonly notices: readonly BotNotice[];
  readonly count: number;
  readonly working: boolean;
}

export interface BotSectionRow<T> {
  readonly thread: T;
  readonly state: BotRowState;
  readonly dimmed: boolean;
  /** Set on a group's lead, whose row stands for the whole group. */
  readonly group?: BotGroupView<T>;
  readonly inGroup: boolean;
  /** An ungrouped row keeps a chevron's width when groups show, so its icon lines up with theirs. */
  readonly gutter: boolean;
}

/** The bots block in display order: thread rows, and a header for each group with no lead. */
export type BotSectionEntry<T> =
  | { readonly kind: "row"; readonly row: BotSectionRow<T> }
  | { readonly kind: "group-header"; readonly group: BotGroupView<T> };

export function resolveBotsSection<T extends BotThread>(
  bots: readonly T[],
  input: {
    readonly expanded: boolean;
    readonly showAll: boolean;
    readonly routeThreadKey: string | null;
    readonly grouping?: (thread: T) => BotGrouping | null;
    readonly expandedGroups?: ReadonlySet<string>;
  },
) {
  const byTitle = (left: { thread: T }, right: { thread: T }) =>
    left.thread.title.localeCompare(right.thread.title);
  const states = bots.map((thread) => ({ thread, state: botRowState(thread) })).toSorted(byTitle);
  const isRoute = (thread: T) =>
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === input.routeThreadKey;
  const shown = ({ thread, state }: { thread: T; state: BotRowState }) =>
    isRoute(thread) || (input.expanded && (input.showAll || botWantsYou(state)));
  const plain = ({ thread, state }: { thread: T; state: BotRowState }): BotSectionRow<T> => ({
    thread,
    state,
    dimmed: !botWantsYou(state),
    inGroup: false,
    gutter: false,
  });

  type Unit = { name: string; asking: boolean; entries: BotSectionEntry<T>[] };
  const units: Unit[] = [];
  const groups = new Map<string, typeof states>();
  for (const entry of states) {
    // A collapsed section shows only the open thread, so groups only form while it is expanded.
    const name = input.expanded ? input.grouping?.(entry.thread)?.group : undefined;
    if (name === undefined) {
      if (shown(entry))
        units.push({
          name: entry.thread.title,
          asking: entry.state === "asking",
          entries: [{ kind: "row", row: plain(entry) }],
        });
      continue;
    }
    groups.set(name, [...(groups.get(name) ?? []), entry]);
  }
  for (const [name, members] of groups) {
    const leads = members.filter(({ thread }) => input.grouping?.(thread)?.lead === true);
    // A settled helper thread that shares the lead's bot never stands in for the lead.
    const lead = leads.find(({ thread }) => thread.settledOverride !== "settled") ?? leads[0];
    const wantsYou = members.some(({ state }) => botWantsYou(state));
    if (!input.showAll && !wantsYou && !members.some(({ thread }) => isRoute(thread))) continue;
    const open = input.expandedGroups?.has(name) ?? false;
    const group: BotGroupView<T> = {
      name,
      open,
      iconThread: (lead ?? members[0]!).thread,
      notices: members.flatMap(({ thread, state }) => botNotice(state, thread) ?? []),
      count: members.reduce((sum, { thread }) => sum + botTitleCount(thread.title), 0),
      working: members.some(({ state }) => state === "working"),
    };
    const entries: BotSectionEntry<T>[] = [
      lead
        ? {
            kind: "row",
            row: {
              ...plain(lead),
              dimmed: open ? !botWantsYou(lead.state) : !wantsYou,
              group,
            },
          }
        : { kind: "group-header", group },
    ];
    if (open) {
      for (const member of members.toSorted(
        (left, right) =>
          Number(right.state === "asking") - Number(left.state === "asking") ||
          byTitle(left, right),
      )) {
        if (member !== lead && shown(member))
          entries.push({ kind: "row", row: { ...plain(member), inGroup: true } });
      }
    }
    units.push({ name, asking: members.some(({ state }) => state === "asking"), entries });
  }
  const sorted = units
    .toSorted(
      (left, right) =>
        Number(right.asking) - Number(left.asking) || left.name.localeCompare(right.name),
    )
    .flatMap((unit) => unit.entries);
  const hasGroups = sorted.some((entry) => entry.kind === "group-header" || entry.row.group);
  const entries = sorted.map((entry): BotSectionEntry<T> =>
    entry.kind === "row" && hasGroups && !entry.row.inGroup && !entry.row.group
      ? { kind: "row", row: { ...entry.row, gutter: true } }
      : entry,
  );
  const rows = entries.flatMap((entry) => (entry.kind === "row" ? [entry.row] : []));
  const needsYou = states
    .filter(({ state }) => botWantsYou(state))
    .toSorted((left, right) => Number(right.state === "asking") - Number(left.state === "asking"))
    .map(({ thread }) => thread);
  return {
    entries,
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
