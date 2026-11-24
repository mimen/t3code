import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ServerEnvironment from "./ServerEnvironment.ts";

const readLabel = Effect.gen(function* () {
  const environment = yield* ServerEnvironment.ServerEnvironment;
  return (yield* environment.getDescriptor).label;
});

const environmentLayer = (baseDir: string) =>
  ServerEnvironment.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
  );

const withLabelOverride = (label: string) =>
  Layer.provide(
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: { T3CODE_ENVIRONMENT_LABEL: label } })),
  );

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("fork environment name", (it) => {
  it.effect("follows the setting live and falls back to the machine name when cleared", () =>
    Effect.gen(function* () {
      const baseDir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
      const machineName = yield* readLabel.pipe(Effect.provide(environmentLayer(baseDir)));

      yield* Effect.gen(function* () {
        const settings = yield* ServerSettings.ServerSettingsService;
        expect(yield* readLabel).toBe(machineName);

        yield* settings.updateSettings({ forkEnvironmentName: "Mini" });
        expect(yield* readLabel).toBe("Mini");

        yield* settings.updateSettings({ forkEnvironmentName: "M3" });
        expect(yield* readLabel).toBe("M3");

        yield* settings.updateSettings({ forkEnvironmentName: "" });
        expect(yield* readLabel).toBe(machineName);
      }).pipe(
        Effect.provide(
          environmentLayer(baseDir).pipe(Layer.provideMerge(ServerSettings.layerTest())),
        ),
      );
    }),
  );

  it.effect("keeps the environment variable ahead of the setting", () =>
    Effect.gen(function* () {
      const baseDir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped();
      const label = yield* readLabel.pipe(
        Effect.provide(
          environmentLayer(baseDir).pipe(
            Layer.provide(ServerSettings.layerTest({ forkEnvironmentName: "Mini" })),
            withLabelOverride(" Studio "),
          ),
        ),
      );
      expect(label).toBe("Studio");
    }),
  );
});
