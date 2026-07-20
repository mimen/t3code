/**
 * Spike probe: drive @anthropic-ai/claude-agent-sdk exactly the way
 * apps/server/src/provider/Layers/ClaudeAdapter.ts does (pathToClaudeCodeExecutable,
 * env, model), but pointed at the claude-gpt-stdio wrapper + a GPT model id.
 * If this answers, the full t3code chain works modulo settings plumbing.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

const wrapper = new URL("./claude-gpt-stdio", import.meta.url).pathname;
const model = process.argv[2] ?? "gpt-5.6-luna[1m]";

const q = query({
  prompt: "Reply with exactly one line: the model id you are running as, verbatim.",
  options: {
    model,
    pathToClaudeCodeExecutable: wrapper,
    systemPrompt: { type: "preset", preset: "claude_code" },
    env: { ...process.env },
    cwd: "/tmp",
    maxTurns: 1,
  },
});

for await (const msg of q) {
  if (msg.type === "assistant") {
    for (const block of msg.message.content) {
      if (block.type === "text") console.log("ASSISTANT:", block.text);
    }
  }
  if (msg.type === "result") {
    console.log(
      "RESULT subtype:",
      msg.subtype,
      "| model info:",
      JSON.stringify(msg.modelUsage ?? {}),
    );
  }
}
