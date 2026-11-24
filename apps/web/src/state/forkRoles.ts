import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { createForkRolesEnvironmentAtoms } from "@t3tools/client-runtime/state/fork-roles";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { Atom, AsyncResult } from "effect/reactivity";
import { msg } from "gt-react";

import {
  FORK_MAKE_ROLE_PROMPT,
  forkRoleMenuAction,
  type ForkRoleMenuState,
} from "../components/threadActionMenu.forkRoles";
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

const roleIdsKeyAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const ids = new Set<string>();
    for (const thread of get(environmentThreadShells.threadShellsAtom)) {
      if (thread.environmentId === environmentId && thread.roleId) ids.add(thread.roleId);
    }
    return [...ids].toSorted().join(",");
  }),
);

const forkRolesEnvironment = createForkRolesEnvironmentAtoms(
  connectionAtomRuntime,
  serverEnvironment.settingsValueAtom,
  roleIdsKeyAtom,
);

const rolesListAtom = (environmentId: EnvironmentId) =>
  forkRolesEnvironment.list({ environmentId, input: {} });

function useForkRoles(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(environmentId === null ? null : rolesListAtom(environmentId)).data;
}

// ponytail: warms only the primary environment's roles for the first Role menu; a linked one still loads cold.
export function useForkRolesPrefetch() {
  useForkRoles(usePrimaryEnvironmentId());
}

export function useForkRole(environmentId: EnvironmentId, roleId: string | null) {
  const roles = useForkRoles(roleId === null ? null : environmentId);
  return roles?.roles.find((role) => role.id === roleId) ?? null;
}

/** Reading starts the fetch, so a menu opened before the first answer shows roles as loading. */
export function readForkRoleMenuState(
  environmentId: EnvironmentId,
  current: string | null,
): ForkRoleMenuState {
  const settings = appAtomRegistry.get(serverEnvironment.settingsValueAtom(environmentId));
  if (!settings?.forkRolesDirectory) return { current, list: { directory: null, roles: [] } };
  const list = AsyncResult.getOrElse(appAtomRegistry.get(rolesListAtom(environmentId)), () => null);
  return { current, list };
}

/** Runs a Role submenu pick and reports a failure as a toast; false for any other menu id. */
export function useForkRoleMenuHandler() {
  const setRole = useOrchestrationCommand(threadEnvironment.setRole, { reportFailure: false });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  return async (
    target: ScopedThreadRef,
    thread: Pick<EnvironmentThreadShell, "runtimeMode" | "interactionMode">,
    menuId: string,
  ) => {
    const action = forkRoleMenuAction(menuId);
    if (action === undefined) return false;
    const { environmentId, threadId } = target;
    const result =
      action.kind === "set"
        ? await setRole({ environmentId, input: { threadId, roleId: action.roleId } })
        : await startTurn({
            environmentId,
            input: {
              threadId,
              message: {
                messageId: newMessageId(),
                role: "user",
                text: FORK_MAKE_ROLE_PROMPT,
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
              ? m(msg("Failed to change role"))
              : m(msg("Failed to send {command}", { command: FORK_MAKE_ROLE_PROMPT })),
          description:
            thrownErrorMessage(squashAtomCommandFailure(result), m) ?? m(msg("An error occurred.")),
        }),
      );
    }
    return true;
  };
}
