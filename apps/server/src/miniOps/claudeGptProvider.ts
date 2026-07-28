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
  promptInjectedValues?: ReadonlyArray<string>,
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
      ...(promptInjectedValues && promptInjectedValues.length > 0
        ? { promptInjectedValues: [...promptInjectedValues] }
        : {}),
    },
  ],
});

/** Models with no reasoning-effort dial at all (mirrors Claude Haiku's built-in catalog entry). */
const NO_EFFORT_CAPABILITIES: ModelCapabilities = { optionDescriptors: [] };

// Reasoning-effort option sets below are mirrored from the built-in Claude
// model catalog (`ClaudeModelCatalog.ts`) so effort semantics are identical
// whether a Claude model is reached natively or through the claude-gpt
// gateway. `ultrathink` is a prompt-injected mode and `ultracode` is a
// Claude Code CLI setting; both are handled generically by the Claude driver
// regardless of which model they're attached to, so they behave the same way
// here as they do for the default Claude provider.
const CLAUDE_FLAGSHIP_EFFORTS: ReadonlyArray<readonly [string, string]> = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra High"],
  ["max", "Max"],
  ["ultracode", "Ultracode"],
  ["ultrathink", "Ultrathink"],
];
const CLAUDE_SONNET_5_EFFORTS: ReadonlyArray<readonly [string, string]> = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra High"],
  ["max", "Max"],
  ["ultrathink", "Ultrathink"],
];
const CLAUDE_OPUS_4_7_EFFORTS: ReadonlyArray<readonly [string, string]> = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra High"],
  ["max", "Max"],
  ["ultrathink", "Ultrathink"],
];
const CLAUDE_MID_TIER_EFFORTS: ReadonlyArray<readonly [string, string]> = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["max", "Max"],
  ["ultrathink", "Ultrathink"],
];
/** No `xhigh`/`ultrathink`: mirrors the older Opus 4.5 built-in entry. */
const CLAUDE_LEGACY_EFFORTS: ReadonlyArray<readonly [string, string]> = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["max", "Max"],
];
const GPT_STANDARD_EFFORTS: ReadonlyArray<readonly [string, string]> = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
];

export const CLAUDE_GPT_MODEL_PROFILES = {
  // ── Modern Claude ────────────────────────────────────────────────
  "claude-fable-5": {
    name: "Claude Fable 5",
    capabilities: effortCapabilities("high", CLAUDE_FLAGSHIP_EFFORTS, ["ultrathink"]),
  },
  "claude-opus-5": {
    name: "Claude Opus 5",
    capabilities: effortCapabilities("high", CLAUDE_FLAGSHIP_EFFORTS, ["ultrathink"]),
  },
  "claude-sonnet-5": {
    name: "Claude Sonnet 5",
    capabilities: effortCapabilities("high", CLAUDE_SONNET_5_EFFORTS, ["ultrathink"]),
  },

  // ── Modern GPT ───────────────────────────────────────────────────
  "gpt-5.6-sol": {
    name: "GPT-5.6 Sol",
    capabilities: effortCapabilities("high", GPT_STANDARD_EFFORTS),
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
    capabilities: effortCapabilities("medium", GPT_STANDARD_EFFORTS),
  },

  // ── Older Claude ─────────────────────────────────────────────────
  "claude-opus-4-8": {
    name: "Claude Opus 4.8",
    capabilities: effortCapabilities("high", CLAUDE_FLAGSHIP_EFFORTS, ["ultrathink"]),
  },
  "claude-opus-4-7": {
    name: "Claude Opus 4.7",
    capabilities: effortCapabilities("xhigh", CLAUDE_OPUS_4_7_EFFORTS, ["ultrathink"]),
  },
  "claude-opus-4-6": {
    name: "Claude Opus 4.6",
    capabilities: effortCapabilities("high", CLAUDE_MID_TIER_EFFORTS, ["ultrathink"]),
  },
  "claude-sonnet-4-6": {
    name: "Claude Sonnet 4.6",
    capabilities: effortCapabilities("high", CLAUDE_MID_TIER_EFFORTS, ["ultrathink"]),
  },
  "claude-sonnet-4-5-20250929": {
    name: "Claude Sonnet 4.5",
    capabilities: effortCapabilities("high", CLAUDE_LEGACY_EFFORTS),
  },
  "claude-haiku-4-5-20251001": {
    name: "Claude Haiku 4.5",
    capabilities: NO_EFFORT_CAPABILITIES,
  },

  // ── Older GPT ────────────────────────────────────────────────────
  "gpt-5.4": {
    name: "GPT-5.4",
    capabilities: effortCapabilities("medium", GPT_STANDARD_EFFORTS),
  },
  "gpt-5.4-mini": {
    name: "GPT-5.4 Mini",
    capabilities: effortCapabilities("medium", GPT_STANDARD_EFFORTS),
  },
  "gpt-5.3-codex-spark": {
    name: "GPT-5.3 Codex Spark",
    capabilities: effortCapabilities("medium", GPT_STANDARD_EFFORTS),
  },
} satisfies ClaudeSettings["customModelProfiles"];

/**
 * Model picker order for the claude-gpt provider instance. This is the
 * deliverable: modern Claude, then modern GPT, then older Claude, then older
 * GPT, matching `CLAUDE_GPT_MODEL_PROFILES` above. Every entry is suffixed
 * `[1m]` (the largest context window the CLI will request), matching the
 * convention already established for the GPT models here.
 */
export const CLAUDE_GPT_CUSTOM_MODELS = [
  // Modern Claude
  "claude-fable-5[1m]",
  "claude-opus-5[1m]",
  "claude-sonnet-5[1m]",
  // Modern GPT
  "gpt-5.6-sol[1m]",
  "gpt-5.6-terra[1m]",
  "gpt-5.6-luna[1m]",
  "gpt-5.5[1m]",
  // Older Claude
  "claude-opus-4-8[1m]",
  "claude-opus-4-7[1m]",
  "claude-opus-4-6[1m]",
  "claude-sonnet-4-6[1m]",
  "claude-sonnet-4-5-20250929[1m]",
  "claude-haiku-4-5-20251001[1m]",
  // Older GPT
  "gpt-5.4[1m]",
  "gpt-5.4-mini[1m]",
  "gpt-5.3-codex-spark[1m]",
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
