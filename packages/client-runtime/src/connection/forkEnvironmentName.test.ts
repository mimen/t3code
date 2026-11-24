import { EnvironmentId, type ServerConfig, type ServerConfigStreamEvent } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { applyServerConfigProjection } from "../state/serverConfigProjection.ts";
import type * as RpcSession from "../rpc/session.ts";
import type { ConnectionCatalogEntry } from "./catalog.ts";
import { makeForkEnvironmentLabels } from "./forkEnvironmentName.ts";
import {
  BearerConnectionTarget,
  RelayConnectionTarget,
  type PersistedConnectionTarget,
} from "./model.ts";

const environmentId = EnvironmentId.make("environment-mini");
const entry: ConnectionCatalogEntry = {
  target: new BearerConnectionTarget({ environmentId, label: "Macmini", connectionId: "direct" }),
  profile: Option.none(),
  alternateRoutes: [
    {
      target: new RelayConnectionTarget({ environmentId, label: "Macmini" }),
      profile: Option.none(),
    },
  ],
  enabled: true,
};

const snapshot = (label: string): ServerConfigStreamEvent =>
  ({
    version: 1,
    type: "snapshot",
    config: { environment: { environmentId, label } } as ServerConfig,
  }) as ServerConfigStreamEvent;

const settingsUpdated = (environmentLabel?: string): ServerConfigStreamEvent =>
  ({
    version: 1,
    type: "settingsUpdated",
    payload: { settings: {}, ...(environmentLabel === undefined ? {} : { environmentLabel }) },
  }) as unknown as ServerConfigStreamEvent;

it.effect(
  "saves the connected server's new name on every route and keeps it for platform rebuilds",
  () =>
    Effect.gen(function* () {
      const entries = yield* SubscriptionRef.make<
        ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
      >(new Map([[environmentId, entry]]));
      const serviceScopes = yield* SubscriptionRef.make<
        ReadonlyMap<EnvironmentId, { readonly entry: ConnectionCatalogEntry }>
      >(new Map([[environmentId, { entry }]]));
      const saved = yield* Ref.make<ReadonlyArray<PersistedConnectionTarget>>([]);
      const events = yield* Queue.unbounded<ServerConfigStreamEvent>();
      const session = yield* SubscriptionRef.make(
        Option.some({
          subscribeServerConfig: () => Stream.fromQueue(events),
        } as unknown as RpcSession.RpcSession),
      );
      const labels = makeForkEnvironmentLabels({
        withLeaseLock: (_environmentId, effect) => effect,
        entries,
        serviceScopes,
        persistedEnvironmentIds: yield* Ref.make<ReadonlySet<EnvironmentId>>(
          new Set([environmentId]),
        ),
        setRoutes: (_environmentId, routes) => Ref.set(saved, routes),
      });
      yield* labels.follow(environmentId, session).pipe(Effect.forkScoped);

      const labelsOf = (value: ConnectionCatalogEntry | undefined) =>
        [value?.target, ...(value?.alternateRoutes ?? []).map((route) => route.target)].map(
          (target) => target?.label,
        );
      const awaitLabel = (label: string) =>
        SubscriptionRef.changes(entries).pipe(
          Stream.filter((current) => current.get(environmentId)?.target.label === label),
          Stream.runHead,
        );

      yield* Queue.offerAll(events, [
        snapshot("Macmini"),
        settingsUpdated(),
        settingsUpdated("Mini"),
      ]);
      yield* awaitLabel("Mini");
      const renamed = (yield* SubscriptionRef.get(entries)).get(environmentId);
      expect(labelsOf(renamed)).toEqual(["Mini", "Mini"]);
      expect((yield* Ref.get(saved)).map((target) => target.label)).toEqual(["Mini", "Mini"]);
      expect((yield* SubscriptionRef.get(serviceScopes)).get(environmentId)?.entry).toBe(renamed);
      expect(labels.applyLearned(entry).target.label).toBe("Mini");

      yield* Queue.offer(events, settingsUpdated("Macmini"));
      yield* awaitLabel("Macmini");
      expect(labelsOf((yield* SubscriptionRef.get(entries)).get(environmentId))).toEqual([
        "Macmini",
        "Macmini",
      ]);
    }),
);

it("a settings push carrying the name renames the connected config", () => {
  const current = applyServerConfigProjection(Option.none(), snapshot("Macmini"));
  const next = applyServerConfigProjection(current, settingsUpdated("M5"));
  expect(Option.getOrThrow(next).config.environment.label).toBe("M5");
  const unchanged = applyServerConfigProjection(next, settingsUpdated());
  expect(Option.getOrThrow(unchanged).config.environment.label).toBe("M5");
});
