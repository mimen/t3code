import { createClaudeSessionEnvironmentAtoms } from "@t3tools/client-runtime/state/claude-sessions";

import { connectionAtomRuntime } from "../connection/runtime";

export const claudeSessionEnvironment = createClaudeSessionEnvironmentAtoms(connectionAtomRuntime);
