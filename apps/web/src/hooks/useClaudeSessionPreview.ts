import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { ClaudeSessionPreview } from "@t3tools/contracts";
import { useCallback, useRef, useState } from "react";

import {
  federatedClaudeSessionKey,
  type FederatedClaudeSession,
} from "../claudeSessionSurfaces.logic";
import { claudeSessionEnvironment } from "../state/claudeSessions";
import { useAtomCommand } from "../state/use-atom-command";

export interface ClaudeSessionPreviewState {
  readonly sessionKey: string | null;
  readonly preview: ClaudeSessionPreview | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}

const EMPTY_PREVIEW_STATE: ClaudeSessionPreviewState = {
  sessionKey: null,
  preview: null,
  isLoading: false,
  error: null,
};

export function useClaudeSessionPreview(): {
  readonly state: ClaudeSessionPreviewState;
  readonly requestPreview: (session: FederatedClaudeSession) => Promise<void>;
  readonly clearPreview: () => void;
} {
  const previewSession = useAtomCommand(claudeSessionEnvironment.preview, { reportFailure: false });
  const [state, setState] = useState<ClaudeSessionPreviewState>(EMPTY_PREVIEW_STATE);
  const generationRef = useRef(0);

  const clearPreview = useCallback((): void => {
    generationRef.current += 1;
    setState(EMPTY_PREVIEW_STATE);
  }, []);

  const requestPreview = useCallback(
    async (session: FederatedClaudeSession): Promise<void> => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const sessionKey = federatedClaudeSessionKey(session);
      setState({ sessionKey, preview: null, isLoading: true, error: null });
      const result = await previewSession({
        environmentId: session.environmentId,
        input: {
          nativeSessionId: session.session.nativeSessionId,
          cwd: session.session.sourceCwd,
        },
      });
      if (generationRef.current !== generation) {
        return;
      }
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        setState({
          sessionKey,
          preview: null,
          isLoading: false,
          error:
            error instanceof Error
              ? error.message
              : "This environment could not provide a live preview.",
        });
        return;
      }
      setState({ sessionKey, preview: result.value, isLoading: false, error: null });
    },
    [previewSession],
  );

  return { state, requestPreview, clearPreview };
}
