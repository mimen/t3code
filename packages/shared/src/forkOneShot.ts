import {
  ComposerContextId,
  type ComposerContextRecord,
  type OrchestrationMessageContext,
} from "@t3tools/contracts";

/**
 * Fork: a one-shot thread settles when its first run completes. The flag rides on that run's
 * user message as an unknown-kind context record, so it needs no contract change, and the
 * message text never references it, so no chip renders.
 */
export const ONE_SHOT_CONTEXT_KIND = "fork-one-shot";

export const ONE_SHOT_INSTRUCTION = [
  "<t3_one_shot>",
  "This is a one-shot task. No follow-up messages or replies will come, so finish the whole task end to end without asking questions or stopping for confirmation.",
  "Where something is ambiguous, make a reasonable assumption and state it in your final message.",
  "Leave the work in a finished, verified state.",
  "</t3_one_shot>",
].join("\n");

export function makeOneShotContextRecord(): ComposerContextRecord {
  return {
    version: 1,
    contextId: ComposerContextId.make(ONE_SHOT_CONTEXT_KIND),
    label: "One-shot",
    kind: ONE_SHOT_CONTEXT_KIND,
    payload: { version: 1 },
  };
}

export function messageIsOneShot(context: OrchestrationMessageContext | undefined): boolean {
  return context?.records.some((record) => record.kind === ONE_SHOT_CONTEXT_KIND) ?? false;
}

export function withOneShotContext(
  context: OrchestrationMessageContext | undefined,
): OrchestrationMessageContext {
  if (messageIsOneShot(context)) return context!;
  return {
    version: 1,
    records: [...(context?.records ?? []), makeOneShotContextRecord()],
  };
}

export function withOneShotInstruction(
  userText: string,
  context: OrchestrationMessageContext | undefined,
): string {
  return messageIsOneShot(context) ? `${ONE_SHOT_INSTRUCTION}\n\n${userText}` : userText;
}
