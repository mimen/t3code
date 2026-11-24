import { type EnvironmentId, type ServerSettings, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createForkRolesEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  settingsValueAtom: (environmentId: EnvironmentId) => Atom.Atom<ServerSettings | null>,
  /** The environment's assigned role ids, sorted and joined, so a newly written role file is fetched. */
  roleIdsKeyAtom: (environmentId: EnvironmentId) => Atom.Atom<string>,
) {
  const refreshKeyAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => {
      const directory = get(settingsValueAtom(environmentId))?.forkRolesDirectory ?? "";
      return `${directory}\n${get(roleIdsKeyAtom(environmentId))}`;
    }).pipe(Atom.withLabel(`environment-data:fork-roles:refresh-key:${environmentId}`)),
  );
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:fork-roles:list",
      tag: WS_METHODS.forkRolesList,
      refreshTrigger: ({ environmentId }) => refreshKeyAtom(environmentId),
    }),
  };
}
