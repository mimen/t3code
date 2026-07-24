import type { DesktopBridge } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { isLocalBackendAvailable, isRemoteOnlyDesktop } from "./desktopRuntimeCapabilities";

function installDesktopBridge(bridge: Pick<DesktopBridge, "getRuntimeCapabilities">): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { desktopBridge: bridge },
  });
}

describe("desktop runtime capabilities", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("defaults to local execution when no current desktop capability bridge exists", () => {
    expect(isRemoteOnlyDesktop()).toBe(false);
    expect(isLocalBackendAvailable()).toBe(true);
  });

  it("recognizes remote-only desktop mode", () => {
    installDesktopBridge({
      getRuntimeCapabilities: () => ({
        executionMode: "remote-only",
        localBackendAvailable: false,
      }),
    });

    expect(isRemoteOnlyDesktop()).toBe(true);
    expect(isLocalBackendAvailable()).toBe(false);
  });
});
