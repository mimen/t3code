import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  AgentSessionImportProjectChangedError,
  AgentSessionImportProjectNotFoundError,
  AgentSessionSource,
  AgentSessionUnavailableError,
  type AgentSessionAttachInput,
  type AgentSessionListInput,
  type AgentSessionPreviewInput,
  type AgentSessionSelection,
  AgentSessionScanError,
  isImportedAgentSessionMessageId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  type AgentSessionImportInput,
  type AgentSessionImportResult,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";

import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderSessionDirectory from "../provider/Services/ProviderSessionDirectory.ts";
import * as AgentSessionScanner from "./AgentSessionScanner.ts";

const CLAUDE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class AgentSessionUnresumableSessionError extends Schema.TaggedErrorClass<AgentSessionUnresumableSessionError>()(
  "AgentSessionUnresumableSessionError",
  {
    source: AgentSessionSource,
    providerSessionId: Schema.String,
  },
) {
  override get message(): string {
    return `Session '${this.providerSessionId}' from '${this.source}' cannot be resumed.`;
  }
}

class AgentSessionThreadProjectConflictError extends Schema.TaggedErrorClass<AgentSessionThreadProjectConflictError>()(
  "AgentSessionThreadProjectConflictError",
  {
    threadId: ThreadId,
    expectedProjectId: ProjectId,
    actualProjectId: ProjectId,
  },
) {
  override get message(): string {
    return `Imported thread '${this.threadId}' belongs to project '${this.actualProjectId}', not '${this.expectedProjectId}'.`;
  }
}

class AgentSessionThreadModifiedError extends Schema.TaggedErrorClass<AgentSessionThreadModifiedError>()(
  "AgentSessionThreadModifiedError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return `Imported thread '${this.threadId}' changed before its history import completed.`;
  }
}

function hasImportedHistory(thread: OrchestrationThread): boolean {
  return thread.messages.some((message) => isImportedAgentSessionMessageId(message.id));
}

function hasImportBlockingActivity(
  thread: OrchestrationThread,
  importedHistoryPresent: boolean,
): boolean {
  return (
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    thread.latestTurn !== null ||
    thread.session !== null ||
    thread.messages.some((message) => !isImportedAgentSessionMessageId(message.id)) ||
    thread.proposedPlans.length > 0 ||
    thread.activities.length > 0 ||
    thread.checkpoints.length > 0 ||
    thread.snoozedUntil != null ||
    thread.snoozedAt != null ||
    thread.pinnedAt != null ||
    thread.pinOrderKey != null ||
    thread.titleRegeneration != null ||
    thread.linkedPullRequest != null ||
    thread.unsettledAt != null ||
    (importedHistoryPresent
      ? thread.settledOverride !== "settled"
      : thread.settledOverride !== null || thread.settledAt !== null)
  );
}

const importLock = Semaphore.makeUnsafe(1);

const resolveProject = Effect.fn("AgentSessionImporter.resolveProject")(function* (
  input: AgentSessionImportInput,
) {
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const project = yield* snapshots
    .getProjectShellById(input.projectId)
    .pipe(
      Effect.mapError((cause) => new AgentSessionScanError({ operation: "read-projects", cause })),
    );
  if (Option.isNone(project))
    return yield* new AgentSessionImportProjectNotFoundError({ projectId: input.projectId });
  if (
    input.expectedWorkspaceRoot !== undefined &&
    normalizeProjectPathForComparison(project.value.workspaceRoot) !==
      normalizeProjectPathForComparison(input.expectedWorkspaceRoot)
  ) {
    return yield* new AgentSessionImportProjectChangedError({ projectId: input.projectId });
  }
  return project.value;
});

const importedThreadId = (selection: AgentSessionSelection) =>
  ThreadId.make(`import:${selection.providerInstanceId}:${selection.providerSessionId}`);
