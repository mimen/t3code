/**
 * The fork's own migration sequence. It runs after upstream's, records into
 * `fork_sql_migrations`, and numbers from 1, so upstream's ids in
 * `effect_sql_migrations` can never collide with or be skipped by a fork id.
 */
import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";

import Migration0001 from "./001_ExternalClaudeSessions.ts";
import Migration0002 from "./002_ExternalClaudeSessionPrefixHash.ts";
import Migration0003 from "./003_ExternalClaudeSessionTimelinePageIndexes.ts";
import Migration0004 from "./004_ExternalClaudeSessionTimelinePageOrderingIndexes.ts";

export const FORK_MIGRATIONS_TABLE = "fork_sql_migrations";

export const forkMigrationEntries = [
  [1, "ExternalClaudeSessions", Migration0001],
  [2, "ExternalClaudeSessionPrefixHash", Migration0002],
  [3, "ExternalClaudeSessionTimelinePageIndexes", Migration0003],
  [4, "ExternalClaudeSessionTimelinePageOrderingIndexes", Migration0004],
] as const;

const run = Migrator.make({});

export const runForkMigrations = Effect.fn("runForkMigrations")(function* () {
  const executed = yield* run({
    table: FORK_MIGRATIONS_TABLE,
    loader: Migrator.fromRecord(
      Object.fromEntries(
        forkMigrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
      ),
    ),
  });
  if (executed.length > 0) {
    yield* Effect.log("Fork migrations ran successfully").pipe(
      Effect.annotateLogs({ migrations: executed.map(([id, name]) => `${id}_${name}`) }),
    );
  }
  return executed;
});
