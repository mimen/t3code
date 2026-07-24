import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationLayerLive } from "../orchestration/runtimeLayer.ts";
import { ExternalClaudeSessionRepositoryLive } from "../persistence/Layers/ExternalClaudeSessions.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import {
  layer as ProviderSessionRuntimeRepositoryLive,
  ProviderSessionRuntimeRepository,
} from "../persistence/ProviderSessionRuntime.ts";
import { ExternalClaudeSessionRepository } from "../persistence/Services/ExternalClaudeSessions.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import { ClaudeSessionStatus, ClaudeSessionStatusLive } from "./ClaudeSessionStatus.ts";

const projectId = ProjectId.make("project-status-test");
const threadId = ThreadId.make("thread-status-test");
const providerInstanceId = ProviderInstanceId.make("claudeAgent");
const nativeSessionId = "123e4567-e89b-42d3-a456-426614174000";
const now = "2026-07-22T12:00:00.000Z";

const configLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-claude-session-status-test-",
});
const orchestrationLayer = OrchestrationLayerLive.pipe(
  Layer.provideMerge(RepositoryIdentityResolver.layer),
  Layer.provideMerge(ProviderSessionRuntimeRepositoryLive),
  Layer.provideMerge(ExternalClaudeSessionRepositoryLive),
  Layer.provideMerge(SqlitePersistenceLayerLive),
);
const statusLayer = ClaudeSessionStatusLive.pipe(Layer.provide(orchestrationLayer));
const statusTests = it.layer(
  Layer.mergeAll(orchestrationLayer, statusLayer).pipe(
    Layer.provideMerge(configLayer),
    Layer.provideMerge(NodeServices.layer),
  ),
);

statusTests("ClaudeSessionStatus", (it) => {
  it.effect("joins runtime state and excludes archived and deleted threads", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const sources = yield* ExternalClaudeSessionRepository;
      const providerRuntimes = yield* ProviderSessionRuntimeRepository;
      const status = yield* ClaudeSessionStatus;

      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("status-project-create"),
        projectId,
        title: "Status project",
        workspaceRoot: "/workspace/status-project",
        createdAt: now,
      });
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("status-thread-create"),
        threadId,
        projectId,
        title: "Status thread",
        modelSelection: { instanceId: providerInstanceId, model: "claude-opus-4-8" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: now,
      });
      yield* sources.createSource({
        sourceId: "source-status-test",
        providerInstanceId,
        localSourceHost: "test-host",
        nativeSessionId,
        sourcePath: "/tmp/status-source.jsonl",
        sourceCwd: "/workspace/status-project",
        threadId,
        state: "synced",
        lastSyncedAt: now,
        diagnostic: null,
        createdAt: now,
        updatedAt: now,
      });
      yield* providerRuntimes.upsert({
        threadId,
        providerName: "claudeAgent",
        providerInstanceId,
        adapterKey: "claudeAgent",
        runtimeMode: "full-access",
        status: "running",
        lastSeenAt: now,
        resumeCursor: null,
        runtimePayload: null,
      });

      const active = yield* status.getSnapshot();
      expect(active.protocolVersion).toBe(1);
      expect(active.attachments).toEqual([
        {
          providerInstanceId,
          localSourceHost: "test-host",
          nativeSessionId,
          sourceCwd: "/workspace/status-project",
          sourceId: "source-status-test",
          threadId,
          projectId,
          state: "synced",
          lastSyncedAt: now,
          diagnostic: null,
          runtimeStatus: "running",
          runtimeLastSeenAt: now,
        },
      ]);

      const joined = yield* status.joinCataloguePage({
        sessions: [
          {
            providerInstanceId,
            localSourceHost: "test-host",
            nativeSessionId,
            sourceCwd: "/workspace/status-project",
            projectRoot: "/workspace/status-project",
            projectName: "status-project",
            title: "Status session",
            titleSource: "native",
            branch: null,
            firstActivityAt: now,
            latestActivityAt: now,
            messageCount: 2,
            observedSize: 512,
            observedMtimeMs: 1_753_185_600_000,
          },
        ],
        nextCursor: null,
        sourceStatus: {
          generation: 1,
          phase: "idle",
          freshness: "fresh",
          indexedAt: now,
          refreshedAt: now,
          ageMs: 5,
          staleAfterMs: 5_000,
          rowCount: 1,
          lastError: null,
          lastRefresh: { scanned: 1, parsed: 1, skipped: 0, removed: 0 },
        },
        mode: { kind: "ccs-daemon", protocolVersion: 1 },
      });
      expect(joined.sessions[0]?.attachment).toMatchObject({
        sourceId: "source-status-test",
        threadId,
        runtimeStatus: "running",
      });

      yield* engine.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("status-thread-archive"),
        threadId,
      });
      expect((yield* status.getSnapshot()).attachments).toEqual([]);

      yield* engine.dispatch({
        type: "thread.unarchive",
        commandId: CommandId.make("status-thread-unarchive"),
        threadId,
      });
      expect((yield* status.getSnapshot()).attachments).toHaveLength(1);

      yield* engine.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("status-thread-delete"),
        threadId,
      });
      expect((yield* status.getSnapshot()).attachments).toEqual([]);
    }),
  );
});
