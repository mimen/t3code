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
  CLAUDE_GPT_MODEL_PROFILES,
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
      // Presentation reflects that this instance serves BOTH vendors through the
      // local gateway; the instance id stays "claude-gpt" because
      // ClaudeBinaryIntegrity requires a pinned CLI hash for exactly that id.
      assert.strictEqual(claudeGpt.displayName, "Claude Code (local gateway)");
      assert.strictEqual(claudeGpt.iconKey, "claude");
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
        [
          "claude-fable-5",
          "claude-haiku-4-5-20251001",
          "claude-opus-4-6",
          "claude-opus-4-7",
          "claude-opus-4-8",
          "claude-opus-5",
          "claude-sonnet-4-5-20250929",
          "claude-sonnet-4-6",
          "claude-sonnet-5",
          "gpt-5.3-codex-spark",
          "gpt-5.4",
          "gpt-5.4-mini",
          "gpt-5.5",
          "gpt-5.6-luna",
          "gpt-5.6-sol",
          "gpt-5.6-terra",
        ],
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

it("orders the model catalogue modern Claude, modern GPT, older Claude, then older GPT", () => {
  const strippedSlugs = CLAUDE_GPT_CUSTOM_MODELS.map((model) => model.replace(/\[1m\]$/, ""));

  assert.deepEqual(strippedSlugs, [
    // Modern Claude
    "claude-fable-5",
    "claude-opus-5",
    "claude-sonnet-5",
    // Modern GPT
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    // Older Claude
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001",
    // Older GPT
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex-spark",
  ]);

  // Every custom model slug must resolve to a profile keyed by its bare slug.
  for (const slug of strippedSlugs) {
    assert.property(CLAUDE_GPT_MODEL_PROFILES, slug);
  }
});

it("gives every GPT model a low/medium/high effort dial, with Sol defaulting to high", () => {
  for (const slug of ["gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"]) {
    const descriptor =
      CLAUDE_GPT_MODEL_PROFILES[slug as keyof typeof CLAUDE_GPT_MODEL_PROFILES].capabilities
        .optionDescriptors?.[0];
    assert.strictEqual(descriptor?.id, "effort");
    assert.deepEqual(
      descriptor?.type === "select" ? descriptor.options.map((option) => option.id) : [],
      ["low", "medium", "high"],
    );
  }

  const solEffort = CLAUDE_GPT_MODEL_PROFILES["gpt-5.6-sol"].capabilities.optionDescriptors?.[0];
  assert.strictEqual(
    solEffort?.type === "select"
      ? solEffort.options.find((option) => option.isDefault)?.id
      : undefined,
    "high",
  );
});

it("mirrors the built-in Claude effort option sets and leaves Haiku without an effort dial", () => {
  const fableEffort =
    CLAUDE_GPT_MODEL_PROFILES["claude-fable-5"].capabilities.optionDescriptors?.[0];
  assert.deepEqual(
    fableEffort?.type === "select" ? fableEffort.options.map((option) => option.id) : [],
    ["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"],
  );
  assert.deepEqual(fableEffort?.type === "select" ? fableEffort.promptInjectedValues : undefined, [
    "ultrathink",
  ]);

  const opus47Effort =
    CLAUDE_GPT_MODEL_PROFILES["claude-opus-4-7"].capabilities.optionDescriptors?.[0];
  assert.strictEqual(
    opus47Effort?.type === "select"
      ? opus47Effort.options.find((option) => option.isDefault)?.id
      : undefined,
    "xhigh",
  );

  assert.deepEqual(CLAUDE_GPT_MODEL_PROFILES["claude-haiku-4-5-20251001"].capabilities, {
    optionDescriptors: [],
  });
});
