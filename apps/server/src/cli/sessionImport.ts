// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import {
  AuthAdministrativeScopes,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  type ClaudeSessionAttachmentStatusCliResult,
  type ClaudeSessionOpenResult,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import { FetchHttpClient } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";
import { Command, Flag, GlobalFlag } from "effect/unstable/cli";

import {
  ClaudeSessionCoordinator,
  type OpenClaudeSessionResult,
} from "../claudeSessions/ClaudeSessionCoordinator.ts";
import {
  toClaudeSessionOpenFailure,
  toClaudeSessionOpenSuccess,
} from "../claudeSessions/bridge.ts";
import {
  defaultClaudeHomePath,
  makeClaudeSessionCoreLive,
} from "../claudeSessions/runtimeLayer.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { OrchestrationLayerLive } from "../orchestration/runtimeLayer.ts";
import { ExternalClaudeSessionRepositoryLive } from "../persistence/Layers/ExternalClaudeSessions.ts";
import { layer as ProviderSessionRuntimeRepositoryLive } from "../persistence/ProviderSessionRuntime.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import {
  clearPersistedServerRuntimeState,
  readPersistedServerRuntimeState,
} from "../serverRuntimeState.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

function sessionImportRuntime(claudeHomePath: string) {
  const orchestrationLayer = OrchestrationLayerLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(ProviderSessionRuntimeRepositoryLive),
    Layer.provideMerge(ExternalClaudeSessionRepositoryLive),
    Layer.provideMerge(SqlitePersistenceLayerLive),
  );
  const claudeSessionLayer = makeClaudeSessionCoreLive(claudeHomePath).pipe(
    Layer.provide(orchestrationLayer),
  );

  return Layer.mergeAll(WorkspacePaths.layer, orchestrationLayer, claudeSessionLayer);
}

const LIVE_SERVER_TIMEOUT = Duration.seconds(30);

const makeLiveServerClient = (origin: string) =>
  HttpApiClient.make(EnvironmentHttpApi, { baseUrl: origin });

function isProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
}

