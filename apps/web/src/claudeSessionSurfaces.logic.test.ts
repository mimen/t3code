import {
  ProviderInstanceId,
  ProjectId,
  ThreadId,
  type ClaudeSessionCatalogEntry,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ALL_CLAUDE_SESSION_ENVIRONMENTS,
  buildClaudeSessionCatalogueQuery,
  buildClaudeSessionProjectScope,
  buildExactClaudeSessionQueries,
  buildGlobalClaudeSessionQueries,
  buildProjectClaudeSessionQueries,
  mergeFederatedClaudeSessions,
  presentClaudeSessionAttachment,
  splitClaudeSessionsForProjectScope,
  splitProjectClaudeSessions,
  type FederatedClaudeSession,
} from "./claudeSessionSurfaces.logic";

function makeSession(
  id: string,
  input: Partial<ClaudeSessionCatalogEntry> = {},
): ClaudeSessionCatalogEntry {
  return {
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    localSourceHost: "mini",
    nativeSessionId: id,
    sourceCwd: "/repo",
    projectRoot: "/repo",
    projectName: "repo",
    title: `Session ${id}`,
    titleSource: "native",
    branch: null,
    firstActivityAt: "2026-07-20T10:00:00.000Z",
    latestActivityAt: "2026-07-20T11:00:00.000Z",
    messageCount: 4,
    observedSize: 100,
    observedMtimeMs: 200,
    ...input,
  };
}

function federated(
  environmentId: string,
  environmentLabel: string,
  session: ClaudeSessionCatalogEntry,
): FederatedClaudeSession {
  return {
    environmentId: environmentId as FederatedClaudeSession["environmentId"],
    environmentLabel,
    session,
  };
}

describe("buildClaudeSessionCatalogueQuery", () => {
  it("trims search and keeps filtering, sorting, paging, and freshness server-driven", () => {
    expect(
      buildClaudeSessionCatalogueQuery(
        {
          query: "  session import  ",
          cwd: "/repo/worktree",
          projectRoot: "/repo",
          activityWindow: "7d",
          sort: "title",
          limit: 20,
          freshness: "require-fresh",
        },
        "next-page",
      ),
    ).toEqual({
      query: "session import",
      cwd: "/repo/worktree",
      projectRoot: "/repo",
      activityWindow: "7d",
      sort: "title",
      limit: 20,
      cursor: "next-page",
      freshness: "require-fresh",
    });
  });
});

describe("federated catalogue queries", () => {
  it("queries every selected environment for the global browser", () => {
    const queries = buildGlobalClaudeSessionQueries({
      environmentIds: ["laptop", "mini"] as FederatedClaudeSession["environmentId"][],
      selection: ALL_CLAUDE_SESSION_ENVIRONMENTS,
      filters: {
        query: "resume",
        activityWindow: "30d",
        sort: "nativeActivity",
        limit: 6,
      },
    });

    expect([...queries.keys()]).toEqual(["laptop", "mini"]);
    expect(queries.get("mini" as FederatedClaudeSession["environmentId"])).toMatchObject({
      query: "resume",
      limit: 6,
    });
  });

  it("scopes project queries to each repository-owning environment", () => {
    const queries = buildProjectClaudeSessionQueries({
      scope: {
        title: "t3code",
        locations: [
          {
            environmentId: "laptop" as FederatedClaudeSession["environmentId"],
            projectId: "project-laptop",
            title: "t3code",
            workspaceRoot: "/Users/me/t3code",
            exactCwd: "/Users/me/t3code/.claude/worktrees/session-import",
            repositoryRoot: "/Users/me/t3code",
          },
          {
            environmentId: "mini" as FederatedClaudeSession["environmentId"],
            projectId: "project-mini",
            title: "t3code",
            workspaceRoot: "/srv/t3code",
            exactCwd: "/srv/t3code",
            repositoryRoot: "/srv/t3code",
          },
        ],
      },
      filters: {
        query: "",
        activityWindow: "all",
        sort: "nativeActivity",
      },
    });

    expect(queries.get("laptop" as FederatedClaudeSession["environmentId"])).toMatchObject({
      projectRoot: "/Users/me/t3code",
    });
    expect(queries.get("mini" as FederatedClaudeSession["environmentId"])).toMatchObject({
      projectRoot: "/srv/t3code",
    });
  });

  it("uses a dedicated exact-CWD query so sibling recency cannot starve the default group", () => {
    const environmentId = "laptop" as FederatedClaudeSession["environmentId"];
    const queries = buildExactClaudeSessionQueries({
      scope: {
        title: "t3code",
        locations: [
          {
            environmentId,
            projectId: "project-laptop",
            title: "t3code",
            workspaceRoot: "/Users/me/t3code",
            exactCwd: "/Users/me/t3code/.claude/worktrees/session-import",
            repositoryRoot: "/Users/me/t3code",
          },
        ],
      },
      filters: {
        query: "",
        activityWindow: "all",
        sort: "nativeActivity",
      },
    });

    expect(queries.get(environmentId)).toMatchObject({
      cwd: "/Users/me/t3code/.claude/worktrees/session-import",
    });
  });
});

