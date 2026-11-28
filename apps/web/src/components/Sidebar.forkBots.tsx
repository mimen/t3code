import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ForkBot, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import { BotIcon, ChevronRightIcon, EyeIcon, EyeOffIcon, HistoryIcon } from "lucide-react";
import { createElement, lazy, Suspense, useState } from "react";

import { useLocalStorage } from "../hooks/useLocalStorage";
import { cn } from "../lib/utils";
import { useForkBot, useForkBotsLookup, useForkBotsPrefetch } from "../state/forkBots";
import {
  type BotGroupView,
  type BotNotice,
  type BotSectionRow,
  type BotThread,
  botNotice,
  botRowState,
  botWantsYou,
  resolveBotsSection,
} from "./Sidebar.forkBots.logic";
import type { SidebarListItem, SidebarListMarker } from "./Sidebar.logic";
import { RelativeTimeLabel } from "./sidebar/SidebarThreadRow";
import { SortableSidebarMarker } from "./sidebar/SidebarListMarkers";
import { CollapsibleSectionHeader } from "./ui/collapsible-section-header";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const BOTS_EXPANDED_KEY = "t3code:sidebar:bots-expanded";
const BOT_GROUPS_EXPANDED_KEY = "t3code:sidebar:bot-groups-expanded";
const GroupNames = Schema.Array(Schema.String);

const botGroupMarker = (name: string): SidebarListMarker => `bot-group:${name}`;
const threadKeyOf = (thread: BotThread) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

export function useBotsSection(
  bots: readonly EnvironmentThreadShell[],
  routeThreadKey: string | null,
) {
  const [expanded, setExpanded] = useLocalStorage(BOTS_EXPANDED_KEY, true, Schema.Boolean);
  const [showAll, setShowAll] = useState(false);
  const [expandedGroups, setExpandedGroups] = useLocalStorage(
    BOT_GROUPS_EXPANDED_KEY,
    [],
    GroupNames,
  );
  useForkBotsPrefetch();
  const grouping = useForkBotsLookup(bots);
  const section = resolveBotsSection(bots, {
    expanded,
    showAll,
    routeThreadKey,
    grouping,
    expandedGroups: new Set(expandedGroups),
  });
  const groupHeaders = new Map<string, BotGroupView<EnvironmentThreadShell>>();
  const listItems = section.entries.map((entry): SidebarListItem => {
    if (entry.kind === "row") {
      return { kind: "thread", key: threadKeyOf(entry.row.thread), section: "bots" };
    }
    groupHeaders.set(botGroupMarker(entry.group.name), entry.group);
    return { kind: "marker", marker: botGroupMarker(entry.group.name) };
  });
  const toggleGroup = (name: string) =>
    setExpandedGroups((names) =>
      names.includes(name) ? names.filter((open) => open !== name) : [...names, name],
    );
  return {
    ...section,
    threads: bots,
    expanded,
    showAll,
    listItems,
    rowsByKey: new Map(section.rows.map((row) => [threadKeyOf(row.thread), row])),
    groupHeaders,
    groupsKey: expandedGroups.join("\n"),
    toggleGroup,
    toggle: () => setExpanded((value) => !value),
    toggleShowAll: () => setShowAll((value) => !value),
  };
}

const DOCK_LIMIT = 4;

/** The tray's bottom edge; the rounded panel replaces a divider line. */
export function BotsEnd() {
  return (
    <SortableSidebarMarker
      marker="bots-end"
      data-testid="sidebar-bots-end"
      className="pointer-events-none mb-2 h-px rounded-b-lg bg-sidebar-control-surface"
    />
  );
}