const decodeClaudeCursor = Schema.decodeUnknownOption(Schema.Struct({ resume: Schema.String }));
const existingSessionThreads = Effect.fn("AgentSessionImporter.existingSessionThreads")(
  function* () {
    const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
    const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    const scanner = yield* AgentSessionScanner.AgentSessionScanner;
    const homes = yield* scanner.claudeSessionHomes;
    const key = (instanceId: AgentSessionSelection["providerInstanceId"], sessionId: string) =>
      `${homes.has(instanceId) ? `home:${homes.get(instanceId)}` : `instance:${instanceId}`}\0${sessionId}`;
    const bindings = yield* directory.listBindings();
    const existing = new Map<string, ThreadId>();
    for (const binding of bindings) {
      if (binding.provider !== "claudeAgent" || !binding.providerInstanceId) continue;
      const cursor = decodeClaudeCursor(binding.resumeCursor);
      if (Option.isNone(cursor)) continue;
      const thread = yield* snapshots.getThreadShellById(binding.threadId);
      if (Option.isSome(thread))
        existing.set(key(binding.providerInstanceId, cursor.value.resume), binding.threadId);
    }
    return (selection: AgentSessionSelection) =>
      existing.get(key(selection.providerInstanceId, selection.providerSessionId));
  },
  Effect.mapError((cause) => new AgentSessionScanError({ operation: "read-projects", cause })),
);

export const listAgentSessions = Effect.fn("listAgentSessions")(function* (
  input: AgentSessionListInput,
) {
  const project = yield* resolveProject(input);
  const scanner = yield* AgentSessionScanner.AgentSessionScanner;
  const result = yield* scanner.list(project.workspaceRoot, input.cursor);
  const existing = yield* existingSessionThreads();
  return {
    ...result,
    sessions: result.sessions.map((session) => ({
      ...session,
      existingThreadId: existing(session) ?? null,
    })),
  };
});

export const previewAgentSession = Effect.fn("previewAgentSession")(function* (
  input: AgentSessionPreviewInput,
) {
  const project = yield* resolveProject(input);
  const scanner = yield* AgentSessionScanner.AgentSessionScanner;
  return yield* scanner.preview(project.workspaceRoot, input, input.before);
});

export const attachAgentSession = Effect.fn("attachAgentSession")(function* (
  input: AgentSessionAttachInput,
) {
  const project = yield* resolveProject(input);
  const scanner = yield* AgentSessionScanner.AgentSessionScanner;
  const existing = (yield* existingSessionThreads())(input);
  if (existing) {
    const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    const imported =
      existing === importedThreadId(input)
        ? yield* snapshots
            .getThreadDetailById(existing)
            .pipe(
              Effect.mapError(
                (cause) => new AgentSessionScanError({ operation: "read-projects", cause }),
              ),
            )
        : Option.none();
    if (
      existing !== importedThreadId(input) ||
      (Option.isSome(imported) && hasImportedHistory(imported.value))
    ) {
      yield* scanner.preview(project.workspaceRoot, input);
      return { threadId: existing };
    }
  }
  const outcome = yield* scanner.selectedThread(project.workspaceRoot, input);
  const result = yield* importAgentThreads(input, outcome);
  if (result.importedCount !== 1)
    return yield* new AgentSessionUnavailableError({
      message: "The session could not be attached. Refresh and try again.",
    });
  return { threadId: importedThreadId(input) };
}, importLock.withPermits(1));

/** Import recent transcript text and persist the cursor needed to resume its provider session. */
export const importRecentAgentThreads = Effect.fn("importRecentAgentThreads")(function* (
  input: AgentSessionImportInput,
) {
  return yield* importAgentThreads(input);
}, importLock.withPermits(1));

