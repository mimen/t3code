import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type {
  ClaudeSessionCatalogEntry,
  ClaudeSessionCatalogueActivityWindow,
  ClaudeSessionCatalogueFreshnessMode,
  ClaudeSessionCatalogueQuery,
  ClaudeSessionCatalogueSort,
  EnvironmentId,
} from "@t3tools/contracts";

export const ALL_CLAUDE_SESSION_ENVIRONMENTS = "all-environments" as const;
export const CLAUDE_SESSION_PAGE_SIZE = 40;
export const CLAUDE_SESSION_SWITCHER_LIMIT = 6;

export type ClaudeSessionEnvironmentSelection =
  | EnvironmentId
  | typeof ALL_CLAUDE_SESSION_ENVIRONMENTS;

export function filterClaudeSessionEnvironments<
  T extends { readonly environmentId: EnvironmentId },
>(
  environments: ReadonlyArray<T>,
  remoteOnly: boolean,
  desktopLocalEnvironmentIds: ReadonlySet<EnvironmentId>,
): ReadonlyArray<T> {
  if (!remoteOnly) return environments;
  return environments.filter(
    (environment) => !desktopLocalEnvironmentIds.has(environment.environmentId),
  );
}

export interface FederatedClaudeSession {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly session: ClaudeSessionCatalogEntry;
}

export interface ClaudeSessionProjectLocation {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly exactCwd: string;
  readonly repositoryRoot: string;
}

export interface ClaudeSessionProjectScope {
  readonly title: string;
  readonly locations: ReadonlyArray<ClaudeSessionProjectLocation>;
}

export interface ClaudeSessionQueryFilters {
  readonly query: string;
  readonly activityWindow: ClaudeSessionCatalogueActivityWindow;
  readonly sort: ClaudeSessionCatalogueSort;
  readonly limit?: number;
  readonly cwd?: string;
  readonly projectRoot?: string;
  readonly freshness?: ClaudeSessionCatalogueFreshnessMode;
}

export interface ClaudeSessionAttachmentPresentation {
  readonly label: string;
  readonly detail: string | null;
  readonly tone: "neutral" | "info" | "success" | "warning" | "error";
  readonly actionLabel: "Attach & open" | "Open T3 thread";
  readonly attached: boolean;
  readonly needsAttention: boolean;
}

interface ProjectScopeCandidate {
  readonly environmentId: EnvironmentId;
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly repositoryIdentity?:
    | {
        readonly canonicalKey: string;
        readonly rootPath?: string;
      }
    | null
    | undefined;
}

export function buildClaudeSessionCatalogueQuery(
  filters: ClaudeSessionQueryFilters,
  cursor?: string,
): ClaudeSessionCatalogueQuery {
  const query = filters.query.trim();
  return {
    ...(query.length > 0 ? { query } : {}),
    ...(filters.cwd ? { cwd: filters.cwd } : {}),
    ...(filters.projectRoot ? { projectRoot: filters.projectRoot } : {}),
    activityWindow: filters.activityWindow,
    sort: filters.sort,
    limit: filters.limit ?? CLAUDE_SESSION_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
    freshness: filters.freshness ?? "allow-stale",
  };
}

export function buildGlobalClaudeSessionQueries(input: {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly selection: ClaudeSessionEnvironmentSelection;
  readonly filters: ClaudeSessionQueryFilters;
}): ReadonlyMap<EnvironmentId, ClaudeSessionCatalogueQuery> {
  const selectedEnvironmentIds =
    input.selection === ALL_CLAUDE_SESSION_ENVIRONMENTS
      ? input.environmentIds
      : input.environmentIds.filter((environmentId) => environmentId === input.selection);
  return new Map(
    selectedEnvironmentIds.map((environmentId) => [
      environmentId,
      buildClaudeSessionCatalogueQuery(input.filters),
    ]),
  );
}

export function buildProjectClaudeSessionQueries(input: {
  readonly scope: ClaudeSessionProjectScope | null;
  readonly filters: ClaudeSessionQueryFilters;
}): ReadonlyMap<EnvironmentId, ClaudeSessionCatalogueQuery> {
  const queries = new Map<EnvironmentId, ClaudeSessionCatalogueQuery>();
  for (const location of input.scope?.locations ?? []) {
    if (queries.has(location.environmentId)) {
      continue;
    }
    queries.set(
      location.environmentId,
      buildClaudeSessionCatalogueQuery({
        ...input.filters,
        projectRoot: location.repositoryRoot,
      }),
    );
  }
  return queries;
}

