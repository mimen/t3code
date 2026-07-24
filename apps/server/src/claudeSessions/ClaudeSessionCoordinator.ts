// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ProviderInstanceId as ProviderInstanceIdType,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { ClaudeSessionCatalog } from "./ClaudeSessionCatalog.ts";
import { hashClaudeJsonlPrefix } from "./ClaudeJsonlReader.ts";
import { ClaudeSessionSync, type ClaudeSessionSyncResult } from "./ClaudeSessionSync.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderSessionRuntimeRepository } from "../persistence/ProviderSessionRuntime.ts";
import { ExternalClaudeSessionRepository } from "../persistence/Services/ExternalClaudeSessions.ts";

const DEFAULT_CLAUDE_PROVIDER_INSTANCE_ID = ProviderInstanceId.make("claudeAgent");
const DEFAULT_CLAUDE_MODEL = "claude-opus-4-8";
const EXTERNAL_SESSION_PARSER_VERSION = "claude-jsonl-v1";
// WebSocket connection layers each construct a coordinator. Attach/open must
// still serialize the same native source across those layer instances.
const sourceOpenSemaphores = new Map<string, Semaphore.Semaphore>();

export class ClaudeSessionCoordinatorError extends Schema.TaggedErrorClass<ClaudeSessionCoordinatorError>()(
  "ClaudeSessionCoordinatorError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Claude session coordinator ${this.operation}: ${this.detail}`;
  }
}

export interface OpenClaudeSessionInput {
  readonly nativeSessionId: string;
  readonly cwd: string;
  readonly providerInstanceId?: ProviderInstanceIdType;
  readonly model?: string;
}

export interface OpenClaudeSessionResult {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly sourceId: string;
  readonly created: boolean;
  /** Synchronization is best effort during open so an existing repairable thread remains reachable. */
  readonly sync: ClaudeSessionSyncResult | null;
  readonly syncError: string | null;
}

export interface ClaudeSessionCoordinatorShape {
  /**
   * Validates a native Claude session, finds an existing attachment by native
   * identity or creates one, then imports all currently complete JSONL records.
   * This is the future `t3 session open --resume-id ... --cwd ... --json` seam.
   */
  readonly open: (
    input: OpenClaudeSessionInput,
  ) => Effect.Effect<OpenClaudeSessionResult, ClaudeSessionCoordinatorError>;
  readonly sync: (
    sourceId: string,
  ) => Effect.Effect<ClaudeSessionSyncResult, ClaudeSessionCoordinatorError>;
}

export class ClaudeSessionCoordinator extends Context.Service<
  ClaudeSessionCoordinator,
  ClaudeSessionCoordinatorShape
>()("t3/claudeSessions/ClaudeSessionCoordinator") {}

