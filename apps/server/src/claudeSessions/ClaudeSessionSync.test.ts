// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { CommandId, MessageId, ProviderInstanceId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { ExternalClaudeSessionRepositoryLive } from "../persistence/Layers/ExternalClaudeSessions.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ExternalClaudeSessionRepository } from "../persistence/Services/ExternalClaudeSessions.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import { ClaudeHomeLive, ClaudeSessionCatalogLive } from "./ClaudeSessionCatalog.ts";
import { readCompleteClaudeJsonlRecords } from "./ClaudeJsonlReader.ts";
import { ClaudeSessionSync, ClaudeSessionSyncLive } from "./ClaudeSessionSync.ts";

const nativeSessionId = "123e4567-e89b-42d3-a456-426614174000";
const sourceId = "claude-source-test";
const projectId = ProjectId.make("project-test");
const threadId = ThreadId.make("thread-test");
const providerInstanceId = ProviderInstanceId.make("claudeAgent");
const now = "2026-03-04T05:06:07.000Z";

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

async function createSyncRuntime(claudeHomePath: string) {
  const configLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-claude-session-sync-test-",
  });
  const catalogLayer = ClaudeSessionCatalogLive.pipe(Layer.provide(ClaudeHomeLive(claudeHomePath)));
  const engineLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
  );
  const syncLayer = ClaudeSessionSyncLive.pipe(
    Layer.provide(catalogLayer),
    Layer.provide(ExternalClaudeSessionRepositoryLive),
    Layer.provide(engineLayer),
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
  );
  const layer = Layer.mergeAll(
    engineLayer,
    OrchestrationProjectionSnapshotQueryLive,
    ExternalClaudeSessionRepositoryLive,
    catalogLayer,
    syncLayer,
  ).pipe(
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(configLayer),
    Layer.provideMerge(NodeServices.layer),
  );
  return ManagedRuntime.make(layer);
}