const importAgentThreads = Effect.fn("AgentSessionImporter.importAgentThreads")(function* (
  input: AgentSessionImportInput,
  selected?: Extract<AgentSessionScanner.AgentSessionRecentThread, { _tag: "Importable" }>,
) {
  const scanner = yield* AgentSessionScanner.AgentSessionScanner;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
  const crypto = yield* Crypto.Crypto;
  const project = yield* resolveProject(input);
  const workspaceRoot = project.workspaceRoot;
  const runtimeMode = selected ? "approval-required" : DEFAULT_RUNTIME_MODE;
  const completedSources = yield* snapshots
    .getImportedAgentSessionSources(input.projectId)
    .pipe(
      Effect.mapError((cause) => new AgentSessionScanError({ operation: "read-projects", cause })),
    );
  const threads = selected
    ? Stream.succeed(selected)
    : scanner.recentThreads(
        workspaceRoot,
        completedSources.map((entry) => entry.source),
      );
  const importedThreadIds = new Set<ThreadId>();
  let importedCount = 0;
  let skippedCount = 0;

  yield* Stream.runForEach(threads, (outcome) =>
    Effect.gen(function* () {
      if (outcome._tag === "Skipped") {
        skippedCount += 1;
        return;
      }
      if (outcome._tag === "AlreadyImported" || outcome._tag === "Duplicate") {
        const threadId = ThreadId.make(
          `import:${outcome.source.providerInstanceId}:${outcome.source.providerSessionId}`,
        );
        if (outcome._tag === "AlreadyImported") {
          importedThreadIds.add(threadId);
          importedCount += 1;
        } else if (importedThreadIds.has(threadId)) {
          const recorded = yield* directory
            .recordImportedTranscript({ threadId, source: outcome.source })
            .pipe(Effect.result);
          if (recorded._tag === "Failure") {
            skippedCount += 1;
            yield* Effect.logWarning("Could not record an imported transcript copy", {
              threadId,
              cause: recorded.failure,
            });
          }
        }
        return;
      }
      const thread = outcome.thread;
      const threadId = ThreadId.make(
        `import:${thread.providerInstanceId}:${thread.providerSessionId}`,
      );
      const imported = yield* Effect.gen(function* () {
        const provider = ProviderDriverKind.make(thread.source);
        const model = thread.model ?? DEFAULT_MODEL_BY_PROVIDER[provider] ?? DEFAULT_MODEL;
        const existingThread = yield* snapshots.getThreadDetailById(threadId);
        const existingBinding = yield* directory.getBinding(threadId);

        if (
          thread.source === "claudeAgent" &&
          !CLAUDE_SESSION_ID_PATTERN.test(thread.providerSessionId)
        ) {
          return yield* new AgentSessionUnresumableSessionError({
            source: thread.source,
            providerSessionId: thread.providerSessionId,
          });
        }

        if (Option.isSome(existingThread) && existingThread.value.projectId !== input.projectId) {
          return yield* new AgentSessionThreadProjectConflictError({
            threadId,
            expectedProjectId: input.projectId,
            actualProjectId: existingThread.value.projectId,
          });
        }

        const importedHistoryPresent = Option.isSome(existingThread)
          ? hasImportedHistory(existingThread.value)
          : false;
        if (
          Option.isSome(existingThread) &&
          importedHistoryPresent &&
          Option.isSome(existingBinding)
        ) {
          yield* directory.recordImportedTranscript({ threadId, source: outcome.source });
          return true;
        }

        if (
          Option.isSome(existingThread) &&
          hasImportBlockingActivity(existingThread.value, importedHistoryPresent)
        ) {
          return yield* new AgentSessionThreadModifiedError({ threadId });
        }

        if (
          Option.isSome(existingBinding) &&
          (existingBinding.value.provider !== provider ||
            existingBinding.value.providerInstanceId !== thread.providerInstanceId ||
            existingBinding.value.status !== "stopped")
        ) {
          return yield* new AgentSessionThreadModifiedError({ threadId });
        }

        // Install the cursor before the thread becomes visible. A concurrent
        // real session can replace it, while insert-ignore keeps this import
        // from replacing that newer binding.
        if (Option.isNone(existingBinding)) {
          yield* directory.upsert(
            {
              threadId,
              provider,
              providerInstanceId: thread.providerInstanceId,
              status: "stopped",
              runtimeMode,
              resumeCursor:
                thread.source === "codex"
                  ? { threadId: thread.providerSessionId }
                  : { threadId, resume: thread.providerSessionId },
              runtimePayload: { cwd: workspaceRoot },
            },
            { onConflict: "ignore" },
          );
        }

        if (Option.isNone(existingThread)) {
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.make(yield* crypto.randomUUIDv4),
            threadId,
            projectId: input.projectId,
            title: thread.title,
            modelSelection: { instanceId: thread.providerInstanceId, model },
            runtimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt: thread.createdAt,
            historyImport: true,
          });
        }

        if (!importedHistoryPresent) {
          yield* engine.dispatch({
            type: "thread.history.import",
            commandId: CommandId.make(yield* crypto.randomUUIDv4),
            threadId,
            messages: thread.messages.map((message, index) => ({
              messageId: MessageId.make(`${threadId}:${String(index).padStart(6, "0")}`),
              role: message.role,
              text: message.text,
              createdAt: message.createdAt,
            })),
          });
        }

        yield* directory.recordImportedTranscript({ threadId, source: outcome.source });

        return true;
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not import an agent session", {
            provider: thread.source,
            sessionId: thread.providerSessionId,
            cause,
          }).pipe(Effect.as(false)),
        ),
      );

      if (imported) {
        importedThreadIds.add(threadId);
        importedCount += 1;
      } else {
        skippedCount += 1;
      }
    }),
  );

  return { importedCount, skippedCount } satisfies AgentSessionImportResult;
});