const withSessionCliToken = <A, E, R>(
  environmentAuth: EnvironmentAuth.EnvironmentAuth["Service"],
  run: (token: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    environmentAuth.issueSession({
      scopes: AuthAdministrativeScopes,
      label: "t3 session open cli",
    }),
    (issued) => run(issued.token),
    (issued) => environmentAuth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
  );

const withSessionStatusCliToken = <A, E, R>(
  environmentAuth: EnvironmentAuth.EnvironmentAuth["Service"],
  run: (token: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    environmentAuth.issueSession({
      scopes: [AuthOrchestrationReadScope],
      label: "t3 session status cli",
    }),
    (issued) => run(issued.token),
    (issued) => environmentAuth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
  );

const tryOpenClaudeSessionOnLiveServer = Effect.fn("tryOpenClaudeSessionOnLiveServer")(function* (
  input: {
    readonly nativeSessionId: string;
    readonly cwd: string;
    readonly model: string | undefined;
  },
  environmentAuth: EnvironmentAuth.EnvironmentAuth["Service"],
  config: ServerConfig.ServerConfig["Service"],
) {
  const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
  if (Option.isNone(runtimeState)) {
    return Option.none<ClaudeSessionOpenResult>();
  }

  const attempt = withSessionCliToken(environmentAuth, (token) =>
    Effect.gen(function* () {
      const client = yield* makeLiveServerClient(runtimeState.value.origin);
      return yield* client.orchestration
        .openClaudeSession({
          headers: { authorization: `Bearer ${token}` },
          payload: input,
        })
        .pipe(Effect.timeout(LIVE_SERVER_TIMEOUT));
    }),
  );
  const attempted = yield* Effect.result(attempt);
  if (attempted._tag === "Success") {
    return Option.some(attempted.success);
  }

  yield* Effect.logDebug("Failed to connect to the persisted Claude session CLI server.", {
    origin: runtimeState.value.origin,
    cause: attempted.failure,
  });
  if (isProcessRunning(runtimeState.value.pid)) {
    return Option.some({
      ok: false,
      error: {
        code: "t3_unavailable",
        message: "The running T3 server did not accept the Claude session open request.",
      },
    } satisfies ClaudeSessionOpenResult);
  }

  yield* clearPersistedServerRuntimeState(config.serverRuntimeStatePath);
  return Option.none<ClaudeSessionOpenResult>();
});

const getClaudeSessionStatusFromLiveServer = Effect.fn("getClaudeSessionStatusFromLiveServer")(
  function* (
    environmentAuth: EnvironmentAuth.EnvironmentAuth["Service"],
    config: ServerConfig.ServerConfig["Service"],
  ) {
    const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    if (Option.isNone(runtimeState)) {
      return {
        ok: false,
        error: {
          code: "t3_unavailable",
          message: "No running T3 server is registered for this environment.",
        },
      } satisfies ClaudeSessionAttachmentStatusCliResult;
    }

    const attempt = withSessionStatusCliToken(environmentAuth, (token) =>
      Effect.gen(function* () {
        const client = yield* makeLiveServerClient(runtimeState.value.origin);
        return yield* client.orchestration
          .claudeSessionAttachmentStatus({
            headers: { authorization: `Bearer ${token}` },
          })
          .pipe(Effect.timeout(LIVE_SERVER_TIMEOUT));
      }),
    );
    const attempted = yield* Effect.result(attempt);
    if (attempted._tag === "Success") {
      return {
        ok: true,
        value: attempted.success,
      } satisfies ClaudeSessionAttachmentStatusCliResult;
    }

    yield* Effect.logDebug("Failed to query Claude session status from the persisted T3 server.", {
      origin: runtimeState.value.origin,
      cause: attempted.failure,
    });
    if (!isProcessRunning(runtimeState.value.pid)) {
      yield* clearPersistedServerRuntimeState(config.serverRuntimeStatePath);
      return {
        ok: false,
        error: {
          code: "t3_unavailable",
          message: "The registered T3 server is no longer running.",
        },
      } satisfies ClaudeSessionAttachmentStatusCliResult;
    }
    return {
      ok: false,
      error: {
        code: "request_failed",
        message: "The running T3 server did not return Claude session attachment status.",
      },
    } satisfies ClaudeSessionAttachmentStatusCliResult;
  },
);

const resumeIdFlag = Flag.string("resume-id").pipe(
  Flag.withDescription("Native Claude Code session UUID to attach or open."),
);
const cwdFlag = Flag.string("cwd").pipe(
  Flag.withDescription("Absolute working directory verified against the native Claude session."),
);
const modelFlag = Flag.string("model").pipe(
  Flag.withDescription("Claude model id for a newly attached thread."),
  Flag.optional,
);
const claudeHomeFlag = Flag.string("claude-home").pipe(
  Flag.withDescription(
    "Claude config home containing projects/ (defaults to CLAUDE_CONFIG_DIR or ~/.claude).",
  ),
  Flag.optional,
);
const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Write the open result as JSON."),
  Flag.withDefault(false),
);

export {
  toClaudeSessionOpenFailure as sessionOpenFailureEnvelope,
  toClaudeSessionOpenSuccess as sessionOpenSuccessEnvelope,
} from "../claudeSessions/bridge.ts";

function renderOpenResult(result: OpenClaudeSessionResult, json: boolean): Effect.Effect<void> {
  if (json) {
    return Console.log(JSON.stringify(toClaudeSessionOpenSuccess(result)));
  }
  return Console.log(
    [
      `${result.created ? "Attached" : "Opened"} Claude session ${result.sourceId}`,
      `  thread: ${result.threadId}`,
      `  project: ${result.projectId}`,
      ...(result.sync
        ? [
            `  imported items: ${result.sync.importedItemCount}`,
            `  checkpoint: line ${result.sync.committedLineOrdinal}, byte ${result.sync.committedByteOffset}`,
            ...(result.sync.hasIncompleteTail
              ? ["  note: waiting for an incomplete final JSONL line"]
              : []),
          ]
        : [`  source sync requires repair: ${result.syncError ?? "unknown error"}`]),
    ].join("\n"),
  );
}

function renderLiveOpenResult(result: ClaudeSessionOpenResult, json: boolean): Effect.Effect<void> {
  if (json) {
    return Console.log(JSON.stringify(result));
  }
  if (!result.ok) {
    return Console.log(`Cannot open Claude session: ${result.error.message}`);
  }
  return Console.log(
    [
      `${result.value.created ? "Attached" : "Opened"} Claude session through the running T3 server`,
      `  thread: ${result.value.threadId}`,
      `  project: ${result.value.projectId}`,
    ].join("\n"),
  );
}

function renderStatusResult(
  result: ClaudeSessionAttachmentStatusCliResult,
  json: boolean,
): Effect.Effect<void> {
  if (json) {
    return Console.log(JSON.stringify(result));
  }
  if (!result.ok) {
    return Console.log(`Cannot load Claude session status: ${result.error.message}`);
  }
  if (result.value.attachments.length === 0) {
    return Console.log("No active T3 Claude session attachments.");
  }
  return Console.log(
    result.value.attachments
      .map(
        (attachment) =>
          `${attachment.nativeSessionId}  ${attachment.state}  ${attachment.runtimeStatus ?? "no-runtime"}  ${attachment.threadId}`,
      )
      .join("\n"),
  );
}

const sessionStatusCommand = Command.make("status", {
  ...projectLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Read active T3 attachment and provider runtime status for native Claude sessions.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig(flags, logLevel);
      const runtimeLayer = Layer.mergeAll(EnvironmentAuth.runtimeLayer, FetchHttpClient.layer).pipe(
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
      );
      const result = yield* Effect.gen(function* () {
        const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
        return yield* getClaudeSessionStatusFromLiveServer(environmentAuth, config);
      }).pipe(Effect.provide(runtimeLayer));
      return yield* renderStatusResult(result, flags.json);
    }),
  ),
);