describe("presentClaudeSessionAttachment", () => {
  it("distinguishes native-only, running, and unhealthy attachments", () => {
    expect(presentClaudeSessionAttachment(makeSession("native"))).toMatchObject({
      label: "Native only",
      actionLabel: "Attach & open",
      attached: false,
    });

    expect(
      presentClaudeSessionAttachment(
        makeSession("running", {
          attachment: {
            sourceId: "source-running",
            threadId: ThreadId.make("thread-running"),
            projectId: ProjectId.make("project-running"),
            state: "synced",
            lastSyncedAt: "2026-07-20T11:00:00.000Z",
            diagnostic: null,
            runtimeStatus: "running",
            runtimeLastSeenAt: "2026-07-20T11:00:00.000Z",
          },
        }),
      ),
    ).toMatchObject({
      label: "Running in T3",
      actionLabel: "Open T3 thread",
      tone: "info",
    });

    expect(
      presentClaudeSessionAttachment(
        makeSession("desynced", {
          attachment: {
            sourceId: "source-desynced",
            threadId: ThreadId.make("thread-desynced"),
            projectId: ProjectId.make("project-desynced"),
            state: "desynced",
            lastSyncedAt: null,
            diagnostic: "The source was rewritten.",
            runtimeStatus: "stopped",
            runtimeLastSeenAt: null,
          },
        }),
      ),
    ).toMatchObject({
      label: "Source needs validation",
      detail: "The source was rewritten.",
      needsAttention: true,
      actionLabel: "Open T3 thread",
    });
  });
});

describe("federated session grouping", () => {
  it("does not merge the same native UUID from different environments", () => {
    const shared = makeSession("same-id");
    const merged = mergeFederatedClaudeSessions(
      [
        {
          environmentId: "laptop" as FederatedClaudeSession["environmentId"],
          environmentLabel: "Laptop",
          sessions: [shared],
        },
        {
          environmentId: "mini" as FederatedClaudeSession["environmentId"],
          environmentLabel: "Mac mini",
          sessions: [shared],
        },
      ],
      "nativeActivity",
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.environmentLabel)).toEqual(["Laptop", "Mac mini"]);
  });

  it("keeps exact CWD matches separate from explicit sibling worktrees", () => {
    const sessions = [
      federated(
        "mini",
        "Mac mini",
        makeSession("exact", { sourceCwd: "/repo/worktree", projectRoot: "/repo" }),
      ),
      federated(
        "mini",
        "Mac mini",
        makeSession("sibling", { sourceCwd: "/repo/other", projectRoot: "/repo" }),
      ),
      federated(
        "mini",
        "Mac mini",
        makeSession("other", { sourceCwd: "/elsewhere", projectRoot: "/elsewhere" }),
      ),
    ];

    const grouped = splitProjectClaudeSessions({
      sessions,
      exactCwd: "/repo/worktree",
      repositoryRoot: "/repo",
    });

    expect(grouped.exact.map((entry) => entry.session.nativeSessionId)).toEqual(["exact"]);
    expect(grouped.siblingWorktrees.map((entry) => entry.session.nativeSessionId)).toEqual([
      "sibling",
    ]);
  });

  it("uses the owning environment's exact CWD while federating repository siblings", () => {
    const grouped = splitClaudeSessionsForProjectScope({
      sessions: [
        federated(
          "laptop",
          "Laptop",
          makeSession("active-worktree", {
            sourceCwd: "/repo/.claude/worktrees/session-import",
            projectRoot: "/repo",
          }),
        ),
        federated(
          "laptop",
          "Laptop",
          makeSession("laptop-sibling", { sourceCwd: "/repo/other", projectRoot: "/repo" }),
        ),
        federated(
          "mini",
          "Mac mini",
          makeSession("mini-exact", { sourceCwd: "/srv/repo", projectRoot: "/srv/repo" }),
        ),
      ],
      scope: {
        title: "repo",
        locations: [
          {
            environmentId: "laptop" as FederatedClaudeSession["environmentId"],
            projectId: "project-laptop",
            title: "repo",
            workspaceRoot: "/repo",
            exactCwd: "/repo/.claude/worktrees/session-import",
            repositoryRoot: "/repo",
          },
          {
            environmentId: "mini" as FederatedClaudeSession["environmentId"],
            projectId: "project-mini",
            title: "repo",
            workspaceRoot: "/srv/repo",
            exactCwd: "/srv/repo",
            repositoryRoot: "/srv/repo",
          },
        ],
      },
    });

    expect(grouped.exact.map((entry) => entry.session.nativeSessionId)).toEqual([
      "active-worktree",
      "mini-exact",
    ]);
    expect(grouped.siblingWorktrees.map((entry) => entry.session.nativeSessionId)).toEqual([
      "laptop-sibling",
    ]);
  });
});

