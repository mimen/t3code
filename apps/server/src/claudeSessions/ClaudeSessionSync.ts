// @effect-diagnostics nodeBuiltinImport:off
import { createHash } from "node:crypto";
import * as NodeFSP from "node:fs/promises";

import {
  CommandId,
  EventId,
  MessageId,
  type ExternalHistoryDeduplicatedMessage,
  type ExternalHistoryItem,
  type ExternalSessionCheckpoint,
  type OrchestrationExternalSessionSummary,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import {
  type ClaudeJsonlReadError,
  hashClaudeJsonlPrefix,
  readCompleteClaudeJsonlRecords,
} from "./ClaudeJsonlReader.ts";
import {
  hashNormalizedClaudeHistoryItem,
  normalizeClaudeJsonlLine,
  type ClaudeNormalizedHistoryItem,
} from "./ClaudeJsonlNormalizer.ts";
import { ClaudeSessionCatalog, type ClaudeSessionCatalogError } from "./ClaudeSessionCatalog.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  ExternalClaudeSessionRepository,
  type ExternalClaudeSessionSource,
} from "../persistence/Services/ExternalClaudeSessions.ts";

const SYNC_BATCH_MAX_RECORDS = 250;
const SYNC_BATCH_MAX_BYTES = 4 * 1024 * 1024;
const IMPORT_LABEL = "Imported from Claude Code";
// Session-core layers are created per WebSocket connection, but process-local
// synchronization must coordinate every connection against the same source.
const sourceSemaphores = new Map<string, Semaphore.Semaphore>();

