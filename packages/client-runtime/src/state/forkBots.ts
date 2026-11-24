import { type EnvironmentId, type ServerSettings, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createForkBotsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  settingsValueAtom: (environmentId: EnvironmentId) => Atom.Atom<ServerSettings | null>,
  /** The environment's assigned bot ids, sorted and joined, so a newly written bot file is fetched. */
  botIdsKeyAtom: (environmentId: EnvironmentId) => Atom.Atom<string>,
) {
  const refreshKeyAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => {
      const directory = get(settingsValueAtom(environmentId))?.forkBotsDirectory ?? "";
      return `${directory}\n${get(botIdsKeyAtom(environmentId))}`;
    }).pipe(Atom.withLabel(`environment-data:fork-bots:refresh-key:${environmentId}`)),
  );
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:fork-bots:list",
      tag: WS_METHODS.forkBotsList,
      refreshTrigger: ({ environmentId }) => refreshKeyAtom(environmentId),
    }),
  };
}
