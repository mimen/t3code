import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type ForkBotsListResult,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import * as ForkBots from "../../../orchestration-v2/ForkBots.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSearch from "../../../orchestration-v2/ThreadSearch.ts";
import * as PeerForwarding from "../../../peer/PeerForwarding.ts";
import * as PeerLinkRequests from "../../../peer/PeerLinkRequests.ts";
import * as PeerLinks from "../../../peer/PeerLinks.ts";
import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../../../scheduledTasks/ScheduledTaskService.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";

const threadId = ThreadId.make("fork-bots-thread");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("fork-bots-environment"),
  requestNamespace: "fork-bots-session",
  thread: {
    threadId,
    providerSessionId: "fork-bots-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "fork-bots", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "fork-bots", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const declaredFailure = (result: McpSchema.CallToolResult) => {
  const text = result.content[0];
  return result.isError === true && text?.type === "text" ? JSON.parse(text.text) : undefined;
};

const bots = (listing: ForkBotsListResult) =>
  Layer.succeed(ForkBots.ForkBots, {
    list: Effect.succeed(listing),
    readBrief: () => Effect.undefined,
  });

const withServer = (dispatched: Array<OrchestrationV2ServerCommand>) =>
  McpHttpServer.layerThreadToolkit.pipe(
    Layer.provide(Layer.mock(ThreadSearch.ThreadSearch)({})),
    Layer.provide(Layer.mock(ScheduledTaskService.ScheduledTaskService)({})),
    Layer.provide(Layer.mock(PeerForwarding.PeerForwarding)({})),
    Layer.provide(Layer.mock(PeerLinkRequests.PeerLinkRequests)({})),
    Layer.provide(Layer.mock(PeerLinks.PeerLinks)({})),
    Layer.provide(Layer.mock(ProviderRegistry.ProviderRegistry)({})),
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provide(NodeCrypto.layer),
    Layer.provide(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (id) => Effect.succeed(McpToolAccessTestkit.liveThreadShell(id)),
        getProjectThreadRecords: ({ threadId: id }) =>
          Effect.succeed(
            McpToolAccessTestkit.idleThreadProjection(McpToolAccessTestkit.liveThreadShell(id)),
          ),
        dispatch: (command) => {
          dispatched.push(command);
          return Effect.succeed({ sequence: 1 } as never);
        },
      }),
    ),
  );

const organize = (args: Record<string, unknown>, listing: ForkBotsListResult) =>
  Effect.flatMap(McpServer.McpServer, (server) =>
    server.callTool({ name: "t3_thread_organize", arguments: args }),
  ).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    Effect.provideService(McpSchema.McpServerClient, client),
    Effect.provide(bots(listing)),
  );

const listing: ForkBotsListResult = {
  directory: "/bots",
  bots: [
    { id: "needs-you", name: "Needs you", path: "/bots/needs-you.md" },
    { id: "inbox", name: "inbox", path: "/bots/inbox.md" },
  ],
};

it.effect("set_bot and clear_bot dispatch thread.bot.set on the calling thread", () => {
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  return Effect.gen(function* () {
    const set = yield* organize({ action: "set_bot", botId: "needs-you" }, listing);
    expect(set.isError).toBe(false);
    const cleared = yield* organize({ action: "clear_bot" }, listing);
    expect(cleared.isError).toBe(false);
    expect(dispatched).toMatchObject([
      { type: "thread.bot.set", threadId, botId: "needs-you" },
      { type: "thread.bot.set", threadId, botId: null },
    ]);
  }).pipe(Effect.provide(withServer(dispatched)));
});

it.effect("set_bot refuses a missing bot file and lists the available ids", () => {
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  return Effect.gen(function* () {
    const missing = yield* organize({ action: "set_bot", botId: "gone" }, listing);
    expect(declaredFailure(missing)).toMatchObject({
      code: "invalid_request",
      message: "No bot file gone.md in /bots. Available bots: needs-you, inbox.",
    });
    const noId = yield* organize({ action: "set_bot" }, listing);
    expect(declaredFailure(noId)).toMatchObject({
      message: "set_bot requires botId. Available bots: needs-you, inbox.",
    });
    const off = yield* organize(
      { action: "set_bot", botId: "needs-you" },
      { directory: null, bots: [] },
    );
    expect(declaredFailure(off)).toMatchObject({
      message: expect.stringContaining("No bots directory is set"),
    });
    expect(dispatched).toEqual([]);
  }).pipe(Effect.provide(withServer(dispatched)));
});