function coordinatorError(
  operation: string,
  detail: string,
  cause?: unknown,
): ClaudeSessionCoordinatorError {
  return new ClaudeSessionCoordinatorError({
    operation,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function projectTitle(cwd: string): string {
  const basename = NodePath.basename(cwd).trim();
  return basename.length > 0 && basename !== NodePath.sep ? basename : "Claude project";
}

function threadTitle(title: string): string {
  const prefix = "[Claude] ";
  const available = 120 - prefix.length;
  return `${prefix}${title.slice(0, available)}`.trim();
}

const makeClaudeSessionCoordinator = Effect.gen(function* () {
  const catalog = yield* ClaudeSessionCatalog;
  const syncService = yield* ClaudeSessionSync;
  const externalSources = yield* ExternalClaudeSessionRepository;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const runtimeRepository = yield* ProviderSessionRuntimeRepository;
  const crypto = yield* Crypto.Crypto;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const nextCommandId = (operation: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.map(CommandId.make),
      Effect.mapError((cause) =>
        coordinatorError(operation, "Cannot generate an orchestration command identifier.", cause),
      ),
    );
  const nextUuid = (operation: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.mapError((cause) => coordinatorError(operation, "Cannot generate a UUID.", cause)),
    );

  const validateRequestedCwd = Effect.fn("ClaudeSessionCoordinator.validateRequestedCwd")(
    function* (requestedCwd: string, sourceCwd: string) {
      const canonicalRequestedCwd = yield* Effect.tryPromise({
        try: () => NodeFSP.realpath(requestedCwd),
        catch: (cause) =>
          coordinatorError(
            "validate-cwd",
            "Requested Claude session working directory does not exist.",
            cause,
          ),
      });
      const stat = yield* Effect.tryPromise({
        try: () => NodeFSP.stat(canonicalRequestedCwd),
        catch: (cause) =>
          coordinatorError(
            "validate-cwd",
            "Cannot stat requested Claude session working directory.",
            cause,
          ),
      });
      if (!stat.isDirectory()) {
        return yield* coordinatorError(
          "validate-cwd",
          "Requested Claude session working directory is not a directory.",
        );
      }
      if (canonicalRequestedCwd !== sourceCwd) {
        return yield* coordinatorError(
          "validate-cwd",
          "Requested working directory does not match the native Claude session source.",
        );
      }
      return canonicalRequestedCwd;
    },
  );

  const ensureProviderRuntime = Effect.fn("ClaudeSessionCoordinator.ensureProviderRuntime")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly nativeSessionId: string;
      readonly sourceCwd: string;
      readonly providerInstanceId: ProviderInstanceIdType;
      readonly model: string;
      readonly now: string;
    }) {
      yield* runtimeRepository
        .upsert({
          threadId: input.threadId,
          providerName: "claudeAgent",
          providerInstanceId: input.providerInstanceId,
          adapterKey: "claudeAgent",
          runtimeMode: "full-access",
          status: "stopped",
          lastSeenAt: input.now,
          resumeCursor: {
            threadId: input.threadId,
            resume: input.nativeSessionId,
            turnCount: 0,
          },
          runtimePayload: {
            cwd: input.sourceCwd,
            modelSelection: {
              instanceId: input.providerInstanceId,
              model: input.model,
            },
          },
        })
        .pipe(
          Effect.mapError((cause) =>
            coordinatorError(
              "seed-provider-runtime",
              "Cannot persist the native Claude resume binding.",
              cause,
            ),
          ),
        );
    },
  );

  const sync: ClaudeSessionCoordinatorShape["sync"] = (sourceId) =>
    syncService
      .syncSource(sourceId)
      .pipe(Effect.mapError((error) => coordinatorError("sync", error.message, error)));

  const synchronizeForOpen = Effect.fn("ClaudeSessionCoordinator.synchronizeForOpen")(function* (
    sourceId: string,
  ) {
    return yield* sync(sourceId).pipe(
      Effect.map((result) => ({ sync: result, syncError: null })),
      Effect.catch((error) =>
        Effect.succeed({
          sync: null,
          syncError: error.detail,
        }),
      ),
    );
  });

  const openUnserialized: ClaudeSessionCoordinatorShape["open"] = (input) =>
    Effect.gen(function* () {
      const providerInstanceId = input.providerInstanceId ?? DEFAULT_CLAUDE_PROVIDER_INSTANCE_ID;
      const model = input.model?.trim() || DEFAULT_CLAUDE_MODEL;
      const localSourceHost = NodeOS.hostname().trim();
      if (localSourceHost.length === 0) {
        return yield* coordinatorError("local-source-host", "Local source host name is empty.");
      }

      const source = yield* catalog
        .findSession(input.nativeSessionId, input.cwd)
        .pipe(Effect.mapError((error) => coordinatorError("resolve-source", error.message, error)));
      const workspaceRoot = yield* validateRequestedCwd(input.cwd, source.sourceCwd);
      const identity = {
        providerInstanceId,
        localSourceHost,
        nativeSessionId: source.nativeSessionId,
      };
      const existingSource = yield* externalSources
        .getSourceByIdentity(identity)
        .pipe(
          Effect.mapError((cause) =>
            coordinatorError(
              "find-source",
              "Cannot look up an existing Claude session attachment.",
              cause,
            ),
          ),
        );

      if (Option.isSome(existingSource)) {
        const commandSnapshot = yield* snapshotQuery
          .getCommandReadModel()
          .pipe(
            Effect.mapError((cause) =>
              coordinatorError(
                "find-thread",
                "Cannot read the existing Claude session thread.",
                cause,
              ),
            ),
          );
        const thread = commandSnapshot.threads.find(
          (entry) => entry.id === existingSource.value.threadId,
        );
        if (thread === undefined || thread.deletedAt !== null) {
          return yield* coordinatorError(
            "find-thread",
            "Existing Claude session attachment points to a missing or deleted thread.",
          );
        }
        const runtime = yield* runtimeRepository
          .getByThreadId({ threadId: thread.id })
          .pipe(
            Effect.mapError((cause) =>
              coordinatorError(
                "load-provider-runtime",
                "Cannot read the native Claude resume binding.",
                cause,
              ),
            ),
          );
        if (Option.isNone(runtime)) {
          const now = yield* nowIso;
          yield* ensureProviderRuntime({
            threadId: thread.id,
            nativeSessionId: existingSource.value.nativeSessionId,
            sourceCwd: existingSource.value.sourceCwd,
            providerInstanceId: existingSource.value.providerInstanceId,
            model: thread.modelSelection.model,
            now,
          });
        }
        const syncOutcome = yield* synchronizeForOpen(existingSource.value.sourceId);
        return {
          threadId: thread.id,
          projectId: thread.projectId,
          sourceId: existingSource.value.sourceId,
          created: false,
          ...syncOutcome,
        } satisfies OpenClaudeSessionResult;
      }

      const now = yield* nowIso;
      const existingProject = yield* snapshotQuery
        .getActiveProjectByWorkspaceRoot(workspaceRoot)
        .pipe(
          Effect.mapError((cause) =>
            coordinatorError(
              "find-project",
              "Cannot look up a project for the Claude source working directory.",
              cause,
            ),
          ),
        );
      const createdProject = Option.isNone(existingProject);
      const projectId = Option.isSome(existingProject)
        ? existingProject.value.id
        : ProjectId.make(yield* nextUuid("create-project-id"));
      if (createdProject) {
        yield* orchestrationEngine
          .dispatch({
            type: "project.create",
            commandId: yield* nextCommandId("create-project-command-id"),
            projectId,
            title: projectTitle(workspaceRoot),
            workspaceRoot,
            createdAt: now,
          })
          .pipe(
            Effect.mapError((cause) =>
              coordinatorError(
                "create-project",
                "Cannot create a project for the Claude session.",
                cause,
              ),
            ),
          );
      }

      const threadId = ThreadId.make(yield* nextUuid("create-thread-id"));
      yield* orchestrationEngine
        .dispatch({
          type: "thread.create",
          commandId: yield* nextCommandId("create-thread-command-id"),
          threadId,
          projectId,
          title: threadTitle(source.title),
          modelSelection: { instanceId: providerInstanceId, model },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
        })
        .pipe(
          Effect.mapError((cause) =>
            coordinatorError(
              "create-thread",
              "Cannot create a thread for the Claude session.",
              cause,
            ),
          ),
        );

      const sourceId = `claude-jsonl-${yield* nextUuid("create-source-id")}`;
      const committedPrefixHash = yield* hashClaudeJsonlPrefix({
        sourcePath: source.sourcePath,
        byteLength: 0,
      }).pipe(
        Effect.mapError((cause) =>
          coordinatorError(
            "hash-source-prefix",
            "Cannot hash the initial Claude transcript prefix.",
            cause,
          ),
        ),
      );
      const checkpoint = {
        sourceId,
        fileIdentity: source.fileIdentity,
        committedPrefixHash,
        generation: 0,
        committedByteOffset: 0,
        committedLineOrdinal: 0,
        observedSize: source.observedSize,
        observedMtimeMs: source.observedMtimeMs,
        parserVersion: EXTERNAL_SESSION_PARSER_VERSION,
        revision: 0,
      };
      const externalSession = {
        sourceId,
        providerInstanceId,
        nativeSessionId: source.nativeSessionId,
        sourcePath: source.sourcePath,
        sourceCwd: workspaceRoot,
        state: "attached" as const,
        lastSyncedAt: null,
        diagnostic: null,
        updatedAt: now,
      };
      // The attachment is allowed to make the normal composer available, so
      // persist its native resume binding before the source becomes visible.
      // A process failure can leave an unattached draft thread, but never an
      // attached thread whose next provider turn creates a fresh native session.
      yield* ensureProviderRuntime({
        threadId,
        nativeSessionId: source.nativeSessionId,
        sourceCwd: workspaceRoot,
        providerInstanceId,
        model,
        now,
      });
      const attachmentExit = yield* orchestrationEngine
        .dispatch({
          type: "thread.external-session.attach",
          commandId: yield* nextCommandId("attach-source-command-id"),
          threadId,
          externalSession,
          localSourceHost,
          checkpoint,
          createdAt: now,
        })
        .pipe(Effect.exit);
      if (Exit.isFailure(attachmentExit)) {
        const winningSource = yield* externalSources
          .getSourceByIdentity(identity)
          .pipe(
            Effect.mapError((cause) =>
              coordinatorError(
                "attach-source",
                "Cannot resolve a competing Claude session attachment.",
                cause,
              ),
            ),
          );
        if (Option.isSome(winningSource)) {
          // A server/CLI race can create this thread before the identity
          // constraint selects its winner. Remove the losing thread before it
          // can be opened as an untracked second continuation of the UUID.
          yield* orchestrationEngine
            .dispatch({
              type: "thread.delete",
              commandId: yield* nextCommandId("discard-racing-thread-command-id"),
              threadId,
            })
            .pipe(
              Effect.mapError((cause) =>
                coordinatorError(
                  "discard-racing-thread",
                  "Cannot remove the losing Claude session attachment thread.",
                  cause,
                ),
              ),
            );
          if (createdProject) {
            yield* orchestrationEngine
              .dispatch({
                type: "project.delete",
                commandId: yield* nextCommandId("discard-racing-project-command-id"),
                projectId,
              })
              .pipe(
                Effect.mapError((cause) =>
                  coordinatorError(
                    "discard-racing-project",
                    "Cannot remove the losing Claude session attachment project.",
                    cause,
                  ),
                ),
              );
          }
          return yield* openUnserialized(input);
        }
        return yield* coordinatorError(
          "attach-source",
          "Cannot attach Claude session source to its thread.",
          attachmentExit.cause,
        );
      }
      const persistedAttachment = yield* externalSources
        .getSourceByIdentity(identity)
        .pipe(
          Effect.mapError((cause) =>
            coordinatorError(
              "attach-source",
              "Cannot verify the persisted Claude session attachment.",
              cause,
            ),
          ),
        );
      if (Option.isSome(persistedAttachment) && persistedAttachment.value.sourceId !== sourceId) {
        yield* orchestrationEngine
          .dispatch({
            type: "thread.delete",
            commandId: yield* nextCommandId("discard-racing-thread-command-id"),
            threadId,
          })
          .pipe(
            Effect.mapError((cause) =>
              coordinatorError(
                "discard-racing-thread",
                "Cannot remove the losing Claude session attachment thread.",
                cause,
              ),
            ),
          );
        if (createdProject) {
          yield* orchestrationEngine
            .dispatch({
              type: "project.delete",
              commandId: yield* nextCommandId("discard-racing-project-command-id"),
              projectId,
            })
            .pipe(
              Effect.mapError((cause) =>
                coordinatorError(
                  "discard-racing-project",
                  "Cannot remove the losing Claude session attachment project.",
                  cause,
                ),
              ),
            );
        }
        return yield* openUnserialized(input);
      }
      const syncOutcome = yield* synchronizeForOpen(sourceId);
      return {
        threadId,
        projectId,
        sourceId,
        created: true,
        ...syncOutcome,
      } satisfies OpenClaudeSessionResult;
    });

  const open: ClaudeSessionCoordinatorShape["open"] = (input) => {
    const providerInstanceId = input.providerInstanceId ?? DEFAULT_CLAUDE_PROVIDER_INSTANCE_ID;
    const sourceKey = `${providerInstanceId}:${NodeOS.hostname()}:${input.nativeSessionId}`;
    const semaphore = sourceOpenSemaphores.get(sourceKey) ?? Semaphore.makeUnsafe(1);
    sourceOpenSemaphores.set(sourceKey, semaphore);
    return semaphore.withPermit(openUnserialized(input));
  };

  return { open, sync } satisfies ClaudeSessionCoordinatorShape;
});

export const ClaudeSessionCoordinatorLive = Layer.effect(
  ClaudeSessionCoordinator,
  makeClaudeSessionCoordinator,
);
