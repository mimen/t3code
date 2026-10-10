import { OrchestrationMessageContext } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { projectComposerContextForProvider } from "./composerContextReferences.ts";
import {
  ONE_SHOT_INSTRUCTION,
  messageIsOneShot,
  withOneShotContext,
  withOneShotInstruction,
} from "./forkOneShot.ts";

const encodeContext = Schema.encodeSync(OrchestrationMessageContext);
const decodeContext = Schema.decodeUnknownSync(OrchestrationMessageContext);

describe("forkOneShot", () => {
  it("survives the message context wire schema", () => {
    const encoded = encodeContext(withOneShotContext(undefined));
    const decoded = decodeContext(JSON.parse(JSON.stringify(encoded)));
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
