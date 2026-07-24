import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type {
  ClaudeSessionCatalogEntry,
  ClaudeSessionCatalogueActivityWindow,
  ClaudeSessionCatalogueFreshnessMode,
  ClaudeSessionCatalogueMode,
  ClaudeSessionCatalogueQuery,
  ClaudeSessionCatalogueSort,
  ClaudeSessionCatalogueSourceStatus,
  EnvironmentId,
  OrchestrationExternalSessionSummary,
} from "@t3tools/contracts";

export const CLAUDE_SESSION_BROWSER_PAGE_SIZE = 30;

export const CLAUDE_SESSION_ACTIVITY_WINDOWS: ReadonlyArray<{
  readonly label: string;
  readonly value: ClaudeSessionCatalogueActivityWindow;
}> = [
  { label: "Today", value: "today" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "All time", value: "all" },
];

export const CLAUDE_SESSION_SORT_OPTIONS: ReadonlyArray<{
  readonly label: string;
  readonly value: ClaudeSessionCatalogueSort;
}> = [
  { label: "Recent activity", value: "nativeActivity" },
  { label: "Project path", value: "cwd" },
  { label: "Title", value: "title" },
];

export interface ClaudeSessionBrowserFilters {
  readonly activityWindow: ClaudeSessionCatalogueActivityWindow;
  readonly searchQuery: string;
  readonly sort: ClaudeSessionCatalogueSort;
}

export interface ClaudeSessionSourcePresentation {
  readonly detail: string;
  readonly problem: string | null;
  readonly title: string;
  readonly tone: "neutral" | "success" | "warning" | "error";
}

export interface ClaudeSessionAttachmentPresentation {
  readonly actionLabel: "Attach and open" | "Open thread";
  readonly detail: string | null;
  readonly label: string;
  readonly problem: boolean;
}

export interface ExternalClaudeSessionPresentation {
  readonly detail: string;
  readonly problem: boolean;
  readonly title: string;
}

export function buildClaudeSessionCatalogueQuery(input: {
  readonly cursor?: string;
  readonly filters: ClaudeSessionBrowserFilters;
  readonly freshness: ClaudeSessionCatalogueFreshnessMode;
}): ClaudeSessionCatalogueQuery {
  const query = input.filters.searchQuery.trim();
  return {
    activityWindow: input.filters.activityWindow,
    sort: input.filters.sort,
    limit: CLAUDE_SESSION_BROWSER_PAGE_SIZE,
    freshness: input.freshness,
    ...(query.length > 0 ? { query } : {}),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  };
}

export function claudeSessionCatalogueTargetKey(
  environmentId: EnvironmentId,
  filters: ClaudeSessionBrowserFilters,
): string {
  return JSON.stringify([
    environmentId,
    filters.activityWindow,
    filters.searchQuery.trim(),
    filters.sort,
  ]);
}

export function claudeSessionCatalogEntryKey(session: ClaudeSessionCatalogEntry): string {
  return [session.providerInstanceId, session.localSourceHost, session.nativeSessionId].join(":");
}

export function mergeClaudeSessionPages(
  existing: ReadonlyArray<ClaudeSessionCatalogEntry>,
  incoming: ReadonlyArray<ClaudeSessionCatalogEntry>,
): ReadonlyArray<ClaudeSessionCatalogEntry> {
  const sessionsByKey = new Map<string, ClaudeSessionCatalogEntry>();
  for (const session of existing) {
    sessionsByKey.set(claudeSessionCatalogEntryKey(session), session);
  }
  for (const session of incoming) {
    sessionsByKey.set(claudeSessionCatalogEntryKey(session), session);
  }
  return [...sessionsByKey.values()];
}

export function isClaudeSessionEnvironmentAvailable(phase: EnvironmentConnectionPhase): boolean {
  return phase === "connected";
}

function modeProblem(mode: ClaudeSessionCatalogueMode): string | null {
  return mode.kind === "builtin-degraded" ? `Limited catalogue mode: ${mode.reason}` : null;
}

export function presentClaudeSessionSourceStatus(
  status: ClaudeSessionCatalogueSourceStatus,
  mode: ClaudeSessionCatalogueMode,
): ClaudeSessionSourcePresentation {
  const degradedProblem = modeProblem(mode);
  const sourceProblem = status.lastError?.message ?? degradedProblem;
  const detail = `${status.rowCount} session${status.rowCount === 1 ? "" : "s"} indexed`;

  if (status.phase === "error") {
    return {
      title: "Session index unavailable",
      detail,
      problem: sourceProblem ?? "The environment could not refresh its Claude session index.",
      tone: "error",
    };
  }
  if (status.phase === "refreshing") {
    return {
      title: "Refreshing Claude session index",
      detail,
      problem: degradedProblem,
      tone: degradedProblem === null ? "neutral" : "warning",
    };
  }
  if (status.freshness === "uninitialized") {
    return {
      title: "Claude session index is not ready",
      detail,
      problem: sourceProblem,
      tone: sourceProblem === null ? "neutral" : "warning",
    };
  }
  if (status.freshness === "stale") {
    return {
      title: "Claude session index may be stale",
      detail,
      problem: sourceProblem,
      tone: "warning",
    };
  }
  return {
    title: "Claude session index is current",
    detail,
    problem: sourceProblem,
    tone: sourceProblem === null ? "success" : "warning",
  };
}

export function presentClaudeSessionAttachment(
  session: ClaudeSessionCatalogEntry,
): ClaudeSessionAttachmentPresentation {
  const attachment = session.attachment;
  if (attachment === undefined) {
    return {
      actionLabel: "Attach and open",
      detail: null,
      label: "Not attached",
      problem: false,
    };
  }

  switch (attachment.state) {
    case "attached":
      return {
        actionLabel: "Open thread",
        detail: attachment.diagnostic,
        label: "Attached · Awaiting sync",
        problem: false,
      };
    case "synced":
      return {
        actionLabel: "Open thread",
        detail: attachment.diagnostic,
        label: "Attached · Synced",
        problem: false,
      };
    case "failed":
      return {
        actionLabel: "Open thread",
        detail: attachment.diagnostic,
        label: "Attached · Sync failed",
        problem: true,
      };
    case "desynced":
      return {
        actionLabel: "Open thread",
        detail: attachment.diagnostic,
        label: "Attached · Source changed",
        problem: true,
      };
  }
}

export function externalClaudeSessionRevisionKey(
  session: OrchestrationExternalSessionSummary | null,
): string | null {
  return session === null
    ? null
    : JSON.stringify([
        session.sourceId,
        session.state,
        session.diagnostic,
        session.lastSyncedAt,
        session.updatedAt,
      ]);
}

export function presentExternalClaudeSession(
  session: OrchestrationExternalSessionSummary,
): ExternalClaudeSessionPresentation {
  switch (session.state) {
    case "attached":
      return {
        title: "Claude history attached",
        detail: "Imported history has not synchronized yet.",
        problem: false,
      };
    case "synced":
      return {
        title: "Claude history synchronized",
        detail:
          session.lastSyncedAt === null
            ? "The attached Claude Code history is synchronized."
            : `Last synchronized ${new Date(session.lastSyncedAt).toLocaleString()}.`,
        problem: false,
      };
    case "failed":
      return {
        title: "Claude history sync failed",
        detail: session.diagnostic ?? "The server could not synchronize the attached source.",
        problem: true,
      };
    case "desynced":
      return {
        title: "Claude session source changed",
        detail:
          session.diagnostic ??
          "The server detected that the attached Claude history no longer matches its checkpoint.",
        problem: true,
      };
  }
}
