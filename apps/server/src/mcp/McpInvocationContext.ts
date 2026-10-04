import {
  type EnvironmentId,
  McpCapabilityUnavailableError,
  PreviewAutomationUnavailableError,
  type ProjectId,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

const ALL_MCP_CAPABILITIES = [
  "preview",
  "orchestration",
  "worktree",
  "device",
  "pull-requests",
  // Never issued with a credential: the MCP endpoint adds it per request while
  // the user lists the thread in `crossProjectOrchestratorThreadIds`.
  "cross-project",
] as const;
export type McpCapability = (typeof ALL_MCP_CAPABILITIES)[number];

export interface McpInvocationScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly capabilities: ReadonlySet<McpCapability>;
  readonly issuedAt: number;
}

export class McpInvocationContext extends Context.Service<
  McpInvocationContext,
  McpInvocationScope
>()("t3/mcp/McpInvocationContext") {}

/** The error a missing capability surfaces as; preview keeps its own so the broker can route it. */
export type McpCapabilityError<C extends McpCapability> = C extends "preview"
  ? PreviewAutomationUnavailableError
  : McpCapabilityUnavailableError;

const missingCapability = (
  invocation: McpInvocationScope,
  capability: McpCapability,
): PreviewAutomationUnavailableError | McpCapabilityUnavailableError => {
  const fields = {
    environmentId: invocation.environmentId,
    threadId: invocation.threadId,
    providerSessionId: invocation.providerSessionId,
    providerInstanceId: invocation.providerInstanceId,
  };
  return capability === "preview"
    ? new PreviewAutomationUnavailableError({ capability, ...fields })
    : new McpCapabilityUnavailableError({ capability, ...fields });
};

export const requireMcpCapability = <const C extends McpCapability>(
  capability: C,
): Effect.Effect<McpInvocationScope, McpCapabilityError<C>, McpInvocationContext> =>
  McpInvocationContext.pipe(
    Effect.filterOrFail(
      (invocation) => invocation.capabilities.has(capability),
      // The conditional type narrows what the literal argument decided at runtime.
      (invocation) => missingCapability(invocation, capability) as McpCapabilityError<C>,
    ),
    Effect.withSpan("mcp.requireCapability"),
  );

/**
 * The project a caller-supplied thread id is looked up in. Without the user's
 * cross-project grant that is always the caller's project, so a thread
 * elsewhere reads as not found; with it, the thread's own project.
 */
export const lookupProjectId = <E>(input: {
  readonly scope: McpInvocationScope;
  readonly callerProjectId: ProjectId;
  readonly threadId: ThreadId;
  readonly getThreadShell: (
    threadId: ThreadId,
  ) => Effect.Effect<{ readonly projectId: ProjectId } | null, E>;
}): Effect.Effect<ProjectId, E> =>
  input.scope.capabilities.has("cross-project")
    ? input
        .getThreadShell(input.threadId)
        .pipe(Effect.map((shell) => shell?.projectId ?? input.callerProjectId))
    : Effect.succeed(input.callerProjectId);
