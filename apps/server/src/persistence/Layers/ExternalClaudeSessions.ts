import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import {
  ClaudeSessionAttachmentStatus,
  ExternalSessionCheckpoint,
  ThreadId,
} from "@t3tools/contracts";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  ExternalClaudeSessionRepository,
  ExternalClaudeSessionSource,
  ExternalClaudeSessionSourceConflictError,
  ExternalClaudeSessionSourceIdentity,
  ExternalClaudeSessionSourceItem,
  type ExternalClaudeSessionRepositoryShape,
} from "../Services/ExternalClaudeSessions.ts";

const SourceIdInput = Schema.Struct({ sourceId: Schema.String });
const ThreadIdInput = Schema.Struct({ threadId: ThreadId });
const SourceItemKeyInput = Schema.Struct({
  sourceId: Schema.String,
  sourceItemKey: Schema.String,
});

const sourceMatchesCheckpoint = (
  current: ExternalSessionCheckpoint,
  next: ExternalSessionCheckpoint,
): boolean =>
  current.sourceId === next.sourceId &&
  current.fileIdentity === next.fileIdentity &&
  current.committedPrefixHash === next.committedPrefixHash &&
  current.generation === next.generation &&
  current.committedByteOffset === next.committedByteOffset &&
  current.committedLineOrdinal === next.committedLineOrdinal &&
  current.observedSize === next.observedSize &&
  current.observedMtimeMs === next.observedMtimeMs &&
  current.parserVersion === next.parserVersion;

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeExternalClaudeSessionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getSourceByIdRow = SqlSchema.findOneOption({
    Request: SourceIdInput,
    Result: ExternalClaudeSessionSource,
    execute: ({ sourceId }) => sql`
      SELECT
        source_id AS "sourceId",
        provider_instance_id AS "providerInstanceId",
        local_source_host AS "localSourceHost",
        native_session_id AS "nativeSessionId",
        source_path AS "sourcePath",
        source_cwd AS "sourceCwd",
        thread_id AS "threadId",
        sync_state AS state,
        last_synced_at AS "lastSyncedAt",
        diagnostic,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM external_session_sources
      WHERE source_id = ${sourceId}
      LIMIT 1
    `,
  });

  const getSourceByIdentityRow = SqlSchema.findOneOption({
    Request: ExternalClaudeSessionSourceIdentity,
    Result: ExternalClaudeSessionSource,
    execute: ({ providerInstanceId, localSourceHost, nativeSessionId }) => sql`
      SELECT
        source_id AS "sourceId",
        provider_instance_id AS "providerInstanceId",
        local_source_host AS "localSourceHost",
        native_session_id AS "nativeSessionId",
        source_path AS "sourcePath",
        source_cwd AS "sourceCwd",
        thread_id AS "threadId",
        sync_state AS state,
        last_synced_at AS "lastSyncedAt",
        diagnostic,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM external_session_sources
      WHERE provider_instance_id = ${providerInstanceId}
        AND local_source_host = ${localSourceHost}
        AND native_session_id = ${nativeSessionId}
      LIMIT 1
    `,
  });

  const getSourceByThreadIdRow = SqlSchema.findOneOption({
    Request: ThreadIdInput,
    Result: ExternalClaudeSessionSource,
    execute: ({ threadId }) => sql`
      SELECT
        source_id AS "sourceId",
        provider_instance_id AS "providerInstanceId",
        local_source_host AS "localSourceHost",
        native_session_id AS "nativeSessionId",
        source_path AS "sourcePath",
        source_cwd AS "sourceCwd",
        thread_id AS "threadId",
        sync_state AS state,
        last_synced_at AS "lastSyncedAt",
        diagnostic,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM external_session_sources
      WHERE thread_id = ${threadId}
      LIMIT 1
    `,
  });

  const listActiveAttachmentStatusRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ClaudeSessionAttachmentStatus,
    execute: () => sql`
      SELECT
        sources.provider_instance_id AS "providerInstanceId",
        sources.local_source_host AS "localSourceHost",
        sources.native_session_id AS "nativeSessionId",
        sources.source_cwd AS "sourceCwd",
        sources.source_id AS "sourceId",
        sources.thread_id AS "threadId",
        threads.project_id AS "projectId",
        sources.sync_state AS state,
        sources.last_synced_at AS "lastSyncedAt",
        sources.diagnostic,
        runtime.status AS "runtimeStatus",
        runtime.last_seen_at AS "runtimeLastSeenAt"
      FROM external_session_sources sources
      INNER JOIN projection_threads threads
        ON threads.thread_id = sources.thread_id
      INNER JOIN projection_projects projects
        ON projects.project_id = threads.project_id
      LEFT JOIN provider_session_runtime runtime
        ON runtime.thread_id = sources.thread_id
      WHERE threads.deleted_at IS NULL
        AND threads.archived_at IS NULL
        AND projects.deleted_at IS NULL
      ORDER BY
        sources.provider_instance_id ASC,
        sources.local_source_host ASC,
        sources.native_session_id ASC
    `,
  });

  const getCheckpointRow = SqlSchema.findOneOption({
    Request: SourceIdInput,
    Result: ExternalSessionCheckpoint,
    execute: ({ sourceId }) => sql`
      SELECT
        source_id AS "sourceId",
        file_identity AS "fileIdentity",
        committed_prefix_hash AS "committedPrefixHash",
        generation,
        committed_byte_offset AS "committedByteOffset",
        committed_line_ordinal AS "committedLineOrdinal",
        observed_size AS "observedSize",
        observed_mtime_ms AS "observedMtimeMs",
        parser_version AS "parserVersion",
        revision
      FROM external_session_checkpoints
      WHERE source_id = ${sourceId}
      LIMIT 1
    `,
  });

  const getSourceItemRow = SqlSchema.findOneOption({
    Request: SourceItemKeyInput,
    Result: ExternalClaudeSessionSourceItem,
    execute: ({ sourceId, sourceItemKey }) => sql`
      SELECT
        source_id AS "sourceId",
        source_item_key AS "sourceItemKey",
        target_kind AS "targetKind",
        target_id AS "targetId",
        content_hash AS "contentHash",
        created_at AS "createdAt"
      FROM external_session_source_items
      WHERE source_id = ${sourceId}
        AND source_item_key = ${sourceItemKey}
      LIMIT 1
    `,
  });

  const getThreadSummaryRow = SqlSchema.findOneOption({
    Request: ThreadIdInput,
    Result: Schema.Struct({
      threadId: ThreadId,
      sourceId: Schema.String,
      providerInstanceId: ExternalClaudeSessionSource.fields.providerInstanceId,
      nativeSessionId: Schema.String,
      sourcePath: Schema.String,
      sourceCwd: Schema.String,
      state: ExternalClaudeSessionSource.fields.state,
      lastSyncedAt: ExternalClaudeSessionSource.fields.lastSyncedAt,
      diagnostic: Schema.NullOr(Schema.String),
      updatedAt: ExternalClaudeSessionSource.fields.updatedAt,
    }),
    execute: ({ threadId }) => sql`
      SELECT
        thread_id AS "threadId",
        source_id AS "sourceId",
        provider_instance_id AS "providerInstanceId",
        native_session_id AS "nativeSessionId",
        source_path AS "sourcePath",
        source_cwd AS "sourceCwd",
        sync_state AS state,
        last_synced_at AS "lastSyncedAt",
        diagnostic,
        updated_at AS "updatedAt"
      FROM projection_thread_external_sessions
      WHERE thread_id = ${threadId}
      LIMIT 1
    `,
  });

  const createSource: ExternalClaudeSessionRepositoryShape["createSource"] = (source) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO external_session_sources (
          source_id, provider_instance_id, local_source_host, native_session_id,
          source_path, source_cwd, thread_id, sync_state, last_synced_at,
          diagnostic, created_at, updated_at
        ) VALUES (
          ${source.sourceId}, ${source.providerInstanceId}, ${source.localSourceHost},
          ${source.nativeSessionId}, ${source.sourcePath}, ${source.sourceCwd},
          ${source.threadId}, ${source.state}, ${source.lastSyncedAt}, ${source.diagnostic},
          ${source.createdAt}, ${source.updatedAt}
        ) ON CONFLICT DO NOTHING
      `.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("ExternalClaudeSessionRepository.createSource")),
      );
      const existing = yield* getSourceByIdRow({ sourceId: source.sourceId }).pipe(
        Effect.mapError(toPersistenceSqlError("ExternalClaudeSessionRepository.createSource:load")),
      );
      if (Option.isNone(existing)) {
        return yield* new ExternalClaudeSessionSourceConflictError({
          sourceId: source.sourceId,
          detail: "External session source was not persisted.",
        });
      }
      if (
        existing.value.providerInstanceId !== source.providerInstanceId ||
        existing.value.localSourceHost !== source.localSourceHost ||
        existing.value.nativeSessionId !== source.nativeSessionId ||
        existing.value.sourcePath !== source.sourcePath ||
        existing.value.sourceCwd !== source.sourceCwd ||
        existing.value.threadId !== source.threadId
      ) {
        return yield* new ExternalClaudeSessionSourceConflictError({
          sourceId: source.sourceId,
          detail: "External session source conflicts with its persisted attachment.",
        });
      }
    });

  const getSourceById: ExternalClaudeSessionRepositoryShape["getSourceById"] = (sourceId) =>
    getSourceByIdRow({ sourceId }).pipe(
      Effect.mapError(toPersistenceSqlError("ExternalClaudeSessionRepository.getSourceById")),
    );

  const getSourceByIdentity: ExternalClaudeSessionRepositoryShape["getSourceByIdentity"] = (
    identity,
  ) =>
    getSourceByIdentityRow(identity).pipe(
      Effect.mapError(toPersistenceSqlError("ExternalClaudeSessionRepository.getSourceByIdentity")),
    );

  const getSourceByThreadId: ExternalClaudeSessionRepositoryShape["getSourceByThreadId"] = (
    threadId,
  ) =>
    getSourceByThreadIdRow({ threadId }).pipe(
      Effect.mapError(toPersistenceSqlError("ExternalClaudeSessionRepository.getSourceByThreadId")),
    );

  const listActiveAttachmentStatuses: ExternalClaudeSessionRepositoryShape["listActiveAttachmentStatuses"] =
    () =>
      listActiveAttachmentStatusRows().pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ExternalClaudeSessionRepository.listActiveAttachmentStatuses:query",
            "ExternalClaudeSessionRepository.listActiveAttachmentStatuses:decodeRows",
          ),
        ),
      );

  const updateSourceState: ExternalClaudeSessionRepositoryShape["updateSourceState"] = (update) =>
    sql`
      UPDATE external_session_sources
      SET sync_state = ${update.state},
          last_synced_at = ${update.lastSyncedAt},
          diagnostic = ${update.diagnostic},
          updated_at = ${update.updatedAt}
      WHERE source_id = ${update.sourceId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ExternalClaudeSessionRepository.updateSourceState")),
    );

  const deleteSourceByThreadId: ExternalClaudeSessionRepositoryShape["deleteSourceByThreadId"] = (
    threadId,
  ) =>
    sql`
      DELETE FROM external_session_sources
      WHERE thread_id = ${threadId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("ExternalClaudeSessionRepository.deleteSourceByThreadId"),
      ),
    );

  const getCheckpoint: ExternalClaudeSessionRepositoryShape["getCheckpoint"] = (sourceId) =>
    getCheckpointRow({ sourceId }).pipe(
      Effect.mapError(toPersistenceSqlError("ExternalClaudeSessionRepository.getCheckpoint")),
    );

  const createCheckpoint: ExternalClaudeSessionRepositoryShape["createCheckpoint"] = (checkpoint) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO external_session_checkpoints (
          source_id, file_identity, committed_prefix_hash, generation, committed_byte_offset,
          committed_line_ordinal, observed_size, observed_mtime_ms,
          parser_version, revision
        ) VALUES (
          ${checkpoint.sourceId}, ${checkpoint.fileIdentity}, ${checkpoint.committedPrefixHash},
          ${checkpoint.generation}, ${checkpoint.committedByteOffset}, ${checkpoint.committedLineOrdinal},
          ${checkpoint.observedSize}, ${checkpoint.observedMtimeMs},
          ${checkpoint.parserVersion}, ${checkpoint.revision}
        ) ON CONFLICT (source_id) DO NOTHING
      `.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("ExternalClaudeSessionRepository.createCheckpoint")),
      );
      const existing = yield* getCheckpointRow({ sourceId: checkpoint.sourceId }).pipe(
        Effect.mapError(
          toPersistenceSqlError("ExternalClaudeSessionRepository.createCheckpoint:load"),
        ),
      );
      if (Option.isNone(existing)) {
        return yield* new ExternalClaudeSessionSourceConflictError({
          sourceId: checkpoint.sourceId,
          detail: "External session checkpoint was not persisted.",
        });
      }
      if (
        existing.value.fileIdentity !== checkpoint.fileIdentity ||
        existing.value.generation !== checkpoint.generation ||
        existing.value.parserVersion !== checkpoint.parserVersion
      ) {
        return yield* new ExternalClaudeSessionSourceConflictError({
          sourceId: checkpoint.sourceId,
          detail: "External session checkpoint conflicts with its persisted attachment.",
        });
      }
    });

  const getSourceItem: ExternalClaudeSessionRepositoryShape["getSourceItem"] = (input) =>
    getSourceItemRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ExternalClaudeSessionRepository.getSourceItem:query",
          "ExternalClaudeSessionRepository.getSourceItem:decodeRow",
        ),
      ),
    );

  const ensureSourceItem: ExternalClaudeSessionRepositoryShape["ensureSourceItem"] = (item) =>
    Effect.gen(function* () {
      const existing = yield* getSourceItemRow({
        sourceId: item.sourceId,
        sourceItemKey: item.sourceItemKey,
      }).pipe(
        Effect.mapError(toPersistenceSqlError("ExternalClaudeSessionRepository.getSourceItem")),
      );
      if (Option.isSome(existing)) {
        if (
          existing.value.contentHash !== item.contentHash ||
          existing.value.targetKind !== item.targetKind ||
          existing.value.targetId !== item.targetId
        ) {
          return yield* new ExternalClaudeSessionSourceConflictError({
            sourceId: item.sourceId,
            detail: `Source item '${item.sourceItemKey}' changed after import.`,
          });
        }
        return;
      }
      yield* sql`
        INSERT INTO external_session_source_items (
          source_id, source_item_key, target_kind, target_id, content_hash, created_at
        ) VALUES (
          ${item.sourceId}, ${item.sourceItemKey}, ${item.targetKind}, ${item.targetId},
          ${item.contentHash}, ${item.createdAt}
        )
      `.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("ExternalClaudeSessionRepository.ensureSourceItem")),
      );
    });

  const advanceCheckpoint: ExternalClaudeSessionRepositoryShape["advanceCheckpoint"] = (input) =>
    Effect.gen(function* () {
      const current = yield* getCheckpoint(input.checkpoint.sourceId);
      if (Option.isNone(current)) {
        return yield* new ExternalClaudeSessionSourceConflictError({
          sourceId: input.checkpoint.sourceId,
          detail: "Cannot advance a missing external session checkpoint.",
        });
      }
      if (
        current.value.revision >= input.checkpoint.revision &&
        current.value.fileIdentity === input.checkpoint.fileIdentity
      ) {
        return;
      }
      if (
        current.value.revision !== input.expectedRevision ||
        current.value.fileIdentity !== input.checkpoint.fileIdentity
      ) {
        return yield* new ExternalClaudeSessionSourceConflictError({
          sourceId: input.checkpoint.sourceId,
          detail: "External session checkpoint changed while synchronization was in progress.",
        });
      }

      yield* sql`
        UPDATE external_session_checkpoints
        SET committed_prefix_hash = ${input.checkpoint.committedPrefixHash},
            generation = ${input.checkpoint.generation},
            committed_byte_offset = ${input.checkpoint.committedByteOffset},
            committed_line_ordinal = ${input.checkpoint.committedLineOrdinal},
            observed_size = ${input.checkpoint.observedSize},
            observed_mtime_ms = ${input.checkpoint.observedMtimeMs},
            parser_version = ${input.checkpoint.parserVersion},
            revision = ${input.checkpoint.revision}
        WHERE source_id = ${input.checkpoint.sourceId}
          AND file_identity = ${input.checkpoint.fileIdentity}
          AND revision = ${input.expectedRevision}
      `.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("ExternalClaudeSessionRepository.advanceCheckpoint")),
      );

      const advanced = yield* getCheckpoint(input.checkpoint.sourceId);
      if (
        Option.isNone(advanced) ||
        advanced.value.revision !== input.checkpoint.revision ||
        !sourceMatchesCheckpoint(advanced.value, input.checkpoint)
      ) {
        return yield* new ExternalClaudeSessionSourceConflictError({
          sourceId: input.checkpoint.sourceId,
          detail: "External session checkpoint compare-and-swap failed.",
        });
      }
    });

  const upsertThreadSummary: ExternalClaudeSessionRepositoryShape["upsertThreadSummary"] = (
    summary,
    threadId,
  ) =>
    sql`
      INSERT INTO projection_thread_external_sessions (
        thread_id, source_id, provider_instance_id, native_session_id,
        source_path, source_cwd, sync_state, last_synced_at, diagnostic, updated_at
      ) VALUES (
        ${threadId}, ${summary.sourceId}, ${summary.providerInstanceId},
        ${summary.nativeSessionId}, ${summary.sourcePath}, ${summary.sourceCwd},
        ${summary.state}, ${summary.lastSyncedAt}, ${summary.diagnostic}, ${summary.updatedAt}
      )
      ON CONFLICT (thread_id) DO UPDATE SET
        source_id = excluded.source_id,
        provider_instance_id = excluded.provider_instance_id,
        native_session_id = excluded.native_session_id,
        source_path = excluded.source_path,
        source_cwd = excluded.source_cwd,
        sync_state = excluded.sync_state,
        last_synced_at = excluded.last_synced_at,
        diagnostic = excluded.diagnostic,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ExternalClaudeSessionRepository.upsertThreadSummary")),
    );

  const getThreadSummary: ExternalClaudeSessionRepositoryShape["getThreadSummary"] = (threadId) =>
    getThreadSummaryRow({ threadId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ExternalClaudeSessionRepository.getThreadSummary:query",
          "ExternalClaudeSessionRepository.getThreadSummary:decodeRow",
        ),
      ),
      Effect.map(
        Option.map((row) => ({
          sourceId: row.sourceId,
          providerInstanceId: row.providerInstanceId,
          nativeSessionId: row.nativeSessionId,
          sourcePath: row.sourcePath,
          sourceCwd: row.sourceCwd,
          state: row.state,
          lastSyncedAt: row.lastSyncedAt,
          diagnostic: row.diagnostic,
          updatedAt: row.updatedAt,
        })),
      ),
    );

  return {
    createSource,
    getSourceById,
    getSourceByIdentity,
    getSourceByThreadId,
    listActiveAttachmentStatuses,
    updateSourceState,
    deleteSourceByThreadId,
    getCheckpoint,
    createCheckpoint,
    getSourceItem,
    ensureSourceItem,
    advanceCheckpoint,
    upsertThreadSummary,
    getThreadSummary,
  } satisfies ExternalClaudeSessionRepositoryShape;
});

export const ExternalClaudeSessionRepositoryLive = Layer.effect(
  ExternalClaudeSessionRepository,
  makeExternalClaudeSessionRepository,
);
