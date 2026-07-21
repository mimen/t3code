// @effect-diagnostics nodeBuiltinImport:off
import { createHash } from "node:crypto";
import * as NodeFSP from "node:fs/promises";

import { type ClaudeSettings, type ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const CLAUDE_GPT_INSTANCE_ID = "claude-gpt";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class ClaudeBinaryIntegrityError extends Schema.TaggedErrorClass<ClaudeBinaryIntegrityError>()(
  "ClaudeBinaryIntegrityError",
  {
    instanceId: Schema.String,
    binaryPath: Schema.String,
    detail: Schema.String,
  },
) {}

export interface VerifyClaudeBinaryIntegrityInput {
  readonly instanceId: ProviderInstanceId;
  readonly settings: Pick<ClaudeSettings, "binaryPath" | "binarySha256">;
}

/**
 * Verify a pinned Claude executable immediately before starting a session. The
 * claude-gpt instance must have a pin; ordinary Claude instances remain
 * backwards-compatible unless they opt into pinning.
 */
export const verifyClaudeBinaryIntegrity = Effect.fn("verifyClaudeBinaryIntegrity")(function* (
  input: VerifyClaudeBinaryIntegrityInput,
): Effect.fn.Return<void, ClaudeBinaryIntegrityError> {
  const expectedHash = input.settings.binarySha256;
  const isClaudeGpt = input.instanceId === CLAUDE_GPT_INSTANCE_ID;
  if (expectedHash.length === 0) {
    if (isClaudeGpt) {
      return yield* new ClaudeBinaryIntegrityError({
        instanceId: input.instanceId,
        binaryPath: input.settings.binaryPath,
        detail: "The claude-gpt provider requires a pinned Claude CLI SHA-256.",
      });
    }
    return;
  }
  if (!SHA256_PATTERN.test(expectedHash)) {
    return yield* new ClaudeBinaryIntegrityError({
      instanceId: input.instanceId,
      binaryPath: input.settings.binaryPath,
      detail: "The configured Claude CLI SHA-256 is malformed.",
    });
  }

  const actualHash = yield* Effect.tryPromise({
    try: async () => {
      const canonicalPath = await NodeFSP.realpath(input.settings.binaryPath);
      const contents = await NodeFSP.readFile(canonicalPath);
      return createHash("sha256").update(contents).digest("hex");
    },
    catch: () =>
      new ClaudeBinaryIntegrityError({
        instanceId: input.instanceId,
        binaryPath: input.settings.binaryPath,
        detail: "The configured Claude CLI cannot be resolved and hashed.",
      }),
  });

  if (actualHash !== expectedHash) {
    return yield* new ClaudeBinaryIntegrityError({
      instanceId: input.instanceId,
      binaryPath: input.settings.binaryPath,
      detail: "The configured Claude CLI no longer matches its SHA-256 pin.",
    });
  }
});
