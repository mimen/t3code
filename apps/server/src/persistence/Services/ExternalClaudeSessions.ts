import {
  ClaudeSessionAttachmentStatus,
  ExternalSessionCheckpoint,
  ExternalSessionSyncState,
  IsoDateTime,
  OrchestrationExternalSessionSummary,
  ProviderInstanceId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Effect from "effect/Effect";

import type { PersistenceDecodeError, PersistenceSqlError } from "../Errors.ts";

export const ExternalClaudeSessionSource = Schema.Struct({
  sourceId: TrimmedNonEmptyString,
  providerInstanceId: ProviderInstanceId,
  localSourceHost: TrimmedNonEmptyString,
  nativeSessionId: TrimmedNonEmptyString,
  sourcePath: TrimmedNonEmptyString,
  sourceCwd: TrimmedNonEmptyString,
  threadId: ThreadId,
  state: ExternalSessionSyncState,
  lastSyncedAt: Schema.NullOr(IsoDateTime),
  diagnostic: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ExternalClaudeSessionSource = typeof ExternalClaudeSessionSource.Type;

export const ExternalClaudeSessionSourceItem = Schema.Struct({
  sourceId: TrimmedNonEmptyString,
  sourceItemKey: TrimmedNonEmptyString,
  targetKind: Schema.Literals(["message", "activity"]),
  targetId: TrimmedNonEmptyString,
  contentHash: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type ExternalClaudeSessionSourceItem = typeof ExternalClaudeSessionSourceItem.Type;

export const ExternalClaudeSessionSourceIdentity = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  localSourceHost: TrimmedNonEmptyString,
  nativeSessionId: TrimmedNonEmptyString,
});
export type ExternalClaudeSessionSourceIdentity = typeof ExternalClaudeSessionSourceIdentity.Type;

export const ExternalClaudeSessionSourceStateUpdate = Schema.Struct({
  sourceId: TrimmedNonEmptyString,
  state: ExternalSessionSyncState,
  lastSyncedAt: Schema.NullOr(IsoDateTime),
  diagnostic: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
export type ExternalClaudeSessionSourceStateUpdate =
  typeof ExternalClaudeSessionSourceStateUpdate.Type;

export const ExternalClaudeSessionCheckpointAdvance = Schema.Struct({
  expectedRevision: Schema.Number,
  checkpoint: ExternalSessionCheckpoint,
});
export type ExternalClaudeSessionCheckpointAdvance =
  typeof ExternalClaudeSessionCheckpointAdvance.Type;

export class ExternalClaudeSessionSourceConflictError extends Schema.TaggedErrorClass<ExternalClaudeSessionSourceConflictError>()(
  "ExternalClaudeSessionSourceConflictError",
  {
    sourceId: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
  },
) {}

export type ExternalClaudeSessionRepositoryError =
  | PersistenceSqlError
  | PersistenceDecodeError
  | ExternalClaudeSessionSourceConflictError;

export interface ExternalClaudeSessionRepositoryShape {
  readonly createSource: (
    source: ExternalClaudeSessionSource,
  ) => Effect.Effect<void, ExternalClaudeSessionRepositoryError>;
  readonly getSourceById: (
    sourceId: string,
  ) => Effect.Effect<
    Option.Option<ExternalClaudeSessionSource>,
    ExternalClaudeSessionRepositoryError
  >;
  readonly getSourceByIdentity: (
    identity: ExternalClaudeSessionSourceIdentity,
  ) => Effect.Effect<
    Option.Option<ExternalClaudeSessionSource>,
    ExternalClaudeSessionRepositoryError
  >;
  readonly getSourceByThreadId: (
    threadId: ThreadId,
  ) => Effect.Effect<
    Option.Option<ExternalClaudeSessionSource>,
    ExternalClaudeSessionRepositoryError
  >;
  readonly listActiveAttachmentStatuses: () => Effect.Effect<
    ReadonlyArray<ClaudeSessionAttachmentStatus>,
    ExternalClaudeSessionRepositoryError
  >;
  readonly updateSourceState: (
    update: ExternalClaudeSessionSourceStateUpdate,
  ) => Effect.Effect<void, ExternalClaudeSessionRepositoryError>;
  readonly deleteSourceByThreadId: (
    threadId: ThreadId,
  ) => Effect.Effect<void, ExternalClaudeSessionRepositoryError>;
  readonly getCheckpoint: (
    sourceId: string,
  ) => Effect.Effect<
    Option.Option<ExternalSessionCheckpoint>,
    ExternalClaudeSessionRepositoryError
  >;
  readonly createCheckpoint: (
    checkpoint: ExternalSessionCheckpoint,
  ) => Effect.Effect<void, ExternalClaudeSessionRepositoryError>;
  readonly getSourceItem: (input: {
    readonly sourceId: string;
    readonly sourceItemKey: string;
  }) => Effect.Effect<
    Option.Option<ExternalClaudeSessionSourceItem>,
    ExternalClaudeSessionRepositoryError
  >;
  readonly ensureSourceItem: (
    item: ExternalClaudeSessionSourceItem,
  ) => Effect.Effect<void, ExternalClaudeSessionRepositoryError>;
  readonly advanceCheckpoint: (
    input: ExternalClaudeSessionCheckpointAdvance,
  ) => Effect.Effect<void, ExternalClaudeSessionRepositoryError>;
  readonly upsertThreadSummary: (
    summary: OrchestrationExternalSessionSummary,
    threadId: ThreadId,
  ) => Effect.Effect<void, ExternalClaudeSessionRepositoryError>;
  readonly getThreadSummary: (
    threadId: ThreadId,
  ) => Effect.Effect<
    Option.Option<OrchestrationExternalSessionSummary>,
    ExternalClaudeSessionRepositoryError
  >;
}

export class ExternalClaudeSessionRepository extends Context.Service<
  ExternalClaudeSessionRepository,
  ExternalClaudeSessionRepositoryShape
>()("t3/persistence/Services/ExternalClaudeSessions/ExternalClaudeSessionRepository") {}
