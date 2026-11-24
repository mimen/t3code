import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** A bot file's stem. A plain file name, so `<botsDirectory>/<id>.md` never leaves the directory. */
export const ForkBotId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
);
export type ForkBotId = typeof ForkBotId.Type;

/** One bot file, as the sidebar and breadcrumb show it. The brief body stays on the server. */
export const ForkBot = Schema.Struct({
  id: ForkBotId,
  name: Schema.String,
  /** A lucide icon name from frontmatter. */
  icon: Schema.optional(Schema.String),
  color: Schema.optional(Schema.String),
  /** Absolute path, for the file viewer. */
  path: Schema.String,
});
export type ForkBot = typeof ForkBot.Type;

export const ForkBotsListResult = Schema.Struct({
  /** Null while the bots directory setting is empty. */
  directory: Schema.NullOr(Schema.String),
  bots: Schema.Array(ForkBot),
});
export type ForkBotsListResult = typeof ForkBotsListResult.Type;
