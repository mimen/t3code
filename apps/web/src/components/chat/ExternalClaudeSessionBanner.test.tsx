import { ProviderInstanceId, type OrchestrationExternalSessionSummary } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ExternalClaudeSessionBanner } from "./ExternalClaudeSessionBanner";

function makeExternalSession(
  state: OrchestrationExternalSessionSummary["state"],
): OrchestrationExternalSessionSummary {
  return {
    sourceId: "claude-source-1",
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    nativeSessionId: "123e4567-e89b-42d3-a456-426614174000",
    sourcePath: "/workspace/.claude/projects/project/session.jsonl",
    sourceCwd: "/workspace/project",
    state,
    lastSyncedAt: null,
    diagnostic:
      state === "failed" || state === "desynced" ? "The native source needs attention." : null,
    updatedAt: "2026-07-20T12:00:00.000Z",
  };
}

describe("ExternalClaudeSessionBanner", () => {
  it("explains an attached source and offers an explicit sync", () => {
    const markup = renderToStaticMarkup(
      <ExternalClaudeSessionBanner
        session={makeExternalSession("attached")}
        isSyncing={false}
        onSync={() => undefined}
      />,
    );

    expect(markup).toContain("Continuing native Claude session");
    expect(markup).toContain("123e4567");
    expect(markup).toContain("History not synchronized yet");
    expect(markup).toContain("/workspace/project");
    expect(markup).toContain("Sync now");
    expect(markup).not.toContain("bg-warning/8");
  });

  it.each([
    ["failed", "Claude Code history synchronization failed"],
    ["desynced", "Claude Code source needs validation"],
  ] as const)("shows a warning for a %s source", (state, label) => {
    const markup = renderToStaticMarkup(
      <ExternalClaudeSessionBanner
        session={makeExternalSession(state)}
        isSyncing={false}
        onSync={() => undefined}
      />,
    );

    expect(markup).toContain(label);
    expect(markup).toContain("The native source needs attention.");
    expect(markup).toContain("bg-warning/8");
  });

  it("disables the action while synchronization is running", () => {
    const markup = renderToStaticMarkup(
      <ExternalClaudeSessionBanner
        session={makeExternalSession("synced")}
        isSyncing
        onSync={() => undefined}
      />,
    );

    expect(markup).toContain("Syncing");
    expect(markup).toMatch(/<button[^>]*disabled/);
  });
});
