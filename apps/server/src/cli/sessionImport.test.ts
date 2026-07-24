import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { sessionOpenFailureEnvelope, sessionOpenSuccessEnvelope } from "./sessionImport.ts";

describe("session open JSON envelopes", () => {
  it("emits only the bridge contract fields for a successful open", () => {
    const envelope = sessionOpenSuccessEnvelope({
      threadId: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      sourceId: "claude-jsonl-source-1",
      created: true,
      syncError: null,
      sync: {
        sourceId: "claude-jsonl-source-1",
        threadId: ThreadId.make("thread-1"),
        importedItemCount: 3,
        committedByteOffset: 42,
        committedLineOrdinal: 2,
        hasIncompleteTail: false,
        syncedAt: "2026-07-20T00:00:00.000Z",
      },
    });

    expect(envelope).toEqual({
      ok: true,
      value: {
        threadId: "thread-1",
        projectId: "project-1",
        created: true,
      },
    });
  });

  it("maps validation and catalogue failures to the CCS bridge codes", () => {
    expect(
      sessionOpenFailureEnvelope({
        operation: "validate-cwd",
        detail: "Requested working directory does not match the native Claude session source.",
        message: "invalid cwd",
      }),
    ).toEqual({ ok: false, error: { code: "invalid_cwd", message: "invalid cwd" } });
    expect(
      sessionOpenFailureEnvelope({
        operation: "resolve-source",
        detail: "Native session id must be a UUID.",
        message: "invalid id",
      }),
    ).toEqual({ ok: false, error: { code: "invalid_resume_id", message: "invalid id" } });
    expect(
      sessionOpenFailureEnvelope({
        operation: "resolve-source",
        detail: "Claude session was not found in the configured home.",
        message: "not found",
      }),
    ).toEqual({ ok: false, error: { code: "source_not_found", message: "not found" } });
  });
});
