import type { NodeId, OrchestrationV2AppThread, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { makeSubagentChildThread } from "./subagentProjection.ts";

describe("makeSubagentChildThread (fork: bots)", () => {
  it("does not inherit the parent's bot", () => {
    const parentThread = {
      id: "parent" as ThreadId,
      botId: "chief-of-staff",
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "parent" },
    } as unknown as OrchestrationV2AppThread;

    const child = makeSubagentChildThread({
      parentThread,
      childThreadId: "child" as ThreadId,
      parentNodeId: "node" as NodeId,
      activeProviderThreadId: null,
      providerInstanceId: parentThread.providerInstanceId,
      modelSelection: parentThread.modelSelection,
      title: "Child",
      now: DateTime.makeUnsafe(0),
      createdBy: parentThread.createdBy,
      creationSource: parentThread.creationSource,
    });

    expect(child.botId).toBeNull();
  });
});
