import { MessageId, ThreadId, type OrchestrationThreadTimelinePage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mergeRefreshedTimelinePage } from "./externalTimelinePaging";

type TimelineItem = OrchestrationThreadTimelinePage["items"][number];

function messageItem(id: string, createdAt: string): TimelineItem {
  return {
    kind: "message",
    message: {
      id: MessageId.make(id),
      role: "assistant",
      text: id,
      turnId: null,
      streaming: false,
      provenance: { origin: "t3" },
      createdAt,
      updatedAt: createdAt,
    },
  };
}

describe("mergeRefreshedTimelinePage", () => {
  it("preserves loaded older pages when the refreshed head overlaps", () => {
    const threadId = ThreadId.make("thread-1");
    const result = mergeRefreshedTimelinePage({
      threadId,
      existing: {
        threadId,
        items: [
          messageItem("older", "2026-07-24T00:00:00.000Z"),
          messageItem("overlap", "2026-07-24T00:01:00.000Z"),
        ],
        nextCursor: "older-cursor",
      },
      page: {
        items: [
          messageItem("overlap", "2026-07-24T00:01:00.000Z"),
          messageItem("new", "2026-07-24T00:02:00.000Z"),
        ],
        nextCursor: "refreshed-cursor",
      },
    });

    expect(result.items.map((item) => item.kind === "message" && item.message.id)).toEqual([
      "older",
      "overlap",
      "new",
    ]);
    expect(result.nextCursor).toBe("older-cursor");
  });

  it("resets pagination when a large sync leaves no overlap with loaded history", () => {
    const threadId = ThreadId.make("thread-1");
    const result = mergeRefreshedTimelinePage({
      threadId,
      existing: {
        threadId,
        items: [messageItem("old-head", "2026-07-24T00:00:00.000Z")],
        nextCursor: "old-cursor",
      },
      page: {
        items: [messageItem("new-head", "2026-07-24T01:00:00.000Z")],
        nextCursor: "new-cursor",
      },
    });

    expect(result.items.map((item) => item.kind === "message" && item.message.id)).toEqual([
      "new-head",
    ]);
    expect(result.nextCursor).toBe("new-cursor");
  });
});
