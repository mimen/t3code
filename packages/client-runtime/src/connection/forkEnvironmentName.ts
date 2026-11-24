import type { EnvironmentId, ServerConfigStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  RelayConnectionTarget,
  SshConnectionTarget,
  type ConnectionTarget,
  type PersistedConnectionTarget,
} from "./model.ts";
import type { ConnectionPersistenceError } from "../platform/persistence.ts";
import type { RpcSession } from "../rpc/session.ts";
import { connectionRoutes, entryWithRoutes } from "./routes.ts";

function targetWithLabel(target: ConnectionTarget, label: string): ConnectionTarget {
  switch (target._tag) {
    case "PrimaryConnectionTarget":
      return new PrimaryConnectionTarget({ ...target, label });
    case "BearerConnectionTarget":
      return new BearerConnectionTarget({ ...target, label });
    case "RelayConnectionTarget":
      return new RelayConnectionTarget({ ...target, label });
    case "SshConnectionTarget":
      return new SshConnectionTarget({ ...target, label });
  }
}

function entryWithLabel(entry: ConnectionCatalogEntry, label: string): ConnectionCatalogEntry {
  return entryWithRoutes(
    entry,
    connectionRoutes(entry).map((route) => ({
      ...route,
      target: targetWithLabel(route.target, label),
    })),
  );
}

function reportedLabel(event: ServerConfigStreamEvent): string | undefined {
  if (event.type === "snapshot") return event.config.environment.label;
  if (event.type === "settingsUpdated") return event.payload.environmentLabel;
  return undefined;
}

/**
 * Saved entries keep the name the server reported when they were paired. This follows the
 * connected server's name so every surface reading `target.label` shows it, and an offline
 * machine keeps its last-known name.
 */
export function makeForkEnvironmentLabels<
  S extends { readonly entry: ConnectionCatalogEntry },
>(deps: {
  readonly withLeaseLock: <A, E, R>(
    environmentId: EnvironmentId,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly entries: SubscriptionRef.SubscriptionRef<
    ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
  >;
  readonly serviceScopes: SubscriptionRef.SubscriptionRef<ReadonlyMap<EnvironmentId, S>>;
  readonly persistedEnvironmentIds: Ref.Ref<ReadonlySet<EnvironmentId>>;
  readonly setRoutes: (
    environmentId: EnvironmentId,
    routes: ReadonlyArray<PersistedConnectionTarget>,
  ) => Effect.Effect<void, ConnectionPersistenceError>;
}) {
  // Platform sources rebuild entries from a cached descriptor; this keeps them on the live name.
  const learned = new Map<EnvironmentId, string>();

  const applyLearned = (entry: ConnectionCatalogEntry): ConnectionCatalogEntry => {
    const label = learned.get(entry.target.environmentId);
    return label === undefined || label === entry.target.label
      ? entry
      : entryWithLabel(entry, label);
  };

  const learn = (environmentId: EnvironmentId, label: string) =>
    deps
      .withLeaseLock(
        environmentId,
        Effect.gen(function* () {
          learned.set(environmentId, label);
          const entry = (yield* SubscriptionRef.get(deps.entries)).get(environmentId);
          if (entry === undefined || entry.target.label === label) return;
          const next = entryWithLabel(entry, label);
          if ((yield* Ref.get(deps.persistedEnvironmentIds)).has(environmentId)) {
            yield* deps.setRoutes(
              environmentId,
              connectionRoutes(next).map((route) => route.target as PersistedConnectionTarget),
            );
          }
          yield* SubscriptionRef.update(deps.serviceScopes, (current) => {
            const lease = current.get(environmentId);
            return lease === undefined
              ? current
              : new Map(current).set(environmentId, { ...lease, entry: next });
          });
          yield* SubscriptionRef.update(deps.entries, (current) =>
            new Map(current).set(environmentId, next),
          );
        }),
      )
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not save the environment's new name.", {
            environmentId,
            error,
          }),
        ),
      );

  const follow = (
    environmentId: EnvironmentId,
    session: SubscriptionRef.SubscriptionRef<Option.Option<RpcSession>>,
  ) =>
    SubscriptionRef.changes(session).pipe(
      Stream.switchMap(
        Option.match({
          onNone: () => Stream.empty,
          onSome: (connected: RpcSession) =>
            connected.subscribeServerConfig().pipe(Stream.catchCause(() => Stream.empty)),
        }),
      ),
      Stream.map(reportedLabel),
      Stream.filter((label): label is string => label !== undefined),
      Stream.changes,
      Stream.runForEach((label) => learn(environmentId, label)),
    );

  return { applyLearned, follow };
}
