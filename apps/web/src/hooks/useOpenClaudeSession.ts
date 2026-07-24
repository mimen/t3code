import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import type { FederatedClaudeSession } from "../claudeSessionSurfaces.logic";
import { claudeSessionEnvironment } from "../state/claudeSessions";
import { useAtomCommand } from "../state/use-atom-command";

export function useOpenClaudeSession(options?: {
  readonly beforeNavigate?: () => void;
}): (session: FederatedClaudeSession) => Promise<void> {
  const navigate = useNavigate();
  const openSession = useAtomCommand(claudeSessionEnvironment.open, { reportFailure: false });
  const beforeNavigate = options?.beforeNavigate;

  return useCallback(
    async (session: FederatedClaudeSession): Promise<void> => {
      const result = await openSession({
        environmentId: session.environmentId,
        input: {
          nativeSessionId: session.session.nativeSessionId,
          cwd: session.session.sourceCwd,
        },
      });
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        throw error instanceof Error ? error : new Error("Could not open this Claude session.");
      }
      if (!result.value.ok) {
        throw new Error(result.value.error.message);
      }
      beforeNavigate?.();
      await navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: session.environmentId,
          threadId: result.value.value.threadId,
        },
      });
    },
    [beforeNavigate, navigate, openSession],
  );
}