describe("buildClaudeSessionProjectScope", () => {
  it("includes repository siblings across environments without unrelated projects", () => {
    const laptop = {
      environmentId: "laptop" as FederatedClaudeSession["environmentId"],
      id: "project-laptop",
      title: "t3code",
      workspaceRoot: "/Users/me/t3code",
      repositoryIdentity: {
        canonicalKey: "github.com/t3tools/t3code",
        rootPath: "/Users/me/t3code",
      },
    };
    const mini = {
      environmentId: "mini" as FederatedClaudeSession["environmentId"],
      id: "project-mini",
      title: "t3code",
      workspaceRoot: "/srv/t3code-worktree",
      repositoryIdentity: { canonicalKey: "github.com/t3tools/t3code", rootPath: "/srv/t3code" },
    };
    const unrelated = {
      environmentId: "mini" as FederatedClaudeSession["environmentId"],
      id: "project-other",
      title: "other",
      workspaceRoot: "/srv/other",
      repositoryIdentity: { canonicalKey: "github.com/example/other", rootPath: "/srv/other" },
    };

    expect(
      buildClaudeSessionProjectScope({
        activeProject: laptop,
        projects: [laptop, mini, unrelated],
      }),
    ).toEqual({
      title: "t3code",
      locations: [
        {
          environmentId: "laptop",
          projectId: "project-laptop",
          title: "t3code",
          workspaceRoot: "/Users/me/t3code",
          exactCwd: "/Users/me/t3code",
          repositoryRoot: "/Users/me/t3code",
        },
        {
          environmentId: "mini",
          projectId: "project-mini",
          title: "t3code",
          workspaceRoot: "/srv/t3code-worktree",
          exactCwd: "/srv/t3code-worktree",
          repositoryRoot: "/srv/t3code",
        },
      ],
    });
  });

  it("uses the active thread worktree as the exact continuation CWD", () => {
    const activeProject = {
      environmentId: "laptop" as FederatedClaudeSession["environmentId"],
      id: "project-laptop",
      title: "t3code",
      workspaceRoot: "/Users/me/t3code",
      repositoryIdentity: {
        canonicalKey: "github.com/t3tools/t3code",
        rootPath: "/Users/me/t3code",
      },
    };

    const duplicateWorkspaceProject = {
      ...activeProject,
      id: "project-duplicate",
      title: "duplicate",
      workspaceRoot: "/Users/me/t3code-clone",
      repositoryIdentity: {
        canonicalKey: "github.com/t3tools/t3code",
        rootPath: "/Users/me/t3code-clone",
      },
    };
    const scope = buildClaudeSessionProjectScope({
      activeProject,
      projects: [duplicateWorkspaceProject, activeProject],
      activeCwd: "/Users/me/t3code/.claude/worktrees/session-import",
    });

    expect(scope?.locations).toHaveLength(1);
    expect(scope?.locations[0]?.projectId).toBe("project-laptop");
    expect(scope?.locations[0]?.exactCwd).toBe("/Users/me/t3code/.claude/worktrees/session-import");
  });
});
