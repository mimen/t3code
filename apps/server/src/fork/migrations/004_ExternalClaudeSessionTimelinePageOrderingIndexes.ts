import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DROP INDEX IF EXISTS idx_projection_thread_messages_timeline_page`;
  yield* sql`DROP INDEX IF EXISTS idx_projection_thread_activities_timeline_page`;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_messages_timeline_page
    ON projection_thread_messages(
      thread_id,
      created_at,
      COALESCE(timeline_order_key, created_at || ':' || message_id),
      message_id
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_timeline_page
    ON projection_thread_activities(
      thread_id,
      created_at,
      COALESCE(timeline_order_key, created_at || ':' || activity_id),
      activity_id
    )
  `;
});