export class ClaudeSessionSyncError extends Schema.TaggedErrorClass<ClaudeSessionSyncError>()(
  "ClaudeSessionSyncError",
  {
    sourceId: Schema.String,
    state: Schema.Literals(["failed", "desynced"]),
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Claude session sync ${this.operation} for '${this.sourceId}' ${this.state}: ${this.detail}`;
  }
}

export interface ClaudeSessionSyncResult {
  readonly sourceId: string;
  readonly threadId: ThreadId;
  readonly importedItemCount: number;
  readonly committedByteOffset: number;
  readonly committedLineOrdinal: number;
  readonly hasIncompleteTail: boolean;
  readonly syncedAt: string;
}

export interface ClaudeSessionSyncShape {
  readonly syncSource: (
    sourceId: string,
  ) => Effect.Effect<ClaudeSessionSyncResult, ClaudeSessionSyncError>;
}

export class ClaudeSessionSync extends Context.Service<ClaudeSessionSync, ClaudeSessionSyncShape>()(
  "t3/claudeSessions/ClaudeSessionSync",
) {}

function toSummary(
  source: ExternalClaudeSessionSource,
  input: {
    readonly state: OrchestrationExternalSessionSummary["state"];
    readonly lastSyncedAt: string | null;
    readonly diagnostic: string | null;
    readonly updatedAt: string;
  },
): OrchestrationExternalSessionSummary {
  return {
    sourceId: source.sourceId,
    providerInstanceId: source.providerInstanceId,
    nativeSessionId: source.nativeSessionId,
    sourcePath: source.sourcePath,
    sourceCwd: source.sourceCwd,
    state: input.state,
    lastSyncedAt: input.lastSyncedAt,
    diagnostic: input.diagnostic,
    updatedAt: input.updatedAt,
  };
}

function makeId(prefix: string, input: string): string {
  return `${prefix}-${createHash("sha256").update(input).digest("hex").slice(0, 32)}`;
}

function timelineOrderKey(timestamp: string, lineOrdinal: number, itemIndex: number): string {
  return `${timestamp}:${String(lineOrdinal).padStart(12, "0")}:${String(itemIndex).padStart(6, "0")}`;
}

function toExternalHistoryItem(input: {
  readonly sourceId: string;
  readonly normalized: ClaudeNormalizedHistoryItem;
  readonly lineOrdinal: number;
  readonly fallbackTimestamp: string;
}): ExternalHistoryItem {
  const createdAt = input.normalized.timestamp ?? input.fallbackTimestamp;
  const sourceItemKey = input.normalized.sourceItemKey;
  const contentHash = hashNormalizedClaudeHistoryItem(input.normalized);
  const provenance = {
    origin: "claude-code-jsonl" as const,
    sourceId: input.sourceId,
    sourceItemKey,
    label: IMPORT_LABEL,
  };
  const orderKey = timelineOrderKey(createdAt, input.lineOrdinal, input.normalized.timelineIndex);
  if (input.normalized.kind === "message") {
    return {
      kind: "message",
      sourceItemKey,
      contentHash,
      message: {
        id: MessageId.make(makeId("claude-jsonl-message", `${input.sourceId}:${sourceItemKey}`)),
        role: input.normalized.role,
        text: input.normalized.text,
        turnId: null,
        streaming: false,
        provenance,
        timelineOrderKey: orderKey,
        createdAt,
        updatedAt: createdAt,
      },
    };
  }
  return {
    kind: "activity",
    sourceItemKey,
    contentHash,
    activity: {
      id: EventId.make(makeId("claude-jsonl-activity", `${input.sourceId}:${sourceItemKey}`)),
      tone: "tool",
      kind: input.normalized.activityKind,
      summary: input.normalized.summary,
      payload: input.normalized.payload,
      turnId: null,
      provenance,
      timelineOrderKey: orderKey,
      createdAt,
    },
  };
}

function toSyncError(input: {
  readonly sourceId: string;
  readonly state: ClaudeSessionSyncError["state"];
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}): ClaudeSessionSyncError {
  return new ClaudeSessionSyncError({
    sourceId: input.sourceId,
    state: input.state,
    operation: input.operation,
    detail: input.detail,
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}

function catalogErrorToSyncError(
  sourceId: string,
  error: ClaudeSessionCatalogError,
): ClaudeSessionSyncError {
  return toSyncError({
    sourceId,
    state: "desynced",
    operation: error.operation,
    detail: error.message,
    cause: error,
  });
}

function readerErrorToSyncError(
  sourceId: string,
  error: ClaudeJsonlReadError,
): ClaudeSessionSyncError {
  return toSyncError({
    sourceId,
    state: error.operation === "line-too-large" ? "failed" : "desynced",
    operation: error.operation,
    detail: error.message,
    cause: error,
  });
}

const makeClaudeSessionSync = Effect.gen(function* () {
  const catalog = yield* ClaudeSessionCatalog;
  const externalSources = yield* ExternalClaudeSessionRepository;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const nextCommandId = (sourceId: string, operation: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.map(CommandId.make),
      Effect.mapError((cause) =>
        toSyncError({
          sourceId,
          state: "failed",
          operation,
          detail: "Cannot generate an orchestration command identifier.",
          cause,
        }),
      ),
    );

  const markState = Effect.fn("ClaudeSessionSync.markState")(function* (
    source: ExternalClaudeSessionSource,
    state: OrchestrationExternalSessionSummary["state"],
    diagnostic: string | null,
  ) {
    const updatedAt = yield* nowIso;
    const commandId = yield* nextCommandId(source.sourceId, "mark-state-command-id");
    yield* orchestrationEngine
      .dispatch({
        type: "thread.external-session.sync-state.set",
        commandId,
        threadId: source.threadId,
        externalSession: toSummary(source, {
          state,
          lastSyncedAt: state === "synced" ? updatedAt : source.lastSyncedAt,
          diagnostic,
          updatedAt,
        }),
        createdAt: updatedAt,
      })
      .pipe(
        Effect.mapError((cause) =>
          toSyncError({
            sourceId: source.sourceId,
            state: "failed",
            operation: "mark-state",
            detail: "Cannot persist external session synchronization state.",
            cause,
          }),
        ),
      );
    return updatedAt;
  });

  const validateSourceItemMappings = Effect.fn("ClaudeSessionSync.validateSourceItemMappings")(
    function* (sourceId: string, items: ReadonlyArray<ExternalHistoryItem>) {
      for (const item of items) {
        const existing = yield* externalSources.getSourceItem({
          sourceId,
          sourceItemKey: item.sourceItemKey,
        });
        if (Option.isNone(existing)) {
          continue;
        }
        const targetId = item.kind === "message" ? item.message.id : item.activity.id;
        if (
          existing.value.contentHash !== item.contentHash ||
          existing.value.targetKind !== item.kind ||
          existing.value.targetId !== targetId
        ) {
          return yield* toSyncError({
            sourceId,
            state: "desynced",
            operation: "source-item-mapping",
            detail: `Source item '${item.sourceItemKey}' changed after import.`,
          });
        }
      }
    },
  );

  const validateDeduplicatedMessageMappings = Effect.fn(
    "ClaudeSessionSync.validateDeduplicatedMessageMappings",
  )(function* (sourceId: string, items: ReadonlyArray<ExternalHistoryDeduplicatedMessage>) {
    for (const item of items) {
      const existing = yield* externalSources.getSourceItem({
        sourceId,
        sourceItemKey: item.sourceItemKey,
      });
      if (Option.isNone(existing)) {
        continue;
      }
      if (
        existing.value.contentHash !== item.contentHash ||
        existing.value.targetKind !== "message" ||
        existing.value.targetId !== item.messageId
      ) {
        return yield* toSyncError({
          sourceId,
          state: "desynced",
          operation: "source-item-mapping",
          detail: `Deduplicated source item '${item.sourceItemKey}' changed after import.`,
        });
      }
    }
  });

  const syncKnownSource = Effect.fn("ClaudeSessionSync.syncKnownSource")(function* (
    source: ExternalClaudeSessionSource,
  ) {
    const thread = yield* snapshotQuery.getThreadDetailById(source.threadId).pipe(
      Effect.mapError((cause) =>
        toSyncError({
          sourceId: source.sourceId,
          state: "failed",
          operation: "load-thread",
          detail: "Cannot read the existing T3 thread before synchronization.",
          cause,
        }),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            toSyncError({
              sourceId: source.sourceId,
              state: "desynced",
              operation: "load-thread",
              detail: "The attached T3 thread no longer exists.",
            }),
          onSome: Effect.succeed,
        }),
      ),
    );
    const liveMessageCandidates = thread.messages.filter(
      (message) =>
        message.provenance?.origin !== "claude-code-jsonl" && message.createdAt >= source.createdAt,
    );
    const matchedLiveMessageIds = new Set<string>();
    const findLiveDuplicate = (item: ClaudeNormalizedHistoryItem) => {
      if (item.kind !== "message" || item.timestamp === null) {
        return null;
      }
      const sourceTimestamp = Date.parse(item.timestamp);
      if (!Number.isFinite(sourceTimestamp)) {
        return null;
      }
      const toleranceMs = item.role === "user" ? 15_000 : 5 * 60_000;
      const match = liveMessageCandidates.find(
        (message) =>
          !matchedLiveMessageIds.has(message.id) &&
          message.role === item.role &&
          message.text === item.text &&
          Math.abs(Date.parse(message.createdAt) - sourceTimestamp) <= toleranceMs,
      );
      if (match === undefined) {
        return null;
      }
      matchedLiveMessageIds.add(match.id);
      return match;
    };

    const validated = yield* catalog
      .validateAttachedSource({
        sourcePath: source.sourcePath,
        nativeSessionId: source.nativeSessionId,
        sourceCwd: source.sourceCwd,
      })
      .pipe(
        Effect.mapError((error) =>
          error._tag === "ClaudeJsonlReadError"
            ? readerErrorToSyncError(source.sourceId, error)
            : catalogErrorToSyncError(source.sourceId, error),
        ),
      );

    let checkpoint = yield* externalSources.getCheckpoint(source.sourceId).pipe(
      Effect.mapError((cause) =>
        toSyncError({
          sourceId: source.sourceId,
          state: "failed",
          operation: "load-checkpoint",
          detail: "Cannot load the external session checkpoint.",
          cause,
        }),
      ),
    );
    if (Option.isNone(checkpoint)) {
      return yield* toSyncError({
        sourceId: source.sourceId,
        state: "desynced",
        operation: "load-checkpoint",
        detail: "External session source is missing its checkpoint.",
      });
    }

    let currentCheckpoint: ExternalSessionCheckpoint = checkpoint.value;
    let importedItemCount = 0;
    let hasIncompleteTail = false;

    while (true) {
      const committedPrefixHash = yield* hashClaudeJsonlPrefix({
        sourcePath: validated.sourcePath,
        byteLength: currentCheckpoint.committedByteOffset,
      }).pipe(Effect.mapError((error) => readerErrorToSyncError(source.sourceId, error)));
      if (
        currentCheckpoint.committedPrefixHash !== "unverified" &&
        committedPrefixHash !== currentCheckpoint.committedPrefixHash
      ) {
        return yield* toSyncError({
          sourceId: source.sourceId,
          state: "desynced",
          operation: "committed-prefix-mutated",
          detail: "Claude session source changed within its committed history.",
        });
      }
      const read = yield* readCompleteClaudeJsonlRecords({
        sourcePath: validated.sourcePath,
        startByteOffset: currentCheckpoint.committedByteOffset,
        startLineOrdinal: currentCheckpoint.committedLineOrdinal,
        maxRecords: SYNC_BATCH_MAX_RECORDS,
        maxBytes: SYNC_BATCH_MAX_BYTES,
      }).pipe(Effect.mapError((error) => readerErrorToSyncError(source.sourceId, error)));
      if (read.fileIdentity !== currentCheckpoint.fileIdentity) {
        return yield* toSyncError({
          sourceId: source.sourceId,
          state: "desynced",
          operation: "file-identity",
          detail: "Claude session source file identity changed after attachment.",
        });
      }
      if (read.observedSize < currentCheckpoint.observedSize) {
        return yield* toSyncError({
          sourceId: source.sourceId,
          state: "desynced",
          operation: "file-truncated",
          detail: "Claude session source file became smaller after synchronization.",
        });
      }
      const batchTimestamp = yield* nowIso;
      const items: ExternalHistoryItem[] = [];
      const deduplicatedMessages: ExternalHistoryDeduplicatedMessage[] = [];
      for (const rawRecord of read.records) {
        const normalized = normalizeClaudeJsonlLine({
          line: rawRecord.line,
          lineOrdinal: rawRecord.lineOrdinal,
        });
        if (normalized.kind === "malformed") {
          return yield* toSyncError({
            sourceId: source.sourceId,
            state: "failed",
            operation: "normalize",
            detail: `Malformed completed JSONL record at line ${rawRecord.lineOrdinal}: ${normalized.detail}`,
          });
        }
        const record = normalized.kind === "normalized" ? normalized.record : null;
        const recordSessionId =
          normalized.kind === "normalized"
            ? normalized.record.nativeSessionId
            : normalized.nativeSessionId;
        const recordCwd = normalized.kind === "normalized" ? normalized.record.cwd : normalized.cwd;
        if (recordSessionId !== null && recordSessionId !== source.nativeSessionId) {
          return yield* toSyncError({
            sourceId: source.sourceId,
            state: "desynced",
            operation: "native-session-id",
            detail: `Source record at line ${rawRecord.lineOrdinal} belongs to another Claude session.`,
          });
        }
        if (recordCwd !== null) {
          const canonicalRecordCwd = yield* Effect.tryPromise({
            try: () => NodeFSP.realpath(recordCwd),
            catch: (cause) =>
              toSyncError({
                sourceId: source.sourceId,
                state: "desynced",
                operation: "source-cwd",
                detail: `Source record working directory no longer exists: ${recordCwd}`,
                cause,
              }),
          });
          if (canonicalRecordCwd !== source.sourceCwd) {
            return yield* toSyncError({
              sourceId: source.sourceId,
              state: "desynced",
              operation: "source-cwd",
              detail: `Source record at line ${rawRecord.lineOrdinal} has a mismatched working directory.`,
            });
          }
        }
        if (record === null) {
          continue;
        }
        for (const normalizedItem of record.items) {
          const historyItem = toExternalHistoryItem({
            sourceId: source.sourceId,
            normalized: normalizedItem,
            lineOrdinal: rawRecord.lineOrdinal,
            fallbackTimestamp: batchTimestamp,
          });
          const liveDuplicate = findLiveDuplicate(normalizedItem);
          if (historyItem.kind === "message" && liveDuplicate !== null) {
            deduplicatedMessages.push({
              sourceItemKey: historyItem.sourceItemKey,
              contentHash: historyItem.contentHash,
              messageId: liveDuplicate.id,
            });
            continue;
          }
          items.push(historyItem);
        }
      }

      yield* validateSourceItemMappings(source.sourceId, items).pipe(
        Effect.mapError((cause) =>
          cause._tag === "ClaudeSessionSyncError"
            ? cause
            : toSyncError({
                sourceId: source.sourceId,
                state: "failed",
                operation: "source-item-mapping",
                detail: "Cannot validate existing source item mappings.",
                cause,
              }),
        ),
      );
      yield* validateDeduplicatedMessageMappings(source.sourceId, deduplicatedMessages).pipe(
        Effect.mapError((cause) =>
          cause._tag === "ClaudeSessionSyncError"
            ? cause
            : toSyncError({
                sourceId: source.sourceId,
                state: "failed",
                operation: "source-item-mapping",
                detail: "Cannot validate deduplicated source item mappings.",
                cause,
              }),
        ),
      );

      if (read.nextByteOffset === currentCheckpoint.committedByteOffset) {
        hasIncompleteTail = read.hasIncompleteTail;
        break;
      }

      const verifiedRead = yield* readCompleteClaudeJsonlRecords({
        sourcePath: validated.sourcePath,
        startByteOffset: currentCheckpoint.committedByteOffset,
        startLineOrdinal: currentCheckpoint.committedLineOrdinal,
        maxRecords: SYNC_BATCH_MAX_RECORDS,
        maxBytes: SYNC_BATCH_MAX_BYTES,
      }).pipe(Effect.mapError((error) => readerErrorToSyncError(source.sourceId, error)));
      const readSuffixStillMatches = read.records.every((record, index) => {
        const verified = verifiedRead.records[index];
        return (
          verified !== undefined &&
          verified.startByteOffset === record.startByteOffset &&
          verified.endByteOffset === record.endByteOffset &&
          verified.line === record.line
        );
      });
      if (!readSuffixStillMatches) {
        return yield* toSyncError({
          sourceId: source.sourceId,
          state: "desynced",
          operation: "suffix-mutated",
          detail: "Claude session source changed while synchronization was reading new history.",
        });
      }
      const finalCommittedPrefixHash = yield* hashClaudeJsonlPrefix({
        sourcePath: validated.sourcePath,
        byteLength: currentCheckpoint.committedByteOffset,
      }).pipe(Effect.mapError((error) => readerErrorToSyncError(source.sourceId, error)));
      if (
        currentCheckpoint.committedPrefixHash !== "unverified" &&
        finalCommittedPrefixHash !== currentCheckpoint.committedPrefixHash
      ) {
        return yield* toSyncError({
          sourceId: source.sourceId,
          state: "desynced",
          operation: "committed-prefix-mutated",
          detail: "Claude session source changed while synchronization was reading its suffix.",
        });
      }
      const nextCommittedPrefixHash = yield* hashClaudeJsonlPrefix({
        sourcePath: validated.sourcePath,
        byteLength: read.nextByteOffset,
      }).pipe(Effect.mapError((error) => readerErrorToSyncError(source.sourceId, error)));
      const nextCheckpoint: ExternalSessionCheckpoint = {
        sourceId: currentCheckpoint.sourceId,
        fileIdentity: read.fileIdentity,
        committedPrefixHash: nextCommittedPrefixHash,
        generation: currentCheckpoint.generation,
        committedByteOffset: read.nextByteOffset,
        committedLineOrdinal: read.nextLineOrdinal,
        observedSize: read.observedSize,
        observedMtimeMs: read.observedMtimeMs,
        parserVersion: currentCheckpoint.parserVersion,
        revision: currentCheckpoint.revision + 1,
      };
      const commandId = yield* nextCommandId(source.sourceId, "import-command-id");
      yield* orchestrationEngine
        .dispatch({
          type: "thread.external-history.import",
          commandId,
          threadId: source.threadId,
          sourceId: source.sourceId,
          items,
          ...(deduplicatedMessages.length === 0 ? {} : { deduplicatedMessages }),
          expectedCheckpointRevision: currentCheckpoint.revision,
          checkpoint: nextCheckpoint,
          createdAt: batchTimestamp,
        })
        .pipe(
          Effect.mapError((cause) =>
            toSyncError({
              sourceId: source.sourceId,
              state: "failed",
              operation: "import",
              detail: "Cannot persist imported Claude JSONL history.",
              cause,
            }),
          ),
        );

      importedItemCount += items.length;
      currentCheckpoint = nextCheckpoint;
      hasIncompleteTail = read.hasIncompleteTail;
      if (!read.reachedLimit || read.hasIncompleteTail) {
        break;
      }
    }

    const syncedAt = yield* markState(source, "synced", null).pipe(
      Effect.mapError((cause) =>
        toSyncError({
          sourceId: source.sourceId,
          state: "failed",
          operation: "mark-synced",
          detail: "Cannot record external source synchronization state.",
          cause,
        }),
      ),
    );
    return {
      sourceId: source.sourceId,
      threadId: source.threadId,
      importedItemCount,
      committedByteOffset: currentCheckpoint.committedByteOffset,
      committedLineOrdinal: currentCheckpoint.committedLineOrdinal,
      hasIncompleteTail,
      syncedAt,
    } satisfies ClaudeSessionSyncResult;
  });

  const syncSource: ClaudeSessionSyncShape["syncSource"] = (sourceId) =>
    Effect.gen(function* () {
      const sourceOption = yield* externalSources.getSourceById(sourceId).pipe(
        Effect.mapError((cause) =>
          toSyncError({
            sourceId,
            state: "failed",
            operation: "load-source",
            detail: "Cannot load external session source.",
            cause,
          }),
        ),
      );
      if (Option.isNone(sourceOption)) {
        return yield* toSyncError({
          sourceId,
          state: "failed",
          operation: "load-source",
          detail: "External session source was not found.",
        });
      }
      const source = sourceOption.value;
      const semaphore = sourceSemaphores.get(sourceId) ?? Semaphore.makeUnsafe(1);
      sourceSemaphores.set(sourceId, semaphore);
      return yield* semaphore.withPermit(
        syncKnownSource(source).pipe(
          Effect.catch((error) =>
            markState(source, error.state, error.detail).pipe(
              Effect.catch(() => Effect.void),
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        ),
      );
    });

  return { syncSource } satisfies ClaudeSessionSyncShape;
});

export const ClaudeSessionSyncLive = Layer.effect(ClaudeSessionSync, makeClaudeSessionSync);