export function buildExactClaudeSessionQueries(input: {
  readonly scope: ClaudeSessionProjectScope | null;
  readonly filters: ClaudeSessionQueryFilters;
}): ReadonlyMap<EnvironmentId, ClaudeSessionCatalogueQuery> {
  const queries = new Map<EnvironmentId, ClaudeSessionCatalogueQuery>();
  for (const location of input.scope?.locations ?? []) {
    if (queries.has(location.environmentId)) {
      continue;
    }
    queries.set(
      location.environmentId,
      buildClaudeSessionCatalogueQuery({
        ...input.filters,
        cwd: location.exactCwd,
      }),
    );
  }
  return queries;
}

export function isClaudeSessionEnvironmentUnavailable(phase: EnvironmentConnectionPhase): boolean {
  return phase === "offline" || phase === "error";
}

export function claudeSessionEnvironmentAvailabilityLabel(
  phase: EnvironmentConnectionPhase,
): string {
  switch (phase) {
    case "available":
      return "Available";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "connected":
      return "Live";
    case "offline":
      return "Offline";
    case "error":
      return "Unavailable";
  }
}

export function presentClaudeSessionAttachment(
  session: ClaudeSessionCatalogEntry,
): ClaudeSessionAttachmentPresentation {
  const attachment = session.attachment;
  if (!attachment) {
    return {
      label: "Native only",
      detail: null,
      tone: "neutral",
      actionLabel: "Attach & open",
      attached: false,
      needsAttention: false,
    };
  }

  if (attachment.state === "failed") {
    return {
      label: "Sync failed",
      detail: attachment.diagnostic,
      tone: "error",
      actionLabel: "Open T3 thread",
      attached: true,
      needsAttention: true,
    };
  }

  if (attachment.state === "desynced") {
    return {
      label: "Source needs validation",
      detail: attachment.diagnostic,
      tone: "warning",
      actionLabel: "Open T3 thread",
      attached: true,
      needsAttention: true,
    };
  }

  if (attachment.runtimeStatus === "running") {
    return {
      label: "Running in T3",
      detail: attachment.diagnostic,
      tone: "info",
      actionLabel: "Open T3 thread",
      attached: true,
      needsAttention: false,
    };
  }

  if (attachment.runtimeStatus === "error") {
    return {
      label: "T3 runtime error",
      detail: attachment.diagnostic,
      tone: "error",
      actionLabel: "Open T3 thread",
      attached: true,
      needsAttention: true,
    };
  }

  if (attachment.state === "synced") {
    return {
      label: "Synced with T3",
      detail: attachment.diagnostic,
      tone: "success",
      actionLabel: "Open T3 thread",
      attached: true,
      needsAttention: false,
    };
  }

  return {
    label: "Attached to T3",
    detail: attachment.diagnostic,
    tone: "info",
    actionLabel: "Open T3 thread",
    attached: true,
    needsAttention: false,
  };
}

export function federatedClaudeSessionKey(session: FederatedClaudeSession): string {
  return [
    session.environmentId,
    session.session.providerInstanceId,
    session.session.localSourceHost,
    session.session.nativeSessionId,
  ].join(":");
}

export function mergeFederatedClaudeSessions(
  pages: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string;
    readonly sessions: ReadonlyArray<ClaudeSessionCatalogEntry>;
  }>,
  sort: ClaudeSessionCatalogueSort,
): FederatedClaudeSession[] {
  const bySource = new Map<string, FederatedClaudeSession>();
  for (const page of pages) {
    for (const session of page.sessions) {
      const scoped = {
        environmentId: page.environmentId,
        environmentLabel: page.environmentLabel,
        session,
      } satisfies FederatedClaudeSession;
      bySource.set(federatedClaudeSessionKey(scoped), scoped);
    }
  }

  return [...bySource.values()].toSorted((left, right) => {
    let comparison = 0;
    switch (sort) {
      case "nativeActivity":
        comparison = (right.session.latestActivityAt ?? "").localeCompare(
          left.session.latestActivityAt ?? "",
        );
        break;
      case "cwd":
        comparison = left.session.sourceCwd.localeCompare(right.session.sourceCwd);
        break;
      case "title":
        comparison = left.session.title.localeCompare(right.session.title);
        break;
    }
    return (
      comparison ||
      left.environmentLabel.localeCompare(right.environmentLabel) ||
      left.session.nativeSessionId.localeCompare(right.session.nativeSessionId)
    );
  });
}

export function groupClaudeSessionsByProject(
  sessions: ReadonlyArray<FederatedClaudeSession>,
): ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly sessions: ReadonlyArray<FederatedClaudeSession>;
}> {
  const groups = new Map<string, { label: string; sessions: Array<FederatedClaudeSession> }>();
  for (const session of sessions) {
    const key = `${session.environmentId}:${session.session.projectRoot}`;
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
      continue;
    }
    groups.set(key, {
      label: session.session.projectName,
      sessions: [session],
    });
  }
  return [...groups.entries()].map(([key, value]) => ({ key, ...value }));
}

