import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { useRightPanelStore } from "~/rightPanelStore";
import { useThreadShell } from "../../state/entities";
import { useForkBot } from "../../state/forkBots";
import { ForkBotIcon } from "../Sidebar.forkBots";
import {
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";

export function BotBreadcrumb(props: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const botId = useThreadShell(props.threadRef)?.botId ?? null;
  const bot = useForkBot(props.threadRef.environmentId, botId);
  if (botId === null) return null;
  return (
    <>
      <WorkspaceBreadcrumbItem>
        {bot === null ? (
          <WorkspaceBreadcrumbText>{botId}</WorkspaceBreadcrumbText>
        ) : (
          <button
            type="button"
            aria-label={gt("Open bot file: {bot}", { bot: bot.name })}
            onClick={() => useRightPanelStore.getState().openFile(props.threadRef, bot.path)}
            className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ForkBotIcon bot={bot} />
            <WorkspaceBreadcrumbText>{bot.name}</WorkspaceBreadcrumbText>
          </button>
        )}
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator>
        <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
      </WorkspaceBreadcrumbSeparator>
    </>
  );
}
