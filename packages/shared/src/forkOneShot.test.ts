import { OrchestrationMessageContext } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { projectComposerContextForProvider } from "./composerContextReferences";
import {
  ONE_SHOT_INSTRUCTION,
  messageIsOneShot,
  withOneShotContext,
  withOneShotInstruction,
} from "./forkOneShot";

describe("forkOneShot", () => {
  it("survives the message context wire schema", () => {
    const encoded = Schema.encodeSync(OrchestrationMessageContext)(withOneShotContext(undefined));
    const decoded = Schema.decodeUnknownSync(OrchestrationMessageContext)(
      JSON.parse(JSON.stringify(encoded)),
    );
    expect(messageIsOneShot(decoded)).toBe(true);
  });

  it("prepends the instruction once and keeps it out of ordinary messages", () => {
    const context = withOneShotContext(withOneShotContext(undefined));
    expect(context.records).toHaveLength(1);
    const text = projectComposerContextForProvider({ text: "fix it", records: context.records });
    expect(withOneShotInstruction(text, context)).toBe(`${ONE_SHOT_INSTRUCTION}\n\nfix it`);
    expect(withOneShotInstruction("fix it", undefined)).toBe("fix it");
  });
});
