import type { OrchestrationExternalSessionSummary } from "@t3tools/contracts";
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "../ui/button";

interface ExternalClaudeSessionBannerProps {
  readonly session: OrchestrationExternalSessionSummary;
  readonly isSyncing: boolean;
  readonly onSync: () => void;
}

function syncLabel(session: OrchestrationExternalSessionSummary): string {
  switch (session.state) {
    case "attached":
      return "History not synchronized yet";
    case "synced":
      return session.lastSyncedAt === null
        ? "Claude Code history synchronized"
        : `Claude Code history synchronized ${new Date(session.lastSyncedAt).toLocaleString()}`;
    case "failed":
      return "Claude Code history synchronization failed";
    case "desynced":
      return "Claude Code source needs validation";
  }
}

export function ExternalClaudeSessionBanner({
  session,
  isSyncing,
  onSync,
}: ExternalClaudeSessionBannerProps) {
  const hasProblem = session.state === "failed" || session.state === "desynced";

  return (
    <div
      className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-xs ${
        hasProblem
          ? "border-warning/30 bg-warning/8 text-warning-foreground"
          : "border-border/70 bg-muted/35 text-muted-foreground"
      }`}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {hasProblem ? <TriangleAlertIcon className="size-3.5 shrink-0" /> : null}
          <span className="shrink-0 font-medium">Continuing native Claude session</span>
          <span className="truncate">· {syncLabel(session)}</span>
          <span
            className="hidden shrink-0 font-mono text-[10px] text-current/65 md:inline"
            title={session.nativeSessionId}
          >
            · {session.nativeSessionId.slice(0, 8)}
          </span>
          <span className="hidden truncate lg:inline">· {session.sourceCwd}</span>
        </div>
        {hasProblem && session.diagnostic ? (
          <div className="truncate pl-5 text-[10px] text-current/80" title={session.diagnostic}>
            {session.diagnostic}
          </div>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 gap-1.5 px-2 text-xs"
        disabled={isSyncing}
        onClick={onSync}
      >
        <RefreshCwIcon className={`size-3.5 ${isSyncing ? "animate-spin" : ""}`} />
        {isSyncing ? "Syncing" : "Sync now"}
      </Button>
    </div>
  );
}
