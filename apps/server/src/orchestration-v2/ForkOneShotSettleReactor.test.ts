import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import { withOneShotContext } from "@t3tools/shared/forkOneShot";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ForkOneShotSettleReactor from "./ForkOneShotSettleReactor.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const NOW = DateTime.makeUnsafe("2026-10-10T12:00:00.000Z");
const THREAD_ID = ThreadId.make("thread:one-shot");
const INSTANCE_ID = ProviderInstanceId.make("codex");

const thread: OrchestrationV2AppThread = {
  id: THREAD_ID,
  projectId: ProjectId.make("project:one-shot"),
  title: "One-shot",
  providerInstanceId: INSTANCE_ID,
  modelSelection: { instanceId: INSTANCE_ID, model: "test" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
  forkedFrom: null,
  createdBy: "user",
  creationSource: "web",
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};

function makeRun(ordinal: number, status: OrchestrationV2Run["status"]): OrchestrationV2Run {
  return {
    id: RunId.make(`run:${ordinal}`),
    threadId: THREAD_ID,
    ordinal,
    providerInstanceId: INSTANCE_ID,
    modelSelection: thread.modelSelection,
    providerThreadId: null,
    userMessageId: MessageId.make(`message:${ordinal}`),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: NOW,
    startedAt: NOW,
    completedAt: NOW,
    checkpointId: null,
    contextHandoffId: null,
  };
}

function makeMessage(ordinal: number, oneShot: boolean): OrchestrationV2ConversationMessage {
  return {
    id: MessageId.make(`message:${ordinal}`),
    threadId: THREAD_ID,
    runId: RunId.make(`run:${ordinal}`),
    nodeId: null,
    role: "user",
    text: "do the thing",
    ...(oneShot ? { context: withOneShotContext(undefined) } : {}),
    attachments: [],
    streaming: false,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: "user",
    creationSource: "web",
  };
}

function runUpdated(run: OrchestrationV2Run): OrchestrationV2DomainEvent {
  return {
    type: "run.updated",
    id: EventId.make(`event:${run.id}:${run.status}`),
    threadId: THREAD_ID,
    runId: run.id,
    occurredAt: NOW,
    payload: run,
  } as OrchestrationV2DomainEvent;
}

/**
 * Feeds `events` to the reactor against a thread whose projection holds `runs` and `messages`,
 * and returns the commands it dispatched. Every completed run reads the projection once, which
 * marks that its event reached the worker.
 */
const settleCommandsAfter = (input: {
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly messages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly events: ReadonlyArray<OrchestrationV2DomainEvent>;
  readonly thread?: OrchestrationV2AppThread;
}) =>
  Effect.gen(function* () {
    const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
    const reads = yield* Queue.unbounded<void>();
    const layer = ForkOneShotSettleReactor.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(Orchestrator.OrchestratorV2)({
            streamDomainEvents: Stream.fromQueue(events),
            dispatch: (command) =>
              Ref.update(commands, (recorded) => [...recorded, command]).pipe(
                Effect.as({ sequence: 1, storedEvents: [] }),
              ),
          }),
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getThreadRecords: (_threadId, _fields, filter) =>
              Queue.offer(reads, undefined).pipe(
                Effect.as({
                  thread: input.thread ?? thread,
                  runs: input.runs,
                  runtimeRequests: [],
                  messages: input.messages.filter(
                    (message) =>
                      filter?.messageIds === undefined || filter.messageIds.includes(message.id),
                  ),
                } as never),
              ),
          }),
        ),
      ),
    );
    return yield* Effect.gen(function* () {
      const reactor = yield* ForkOneShotSettleReactor.ForkOneShotSettleReactor;
      yield* reactor.start();
      yield* Queue.offerAll(events, input.events);
      const completed = input.events.filter(
        (event) => event.type === "run.updated" && event.payload.status === "completed",
      );
      for (const _ of completed) yield* Queue.take(reads);
      yield* reactor.drain;
      return yield* Ref.get(commands);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped);

describe("ForkOneShotSettleReactor", () => {
  it.effect("settles a thread whose one-shot run completes", () =>
    Effect.gen(function* () {
      const run = makeRun(1, "completed");
      const commands = yield* settleCommandsAfter({
        runs: [run],
        messages: [makeMessage(1, true)],
        events: [runUpdated(run)],
      });
      assert.deepStrictEqual(commands, [
        {
          type: "thread.settle",
          commandId: `server:fork-one-shot-settle:${THREAD_ID}:${run.id}`,
          threadId: THREAD_ID,
        } as OrchestrationV2ServerCommand,
      ]);
    }),
  );

  it.effect("leaves a failed one-shot run in the inbox", () =>
    Effect.gen(function* () {
      const run = makeRun(1, "failed");
      // An ordinary completed run after it proves the failed event was already handled.
      const sentinel = makeRun(2, "completed");
      const commands = yield* settleCommandsAfter({
        runs: [run, sentinel],
        messages: [makeMessage(1, true), makeMessage(2, false)],
        events: [runUpdated(run), runUpdated(sentinel)],
      });
      assert.deepStrictEqual(commands, []);
    }),
  );

  it.effect("does not settle an ordinary thread", () =>
    Effect.gen(function* () {
      const run = makeRun(1, "completed");
      const commands = yield* settleCommandsAfter({
        runs: [run],
        messages: [makeMessage(1, false)],
        events: [runUpdated(run)],
      });
      assert.deepStrictEqual(commands, []);
    }),
  );

  it.effect("does not settle again when a reply's run completes", () =>
    Effect.gen(function* () {
      const reply = makeRun(2, "completed");
      const commands = yield* settleCommandsAfter({
        runs: [makeRun(1, "completed"), reply],
        messages: [makeMessage(1, true), makeMessage(2, false)],
        events: [runUpdated(reply)],
      });
      assert.deepStrictEqual(commands, []);
    }),
  );

  it.effect("does not settle while a queued run is waiting", () =>
    Effect.gen(function* () {
      const run = makeRun(1, "completed");
      const commands = yield* settleCommandsAfter({
        runs: [run, makeRun(2, "queued")],
        messages: [makeMessage(1, true), makeMessage(2, false)],
        events: [runUpdated(run)],
      });
      assert.deepStrictEqual(commands, []);
    }),
  );

  it.effect("does not settle a pinned thread", () =>
    Effect.gen(function* () {
      const run = makeRun(1, "completed");
      const commands = yield* settleCommandsAfter({
        runs: [run],
        messages: [makeMessage(1, true)],
        events: [runUpdated(run)],
        thread: { ...thread, pinnedAt: NOW },
      });
      assert.deepStrictEqual(commands, []);
    }),
  );
});
