import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ForkBot } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import { BotIcon, EyeIcon, EyeOffIcon, HistoryIcon } from "lucide-react";
import { createElement, lazy, Suspense, useState } from "react";

import { useLocalStorage } from "../hooks/useLocalStorage";
import { cn } from "../lib/utils";
import { useForkBot, useForkBotsPrefetch } from "../state/forkBots";
import { type BotRowState, resolveBotsSection } from "./Sidebar.forkBots.logic";
import { RelativeTimeLabel } from "./sidebar/SidebarThreadRow";
import { SortableSidebarMarker } from "./sidebar/SidebarListMarkers";
import { CollapsibleSectionHeader } from "./ui/collapsible-section-header";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const BOTS_EXPANDED_KEY = "t3code:sidebar:bots-expanded";

export function useBotsSection(
  bots: readonly EnvironmentThreadShell[],
  routeThreadKey: string | null,
) {
  const [expanded, setExpanded] = useLocalStorage(BOTS_EXPANDED_KEY, true, Schema.Boolean);
  const [showAll, setShowAll] = useState(false);
  useForkBotsPrefetch();
  const section = resolveBotsSection(bots, { expanded, showAll, routeThreadKey });
  return {
    ...section,
    threads: bots,
    expanded,
    showAll,
    rowStates: new Map(
      section.rows.map(({ thread, state }) => [
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        state,
      ]),
    ),
    toggle: () => setExpanded((value) => !value),
    toggleShowAll: () => setShowAll((value) => !value),
  };
}

export function BotsEnd() {
  return (
    <SortableSidebarMarker
      marker="bots-end"
      data-testid="sidebar-bots-end"
      className="pointer-events-none mx-2.5 flex h-3 items-center"
    >
      <div aria-hidden className="h-px flex-1 bg-sidebar-border" />
    </SortableSidebarMarker>
  );
}

export function BotsHeader(props: { readonly section: ReturnType<typeof useBotsSection> }) {
  const { section } = props;
  const gt = useGT();
  const showAllLabel = section.showAll
    ? gt("Hide quiet bots", { $context: "sidebar bots section" })
    : gt("Show all bots", { $context: "sidebar bots section" });
  return (
    <SortableSidebarMarker
      marker="bots-header"
      data-testid="sidebar-bots-header"
      className="relative mx-0.5 flex h-8 items-center"
    >
      <CollapsibleSectionHeader
        data-sidebar-row="shelf:bots"
        data-testid="sidebar-bots-shelf-toggle"
        onClick={section.toggle}
        expanded={section.expanded}
        accessory={
          <span className="inline-flex items-center gap-1.5 font-normal tabular-nums">
            {section.working ? <Spinner size="xs" /> : null}
            {section.needsYouCount}
          </span>
        }
      >
        {gt("Bots", { $context: "sidebar section" })}
      </CollapsibleSectionHeader>
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
function SidebarBotStatus(props: {
  readonly environmentId: EnvironmentId;
  readonly botId: string | null;
  readonly state: Exclude<BotRowState, "quiet">;
}) {
  const gt = useGT();
  const color = useForkBot(props.environmentId, props.botId)?.color;
  if (props.state === "working") return <Spinner size="xs" tone="muted" />;
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", color === undefined && "bg-primary")}
      style={color === undefined ? undefined : { backgroundColor: color }}
    >
      <span className="sr-only">{gt("Needs you", { $context: "bot row status" })}</span>
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

/** What a bot row draws beyond an ordinary row: its icon, its status slot, and its last run on hover. */
export function sidebarBotRow(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "botId" | "latestRun">,
  state: BotRowState | undefined,
) {
  const botState = state ?? "quiet";
  const lastRun = thread.latestRun?.completedAt ?? thread.latestRun?.startedAt ?? null;
  return {
    icon: <SidebarBotIcon environmentId={thread.environmentId} botId={thread.botId} />,
    dimmed: botState !== "needs-you",
    status:
      botState === "quiet" ? null : (
        <SidebarBotStatus
          environmentId={thread.environmentId}
          botId={thread.botId}
          state={botState}
        />
      ),
    tooltipLine: <SidebarBotLastRun timestamp={lastRun} />,
  };
}
