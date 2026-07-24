// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { CommandId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "../orchestration/runtimeLayer.ts";
import { ExternalClaudeSessionRepositoryLive } from "../persistence/Layers/ExternalClaudeSessions.ts";
import { layer as ProviderSessionRuntimeRepositoryLive } from "../persistence/ProviderSessionRuntime.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import { ProviderSessionRuntimeRepository } from "../persistence/ProviderSessionRuntime.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import { ClaudeSessionCoordinator } from "./ClaudeSessionCoordinator.ts";
import { makeClaudeSessionCoreLive } from "./runtimeLayer.ts";

const nativeSessionId = "123e4567-e89b-42d3-a456-426614174000";
const temporaryDirectories: string[] = [];

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

async function createCoordinatorRuntime(claudeHomePath: string) {
  const configLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-claude-session-coordinator-test-",
  });
  const orchestrationLayer = OrchestrationLayerLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(ProviderSessionRuntimeRepositoryLive),
    Layer.provideMerge(ExternalClaudeSessionRepositoryLive),
    Layer.provideMerge(SqlitePersistenceLayerLive),
  );
  const claudeSessionLayer = makeClaudeSessionCoreLive(claudeHomePath).pipe(
    Layer.provide(orchestrationLayer),
  );
  const layer = Layer.mergeAll(orchestrationLayer, claudeSessionLayer).pipe(
    Layer.provideMerge(configLayer),
    Layer.provideMerge(NodeServices.layer),
  );
  return ManagedRuntime.make(layer);
}

describe("ClaudeSessionCoordinator", () => {
  it("attaches once, imports inert history, and seeds the native resume binding", async () => {
    const claudeHome = await makeTemporaryDirectory("t3-claude-coordinator-home-");
    const workspaceRoot = await makeTemporaryDirectory("t3-claude-coordinator-workspace-");
    const transcriptDirectory = NodePath.join(claudeHome, "projects", "project");
    await NodeFSP.mkdir(transcriptDirectory, { recursive: true });
    const sourcePath = NodePath.join(transcriptDirectory, `${nativeSessionId}.jsonl`);
    await NodeFSP.writeFile(
      sourcePath,
      [
        JSON.stringify({
          type: "user",
          uuid: "user-1",
          sessionId: nativeSessionId,
          cwd: workspaceRoot,
          timestamp: "2026-03-04T05:06:07.000Z",
          message: { role: "user", content: "Coordinator marker" },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          sessionId: nativeSessionId,
          cwd: workspaceRoot,
          timestamp: "2026-03-04T05:06:08.000Z",
          message: { role: "assistant", content: "Coordinator answer" },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    const runtime = await createCoordinatorRuntime(claudeHome);

    try {
      const coordinator = await runtime.runPromise(Effect.service(ClaudeSessionCoordinator));
      const runtimeRepository = await runtime.runPromise(
        Effect.service(ProviderSessionRuntimeRepository),
      );
      const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
      const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));

      const firstOpen = await runtime.runPromise(
        coordinator.open({ nativeSessionId, cwd: workspaceRoot }),
      );
      expect(firstOpen.created).toBe(true);
      expect(firstOpen.sync?.importedItemCount).toBe(2);
      expect(firstOpen.syncError).toBeNull();

      const providerRuntime = await runtime.runPromise(
        runtimeRepository.getByThreadId({ threadId: firstOpen.threadId }),
      );
      expect(Option.isSome(providerRuntime)).toBe(true);
      if (Option.isSome(providerRuntime)) {
        expect(providerRuntime.value.resumeCursor).toMatchObject({
          threadId: firstOpen.threadId,
          resume: nativeSessionId,
        });
        expect(providerRuntime.value.runtimePayload).toMatchObject({
          cwd: await NodeFSP.realpath(workspaceRoot),
        });
      }

      if (Option.isSome(providerRuntime)) {
        await runtime.runPromise(
          runtimeRepository.upsert({
            ...providerRuntime.value,
            status: "running",
            resumeCursor: {
              threadId: firstOpen.threadId,
              resume: nativeSessionId,
              resumeSessionAt: "latest-native-assistant-item",
              turnCount: 7,
            },
            runtimePayload: {
              cwd: await NodeFSP.realpath(workspaceRoot),
              preserved: true,
            },
          }),
        );
      }

      const secondOpen = await runtime.runPromise(
        coordinator.open({ nativeSessionId, cwd: workspaceRoot }),
      );
      expect(secondOpen.created).toBe(false);
      const reopenedProviderRuntime = await runtime.runPromise(
        runtimeRepository.getByThreadId({ threadId: firstOpen.threadId }),
      );
      expect(Option.isSome(reopenedProviderRuntime)).toBe(true);
      if (Option.isSome(reopenedProviderRuntime)) {
        expect(reopenedProviderRuntime.value.status).toBe("running");
        expect(reopenedProviderRuntime.value.resumeCursor).toMatchObject({
          resumeSessionAt: "latest-native-assistant-item",
          turnCount: 7,
        });
        expect(reopenedProviderRuntime.value.runtimePayload).toMatchObject({ preserved: true });
      }
      expect(secondOpen.threadId).toBe(firstOpen.threadId);
      expect(secondOpen.sourceId).toBe(firstOpen.sourceId);

      await NodeFSP.appendFile(sourcePath, "not valid JSONL\n", "utf8");
      const repairOpen = await runtime.runPromise(
        coordinator.open({ nativeSessionId, cwd: workspaceRoot }),
      );
      expect(repairOpen.created).toBe(false);
      expect(repairOpen.threadId).toBe(firstOpen.threadId);
      expect(repairOpen.sync).toBeNull();
      expect(repairOpen.syncError).toContain("Malformed completed JSONL record");

      const snapshot = await runtime.runPromise(snapshotQuery.getSnapshot());
      const thread = snapshot.threads.find((entry) => entry.id === firstOpen.threadId);
      expect(thread?.messages).toHaveLength(2);
      expect(thread?.externalSession?.state).toBe("failed");
      const brokenContents = await NodeFSP.readFile(sourcePath, "utf8");
      await NodeFSP.writeFile(
        sourcePath,
        brokenContents.slice(0, -"not valid JSONL\n".length),
        "utf8",
      );

      await runtime.runPromise(
        engine.dispatch({
          type: "thread.delete",
          commandId: CommandId.make("delete-imported-claude-thread"),
          threadId: firstOpen.threadId,
        }),
      );
      const reopenedAfterDelete = await runtime.runPromise(
        coordinator.open({ nativeSessionId, cwd: workspaceRoot }),
      );
      expect(reopenedAfterDelete.created).toBe(true);
      expect(reopenedAfterDelete.threadId).not.toBe(firstOpen.threadId);
      expect(reopenedAfterDelete.syncError).toBeNull();

      const events = await runtime.runPromise(
        Stream.runCollect(engine.readEvents(0, 100)).pipe(Effect.map((chunk) => Array.from(chunk))),
      );
      expect(events.some((event) => event.type === "thread.turn-start-requested")).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });
});
