import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { GATEWAY_KEY_FD_TIMEOUT_MS } from "../cli/mini.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  CLAUDE_GPT_CUSTOM_MODELS,
  CLAUDE_GPT_GATEWAY_BASE_URL,
  CLAUDE_GPT_INSTANCE_ID,
  configureClaudeGptProvider,
  isForbiddenClaudeGptWrapperPath,
} from "./claudeGptProvider.ts";

const CODEX_PERSONAL_INSTANCE_ID = ProviderInstanceId.make("codex-personal");
const CODEX_DRIVER = ProviderDriverKind.make("codex");

const makeServerSettingsLayer = () =>
  ServerSettings.layer.pipe(
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-mini-claude-gpt-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("Mini claude-gpt provider", (it) => {
  it.effect("preserves existing provider instances and redacts gateway credentials", () =>
    Effect.gen(function* () {
      assert.strictEqual(isForbiddenClaudeGptWrapperPath("/opt/homebrew/bin/claude-gpt"), true);
      assert.strictEqual(isForbiddenClaudeGptWrapperPath("/opt/homebrew/bin/claude"), false);
      assert.strictEqual(GATEWAY_KEY_FD_TIMEOUT_MS, 30_000);

      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const secretStore = yield* ServerSecretStore.ServerSecretStore;
      const serverSettings = yield* ServerSettings.ServerSettingsService;

      yield* serverSettings.updateSettings({
        providerInstances: {
          [CODEX_PERSONAL_INSTANCE_ID]: {
            driver: CODEX_DRIVER,
            environment: [
              {
                name: "OPENAI_API_KEY",
                value: "test-existing-provider-key",
                sensitive: true,
              },
            ],
            config: {},
          },
        },
      });

      yield* configureClaudeGptProvider({
        gatewayKey: "test-gateway-key",
        claudeCliPath: "/opt/homebrew/bin/claude",
        claudeCliSha256: "a".repeat(64),
        claudeHomePath: "/Users/mini/.config/claude-gpt",
      });

      const settings = yield* serverSettings.getSettings;
      assert.deepEqual(Object.keys(settings.providerInstances).sort(), [
        "claude-gpt",
        "codex-personal",
      ]);

      const claudeGpt = settings.providerInstances[CLAUDE_GPT_INSTANCE_ID];
      if (claudeGpt === undefined) {
        return yield* Effect.die("Expected the claude-gpt provider instance.");
      }
      assert.strictEqual(claudeGpt.driver, "claudeAgent");
      assert.strictEqual(claudeGpt.displayName, "Claude-GPT");
      assert.strictEqual(claudeGpt.iconKey, "openai");
      assert.deepEqual(claudeGpt.environment, [
        {
          name: "ANTHROPIC_BASE_URL",
          value: CLAUDE_GPT_GATEWAY_BASE_URL,
          sensitive: false,
        },
        {
          name: "ANTHROPIC_AUTH_TOKEN",
          value: "test-gateway-key",
          sensitive: true,
          valueRedacted: true,
        },
        {
          name: "CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK",
          value: "1",
          sensitive: false,
        },
        {
          name: "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
          value: "372000",
          sensitive: false,
        },
      ]);
      assert.strictEqual(
        (claudeGpt.config as { binarySha256: string }).binarySha256,
        "a".repeat(64),
      );
      assert.deepEqual((claudeGpt.config as { customModels: ReadonlyArray<string> }).customModels, [
        ...CLAUDE_GPT_CUSTOM_MODELS,
      ]);
      assert.deepEqual(
        Object.keys(
          (claudeGpt.config as { customModelProfiles: Record<string, unknown> })
            .customModelProfiles,
        ).sort(),
        ["gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"],
      );

      const persistedSettings = yield* fileSystem.readFileString(config.settingsPath);
      assert.notInclude(persistedSettings, "test-gateway-key");
      assert.notInclude(persistedSettings, "test-existing-provider-key");
      assert.include(persistedSettings, '"valueRedacted": true');

      const existingSecret = yield* secretStore.get(
        "provider-env-Y29kZXgtcGVyc29uYWw-T1BFTkFJX0FQSV9LRVk",
      );
      assert.strictEqual(Option.isSome(existingSecret), true);
      if (Option.isSome(existingSecret)) {
        assert.strictEqual(
          new TextDecoder().decode(existingSecret.value),
          "test-existing-provider-key",
        );
      }
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});