export function splitProjectClaudeSessions(input: {
  readonly sessions: ReadonlyArray<FederatedClaudeSession>;
  readonly exactCwd: string;
  readonly repositoryRoot: string;
}): {
  readonly exact: ReadonlyArray<FederatedClaudeSession>;
  readonly siblingWorktrees: ReadonlyArray<FederatedClaudeSession>;
} {
  const exact: FederatedClaudeSession[] = [];
  const siblingWorktrees: FederatedClaudeSession[] = [];
  for (const session of input.sessions) {
    if (session.session.sourceCwd === input.exactCwd) {
      exact.push(session);
    } else if (session.session.projectRoot === input.repositoryRoot) {
      siblingWorktrees.push(session);
    }
  }
  return { exact, siblingWorktrees };
}

export function splitClaudeSessionsForProjectScope(input: {
  readonly sessions: ReadonlyArray<FederatedClaudeSession>;
  readonly scope: ClaudeSessionProjectScope | null;
}): {
  readonly exact: ReadonlyArray<FederatedClaudeSession>;
  readonly siblingWorktrees: ReadonlyArray<FederatedClaudeSession>;
} {
  if (!input.scope) {
    return { exact: [], siblingWorktrees: [] };
  }

  const locationByEnvironment = new Map<EnvironmentId, ClaudeSessionProjectLocation>();
  for (const location of input.scope.locations) {
    if (!locationByEnvironment.has(location.environmentId)) {
      locationByEnvironment.set(location.environmentId, location);
    }
  }
  const exact: FederatedClaudeSession[] = [];
  const siblingWorktrees: FederatedClaudeSession[] = [];
  for (const session of input.sessions) {
    const location = locationByEnvironment.get(session.environmentId);
    if (!location) {
      continue;
    }
    if (session.session.sourceCwd === location.exactCwd) {
      exact.push(session);
    } else if (session.session.projectRoot === location.repositoryRoot) {
      siblingWorktrees.push(session);
    }
  }
  return { exact, siblingWorktrees };
}

export function buildClaudeSessionProjectScope(input: {
  readonly activeProject: ProjectScopeCandidate | null;
  readonly projects: ReadonlyArray<ProjectScopeCandidate>;
  readonly activeCwd?: string | null;
}): ClaudeSessionProjectScope | null {
  const activeProject = input.activeProject;
  if (!activeProject) {
    return null;
  }

  const canonicalKey = activeProject.repositoryIdentity?.canonicalKey ?? null;
  const members = (
    canonicalKey
      ? input.projects.filter(
          (project) => project.repositoryIdentity?.canonicalKey === canonicalKey,
        )
      : [activeProject]
  ).toSorted((left, right) => {
    const leftIsActive =
      left.environmentId === activeProject.environmentId && left.id === activeProject.id;
    const rightIsActive =
      right.environmentId === activeProject.environmentId && right.id === activeProject.id;
    return Number(rightIsActive) - Number(leftIsActive);
  });
  const locationByEnvironment = new Map<EnvironmentId, ClaudeSessionProjectLocation>();
  for (const project of members) {
    const repositoryRoot = project.repositoryIdentity?.rootPath?.trim() || project.workspaceRoot;
    const isActiveProject =
      project.environmentId === activeProject.environmentId && project.id === activeProject.id;
    const location = {
      environmentId: project.environmentId,
      projectId: project.id,
      title: project.title,
      workspaceRoot: project.workspaceRoot,
      exactCwd: isActiveProject
        ? input.activeCwd?.trim() || project.workspaceRoot
        : project.workspaceRoot,
      repositoryRoot,
    } satisfies ClaudeSessionProjectLocation;
    if (!locationByEnvironment.has(location.environmentId)) {
      locationByEnvironment.set(location.environmentId, location);
    }
  }

  return {
    title: activeProject.title,
    locations: [...locationByEnvironment.values()],
  };
}

export function formatClaudeCatalogueAge(ageMs: number | null): string {
  if (ageMs === null) {
    return "not indexed yet";
  }
  if (ageMs < 60_000) {
    return "updated just now";
  }
  if (ageMs < 60 * 60_000) {
    const minutes = Math.max(1, Math.round(ageMs / 60_000));
    return `updated ${minutes}m ago`;
  }
  const hours = Math.max(1, Math.round(ageMs / (60 * 60_000)));
  return `updated ${hours}h ago`;
}