describe("ClaudeSessionSync", () => {
  it("imports append-only history idempotently without creating provider turn intent", async () => {
    const claudeHome = await makeTemporaryDirectory("t3-claude-home-");
    const workspaceRoot = await makeTemporaryDirectory("t3-claude-workspace-");
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
          timestamp: now,
          message: { role: "user", content: "Remember the import marker." },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          sessionId: nativeSessionId,
          cwd: workspaceRoot,
          timestamp: "2026-03-04T05:06:08.000Z",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "I remember the import marker." },
              { type: "tool_use", id: "tool-1", name: "Read", input: { path: "README.md" } },
            ],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    const canonicalWorkspaceRoot = await NodeFSP.realpath(workspaceRoot);
    const initialRead = await Effect.runPromise(
      readCompleteClaudeJsonlRecords({
        sourcePath,
        startByteOffset: 0,
        startLineOrdinal: 0,
      }),
    );
    const runtime = await createSyncRuntime(claudeHome);

    try {
      const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
      const sources = await runtime.runPromise(Effect.service(ExternalClaudeSessionRepository));
      const syncService = await runtime.runPromise(Effect.service(ClaudeSessionSync));
      const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));

      await runtime.runPromise(
        engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("project-command"),
          projectId,
          title: "Project",
          workspaceRoot: canonicalWorkspaceRoot,
          createdAt: now,
        }),
      );
      await runtime.runPromise(
        engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("thread-command"),
          threadId,
          projectId,
          title: "Imported Claude session",
          modelSelection: { instanceId: providerInstanceId, model: "claude-opus-4-8" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
        }),
      );
      await runtime.runPromise(
        sources.createSource({
          sourceId,
          providerInstanceId,
          localSourceHost: "test-host",
          nativeSessionId,
          sourcePath: initialRead.canonicalPath,
          sourceCwd: canonicalWorkspaceRoot,
          threadId,
          state: "attached",
          lastSyncedAt: null,
          diagnostic: null,
          createdAt: now,
          updatedAt: now,
        }),
      );
      await runtime.runPromise(
        sources.createCheckpoint({
          sourceId,
          fileIdentity: initialRead.fileIdentity,
          committedPrefixHash: "unverified",
          generation: 0,
          committedByteOffset: 0,
          committedLineOrdinal: 0,
          observedSize: initialRead.observedSize,
          observedMtimeMs: initialRead.observedMtimeMs,
          parserVersion: "claude-jsonl-v1",
          revision: 0,
        }),
      );
      await runtime.runPromise(
        engine.dispatch({
          type: "thread.external-session.attach",
          commandId: CommandId.make("attach-command"),
          threadId,
          externalSession: {
            sourceId,
            providerInstanceId,
            nativeSessionId,
            sourcePath: initialRead.canonicalPath,
            sourceCwd: canonicalWorkspaceRoot,
            state: "attached",
            lastSyncedAt: null,
            diagnostic: null,
            updatedAt: now,
          },
          localSourceHost: "test-host",
          checkpoint: {
            sourceId,
            fileIdentity: initialRead.fileIdentity,
            committedPrefixHash: "unverified",
            generation: 0,
            committedByteOffset: 0,
            committedLineOrdinal: 0,
            observedSize: initialRead.observedSize,
            observedMtimeMs: initialRead.observedMtimeMs,
            parserVersion: "claude-jsonl-v1",
            revision: 0,
          },
          createdAt: now,
        }),
      );

      const firstSync = await runtime.runPromise(syncService.syncSource(sourceId));
      expect(firstSync.importedItemCount).toBe(3);
      const firstSnapshot = await runtime.runPromise(snapshotQuery.getSnapshot());
      const importedThread = firstSnapshot.threads.find((thread) => thread.id === threadId);
      expect(importedThread?.messages).toHaveLength(2);
      expect(importedThread?.activities).toHaveLength(1);
      expect(importedThread?.messages.every((message) => message.turnId === null)).toBe(true);
      expect(importedThread?.messages.every((message) => message.streaming === false)).toBe(true);
      expect(
        importedThread?.messages.every(
          (message) => message.provenance?.origin === "claude-code-jsonl",
        ),
      ).toBe(true);
      expect(importedThread?.externalSession?.state).toBe("synced");

      const newestPage = await runtime.runPromise(
        snapshotQuery.getThreadTimelinePage({ threadId, limit: 2 }),
      );
      expect(Option.isSome(newestPage)).toBe(true);
      if (Option.isSome(newestPage)) {
        expect(newestPage.value.items).toHaveLength(2);
        expect(newestPage.value.nextCursor).not.toBeNull();
        const olderPage = await runtime.runPromise(
          snapshotQuery.getThreadTimelinePage({
            threadId,
            ...(newestPage.value.nextCursor === null
              ? {}
              : { beforeCursor: newestPage.value.nextCursor }),
            limit: 2,
          }),
        );
        expect(Option.isSome(olderPage)).toBe(true);
        if (Option.isSome(olderPage)) {
          expect(olderPage.value.items).toHaveLength(1);
          expect(olderPage.value.nextCursor).toBeNull();
        }
      }

      const secondSync = await runtime.runPromise(syncService.syncSource(sourceId));
      expect(secondSync.importedItemCount).toBe(0);
      const secondSnapshot = await runtime.runPromise(snapshotQuery.getSnapshot());
      const secondThread = secondSnapshot.threads.find((thread) => thread.id === threadId);
      expect(secondThread?.messages).toHaveLength(2);
      expect(secondThread?.activities).toHaveLength(1);

      const liveMessageId = MessageId.make("live-assistant-message");
      const continuationTimestamp = "2026-03-04T05:06:09.000Z";
      await runtime.runPromise(
        engine.dispatch({
          type: "thread.message.assistant.delta",
          commandId: CommandId.make("live-assistant-delta-command"),
          threadId,
          messageId: liveMessageId,
          delta: "This response was already persisted by T3.",
          createdAt: continuationTimestamp,
        }),
      );
      await runtime.runPromise(
        engine.dispatch({
          type: "thread.message.assistant.complete",
          commandId: CommandId.make("live-assistant-complete-command"),
          threadId,
          messageId: liveMessageId,
          createdAt: continuationTimestamp,
        }),
      );
      await NodeFSP.appendFile(
        sourcePath,
        `${JSON.stringify({
          type: "assistant",
          uuid: "assistant-continuation",
          sessionId: nativeSessionId,
          cwd: workspaceRoot,
          timestamp: continuationTimestamp,
          message: { role: "assistant", content: "This response was already persisted by T3." },
        })}\n`,
        "utf8",
      );
      const deduplicatedSync = await runtime.runPromise(syncService.syncSource(sourceId));
      expect(deduplicatedSync.importedItemCount).toBe(0);
      const deduplicatedSnapshot = await runtime.runPromise(snapshotQuery.getSnapshot());
      expect(
        deduplicatedSnapshot.threads.find((thread) => thread.id === threadId)?.messages,
      ).toHaveLength(3);
      const deduplicatedMapping = await runtime.runPromise(
        sources.getSourceItem({
          sourceId,
          sourceItemKey: "assistant-continuation:message:0",
        }),
      );
      expect(Option.isSome(deduplicatedMapping)).toBe(true);
      if (Option.isSome(deduplicatedMapping)) {
        expect(deduplicatedMapping.value.targetId).toBe(liveMessageId);
      }

      await NodeFSP.appendFile(
        sourcePath,
        `${JSON.stringify({
          type: "user",
          uuid: "user-2",
          sessionId: nativeSessionId,
          cwd: workspaceRoot,
          timestamp: "2026-03-04T05:06:09.000Z",
          message: { role: "user", content: "This record was appended after the first sync." },
        })}\n`,
        "utf8",
      );
      const appendSync = await runtime.runPromise(syncService.syncSource(sourceId));
      expect(appendSync.importedItemCount).toBe(1);
      const appendedSnapshot = await runtime.runPromise(snapshotQuery.getSnapshot());
      expect(
        appendedSnapshot.threads.find((thread) => thread.id === threadId)?.messages,
      ).toHaveLength(4);

      const committedContents = await NodeFSP.readFile(sourcePath, "utf8");
      const mutatedPrefix = committedContents.replace(
        "Remember the import marker.",
        "Remember the import vector.",
      );
      await NodeFSP.writeFile(
        sourcePath,
        `${mutatedPrefix}${JSON.stringify({
          type: "user",
          uuid: "user-after-prefix-mutation",
          sessionId: nativeSessionId,
          cwd: workspaceRoot,
          message: { role: "user", content: "Suffix after a rewritten prefix" },
        })}\n`,
        "utf8",
      );
      await expect(runtime.runPromise(syncService.syncSource(sourceId))).rejects.toMatchObject({
        _tag: "ClaudeSessionSyncError",
        state: "desynced",
        operation: "committed-prefix-mutated",
      });

      await NodeFSP.writeFile(
        sourcePath,
        `${committedContents}${JSON.stringify({
          type: "user",
          uuid: "user-after-prefix-mutation",
          sessionId: nativeSessionId,
          cwd: workspaceRoot,
          message: { role: "user", content: "Suffix after a rewritten prefix" },
        })}\n`,
        "utf8",
      );
      const repairedSync = await runtime.runPromise(syncService.syncSource(sourceId));
      expect(repairedSync.importedItemCount).toBe(1);

      const replacementPath = `${sourcePath}.replacement`;
      await NodeFSP.writeFile(
        replacementPath,
        `${await NodeFSP.readFile(sourcePath, "utf8")}${JSON.stringify({
          type: "user",
          uuid: "user-after-rewrite",
          sessionId: nativeSessionId,
          cwd: workspaceRoot,
          message: { role: "user", content: "Rewritten source" },
        })}\n`,
        "utf8",
      );
      await NodeFSP.rename(replacementPath, sourcePath);
      await expect(runtime.runPromise(syncService.syncSource(sourceId))).rejects.toMatchObject({
        _tag: "ClaudeSessionSyncError",
        state: "desynced",
      });
      const desyncedSnapshot = await runtime.runPromise(snapshotQuery.getSnapshot());
      expect(
        desyncedSnapshot.threads.find((thread) => thread.id === threadId)?.externalSession?.state,
      ).toBe("desynced");

      const events = await runtime.runPromise(
        Stream.runCollect(engine.readEvents(0, 100)).pipe(Effect.map((chunk) => Array.from(chunk))),
      );
      expect(events.some((event) => event.type === "thread.turn-start-requested")).toBe(false);
      expect(events.some((event) => event.type === "thread.external-history-imported")).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });
});