export function BotsHeader(props: {
  readonly section: ReturnType<typeof useBotsSection>;
  readonly onOpenThread: (threadRef: ScopedThreadRef) => void;
}) {
  const { section } = props;
  const gt = useGT();
  const label = gt("Bots", { $context: "sidebar section" });
  const showAllLabel = section.showAll
    ? gt("Hide quiet bots", { $context: "sidebar bots section" })
    : gt("Show all bots", { $context: "sidebar bots section" });
  const dock = section.expanded ? [] : section.needsYou;
  return (
    <SortableSidebarMarker
      marker="bots-header"
      data-testid="sidebar-bots-header"
      className="relative -mb-px flex items-center rounded-t-lg bg-sidebar-control-surface px-0.5 pt-0.5 pb-px"
    >
      <CollapsibleSectionHeader
        data-sidebar-row="shelf:bots"
        data-testid="sidebar-bots-shelf-toggle"
        onClick={section.toggle}
        expanded={section.expanded}
        accessory={
          <span className="inline-flex items-center gap-1.5 font-normal tabular-nums">
            {section.working ? <Spinner size="xs" /> : null}
            {section.expanded ? section.needsYouCount : null}
          </span>
        }
      >
        {label}
      </CollapsibleSectionHeader>
      {dock.length > 0 ? (
        // Siblings of the toggle, not inside it; the hidden label lines the chips up after "Bots".
        <div className="pointer-events-none absolute inset-x-0.5 top-0.5 bottom-px flex items-center gap-1 px-2 text-xs font-medium">
          <span aria-hidden className="invisible me-1">
            {label}
          </span>
          {dock.slice(0, DOCK_LIMIT).map((thread) => (
            <BotDockChip key={thread.id} thread={thread} onOpenThread={props.onOpenThread} />
          ))}
          {dock.length > DOCK_LIMIT ? (
            <span className="text-sidebar-muted-foreground tabular-nums">
              +{dock.length - DOCK_LIMIT}
            </span>
          ) : null}
        </div>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={showAllLabel}
              aria-pressed={section.showAll}
              onClick={section.toggleShowAll}
              className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
            />
          }
        >
          {section.showAll ? <EyeOffIcon className="size-3" /> : <EyeIcon className="size-3" />}
        </TooltipTrigger>
        <TooltipPopup side="top">{showAllLabel}</TooltipPopup>
      </Tooltip>
    </SortableSidebarMarker>
  );
}

function BotDockChip(props: {
  readonly thread: BotThread;
  readonly onOpenThread: (threadRef: ScopedThreadRef) => void;
}) {
  const { thread } = props;
  const bot = useForkBot(thread.environmentId, thread.botId);
  const notice = botNotice(botRowState(thread), thread) ?? "done";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={thread.title}
            onClick={() => props.onOpenThread(scopeThreadRef(thread.environmentId, thread.id))}
            className="pointer-events-auto relative inline-flex size-5.5 shrink-0 cursor-pointer items-center justify-center rounded-md bg-card ring-1 ring-inset ring-sidebar-border/70 hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          />
        }
      >
        <ForkBotIcon bot={bot} className="size-3" />
        <span
          aria-hidden
          className={cn(
            "absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-sidebar-control-surface",
            NOTICE_DOT_CLASS[notice],
          )}
        />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{thread.title}</TooltipPopup>
    </Tooltip>
  );
}

// All lucide icons load as one chunk, only once a bot names an icon.
const LucideBotIcon = lazy(() =>
  import("../lib/lucideIconByName").then(({ lucideIconByName }) => ({
    default: function LucideBotIcon(props: { name: string; className: string }) {
      return createElement(lucideIconByName(props.name) ?? BotIcon, { className: props.className });
    },
  })),
);

export function ForkBotIcon(props: {
  readonly bot: Pick<ForkBot, "icon" | "color"> | null;
  readonly className?: string;
}) {
  const className = cn("size-3.5 shrink-0", props.className);
  const icon = props.bot?.icon;
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0", props.bot?.color === undefined && "text-icon-muted")}
      style={props.bot?.color === undefined ? undefined : { color: props.bot.color }}
    >
      {icon === undefined ? (
        <BotIcon className={className} />
      ) : (
        <Suspense fallback={<BotIcon className={className} />}>
          <LucideBotIcon name={icon} className={className} />
        </Suspense>
      )}
    </span>
  );
}

function SidebarBotIcon(props: {
  readonly environmentId: EnvironmentId;
  readonly botId: string | null;
}) {
  return <ForkBotIcon bot={useForkBot(props.environmentId, props.botId)} />;
}

/** The one status a bot row shows: a spinner while it runs, a dot in its color while it needs you. */
const NOTICE_DOT_CLASS = {
  asking: "bg-warning",
  failed: "bg-error",
  done: "bg-success",
} satisfies Record<BotNotice, string>;

function SidebarBotStatus(props: { readonly notice: Exclude<BotNotice, "asking"> | null }) {
  const gt = useGT();
  if (props.notice === null) return <Spinner size="xs" tone="muted" />;
  return (
    <span className={cn("size-1.5 shrink-0 rounded-full", NOTICE_DOT_CLASS[props.notice])}>
      <span className="sr-only">
        {props.notice === "failed"
          ? gt("Failed, needs you", { $context: "bot row status" })
          : gt("Needs you", { $context: "bot row status" })}
      </span>
    </span>
  );
}

