// @effect-diagnostics nodeBuiltinImport:off
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ProviderInstanceId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { verifyClaudeBinaryIntegrity } from "./ClaudeBinaryIntegrity.ts";

const claudeGptInstanceId = ProviderInstanceId.make("claude-gpt");

it.effect("pins the canonical Claude executable before session startup", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const temporaryDirectory = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "t3code-claude-integrity-test-"))),
        (directory) => Effect.sync(() => rmSync(directory, { force: true, recursive: true })),
      );
      const executablePath = join(temporaryDirectory, "claude");
      const symlinkPath = join(temporaryDirectory, "claude-symlink");
      writeFileSync(executablePath, "trusted-claude-cli");
      symlinkSync(executablePath, symlinkPath);
      const trustedHash = createHash("sha256").update("trusted-claude-cli").digest("hex");

      yield* verifyClaudeBinaryIntegrity({
        instanceId: claudeGptInstanceId,
        settings: { binaryPath: symlinkPath, binarySha256: trustedHash },
      });

      writeFileSync(executablePath, "mutated-claude-cli");
      const mismatch = yield* Effect.flip(
        verifyClaudeBinaryIntegrity({
          instanceId: claudeGptInstanceId,
          settings: { binaryPath: symlinkPath, binarySha256: trustedHash },
        }),
      );
      assert.strictEqual(mismatch._tag, "ClaudeBinaryIntegrityError");
      assert.strictEqual(
        mismatch.detail,
        "The configured Claude CLI no longer matches its SHA-256 pin.",
      );

      const missingPin = yield* Effect.flip(
        verifyClaudeBinaryIntegrity({
          instanceId: claudeGptInstanceId,
          settings: { binaryPath: symlinkPath, binarySha256: "" },
        }),
      );
      assert.strictEqual(missingPin._tag, "ClaudeBinaryIntegrityError");
      assert.strictEqual(
        missingPin.detail,
        "The claude-gpt provider requires a pinned Claude CLI SHA-256.",
      );
    }),
  ),
);
