import { ClaudeSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { makeClaudeModelCatalog } from "./ClaudeModelCatalog.ts";

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

const profiledSettings = decodeClaudeSettings({
  includeBuiltInModels: false,
  customModels: [" custom-model "],
  customModelProfiles: {
    "custom-model": {
      name: "Custom Claude",
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Reasoning",
            type: "select",
            options: [
              { id: "high", label: "High", isDefault: true },
              { id: "xhigh", label: "Extra High" },
            ],
          },
          {
            id: "contextWindow",
            label: "Context Window",
            type: "select",
            options: [
              { id: "200k", label: "200k", isDefault: true },
              { id: "1m", label: "1M" },
            ],
          },
        ],
      },
    },
  },
});

describe("ClaudeModelCatalog", () => {
  it("exposes only configured profiled custom models when built-ins are suppressed", () => {
    const catalog = makeClaudeModelCatalog(profiledSettings);

    expect(catalog.pendingModels()).toEqual([
      {
        slug: "custom-model",
        name: "Custom Claude",
        isCustom: true,
        capabilities: profiledSettings.customModelProfiles["custom-model"]?.capabilities,
      },
    ]);
  });

  it("normalizes and deduplicates configured custom models before matching profiles", () => {
    const catalog = makeClaudeModelCatalog(
      decodeClaudeSettings({
        includeBuiltInModels: false,
        customModels: ["  custom-model  ", "custom-model", "  other-model "],
        customModelProfiles: {
          "  custom-model  ": {
            name: "Custom Claude",
            capabilities: {},
          },
        },
      }),
    );

    expect(catalog.pendingModels().map((model) => [model.slug, model.name])).toEqual([
      ["custom-model", "Custom Claude"],
      ["other-model", "other-model"],
    ]);
  });

  it("uses profile capabilities for effort and context accounting", () => {
    const catalog = makeClaudeModelCatalog(profiledSettings);
    const selection = {
      instanceId: ProviderInstanceId.make("claude_custom"),
      model: "custom-model",
      options: [
        { id: "effort", value: "xhigh" as const },
        { id: "contextWindow", value: "1m" as const },
      ],
    };

    expect(catalog.capabilitiesFor("custom-model")).toEqual(
      profiledSettings.customModelProfiles["custom-model"]?.capabilities,
    );
    expect(catalog.resolveEffort(selection.model, "xhigh")).toBe("xhigh");
    expect(catalog.normalizeCliEffort("xhigh", selection.model)).toBe("xhigh");
    expect(catalog.selectedContextWindow(selection)).toBe(1_000_000);
    expect(
      catalog.selectedContextWindow({
        instanceId: ProviderInstanceId.make("claude_custom"),
        model: "custom-model",
      }),
    ).toBe(200_000);
  });

  it("adds a single 1m suffix and leaves 200k base ids unchanged", () => {
    const catalog = makeClaudeModelCatalog(profiledSettings);
    const oneMillionSelection = {
      instanceId: ProviderInstanceId.make("claude_custom"),
      model: "custom-model[1m]",
      options: [{ id: "contextWindow", value: "1m" as const }],
    };
    const twoHundredKSelection = {
      instanceId: ProviderInstanceId.make("claude_custom"),
      model: "custom-model",
      options: [{ id: "contextWindow", value: "200k" as const }],
    };

    expect(catalog.resolveApiModelId(oneMillionSelection)).toBe("custom-model[1m]");
    expect(catalog.resolveApiModelId(twoHundredKSelection)).toBe("custom-model");
  });

  it("preserves built-in capabilities when a custom string duplicates an enabled built-in", () => {
    const catalog = makeClaudeModelCatalog(
      decodeClaudeSettings({
        customModels: ["claude-sonnet-4-6"],
        customModelProfiles: {
          "claude-sonnet-4-6": {
            capabilities: {},
          },
        },
      }),
    );
    const selection = {
      instanceId: ProviderInstanceId.make("claude_custom"),
      model: "claude-sonnet-4-6",
      options: [{ id: "contextWindow", value: "1m" as const }],
    };

    expect(catalog.pendingModels().find((model) => model.slug === selection.model)?.isCustom).toBe(
      false,
    );
    expect(catalog.selectedContextWindow(selection)).toBe(1_000_000);
    expect(catalog.resolveApiModelId(selection)).toBe("claude-sonnet-4-6[1m]");
  });

  it("matches profiled decorated custom model ids while preserving their transport id", () => {
    const catalog = makeClaudeModelCatalog(
      decodeClaudeSettings({
        includeBuiltInModels: false,
        customModels: ["custom-model[1m]"],
        customModelProfiles: {
          "custom-model[1m]": profiledSettings.customModelProfiles["custom-model"]!,
        },
      }),
    );
    const selection = {
      instanceId: ProviderInstanceId.make("claude_custom"),
      model: "custom-model[1m]",
      options: [
        { id: "effort", value: "xhigh" as const },
        { id: "contextWindow", value: "1m" as const },
      ],
    };

    expect(catalog.pendingModels()[0]?.slug).toBe("custom-model[1m]");
    expect(catalog.resolveEffort(selection.model, "xhigh")).toBe("xhigh");
    expect(catalog.normalizeCliEffort("xhigh", selection.model)).toBe("xhigh");
    expect(catalog.resolveApiModelId(selection)).toBe("custom-model[1m]");
  });

  it("keeps built-in version gating when built-ins are enabled", () => {
    const catalog = makeClaudeModelCatalog(decodeClaudeSettings({}));

    expect(
      catalog.modelsForVersion("2.1.168").some((model) => model.slug === "claude-fable-5"),
    ).toBe(false);
    expect(catalog.versionUpgradeMessage("2.1.168")).toContain("Claude Fable 5");
  });
});
