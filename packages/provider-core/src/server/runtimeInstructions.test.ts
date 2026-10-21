import { describe, expect, it } from "vite-plus/test";
import { withUserDevice } from "./runtimeInstructions.ts";

describe("withUserDevice", () => {
  it("names a same-machine sender with every known detail", () => {
    expect(
      withUserDevice("open the app", {
        label: "T3 Code\nDesktop",
        os: "macOS",
        deviceType: "desktop",
        surface: "desktop",
        sameMachine: true,
      }),
    ).toBe(
      '<user_device>The user sent this message from "T3 Code Desktop" (macOS desktop, desktop) on this machine.</user_device>\n\nopen the app',
    );
  });

  it("names the remote host, or says it is unknown", () => {
    expect(
      withUserDevice("hi", {
        deviceType: "mobile",
        os: "iOS",
        sameMachine: false,
        hostName: "phone.tailnet.ts.net",
      }),
    ).toBe(
      "<user_device>The user sent this message from a device (iOS mobile) on another machine (phone.tailnet.ts.net).</user_device>\n\nhi",
    );
    expect(withUserDevice("hi", { deviceType: "unknown", sameMachine: false })).toBe(
      "<user_device>The user sent this message from an unknown device on another machine (unknown host).</user_device>\n\nhi",
    );
  });

  it("leaves messages without a sender and slash commands unchanged", () => {
    expect(withUserDevice("hi", undefined)).toBe("hi");
    expect(withUserDevice("  /compact", { deviceType: "desktop", sameMachine: true })).toBe(
      "  /compact",
    );
  });
});
