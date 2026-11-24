import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerSettings from "../serverSettings.ts";

const labelOverridden = Config.String("T3CODE_ENVIRONMENT_LABEL").pipe(
  Config.map((label) => label.trim() !== ""),
  Config.withDefault(false),
);

/** The live label: the env override, then the named setting, then the label resolved at startup. */
export const makeForkEnvironmentLabel = Effect.fn("makeForkEnvironmentLabel")(function* (
  resolvedLabel: string,
) {
  const overridden = yield* labelOverridden.pipe(Effect.orElseSucceed(() => false));
  const settings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
  if (overridden || Option.isNone(settings)) return Effect.succeed(resolvedLabel);
  return settings.value.getSettings.pipe(
    Effect.map(({ forkEnvironmentName }) => forkEnvironmentName || resolvedLabel),
    Effect.orElseSucceed(() => resolvedLabel),
  );
});
