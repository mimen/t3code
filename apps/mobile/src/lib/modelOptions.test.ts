import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type ServerConfig } from "@t3tools/contracts";

import { buildModelOptions, resolveAdvertisedModelSelection } from "./modelOptions";

describe("mobile model options", () => {
  it("normalizes a legacy fallback selection against current capabilities", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          iconKey: "claude",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "gpt-test",
              name: "GPT Test",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "serviceTier",
                    label: "Service Tier",
                    type: "select",
                    options: [
                      { id: "default", label: "Standard", isDefault: true },
                      { id: "priority", label: "Fast" },
                    ],
                    currentValue: "default",
                  },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const [option] = buildModelOptions(config, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-test",
      options: [{ id: "fastMode", value: true }],
    });

    expect(option?.capabilities?.optionDescriptors?.[0]?.id).toBe("serviceTier");
    expect(option?.providerIconKey).toBe("claude");
    expect(option?.selection.options).toEqual([{ id: "serviceTier", value: "default" }]);
  });

  it("does not synthesize an option for a stale selection", () => {
    const config = {
      providers: [
        {
          instanceId: "claude-gpt",
          driver: "claudeAgent",
          displayName: "Claude-GPT",
          modelsAreAuthoritative: true,
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "gpt-5.6-sol",
              name: "GPT-5.6 Sol",
              isCustom: true,
              capabilities: null,
            },
          ],
        },
      ],
    } as unknown as ServerConfig;
    const staleSelection = {
      instanceId: ProviderInstanceId.make("claude-gpt"),
      model: "gpt-5.6-sol[1m]",
    };

    const options = buildModelOptions(config, staleSelection);

    expect(options.map((option) => option.selection.model)).toEqual(["gpt-5.6-sol"]);
    expect(resolveAdvertisedModelSelection(options, staleSelection)).toEqual(options[0]?.selection);
  });

  it("does not move a stale authoritative selection to another provider", () => {
    const config = {
      providers: [
        {
          instanceId: "claude-gpt",
          driver: "claudeAgent",
          displayName: "Claude-GPT",
          modelsAreAuthoritative: true,
          enabled: true,
          installed: false,
          auth: { status: "unknown" },
          models: [],
        },
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "gpt-5.4",
              name: "GPT-5.4",
              isCustom: false,
              capabilities: null,
            },
          ],
        },
      ],
    } as unknown as ServerConfig;
    const staleSelection = {
      instanceId: ProviderInstanceId.make("claude-gpt"),
      model: "gpt-5.6-sol[1m]",
    };

    const options = buildModelOptions(config, staleSelection);

    expect(options.map((option) => option.selection.instanceId)).toEqual(["codex"]);
    expect(resolveAdvertisedModelSelection(options, staleSelection)).toBeNull();
  });
});
