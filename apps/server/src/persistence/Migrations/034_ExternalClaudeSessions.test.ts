import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("034_ExternalClaudeSessions", (it) => {
  it.effect("adds external source persistence and timeline provenance columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 33 });
      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* runMigrations({ toMigrationInclusive: 35 });

      const externalTables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'external_session_sources',
            'external_session_source_items',
            'external_session_checkpoints',
            'projection_thread_external_sessions'
          )
        ORDER BY name ASC
      `;
      assert.deepStrictEqual(
        externalTables.map((table) => table.name),
        [
          "external_session_checkpoints",
          "external_session_source_items",
          "external_session_sources",
          "projection_thread_external_sessions",
        ],
      );

      const checkpointColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(external_session_checkpoints)
      `;
      assert.ok(checkpointColumns.some((column) => column.name === "committed_prefix_hash"));

      const messageColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_messages)
      `;
      assert.ok(messageColumns.some((column) => column.name === "provenance_json"));
      assert.ok(messageColumns.some((column) => column.name === "timeline_order_key"));

      const activityColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_activities)
      `;
      assert.ok(activityColumns.some((column) => column.name === "provenance_json"));
      assert.ok(activityColumns.some((column) => column.name === "timeline_order_key"));
    }),
  );
});
