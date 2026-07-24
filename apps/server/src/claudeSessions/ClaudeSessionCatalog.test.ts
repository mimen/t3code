// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ProviderInstanceId, type ClaudeSessionCatalogueQuery } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { CcsCatalogueClient } from "./CcsCatalogueClient.ts";
import {
  ClaudeHomeLive,
  ClaudeSessionCatalog,
  ClaudeSessionCatalogLive,
} from "./ClaudeSessionCatalog.ts";

const nativeSessionId = "123e4567-e89b-42d3-a456-426614174000";
const temporaryDirectories: string[] = [];

const sourceStatus = {
  generation: 4,
  phase: "idle" as const,
  freshness: "fresh" as const,
  indexedAt: "2026-07-22T12:00:00.000Z",
  refreshedAt: "2026-07-22T12:00:00.000Z",
  ageMs: 10,
  staleAfterMs: 5_000,
  rowCount: 1,
  lastError: null,
  lastRefresh: { scanned: 1, parsed: 1, skipped: 0, removed: 0 },
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("ClaudeSessionCatalog", () => {
  it("prefers the CCS daemon and forwards pagination and filters", async () => {
    const queries: ClaudeSessionCatalogueQuery[] = [];
    const daemon = CcsCatalogueClient.of({
      queryRootSessions: (query) =>
        Effect.sync(() => {
          queries.push(query);
          return {
            protocolVersion: 1 as const,
            sessions: [
              {
                providerInstanceId: ProviderInstanceId.make("claudeAgent"),
                localSourceHost: "test-host",
                nativeSessionId,
                sourceCwd: "/workspace/project",
                projectRoot: "/workspace/project",
                projectName: "project",
                title: "Indexed title",
                titleSource: "native" as const,
                branch: "main",
                firstActivityAt: "2026-07-21T12:00:00.000Z",
                latestActivityAt: "2026-07-22T12:00:00.000Z",
                messageCount: 12,
                observedSize: 4_096,
                observedMtimeMs: 1_753_185_600_000,
              },
            ],
            nextCursor: "next-page",
            sourceStatus,
          };
        }),
      lookupSource: () => Effect.die("lookup should not run"),
    });
    const layer = ClaudeSessionCatalogLive.pipe(
      Layer.provide(ClaudeHomeLive(NodePath.join(NodeOS.homedir(), ".claude"))),
      Layer.provide(Layer.succeed(CcsCatalogueClient, daemon)),
    );
    const runtime = ManagedRuntime.make(layer);

    try {
      const catalog = await runtime.runPromise(Effect.service(ClaudeSessionCatalog));
      const query = {
        query: "indexed",
        cwdPrefix: "/workspace",
        activityWindow: "7d" as const,
        sort: "title" as const,
        limit: 25,
        cursor: "page-1",
        freshness: "require-fresh" as const,
      };
      const page = await runtime.runPromise(catalog.listSessions(query));

      expect(queries).toEqual([query]);
      expect(page.mode).toEqual({ kind: "ccs-daemon", protocolVersion: 1 });
      expect(page.nextCursor).toBe("next-page");
      expect(page.sessions[0]).toMatchObject({
        nativeSessionId,
        title: "Indexed title",
        sourceCwd: "/workspace/project",
      });
      expect(page.sessions[0]?.sourcePath).toBeUndefined();
    } finally {
      await runtime.dispose();
    }
  });

  it("uses the explicit bounded fallback and keeps JSONL validation on preview and attach", async () => {
    const claudeHome = await makeTemporaryDirectory("t3-claude-catalog-home-");
    const workspaceRoot = await makeTemporaryDirectory("t3-claude-catalog-workspace-");
    const projectsRoot = NodePath.join(claudeHome, "projects");
    const projectDirectory = NodePath.join(projectsRoot, "project");
    const workspaceAlias = NodePath.join(claudeHome, "workspace-alias");
    await NodeFSP.mkdir(projectDirectory, { recursive: true });
    await NodeFSP.symlink(workspaceRoot, workspaceAlias);
    const sourcePath = NodePath.join(projectDirectory, `${nativeSessionId}.jsonl`);
    await NodeFSP.writeFile(
      sourcePath,
      [
        JSON.stringify({
          type: "user",
          uuid: "user-1",
          sessionId: nativeSessionId,
          cwd: workspaceAlias,
          timestamp: "2026-07-22T10:00:00.000Z",
          message: { role: "user", content: "Catalogue marker" },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          sessionId: nativeSessionId,
          cwd: workspaceAlias,
          timestamp: "2026-07-22T10:01:00.000Z",
          message: { role: "assistant", content: "Preview answer" },
        }),
        JSON.stringify({
          type: "user",
          uuid: "user-2",
          sessionId: nativeSessionId,
          cwd: workspaceAlias,
          timestamp: "2026-07-22T10:02:00.000Z",
          message: { role: "user", content: "x".repeat(450) },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const outsideDirectory = await makeTemporaryDirectory("t3-claude-catalog-outside-");
    const outsidePath = NodePath.join(outsideDirectory, "outside.jsonl");
    await NodeFSP.writeFile(outsidePath, "{}\n", "utf8");
    await NodeFSP.symlink(outsidePath, NodePath.join(projectDirectory, "escape.jsonl"));

    const subagentDirectory = NodePath.join(projectDirectory, "subagents");
    await NodeFSP.mkdir(subagentDirectory, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(subagentDirectory, "subagent.jsonl"),
      `${JSON.stringify({
        type: "user",
        uuid: "subagent-user-1",
        sessionId: nativeSessionId,
        cwd: workspaceRoot,
        isSidechain: true,
        message: { role: "user", content: "Subagent marker" },
      })}\n`,
      "utf8",
    );

    const runtime = ManagedRuntime.make(
      ClaudeSessionCatalogLive.pipe(Layer.provide(ClaudeHomeLive(claudeHome))),
    );
    try {
      const catalog = await runtime.runPromise(Effect.service(ClaudeSessionCatalog));
      const page = await runtime.runPromise(catalog.listSessions({ limit: 20 }));
      expect(page.sessions).toHaveLength(1);
      expect(page.mode).toMatchObject({
        kind: "builtin-degraded",
        candidateLimit: 200,
      });
      expect(page.nextCursor).toBeNull();
      expect(page.sessions[0]).toMatchObject({
        nativeSessionId,
        title: `Claude session ${nativeSessionId.slice(0, 8)}`,
        titleSource: "fallback",
      });
      expect(page.sessions[0]?.sourcePath).toBeUndefined();

      const source = await runtime.runPromise(catalog.findSession(nativeSessionId, workspaceRoot));
      expect(source.sourcePath).toBe(await NodeFSP.realpath(sourcePath));
      expect(source.sourceCwd).toBe(await NodeFSP.realpath(workspaceRoot));
      expect(source.title).toBe("Catalogue marker");

      const preview = await runtime.runPromise(
        catalog.previewSession(nativeSessionId, workspaceRoot),
      );
      expect(preview.firstUserExcerpt).toBe("Catalogue marker");
      expect(preview.latestAssistantExcerpt).toBe("Preview answer");
      expect(preview.latestUserExcerpt).toHaveLength(400);
      expect(preview.isPartial).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });
});