const sessionOpenCommand = Command.make("open", {
  ...projectLocationFlags,
  resumeId: resumeIdFlag,
  cwd: cwdFlag,
  model: modelFlag,
  claudeHome: claudeHomeFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Attach or open a native Claude Code session, synchronize complete JSONL history, and seed native resume state.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig(flags, logLevel);
      const configuredClaudeHome = Option.getOrUndefined(flags.claudeHome)?.trim();
      const claudeHomePath =
        configuredClaudeHome && configuredClaudeHome.length > 0
          ? NodePath.resolve(configuredClaudeHome)
          : defaultClaudeHomePath();
      const runtimeLayer = Layer.mergeAll(
        sessionImportRuntime(claudeHomePath),
        EnvironmentAuth.runtimeLayer,
        FetchHttpClient.layer,
      ).pipe(
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
      );
      const input = {
        nativeSessionId: flags.resumeId,
        cwd: flags.cwd,
        ...(Option.isSome(flags.model) ? { model: flags.model.value } : {}),
      };

      const open = Effect.gen(function* () {
        const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
        const liveResult = yield* tryOpenClaudeSessionOnLiveServer(
          {
            nativeSessionId: input.nativeSessionId,
            cwd: input.cwd,
            model: input.model,
          },
          environmentAuth,
          config,
        );
        if (Option.isSome(liveResult)) {
          return yield* renderLiveOpenResult(liveResult.value, flags.json);
        }

        const coordinator = yield* ClaudeSessionCoordinator;
        const result = yield* coordinator.open(input);
        return yield* renderOpenResult(result, flags.json);
      }).pipe(Effect.provide(runtimeLayer));

      if (!flags.json) {
        return yield* open;
      }
      return yield* open.pipe(
        Effect.catch((error) => Console.log(JSON.stringify(toClaudeSessionOpenFailure(error)))),
      );
    }),
  ),
);

export const sessionCommand = Command.make("session").pipe(
  Command.withDescription("Native Claude session utilities."),
  Command.withSubcommands([sessionOpenCommand, sessionStatusCommand]),
);