function SidebarBotLastRun(props: { readonly timestamp: string | null }) {
  if (props.timestamp === null) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <HistoryIcon aria-hidden className="size-3 shrink-0 stroke-muted-foreground" />
      <div className="min-w-0 truncate text-foreground/75">
        <T>
          Last run <RelativeTimeLabel timestamp={props.timestamp} />
        </T>
      </div>
    </div>
  );
}

function BotGroupChevron(props: { readonly open: boolean }) {
  return (
    <ChevronRightIcon
      aria-hidden
      className={cn(
        "size-3 shrink-0 text-sidebar-muted-foreground transition-transform",
        props.open && "rotate-90",
      )}
    />
  );
}

/** A collapsed group's dots for each waiting member and the sum of their counts. */
function BotGroupSummary(props: { readonly group: BotGroupView<BotThread> }) {
  const { group } = props;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-sidebar-muted-foreground tabular-nums">
      {group.working ? <Spinner size="xs" tone="muted" /> : null}
      {group.notices.length > 0 ? (
        <span aria-hidden className="inline-flex items-center gap-0.5">
          {group.notices.slice(0, DOCK_LIMIT).map((notice, index) => (
            <span
              // oxlint-disable-next-line react/no-array-index-key -- dots carry no identity of their own
              key={index}
              className={cn("size-1.5 rounded-full", NOTICE_DOT_CLASS[notice])}
            />
          ))}
        </span>
      ) : null}
      {group.count > 0 ? group.count : null}
    </span>
  );
}

/** The row of a group with no lead bot; it only expands and collapses. */
export function BotGroupHeader(props: {
  readonly marker: SidebarListMarker;
  readonly group: BotGroupView<BotThread>;
  readonly onToggle: (name: string) => void;
}) {
  const { group } = props;
  const bot = useForkBot(group.iconThread.environmentId, group.iconThread.botId);
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid="sidebar-bot-group"
      className="-mb-px bg-sidebar-control-surface px-0.5 pb-px"
    >
      <button
        type="button"
        aria-expanded={group.open}
        onClick={() => props.onToggle(group.name)}
        className={cn(
          "flex h-7 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-start text-sidebar-foreground hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          !group.open && group.notices.length === 0 && "opacity-55",
        )}
      >
        <span className="inline-flex shrink-0 items-center gap-1">
          <BotGroupChevron open={group.open} />
          <ForkBotIcon bot={bot} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
        {group.open ? null : <BotGroupSummary group={group} />}
      </button>
    </SortableSidebarMarker>
  );
}

/** What a bot row draws beyond an ordinary row: its icon, its status slot, and its last run on hover. */
export function sidebarBotRow(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "botId" | "latestRun">,
  row: BotSectionRow<BotThread> | undefined,
  onToggleGroup: (name: string) => void,
) {
  const botState = row?.state ?? "quiet";
  const notice = botNotice(botState, thread);
  const lastRun = thread.latestRun?.completedAt ?? thread.latestRun?.startedAt ?? null;
  const group = row?.group;
  const icon = <SidebarBotIcon environmentId={thread.environmentId} botId={thread.botId} />;
  return {
    icon:
      group === undefined ? (
        row?.gutter ? (
          <span className="inline-flex shrink-0 items-center gap-1">
            <span aria-hidden className="size-3 shrink-0" />
            {icon}
          </span>
        ) : (
          icon
        )
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={group.name}
            aria-expanded={group.open}
            onClick={(event) => {
              event.stopPropagation();
              onToggleGroup(group.name);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className="-m-1 inline-flex cursor-pointer rounded-sm p-1 hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <BotGroupChevron open={group.open} />
          </button>
          {icon}
        </span>
      ),
    label:
      group === undefined ? undefined : (
        <span className="min-w-0 flex-1 truncate text-start text-sm font-medium text-foreground">
          {group.name}
        </span>
      ),
    inGroup: row?.inGroup ?? false,
    dimmed: row?.dimmed ?? !botWantsYou(botState),
    urgent: botState === "asking",
    // An asking bot shows the row's own "Awaiting Input" or "Pending Approval" status instead.
    status:
      group !== undefined && !group.open ? (
        <BotGroupSummary group={group} />
      ) : botState === "working" ? (
        <SidebarBotStatus notice={null} />
      ) : notice === "done" || notice === "failed" ? (
        <SidebarBotStatus notice={notice} />
      ) : null,
    tooltipLine: <SidebarBotLastRun timestamp={lastRun} />,
  };
}
