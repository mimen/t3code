import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ForkBot } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { BotIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { createElement, lazy, Suspense, useState } from "react";

import { useLocalStorage } from "../hooks/useLocalStorage";
import { cn } from "../lib/utils";
import { useForkBot, useForkBotsPrefetch } from "../state/forkBots";
import { resolveBotsSection } from "./Sidebar.forkBots.logic";
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
    dimmedKeys: new Set(
      section.rows.flatMap(({ thread, dimmed }) =>
        dimmed ? [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))] : [],
      ),
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

export function SidebarBotIcon(props: {
  readonly environmentId: EnvironmentId;
  readonly botId: string | null;
}) {
  return <ForkBotIcon bot={useForkBot(props.environmentId, props.botId)} />;
}
