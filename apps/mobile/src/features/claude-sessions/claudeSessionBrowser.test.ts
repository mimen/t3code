import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ClaudeSessionCatalogEntry,
  type ClaudeSessionCatalogueSourceStatus,
  type OrchestrationExternalSessionSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildClaudeSessionCatalogueQuery,
  claudeSessionCatalogueTargetKey,
  claudeSessionCatalogEntryKey,
  externalClaudeSessionRevisionKey,
  isClaudeSessionEnvironmentAvailable,
  mergeClaudeSessionPages,
  presentClaudeSessionAttachment,
  presentClaudeSessionSourceStatus,
  presentExternalClaudeSession,
} from "./claudeSessionBrowser";

const SOURCE_STATUS: ClaudeSessionCatalogueSourceStatus = {
  generation: 3,
  phase: "idle",
  freshness: "fresh",
  indexedAt: "2026-07-22T10:00:00.000Z",
  refreshedAt: "2026-07-22T10:00:00.000Z",
  ageMs: 100,
  staleAfterMs: 30_000,
  rowCount: 2,
  lastError: null,
  lastRefresh: {
    scanned: 2,
    parsed: 2,
    skipped: 0,
    removed: 0,
  },
};

function makeSession(input: {
  readonly id: string;
  readonly title: string;
  readonly attachmentState?: "attached" | "synced" | "failed" | "desynced";
}): ClaudeSessionCatalogEntry {
  return {
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    localSourceHost: "macbook.local",
    nativeSessionId: input.id,
    sourceCwd: `/repo/${input.id}`,
    projectRoot: `/repo/${input.id}`,
    projectName: input.id,
    title: input.title,
    titleSource: "native",
    branch: "main",
    firstActivityAt: "2026-07-22T09:00:00.000Z",
    latestActivityAt: "2026-07-22T10:00:00.000Z",
    messageCount: 4,
    observedSize: 1_024,
    observedMtimeMs: 100,
    ...(input.attachmentState === undefined
      ? {}
      : {
          attachment: {
            sourceId: `source:${input.id}`,
            threadId: ThreadId.make(`thread:${input.id}`),
            projectId: ProjectId.make(`project:${input.id}`),
            state: input.attachmentState,
            lastSyncedAt: null,
            diagnostic: input.attachmentState === "failed" ? "JSONL read failed" : null,
            runtimeStatus: "running" as const,
            runtimeLastSeenAt: "2026-07-22T10:00:00.000Z",
          },
        }),
  };
}

