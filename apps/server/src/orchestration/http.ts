import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { ClaudeSessionCoordinator } from "../claudeSessions/ClaudeSessionCoordinator.ts";
import { ClaudeSessionFocus } from "../claudeSessions/ClaudeSessionFocus.ts";
import { ClaudeSessionStatus } from "../claudeSessions/ClaudeSessionStatus.ts";
import {
  toClaudeSessionOpenFailure,
  toClaudeSessionOpenSuccess,
} from "../claudeSessions/bridge.ts";
import { normalizeDispatchCommand } from "./Normalizer.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

export const orchestrationHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "orchestration",
  Effect.fnUntraced(function* (handlers) {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;

    return handlers
      .handle(
        "snapshot",
        Effect.fn("environment.orchestration.snapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* projectionSnapshotQuery
            .getSnapshot()
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_snapshot_failed", cause),
              ),
            );
        }),
      )
      .handle(
        "shellSnapshot",
        Effect.fn("environment.orchestration.shellSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* projectionSnapshotQuery
            .getShellSnapshot()
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_snapshot_failed", cause),
              ),
            );
        }),
      )
      .handle(
        "threadSnapshot",
        Effect.fn("environment.orchestration.threadSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const snapshot = yield* projectionSnapshotQuery
            .getThreadDetailSnapshot(args.params.threadId)
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_thread_snapshot_failed", cause),
              ),
            );
          if (Option.isNone(snapshot)) {
            return yield* failEnvironmentNotFound("thread_not_found");
          }
          return snapshot.value;
        }),
      )
      .handle(
        "claudeSessionAttachmentStatus",
        Effect.fn("environment.orchestration.claudeSessionAttachmentStatus")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const claudeSessionStatus = yield* Effect.serviceOption(ClaudeSessionStatus);
          if (Option.isNone(claudeSessionStatus)) {
            return yield* failEnvironmentInternal(
              "claude_session_attachment_status_failed",
              new Error("Claude session status support is unavailable."),
            );
          }
          return yield* claudeSessionStatus.value
            .getSnapshot()
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("claude_session_attachment_status_failed", cause),
              ),
            );
        }),
      )
      .handle(
        "openClaudeSession",
        Effect.fn("environment.orchestration.openClaudeSession")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const claudeSessionCoordinator = yield* Effect.serviceOption(ClaudeSessionCoordinator);
          if (Option.isNone(claudeSessionCoordinator)) {
            return toClaudeSessionOpenFailure({
              operation: "session-service",
              message: "Claude session support is unavailable in this T3 server.",
            });
          }
          const opened = yield* claudeSessionCoordinator.value
            .open({
              nativeSessionId: args.payload.nativeSessionId,
              cwd: args.payload.cwd,
              ...(args.payload.model === undefined ? {} : { model: args.payload.model }),
            })
            .pipe(
              Effect.map(toClaudeSessionOpenSuccess),
              Effect.catch((error) => Effect.succeed(toClaudeSessionOpenFailure(error))),
            );
          const claudeSessionFocus = yield* Effect.serviceOption(ClaudeSessionFocus);
          if (opened.ok && Option.isSome(claudeSessionFocus)) {
            yield* claudeSessionFocus.value.requestFocus(opened.value.threadId);
          }
          return opened;
        }),
      )
      .handle(
        "dispatch",
        Effect.fn("environment.orchestration.dispatch")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const normalizedCommand = yield* normalizeDispatchCommand(args.payload).pipe(
            Effect.catch(() => failEnvironmentInvalidRequest("invalid_command")),
          );
          return yield* orchestrationEngine
            .dispatch(normalizedCommand)
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_dispatch_failed", cause),
              ),
            );
        }),
      );
  }),
);
