import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";

import { ProviderInstanceId } from "@t3tools/contracts";

import * as ServerSettings from "../serverSettings.ts";
import * as CodexAdapterV2 from "./Adapters/CodexAdapterV2.ts";
import * as ForkBots from "./ForkBots.ts";

const withBots = (forkBotsDirectory: string, warnings: Array<string> = []) =>
  Effect.provide(
    Layer.mergeAll(
      ForkBots.layer.pipe(Layer.provide(ServerSettings.layerTest({ forkBotsDirectory }))),
      Logger.layer([Logger.make(({ message }) => void warnings.push(JSON.stringify(message)))], {
        mergeWithExisting: false,
      }),
    ),
  );

const botsDirectory = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-bots-" });
  const write = (name: string, contents: string) =>
    fs.writeFileString(path.join(dir, name), contents);
  yield* write(
    "needs-you.md",
    "---\nname: Needs you\nicon: inbox\ncolor: amber\n---\nTriage the needs-you queue.\n",
  );
  yield* write("plain.md", "Just a brief.");
  yield* write("broken.md", "---\nname: [unclosed\n---\nBody after bad frontmatter.");
  yield* write("empty.md", "---\nname: Empty\n---\n");
  yield* write("notes.txt", "not a bot");
  yield* write("bad id.md", "stem is not a bot id");
  return { dir: yield* fs.realPath(dir), path };
});

it.describe("parseBotFile", () => {
  it("reads frontmatter fields and the body after it", () => {
    assert.deepEqual(ForkBots.parseBotFile("---\nname: A\nicon: bot\n---\n\nBody\n"), {
      name: "A",
      icon: "bot",
      brief: "Body",
    });
  });

  it("ignores malformed frontmatter but keeps the body", () => {
    assert.deepEqual(ForkBots.parseBotFile("---\nname: [x\n---\nBody"), { brief: "Body" });
  });

  it("treats a file without frontmatter as all body", () => {
    assert.deepEqual(ForkBots.parseBotFile("Body only"), { brief: "Body only" });
  });
});

it.layer(NodeServices.layer)("ForkBots", (it) => {
  it.effect("lists only .md files whose stem is a bot id, named from frontmatter or stem", () =>
    Effect.gen(function* () {
      const { dir, path } = yield* botsDirectory;
      const result = yield* Effect.flatMap(ForkBots.ForkBots, (bots) => bots.list).pipe(
        withBots(dir),
      );
      assert.equal(result.directory, dir);
      assert.deepEqual(result.bots, [
        { id: "broken", name: "broken", path: path.join(dir, "broken.md") },
        { id: "empty", name: "Empty", path: path.join(dir, "empty.md") },
        {
          id: "needs-you",
          name: "Needs you",
          icon: "inbox",
          color: "amber",
          path: path.join(dir, "needs-you.md"),
        },
        { id: "plain", name: "plain", path: path.join(dir, "plain.md") },
      ]);
    }),
  );

  it.effect("reads a brief fresh from disk on every call", () =>
    Effect.gen(function* () {
      const { dir, path } = yield* botsDirectory;
      const fs = yield* FileSystem.FileSystem;
      yield* Effect.gen(function* () {
        const bots = yield* ForkBots.ForkBots;
        assert.equal(yield* bots.readBrief("needs-you"), "Triage the needs-you queue.");
        yield* fs.writeFileString(path.join(dir, "needs-you.md"), "Edited brief.");
        assert.equal(yield* bots.readBrief("needs-you"), "Edited brief.");
        assert.equal(yield* bots.readBrief("broken"), "Body after bad frontmatter.");
        assert.isUndefined(yield* bots.readBrief("empty"));
      }).pipe(withBots(dir));
    }),
  );

  it.effect("returns no brief and warns with the bot and path when the file is missing", () =>
    Effect.gen(function* () {
      const { dir, path } = yield* botsDirectory;
      const warnings: Array<string> = [];
      const brief = yield* Effect.flatMap(ForkBots.ForkBots, (bots) => bots.readBrief("gone")).pipe(
        withBots(dir, warnings),
      );
      assert.isUndefined(brief);
      assert.isTrue(
        warnings.some(
          (warning) =>
            warning.includes("bot file missing or unreadable") &&
            warning.includes('"botId":"gone"') &&
            warning.includes(JSON.stringify(path.join(dir, "gone.md"))),
        ),
        warnings.join("\n"),
      );
    }),
  );

  it.effect("rejects an id that would leave the directory", () =>
    Effect.gen(function* () {
      const { dir } = yield* botsDirectory;
      const brief = yield* Effect.flatMap(ForkBots.ForkBots, (bots) =>
        bots.readBrief("../needs-you"),
      ).pipe(withBots(dir));
      assert.isUndefined(brief);
    }),
  );

  it.effect("is off with an empty setting or an unreadable directory", () =>
    Effect.gen(function* () {
      const { dir, path } = yield* botsDirectory;
      for (const directory of ["", path.join(dir, "missing")]) {
        yield* Effect.gen(function* () {
          const bots = yield* ForkBots.ForkBots;
          assert.deepEqual(yield* bots.list, { directory: null, bots: [] });
        }).pipe(withBots(directory));
      }
      assert.isUndefined(
        yield* Effect.flatMap(ForkBots.ForkBots, (bots) => bots.readBrief("needs-you")).pipe(
          withBots(""),
        ),
      );
    }),
  );
});

