import type { ClaudeSessionOpenErrorCode, ClaudeSessionOpenResult } from "@t3tools/contracts";

import { type OpenClaudeSessionResult } from "./ClaudeSessionCoordinator.ts";

export interface ClaudeSessionOpenFailure {
  readonly message: string;
  readonly operation?: string | undefined;
  readonly detail?: string | undefined;
}

export function toClaudeSessionOpenSuccess(
  result: OpenClaudeSessionResult,
): ClaudeSessionOpenResult {
  return {
    ok: true,
    value: {
      threadId: result.threadId,
      projectId: result.projectId,
      created: result.created,
    },
  };
}

export function toClaudeSessionOpenFailure(
  error: ClaudeSessionOpenFailure,
): ClaudeSessionOpenResult {
  const detail = error.detail ?? error.message;
  const code: ClaudeSessionOpenErrorCode =
    error.operation === "validate-cwd"
      ? "invalid_cwd"
      : error.operation === "resolve-source" && /UUID/i.test(detail)
        ? "invalid_resume_id"
        : error.operation === "resolve-source"
          ? "source_not_found"
          : error.operation === "seed-provider-runtime"
            ? "provider_unavailable"
            : "request_failed";
  return { ok: false, error: { code, message: error.message } };
}
