import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries } from "../../persistence/Migrations.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { forkMigrationEntries, runForkMigrations } from "./ForkMigrations.ts";

it.layer(SqlitePersistenceMemory)("fork migrations", (it) => {
  it.effect("a fresh database runs both sequences, each in its own table", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const upstream = yield* sql<{ readonly migration_id: number }>`
        SELECT migration_id FROM effect_sql_migrations ORDER BY migration_id
      `;
      assert.deepStrictEqual(
        upstream.map((row) => row.migration_id),
        migrationEntries.map(([id]) => id),
      );

      const fork = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM fork_sql_migrations ORDER BY migration_id
      `;
      assert.deepStrictEqual(
        fork.map((row) => [row.migration_id, row.name]),
        forkMigrationEntries.map(([id, name]) => [id, name]),
      );

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'external_session%'
        ORDER BY name
      `;
      assert.deepStrictEqual(
        tables.map((table) => table.name),
        ["external_session_checkpoints", "external_session_source_items", "external_session_sources"],
      );
    }),
  );

  it.effect("a second run is a no-op", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* runForkMigrations(), []);
    }),
  );
});
