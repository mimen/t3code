import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const messageColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_messages)
  `;
  if (!messageColumns.some((column) => column.name === "provenance_json")) {
    yield* sql`ALTER TABLE projection_thread_messages ADD COLUMN provenance_json TEXT`;
  }
  if (!messageColumns.some((column) => column.name === "timeline_order_key")) {
    yield* sql`ALTER TABLE projection_thread_messages ADD COLUMN timeline_order_key TEXT`;
  }

  const activityColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_activities)
  `;
  if (!activityColumns.some((column) => column.name === "provenance_json")) {
    yield* sql`ALTER TABLE projection_thread_activities ADD COLUMN provenance_json TEXT`;
  }
  if (!activityColumns.some((column) => column.name === "timeline_order_key")) {
    yield* sql`ALTER TABLE projection_thread_activities ADD COLUMN timeline_order_key TEXT`;
  }

  yield* sql`
    CREATE TABLE IF NOT EXISTS external_session_sources (
      source_id TEXT PRIMARY KEY,
      provider_instance_id TEXT NOT NULL,
      local_source_host TEXT NOT NULL,
      native_session_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_cwd TEXT NOT NULL,
      thread_id TEXT NOT NULL UNIQUE,
      sync_state TEXT NOT NULL,
      last_synced_at TEXT,
      diagnostic TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (provider_instance_id, local_source_host, native_session_id)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS external_session_source_items (
      source_id TEXT NOT NULL,
      source_item_key TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (source_id, source_item_key),
      FOREIGN KEY (source_id) REFERENCES external_session_sources(source_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS external_session_checkpoints (
      source_id TEXT PRIMARY KEY,
      file_identity TEXT NOT NULL,
      committed_prefix_hash TEXT NOT NULL,
      generation INTEGER NOT NULL,
      committed_byte_offset INTEGER NOT NULL,
      committed_line_ordinal INTEGER NOT NULL,
      observed_size INTEGER NOT NULL,
      observed_mtime_ms INTEGER NOT NULL,
      parser_version TEXT NOT NULL,
      revision INTEGER NOT NULL,
      FOREIGN KEY (source_id) REFERENCES external_session_sources(source_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_external_sessions (
      thread_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      native_session_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_cwd TEXT NOT NULL,
      sync_state TEXT NOT NULL,
      last_synced_at TEXT,
      diagnostic TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES external_session_sources(source_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_external_session_sources_path
    ON external_session_sources(source_path)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_external_session_source_items_target
    ON external_session_source_items(target_kind, target_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_messages_timeline
    ON projection_thread_messages(thread_id, timeline_order_key, message_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_timeline
    ON projection_thread_activities(thread_id, timeline_order_key, activity_id)
  `;
});
