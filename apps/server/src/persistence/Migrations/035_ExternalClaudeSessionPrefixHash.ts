import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(external_session_checkpoints)
  `;
  if (!columns.some((column) => column.name === "committed_prefix_hash")) {
    yield* sql`
      ALTER TABLE external_session_checkpoints
      ADD COLUMN committed_prefix_hash TEXT NOT NULL DEFAULT 'unverified'
    `;
  }
});
