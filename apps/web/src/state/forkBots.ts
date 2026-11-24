import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { createForkBotsEnvironmentAtoms } from "@t3tools/client-runtime/state/fork-bots";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { Atom, AsyncResult } from "effect/reactivity";
import { msg } from "gt-react";

import {
  FORK_MAKE_BOT_PROMPT,
  forkBotMenuAction,
  type ForkBotMenuState,
} from "../components/threadActionMenu.forkBots";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { connectionAtomRuntime } from "../connection/runtime";
import { m } from "../i18n/messages";
import { newMessageId } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { usePrimaryEnvironmentId } from "./environments";
import { useEnvironmentQuery } from "./query";
import { serverEnvironment } from "./server";
import { environmentThreadShells, threadEnvironment } from "./threads";
import { useOrchestrationCommand } from "./use-orchestration-command";

const botIdsKeyAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const ids = new Set<string>();
    for (const thread of get(environmentThreadShells.threadShellsAtom)) {
      if (thread.environmentId === environmentId && thread.botId) ids.add(thread.botId);
    }
    return [...ids].toSorted().join(",");
  }),
);

const forkBotsEnvironment = createForkBotsEnvironmentAtoms(
  connectionAtomRuntime,
  serverEnvironment.settingsValueAtom,
  botIdsKeyAtom,
);

const botsListAtom = (environmentId: EnvironmentId) =>
  forkBotsEnvironment.list({ environmentId, input: {} });

function useForkBots(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(environmentId === null ? null : botsListAtom(environmentId)).data;
}

// ponytail: warms only the primary environment's bots for the first Bot menu; a linked one still loads cold.
export function useForkBotsPrefetch() {
  useForkBots(usePrimaryEnvironmentId());
}

export function useForkBot(environmentId: EnvironmentId, botId: string | null) {
  const bots = useForkBots(botId === null ? null : environmentId);
  return bots?.bots.find((bot) => bot.id === botId) ?? null;
}

/** Reading starts the fetch, so a menu opened before the first answer shows bots as loading. */
export function readForkBotMenuState(
  environmentId: EnvironmentId,
  current: string | null,
): ForkBotMenuState {
  const settings = appAtomRegistry.get(serverEnvironment.settingsValueAtom(environmentId));
  if (!settings?.forkBotsDirectory) return { current, list: { directory: null, bots: [] } };
  const list = AsyncResult.getOrElse(appAtomRegistry.get(botsListAtom(environmentId)), () => null);
  return { current, list };
}

/** Runs a Bot submenu pick and reports a failure as a toast; false for any other menu id. */
export function useForkBotMenuHandler() {
  const setBot = useOrchestrationCommand(threadEnvironment.setBot, { reportFailure: false });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  return async (
    target: ScopedThreadRef,
    thread: Pick<EnvironmentThreadShell, "runtimeMode" | "interactionMode">,
    menuId: string,
  ) => {
    const action = forkBotMenuAction(menuId);
    if (action === undefined) return false;
    const { environmentId, threadId } = target;
    const result =
      action.kind === "set"
        ? await setBot({ environmentId, input: { threadId, botId: action.botId } })
        : await startTurn({
            environmentId,
            input: {
              threadId,
              message: {
                messageId: newMessageId(),
                role: "user",
                text: FORK_MAKE_BOT_PROMPT,
                attachments: [],
              },
              runtimeMode: thread.runtimeMode,
              interactionMode: thread.interactionMode,
              dispatchMode: "queue",
            },
          });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title:
            action.kind === "set"
              ? m(msg("Failed to change bot"))
              : m(msg("Failed to send {command}", { command: FORK_MAKE_BOT_PROMPT })),
          description:
            thrownErrorMessage(squashAtomCommandFailure(result), m) ?? m(msg("An error occurred.")),
        }),
      );
    }
    return true;
  };
}
