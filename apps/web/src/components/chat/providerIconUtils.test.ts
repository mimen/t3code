import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import {
  PROVIDER_ICON_BY_KEY,
  PROVIDER_ICON_BY_PROVIDER,
  resolveProviderIcon,
} from "./providerIconUtils";

describe("resolveProviderIcon", () => {
  it("uses an explicit instance icon before the driver default", () => {
    expect(resolveProviderIcon("claude", ProviderDriverKind.make("codex"))).toBe(
      PROVIDER_ICON_BY_KEY.claude,
    );
  });

  it("falls back to the driver icon when an instance has no override", () => {
    const driver = ProviderDriverKind.make("codex");
    expect(resolveProviderIcon(undefined, driver)).toBe(PROVIDER_ICON_BY_PROVIDER[driver]);
  });
});
