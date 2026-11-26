import {
  ForkBotId,
  OrchestratorMcpFailure,
  type ForkBot,
  type ForkBotsListResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { parse as parseYamlDocument } from "yaml";

import { expandHomePath } from "../os-jank.ts";
import { CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES } from "../provider/CodexDeveloperInstructions.ts";
import * as ServerSettings from "../serverSettings.ts";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const isForkBotId = Schema.is(ForkBotId);

export interface ParsedBotFile {
  readonly name?: string;
  readonly icon?: string;
  readonly color?: string;
  readonly brief: string;
}

export function parseBotFile(contents: string): ParsedBotFile {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (!match) return { brief: contents.trim() };
  const brief = contents.slice(match[0].length).trim();
  let parsed: unknown;
  try {
    parsed = parseYamlDocument(match[1] ?? "");
  } catch {
    return { brief };
  }
  if (typeof parsed !== "object" || parsed === null) return { brief };
  const record = parsed as Record<string, unknown>;
  const field = (key: string) => {
    const value = record[key];
    return typeof value === "string" && value.trim() ? { [key]: value.trim() } : {};
  };
  return { ...field("name"), ...field("icon"), ...field("color"), brief };
}

export interface ForkBotsShape {
  readonly list: Effect.Effect<ForkBotsListResult>;
  /** The bot file's body, or undefined when bots are off, the file is missing, or the body is empty. */
  readonly readBrief: (botId: string) => Effect.Effect<string | undefined>;
}

/** Fork: bot briefs in the `forkBotsDirectory` folder, read fresh on every call. Off unless provided. */
export class ForkBots extends Context.Reference<ForkBotsShape>("t3/orchestration-v2/ForkBots", {
  defaultValue: () => ({
    list: Effect.succeed({ directory: null, bots: [] }),
    readBrief: () => Effect.undefined,
  }),
}) {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const directory = serverSettings.getSettings.pipe(
    Effect.flatMap((settings) =>
      settings.forkBotsDirectory === ""
        ? Effect.succeed(null)
        : expandHomePath(settings.forkBotsDirectory).pipe(
            Effect.map((dir) => path.resolve(dir)),
            Effect.provideService(Path.Path, path),
          ),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("bots: settings read failed", { cause }).pipe(Effect.as(null)),
    ),
  );

  const botPath = (dir: string, botId: string) => {
    const file = path.resolve(dir, `${botId}.md`);
    return path.dirname(file) === dir ? file : null;
  };

  const list: ForkBotsShape["list"] = Effect.gen(function* () {
    const dir = yield* directory;
    if (dir === null) return { directory: null, bots: [] };
    const entries = yield* fileSystem
      .readDirectory(dir)
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("bots: directory unreadable", { path: dir, cause }).pipe(
            Effect.as(null),
          ),
        ),
      );
    if (entries === null) return { directory: null, bots: [] };
    const bots: Array<ForkBot> = [];
    for (const entry of entries.toSorted()) {
      if (!entry.endsWith(".md")) continue;
      const id = entry.slice(0, -".md".length);
      if (!isForkBotId(id)) continue;
      const file = path.join(dir, entry);
      const contents = yield* fileSystem.readFileString(file).pipe(Effect.option);
      if (contents._tag === "None") continue;
      const { name, icon, color } = parseBotFile(contents.value);
      bots.push({
        id,
        name: name ?? id,
        ...(icon ? { icon } : {}),
        ...(color ? { color } : {}),
        path: file,
      });
    }
    return { directory: dir, bots };
  });

  const readBrief: ForkBotsShape["readBrief"] = Effect.fn("ForkBots.readBrief")(function* (
    botId: string,
  ) {
    const dir = yield* directory;
    if (dir === null) return undefined;
    const file = isForkBotId(botId) ? botPath(dir, botId) : null;
    if (file === null) {
      yield* Effect.logWarning("bots: invalid bot id", { botId, path: dir });
      return undefined;
    }
    const contents = yield* fileSystem.readFileString(file).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("bots: bot file missing or unreadable", {
          botId,
          path: file,
          cause,
        }).pipe(Effect.as(undefined)),
      ),
    );
    const brief = contents === undefined ? "" : parseBotFile(contents).brief;
    return brief === "" ? undefined : brief;
  });

  return ForkBots.of({ list, readBrief });
});

export const layer = Layer.effect(ForkBots, make);

/** The bot `t3_thread_organize` sets, once its file is confirmed to exist. */
export const forkBotToSet = Effect.fn("ForkBots.botToSet")(function* (input: {
  readonly botId?: ForkBotId | undefined;
}) {
  const { directory, bots } = yield* (yield* ForkBots).list;
  const invalid = (message: string) =>
    new OrchestratorMcpFailure({ code: "invalid_request", message });
  if (directory === null) {
    return yield* invalid("No bots directory is set. Set it in Settings before assigning a bot.");
  }
  const available = `Available bots: ${bots.map((bot) => bot.id).join(", ") || "none"}.`;
  if (input.botId === undefined) return yield* invalid(`set_bot requires botId. ${available}`);
  if (!bots.some((bot) => bot.id === input.botId)) {
    return yield* invalid(`No bot file ${input.botId}.md in ${directory}. ${available}`);
  }
  return input.botId;
});

/** The `<bot>` block a bot thread's agent gets at session start, or undefined when it has no brief. */
export const forkBotInstructions = Effect.fn("ForkBots.instructions")(function* (
  bots: ForkBotsShape,
  botId: string | null | undefined,
) {
  if (!botId) return undefined;
  const brief = yield* bots.readBrief(botId);
  if (brief === undefined) return undefined;
  return `<bot id="${botId}">\nThis thread holds a standing bot. Its brief, from ${botId}.md:\n\n${brief}\n</bot>`;
});

/** Codex `turn/start` entries for the bot block, split at line breaks to fit the per-entry cap. */
export function forkBotCodexContext(botInstructions: string | undefined) {
  if (!botInstructions) return undefined;
  const chunks: Array<string> = [];
  let current = "";
  let bytes = 0;
  for (const char of botInstructions) {
    const size = Buffer.byteLength(char);
    // A cut can leave a remainder that the next character still overflows.
    while (bytes + size > CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES) {
      const cut = current.lastIndexOf("\n");
      chunks.push(cut > 0 ? current.slice(0, cut) : current);
      current = cut > 0 ? current.slice(cut + 1) : "";
      bytes = Buffer.byteLength(current);
    }
    current += char;
    bytes += size;
  }
  chunks.push(current);
  return Object.fromEntries(
    chunks.map((value, index) => [
      `t3_code_bot_${String(index + 1).padStart(2, "0")}`,
      { kind: "application" as const, value },
    ]),
  );
}
