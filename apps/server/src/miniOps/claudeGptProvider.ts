import {
  type ClaudeSettings,
  type ModelCapabilities,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
  type ServerSettingsError,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ServerSettingsService } from "../serverSettings.ts";

export const CLAUDE_GPT_INSTANCE_ID = ProviderInstanceId.make("claude-gpt");
export const CLAUDE_GPT_GATEWAY_BASE_URL = "http://127.0.0.1:8317";

const CLAUDE_GPT_DRIVER = ProviderDriverKind.make("claudeAgent");

const effortCapabilities = (
  defaultEffort: string,
  efforts: ReadonlyArray<readonly [string, string]>,
): ModelCapabilities => ({
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: efforts.map(([id, label]) => ({
        id,
        label,
        ...(id === defaultEffort ? { isDefault: true } : {}),
      })),
    },
  ],
});

export const CLAUDE_GPT_MODEL_PROFILES = {
  "gpt-5.6-sol": {
    name: "GPT-5.6 Sol",
    capabilities: effortCapabilities("high", [
      ["low", "Low"],
      ["medium", "Medium"],
      ["high", "High"],
    ]),
  },
  "gpt-5.6-terra": {
    name: "GPT-5.6 Terra",
    capabilities: effortCapabilities("medium", [
      ["low", "Low"],
      ["medium", "Medium"],
      ["high", "High"],
      ["xhigh", "Extra High"],
    ]),
  },
  "gpt-5.6-luna": {
    name: "GPT-5.6 Luna",
    capabilities: effortCapabilities("low", [["low", "Low"]]),
  },
  "gpt-5.5": {
    name: "GPT-5.5",
    capabilities: effortCapabilities("medium", [
      ["low", "Low"],
      ["medium", "Medium"],
      ["high", "High"],
    ]),
  },
} satisfies ClaudeSettings["customModelProfiles"];

export const CLAUDE_GPT_CUSTOM_MODELS = [
  "gpt-5.6-sol[1m]",
  "gpt-5.6-terra[1m]",
  "gpt-5.6-luna[1m]",
  "gpt-5.5[1m]",
] as const;

export interface ConfigureClaudeGptProviderInput {
  readonly gatewayKey: string;
  readonly claudeCliPath: string;
  readonly claudeCliSha256: string;
  readonly claudeHomePath: string;
}

/**
 * The local `claude-gpt` wrapper is not a Claude Code executable: it can replace
 * provider environment variables and force a permission mode. The Mini operation
 * must invoke the actual Claude CLI so the key and T3 permission controls apply.
 */
export function isForbiddenClaudeGptWrapperPath(claudeCliPath: string): boolean {
  return claudeCliPath.replace(/\/+$/, "").endsWith("/claude-gpt");
}

function claudeGptSettings(input: ConfigureClaudeGptProviderInput): ClaudeSettings {
  return {
    enabled: true,
    binaryPath: input.claudeCliPath,
    binarySha256: input.claudeCliSha256,
    homePath: input.claudeHomePath,
    customModels: [...CLAUDE_GPT_CUSTOM_MODELS],
    includeBuiltInModels: false,
    customModelProfiles: CLAUDE_GPT_MODEL_PROFILES,
    launchArgs: "",
  };
}

export function buildClaudeGptProviderPatch(
  current: ServerSettings,
  input: ConfigureClaudeGptProviderInput,
): ServerSettingsPatch {
  return {
    providerInstances: {
      ...current.providerInstances,
      [CLAUDE_GPT_INSTANCE_ID]: {
        driver: CLAUDE_GPT_DRIVER,
        displayName: "Claude-GPT",
        accentColor: "#10A37F",
        iconKey: "openai",
        enabled: true,
        environment: [
          {
            name: "ANTHROPIC_BASE_URL",
            value: CLAUDE_GPT_GATEWAY_BASE_URL,
            sensitive: false,
          },
          {
            name: "ANTHROPIC_AUTH_TOKEN",
            value: input.gatewayKey,
            sensitive: true,
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
        ],
        config: claudeGptSettings(input),
      },
    },
  };
}

export const configureClaudeGptProvider = Effect.fn("configureClaudeGptProvider")(function* (
  input: ConfigureClaudeGptProviderInput,
): Effect.fn.Return<void, ServerSettingsError, ServerSettingsService> {
  const serverSettings = yield* ServerSettingsService;
  const current = yield* serverSettings.getSettings;
  yield* serverSettings.updateSettings(buildClaudeGptProviderPatch(current, input));
});