it.describe("Codex bot context", () => {
  const build = (botInstructions: string | undefined, hasT3Mcp: boolean) =>
    CodexAdapterV2.buildCodexTurnStartParams({
      nativeThreadId: "native-bot",
      codexInput: [{ type: "text", text: "test" }],
      runtimePolicy: { runtimeMode: "full-access", interactionMode: "default", cwd: "/work/app" },
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      hasT3Mcp,
      botInstructions,
    });

  it.effect("sends the bot block as its own entry, with or without T3 Code's MCP tools", () =>
    Effect.gen(function* () {
      const bot = '<bot id="needs-you">\nTriage the queue.\n</bot>';
      const withoutMcp = yield* build(bot, false);
      assert.deepEqual(withoutMcp.additionalContext, {
        t3_code_bot_01: { kind: "application", value: bot },
      });
      assert.deepEqual((yield* build(bot, true)).additionalContext?.t3_code_bot_01, {
        kind: "application",
        value: bot,
      });
      assert.isUndefined((yield* build(undefined, false)).additionalContext);
    }),
  );

  it.effect("splits a long brief at line breaks into numbered entries under the cap", () =>
    Effect.gen(function* () {
      const bot = Array.from({ length: 300 }, (_, index) => `line ${index} ${"é".repeat(20)}`).join(
        "\n",
      );
      const context = (yield* build(bot, false)).additionalContext ?? {};
      const keys = Object.keys(context);
      assert.isAbove(keys.length, 1);
      assert.deepEqual(
        keys,
        keys.map((_, index) => `t3_code_bot_${String(index + 1).padStart(2, "0")}`),
      );
      const values = keys.map((key) => context[key]!.value);
      for (const value of values) assert.isAtMost(Buffer.byteLength(value), 4_000);
      assert.equal(values.join("\n"), bot);
    }),
  );
});

it.layer(NodeServices.layer)("forkBotInstructions", (it) => {
  it.effect("wraps the brief in a bot block, and gives none for a missing file", () =>
    Effect.gen(function* () {
      const { dir } = yield* botsDirectory;
      yield* Effect.gen(function* () {
        const bots = yield* ForkBots.ForkBots;
        assert.equal(
          yield* ForkBots.forkBotInstructions(bots, "needs-you"),
          '<bot id="needs-you">\nThis thread holds a standing bot. Its brief, from needs-you.md:\n\nTriage the needs-you queue.\n</bot>',
        );
        assert.isUndefined(yield* ForkBots.forkBotInstructions(bots, "gone"));
        assert.isUndefined(yield* ForkBots.forkBotInstructions(bots, null));
      }).pipe(withBots(dir));
    }),
  );
});
