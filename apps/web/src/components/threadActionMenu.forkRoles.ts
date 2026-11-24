import type { ContextMenuItem, ForkRolesListResult } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";

export type ForkRoleMenuId = "role" | "role:none" | "role:make" | `role:set:${string}`;

/** The Claude Code skill that turns a thread into a role, sent like the composer's `/q`. */
export const FORK_MAKE_ROLE_PROMPT = "/make-role";

export interface ForkRoleMenuState {
  readonly current: string | null;
  /** Null until the environment answers, or when it cannot list roles. */
  readonly list: ForkRolesListResult | null;
}

export function forkRoleMenuItems(
  state: ForkRoleMenuState | undefined,
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<ForkRoleMenuId>> {
  if (state === undefined) return [];
  const roles = state.list?.roles ?? [];
  const hint =
    state.list === null
      ? resolve(msg("Loading roles…"))
      : state.list.directory === null
        ? resolve(msg("Set a roles directory in Settings"))
        : undefined;
  return [
    {
      id: "role",
      label: resolve(msg("Role", { $context: "submenu: the standing job a thread runs" })),
      icon: "bot",
      ...(hint === undefined
        ? {
            children: [
              ...roles.map((role) => ({
                id: `role:set:${role.id}` as const,
                label: role.name,
                checked: role.id === state.current,
              })),
              state.current === null
                ? {
                    id: "role:make" as const,
                    label: resolve(msg("Make this thread a role…")),
                    separatorBefore: roles.length > 0,
                  }
                : {
                    id: "role:none" as const,
                    label: resolve(msg("No role")),
                    separatorBefore: roles.length > 0,
                  },
            ],
          }
        : { disabled: true, detail: hint }),
    },
  ];
}

export type ForkRoleMenuAction =
  | { readonly kind: "set"; readonly roleId: string | null }
  | { readonly kind: "make" };

/** What a Role submenu id does, or undefined for any other id. */
export function forkRoleMenuAction(id: string): ForkRoleMenuAction | undefined {
  if (id === "role:make") return { kind: "make" };
  if (id === "role:none") return { kind: "set", roleId: null };
  return id.startsWith("role:set:")
    ? { kind: "set", roleId: id.slice("role:set:".length) }
    : undefined;
}
