import { randomUUID } from "node:crypto";

import { type OrchestrationShellFocusRequest, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

export interface ClaudeSessionFocusShape {
  readonly requestFocus: (threadId: ThreadId) => Effect.Effect<void>;
  readonly streamFocusRequests: Stream.Stream<OrchestrationShellFocusRequest>;
}

export class ClaudeSessionFocus extends Context.Service<
  ClaudeSessionFocus,
  ClaudeSessionFocusShape
>()("t3/claudeSessions/ClaudeSessionFocus") {}

const makeClaudeSessionFocus = Effect.gen(function* () {
  const focusRequests = yield* PubSub.unbounded<OrchestrationShellFocusRequest>();

  return {
    requestFocus: (threadId) =>
      PubSub.publish(focusRequests, {
        requestId: randomUUID(),
        threadId,
      }).pipe(Effect.asVoid),
    streamFocusRequests: Stream.fromPubSub(focusRequests),
  } satisfies ClaudeSessionFocusShape;
});

export const ClaudeSessionFocusLive = Layer.effect(ClaudeSessionFocus, makeClaudeSessionFocus);
