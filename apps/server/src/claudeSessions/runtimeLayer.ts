// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Layer from "effect/Layer";

import { CcsCatalogueClientConfiguredLive } from "./CcsCatalogueClient.ts";
import { ClaudeHomeLive, ClaudeSessionCatalogLive } from "./ClaudeSessionCatalog.ts";
import { ClaudeSessionCoordinatorLive } from "./ClaudeSessionCoordinator.ts";
import { ClaudeSessionFocusLive } from "./ClaudeSessionFocus.ts";
import { ClaudeSessionStatusLive } from "./ClaudeSessionStatus.ts";
import { ClaudeSessionSyncLive } from "./ClaudeSessionSync.ts";

export function defaultClaudeHomePath(): string {
  const configuredHome = process.env.CLAUDE_CONFIG_DIR?.trim();
  return configuredHome && configuredHome.length > 0
    ? NodePath.resolve(configuredHome)
    : NodePath.join(NodeOS.homedir(), ".claude");
}

/**
 * Adds the session catalogue, synchronizer, and attach/open coordinator for a
 * single configured Claude home. Callers provide the normal server services
 * (SQLite repositories, orchestration engine, and provider runtime repository).
 */
export const makeClaudeSessionCoreLive = (claudeHomePath: string) => {
  const catalogLayer = ClaudeSessionCatalogLive.pipe(
    Layer.provide(ClaudeHomeLive(claudeHomePath)),
    Layer.provideMerge(CcsCatalogueClientConfiguredLive),
  );
  const syncLayer = ClaudeSessionSyncLive.pipe(Layer.provideMerge(catalogLayer));
  const coordinatorLayer = ClaudeSessionCoordinatorLive.pipe(
    Layer.provideMerge(catalogLayer),
    Layer.provideMerge(syncLayer),
  );

  return Layer.mergeAll(
    catalogLayer,
    syncLayer,
    coordinatorLayer,
    ClaudeSessionStatusLive,
    ClaudeSessionFocusLive,
  );
};
