import { describe, expect, it } from "vite-plus/test";

import {
  hashNormalizedClaudeHistoryItem,
  normalizeClaudeJsonlLine,
} from "./ClaudeJsonlNormalizer.ts";

const nativeSessionId = "123e4567-e89b-42d3-a456-426614174000";

describe("ClaudeJsonlNormalizer", () => {
  it("normalizes visible messages and inert tool activities without thinking", () => {
    const normalized = normalizeClaudeJsonlLine({
      lineOrdinal: 8,
      line: JSON.stringify({
        type: "assistant",
        uuid: "assistant-1",
        sessionId: nativeSessionId,
        cwd: "/workspace/project",
        timestamp: "2026-03-04T05:06:07.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private chain of thought" },
            { type: "text", text: "I will inspect the repository." },
            { type: "tool_use", id: "tool-1", name: "Read", input: { path: "src/index.ts" } },
          ],
        },
      }),
    });

    expect(normalized.kind).toBe("normalized");
    if (normalized.kind !== "normalized") {
      return;
    }
    expect(normalized.record.items).toEqual([
      {
        kind: "message",
        sourceItemKey: "assistant-1:message:0",
        role: "assistant",
        text: "I will inspect the repository.",
        timestamp: "2026-03-04T05:06:07.000Z",
        timelineIndex: 0,
      },
      {
        kind: "activity",
        sourceItemKey: "assistant-1:tool-call:1",
        activityKind: "claude-code.tool-call",
        summary: "Tool call: Read",
        payload: {
          name: "Read",
          toolUseId: "tool-1",
          input: { path: "src/index.ts" },
        },
        timestamp: "2026-03-04T05:06:07.000Z",
        timelineIndex: 1,
      },
    ]);
    expect(JSON.stringify(normalized.record.items)).not.toContain("private chain of thought");
  });

  it("classifies user tool results as inert activities", () => {
    const normalized = normalizeClaudeJsonlLine({
      lineOrdinal: 9,
      line: JSON.stringify({
        type: "user",
        uuid: "result-1",
        sessionId: nativeSessionId,
        cwd: "/workspace/project",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: [{ type: "text", text: "file contents" }],
            },
          ],
        },
      }),
    });

    expect(normalized.kind).toBe("normalized");
    if (normalized.kind !== "normalized") {
      return;
    }
    expect(normalized.record.items).toHaveLength(1);
    expect(normalized.record.items[0]).toMatchObject({
      kind: "activity",
      activityKind: "claude-code.tool-result",
      summary: "Tool result: file contents",
      payload: { toolUseId: "tool-1" },
    });
  });

  it("does not import nested sidechain records and rejects malformed completed JSON", () => {
    const sidechain = normalizeClaudeJsonlLine({
      lineOrdinal: 10,
      line: JSON.stringify({
        type: "assistant",
        isSidechain: true,
        sessionId: nativeSessionId,
        cwd: "/workspace/project",
      }),
    });
    expect(sidechain).toMatchObject({ kind: "ignored", nativeSessionId });

    expect(normalizeClaudeJsonlLine({ lineOrdinal: 11, line: "not json" })).toEqual({
      kind: "malformed",
      detail: "Record is not valid JSON.",
    });
  });

  it("hashes normalized visible content rather than skipped thinking payloads", () => {
    const first = normalizeClaudeJsonlLine({
      lineOrdinal: 12,
      line: JSON.stringify({
        type: "assistant",
        uuid: "assistant-hash",
        sessionId: nativeSessionId,
        cwd: "/workspace/project",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "first private thought" },
            { type: "text", text: "Visible answer" },
          ],
        },
      }),
    });
    const second = normalizeClaudeJsonlLine({
      lineOrdinal: 12,
      line: JSON.stringify({
        type: "assistant",
        uuid: "assistant-hash",
        sessionId: nativeSessionId,
        cwd: "/workspace/project",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "different private thought" },
            { type: "text", text: "Visible answer" },
          ],
        },
      }),
    });

    expect(first.kind).toBe("normalized");
    expect(second.kind).toBe("normalized");
    if (first.kind !== "normalized" || second.kind !== "normalized") {
      return;
    }
    expect(hashNormalizedClaudeHistoryItem(first.record.items[0]!)).toBe(
      hashNormalizedClaudeHistoryItem(second.record.items[0]!),
    );
  });
});
