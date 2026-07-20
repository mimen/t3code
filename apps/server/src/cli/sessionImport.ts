import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";

import * as NodeOs from "node:os";

import * as ServerConfig from "../config.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "../orchestration/runtimeLayer.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import * as ProviderSessionRuntimeRepo from "../persistence/ProviderSessionRuntime.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

/**
 * SPIKE: import an existing Claude Code session (~/.claude/projects JSONL)
 * as a t3code thread whose resume cursor points at the original session id.
 * Offline only — run while the server is stopped, then start the server.
 */

interface ParsedClaudeSession {
  readonly sessionId: string;
  readonly cwd: string;
  readonly title: string;
  readonly userTurnCount: number;
}

class SessionImportError extends Schema.TaggedErrorClass<SessionImportError>()(
  "SessionImportError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const decodeUnknownJsonString = Schema.decodeUnknownExit(Schema.UnknownFromJsonString);

const parseClaudeSessionJsonl = Effect.fn(function* (jsonlPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(jsonlPath);
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let title: string | undefined;
  let userTurnCount = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const decoded = decodeUnknownJsonString(line);
    if (
      Exit.isFailure(decoded) ||
      typeof decoded.value !== "object" ||
      decoded.value === null ||
      Array.isArray(decoded.value)
    ) {
      continue;
    }
    const entry = decoded.value as Record<string, unknown>;
    if (typeof entry.sessionId === "string" && !sessionId) {
      sessionId = entry.sessionId;
    }
    if (entry.type === "user") {
      userTurnCount += 1;
      if (typeof entry.cwd === "string" && !cwd) cwd = entry.cwd;
      if (!title) {
        const message = entry.message as { content?: unknown } | undefined;
        const content = message?.content;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content
                  .map((c) =>
                    typeof c === "object" && c !== null && "text" in c
                      ? String((c as { text: unknown }).text)
                      : "",
                  )
                  .join(" ")
              : "";
        const trimmed = text.replace(/\s+/g, " ").trim();
        if (trimmed.length > 0) {
          title = trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
        }
      }
    }
  }
  if (!sessionId) {
    return yield* new SessionImportError({ reason: `No sessionId found in ${jsonlPath}` });
  }
  if (!cwd) {
    return yield* new SessionImportError({ reason: `No cwd found in ${jsonlPath}` });
  }
  return {
    sessionId,
    cwd,
    title: title ?? `Imported Claude session ${sessionId.slice(0, 8)}`,
    userTurnCount,
  } satisfies ParsedClaudeSession;
});

const resolveJsonlPath = Effect.fn(function* (input: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (input.endsWith(".jsonl") && (yield* fs.exists(input))) {
    return input;
  }
  // Treat input as a session id: search ~/.claude/projects/*/<id>.jsonl
  const claudeProjectsDir = path.join(NodeOs.homedir(), ".claude", "projects");
  const projectDirs = yield* fs.readDirectory(claudeProjectsDir);
  for (const dir of projectDirs) {
    const candidate = path.join(claudeProjectsDir, dir, `${input}.jsonl`);
    if (yield* fs.exists(candidate)) {
      return candidate;
    }
  }
  return yield* new SessionImportError({
    reason: `Could not resolve '${input}' to a JSONL path under ${claudeProjectsDir}`,
  });
});

const randomUuid = Crypto.Crypto.pipe(Effect.flatMap((crypto) => crypto.randomUUIDv4));

const SessionImportRuntimeLive = Layer.mergeAll(
  WorkspacePaths.layer,
  OrchestrationLayerLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(ProviderSessionRuntimeRepo.layer),
    Layer.provideMerge(SqlitePersistenceLayerLive),
  ),
);

const sessionImportCommand = Command.make("import", {
  ...projectLocationFlags,
  source: Argument.string("session").pipe(
    Argument.withDescription("Claude Code session id or path to its JSONL transcript."),
  ),
  model: Flag.string("model").pipe(
    Flag.withDescription("Claude model id for the imported thread."),
    Flag.withDefault("claude-opus-4-8"),
  ),
}).pipe(
  Command.withDescription(
    "SPIKE: import an existing Claude Code session as a resumable t3code thread (server must be stopped).",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig(flags, logLevel);

      const path = yield* Path.Path;
      const jsonlPath = yield* resolveJsonlPath(flags.source);
      const parsed = yield* parseClaudeSessionJsonl(jsonlPath);
      yield* Console.log(
        `Parsed session ${parsed.sessionId}\n  cwd: ${parsed.cwd}\n  title: ${parsed.title}\n  user turns: ${parsed.userTurnCount}`,
      );

      const runtimeLayer = SessionImportRuntimeLive.pipe(
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
      );

      return yield* Effect.gen(function* () {
        const snapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
        const snapshot: OrchestrationReadModel = yield* snapshotQuery.getSnapshot();
        const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
        const runtimeRepo = yield* ProviderSessionRuntimeRepo.ProviderSessionRuntimeRepository;

        const nowIso = DateTime.formatIso(yield* DateTime.now);

        // 1. Ensure a project whose workspaceRoot matches the session cwd.
        let project = snapshot.projects.find(
          (candidate) => candidate.deletedAt === null && candidate.workspaceRoot === parsed.cwd,
        );
        if (!project) {
          const projectId = ProjectId.make(yield* randomUuid);
          yield* orchestrationEngine.dispatch({
            type: "project.create",
            commandId: CommandId.make(yield* randomUuid),
            projectId,
            title: path.basename(parsed.cwd),
            workspaceRoot: parsed.cwd,
            createdAt: nowIso,
          });
          yield* Console.log(`Created project ${projectId} for ${parsed.cwd}`);
          project = { id: projectId } as (typeof snapshot.projects)[number];
        } else {
          yield* Console.log(`Reusing project ${project.id} (${parsed.cwd})`);
        }

        // 2. Create the thread.
        const threadId = ThreadId.make(yield* randomUuid);
        const providerInstanceId = ProviderInstanceId.make("claudeAgent");
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.make(yield* randomUuid),
          threadId,
          projectId: project.id,
          title: `[imported] ${parsed.title}`,
          modelSelection: {
            instanceId: providerInstanceId,
            model: flags.model,
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: nowIso,
        });
        yield* Console.log(`Created thread ${threadId}`);

        // 3. Seed the provider session runtime so the first turn resumes the
        //    original Claude Code session.
        yield* runtimeRepo.upsert({
          threadId,
          providerName: "claudeAgent",
          providerInstanceId,
          adapterKey: "claudeAgent",
          runtimeMode: "full-access",
          status: "stopped",
          lastSeenAt: nowIso,
          resumeCursor: {
            threadId,
            resume: parsed.sessionId,
            turnCount: parsed.userTurnCount,
          },
          runtimePayload: null,
        });
        yield* Console.log(
          `Seeded resume cursor -> claude session ${parsed.sessionId}. Start the server and send a message in this thread to continue the session.`,
        );
      }).pipe(Effect.provide(runtimeLayer));
    }),
  ),
);

export const sessionCommand = Command.make("session").pipe(
  Command.withDescription("Session utilities (spike)."),
  Command.withSubcommands([sessionImportCommand]),
);
