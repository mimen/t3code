import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { DesktopExecutionModeSchema, DesktopRuntimeCapabilitiesSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopConnectionCatalogStore from "../../app/DesktopConnectionCatalogStore.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const decodeConnectionCatalog = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ConnectionCatalogDocument),
);

export class DesktopRemoteOnlyModeRequiresSavedEnvironmentError extends Schema.TaggedErrorClass<DesktopRemoteOnlyModeRequiresSavedEnvironmentError>()(
  "DesktopRemoteOnlyModeRequiresSavedEnvironmentError",
  {},
) {
  override get message(): string {
    return "Add and save a remote environment before switching this desktop to remote-only mode.";
  }
}

const hasSavedRemoteEnvironment = Effect.gen(function* () {
  const catalogStore = yield* DesktopConnectionCatalogStore.DesktopConnectionCatalogStore;
  const serialized = yield* catalogStore.get;
  if (Option.isNone(serialized)) {
    return false;
  }
  const catalog = yield* decodeConnectionCatalog(serialized.value).pipe(Effect.option);
  return Option.isSome(catalog) && catalog.value.targets.length > 0;
});

export const getRuntimeCapabilities = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_RUNTIME_CAPABILITIES_CHANNEL,
  result: DesktopRuntimeCapabilitiesSchema,
  handler: Effect.fn("desktop.ipc.executionMode.getRuntimeCapabilities")(function* () {
    const settings = yield* DesktopAppSettings.DesktopAppSettings;
    const executionMode = (yield* settings.get).executionMode;
    return {
      executionMode,
      // Remote-only is a UI policy. The proven local backend continues to run
      // so switching this setting never changes the desktop boot path.
      localBackendAvailable: true,
    };
  }),
});

export const setExecutionMode = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_EXECUTION_MODE_CHANNEL,
  payload: DesktopExecutionModeSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.executionMode.setExecutionMode")(function* (mode) {
    if (mode === "remote-only" && !(yield* hasSavedRemoteEnvironment)) {
      return yield* new DesktopRemoteOnlyModeRequiresSavedEnvironmentError();
    }

    const settings = yield* DesktopAppSettings.DesktopAppSettings;
    const changed = yield* settings.setExecutionMode(mode);
    if (!changed.changed) {
      return;
    }
  }),
});