describe("Claude session browser model", () => {
  it("builds trimmed, paged live catalogue queries", () => {
    expect(
      buildClaudeSessionCatalogueQuery({
        filters: {
          activityWindow: "7d",
          searchQuery: "  payment refactor  ",
          sort: "title",
        },
        freshness: "require-fresh",
        cursor: "page:2",
      }),
    ).toEqual({
      activityWindow: "7d",
      sort: "title",
      limit: 30,
      freshness: "require-fresh",
      query: "payment refactor",
      cursor: "page:2",
    });

    expect(
      buildClaudeSessionCatalogueQuery({
        filters: {
          activityWindow: "all",
          searchQuery: "   ",
          sort: "nativeActivity",
        },
        freshness: "allow-stale",
      }),
    ).not.toHaveProperty("query");
  });

  it("scopes rendered catalogue data to the active environment and filters", () => {
    const filters = {
      activityWindow: "30d" as const,
      searchQuery: "  checkout flow  ",
      sort: "nativeActivity" as const,
    };
    const firstEnvironmentKey = claudeSessionCatalogueTargetKey(
      EnvironmentId.make("environment-a"),
      filters,
    );

    expect(firstEnvironmentKey).toBe('["environment-a","30d","checkout flow","nativeActivity"]');
    expect(claudeSessionCatalogueTargetKey(EnvironmentId.make("environment-b"), filters)).not.toBe(
      firstEnvironmentKey,
    );
    expect(
      claudeSessionCatalogueTargetKey(EnvironmentId.make("environment-a"), {
        ...filters,
        searchQuery: "another query",
      }),
    ).not.toBe(firstEnvironmentKey);
  });

  it("merges pages by environment-owned native session identity", () => {
    const first = makeSession({ id: "one", title: "Original" });
    const updated = makeSession({ id: "one", title: "Updated" });
    const second = makeSession({ id: "two", title: "Second" });

    expect(claudeSessionCatalogEntryKey(first)).toBe("claudeAgent:macbook.local:one");
    expect(mergeClaudeSessionPages([first], [updated, second])).toEqual([updated, second]);
  });

  it("treats only connected environments as browseable", () => {
    expect(isClaudeSessionEnvironmentAvailable("connected")).toBe(true);
    expect(isClaudeSessionEnvironmentAvailable("connecting")).toBe(false);
    expect(isClaudeSessionEnvironmentAvailable("reconnecting")).toBe(false);
    expect(isClaudeSessionEnvironmentAvailable("offline")).toBe(false);
    expect(isClaudeSessionEnvironmentAvailable("error")).toBe(false);
    expect(isClaudeSessionEnvironmentAvailable("available")).toBe(false);
  });

  it("projects source freshness and server catalogue failures", () => {
    expect(
      presentClaudeSessionSourceStatus(SOURCE_STATUS, {
        kind: "ccs-daemon",
        protocolVersion: 1,
      }),
    ).toEqual({
      title: "Claude session index is current",
      detail: "2 sessions indexed",
      problem: null,
      tone: "success",
    });

    expect(
      presentClaudeSessionSourceStatus(
        {
          ...SOURCE_STATUS,
          phase: "error",
          freshness: "stale",
          lastError: {
            at: "2026-07-22T10:05:00.000Z",
            message: "Catalogue daemon unavailable",
          },
        },
        {
          kind: "builtin-degraded",
          reason: "ccs daemon unavailable",
          candidateLimit: 200,
        },
      ),
    ).toEqual({
      title: "Session index unavailable",
      detail: "2 sessions indexed",
      problem: "Catalogue daemon unavailable",
      tone: "error",
    });
  });

  it("projects attach/open actions and server diagnostics", () => {
    expect(presentClaudeSessionAttachment(makeSession({ id: "new", title: "New" }))).toEqual({
      actionLabel: "Attach and open",
      detail: null,
      label: "Not attached",
      problem: false,
    });

    expect(
      presentClaudeSessionAttachment(
        makeSession({ id: "failed", title: "Failed", attachmentState: "failed" }),
      ),
    ).toEqual({
      actionLabel: "Open thread",
      detail: "JSONL read failed",
      label: "Attached · Sync failed",
      problem: true,
    });
  });

  it("keeps attached-thread sync feedback server-backed", () => {
    const session: OrchestrationExternalSessionSummary = {
      sourceId: "source:one",
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      nativeSessionId: "native:one",
      sourcePath: "/Users/test/.claude/projects/repo/one.jsonl",
      sourceCwd: "/repo/one",
      state: "desynced",
      lastSyncedAt: "2026-07-22T10:00:00.000Z",
      diagnostic: "The source prefix no longer matches the committed checkpoint.",
      updatedAt: "2026-07-22T10:05:00.000Z",
    };

    expect(
      externalClaudeSessionRevisionKey({
        ...session,
        updatedAt: "2026-07-22T10:06:00.000Z",
      }),
    ).not.toBe(externalClaudeSessionRevisionKey(session));
    expect(
      externalClaudeSessionRevisionKey({
        ...session,
        lastSyncedAt: "2026-07-22T10:06:00.000Z",
      }),
    ).not.toBe(externalClaudeSessionRevisionKey(session));

    expect(presentExternalClaudeSession(session)).toEqual({
      title: "Claude session source changed",
      detail: "The source prefix no longer matches the committed checkpoint.",
      problem: true,
    });
  });
});
