import { CommandId, type OrchestrationV2Run, type ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { messageIsOneShot } from "@t3tools/shared/forkOneShot";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const ACTIVE_RUN_STATUSES: ReadonlyArray<OrchestrationV2Run["status"]> = [
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
];

/** Fork: settles a one-shot thread when the run its one-shot message started completes cleanly. */
export class ForkOneShotSettleReactor extends Context.Service<
  ForkOneShotSettleReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ForkOneShotSettleReactor") {}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const settleIfOneShot = Effect.fn("ForkOneShotSettleReactor.settleIfOneShot")(
    function* (input: { readonly threadId: ThreadId; readonly run: OrchestrationV2Run }) {
      const { thread, runs, runtimeRequests, messages } = yield* projections.getThreadRecords(
        input.threadId,
        ["runs", "runtimeRequests", "messages"],
        { messageIds: [input.run.userMessageId] },
      );
      const message = messages.find((candidate) => candidate.id === input.run.userMessageId);
      if (!messageIsOneShot(message?.context)) return;
      // A pinned thread is one the user is keeping in view; settling would unpin it.
      if (thread.archivedAt !== null || thread.pinnedAt != null) return;
      if (thread.settledOverride === "settled") return;
      if (runs.some((run) => ACTIVE_RUN_STATUSES.includes(run.status))) return;
      if (runtimeRequests.some((request) => request.status === "pending")) return;
      yield* orchestrator.dispatch({
        type: "thread.settle",
        // Deterministic, so a replayed completion cannot settle the thread a second time.
        commandId: CommandId.make(`server:fork-one-shot-settle:${input.threadId}:${input.run.id}`),
        threadId: input.threadId,
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("one-shot settle failed", {
              threadId: input.threadId,
              runId: input.run.id,
              cause: Cause.pretty(cause),
            }),
        ),
      ),
  );

  const worker = yield* makeDrainableWorker(settleIfOneShot);

  const start: ForkOneShotSettleReactor["Service"]["start"] = () =>
    forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        event.type === "run.updated" && event.payload.status === "completed"
          ? worker.enqueue({ threadId: event.threadId, run: event.payload })
          : Effect.void,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("one-shot settle event stream failed", { cause }),
        ),
      ),
    );

  return ForkOneShotSettleReactor.of({ start, drain: worker.drain });
});

export const layer = Layer.effect(ForkOneShotSettleReactor, make);
