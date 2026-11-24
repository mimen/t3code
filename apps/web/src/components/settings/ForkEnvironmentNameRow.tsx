import { AuthSettingsWriteScope, type EnvironmentId, type ServerConfig } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentScope } from "../../state/session";
import { Input } from "../ui/input";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export function ForkEnvironmentNameRow({
  environmentId,
  serverConfig,
}: {
  readonly environmentId: EnvironmentId;
  readonly serverConfig: Pick<ServerConfig, "environment" | "settings"> | null;
}) {
  const gt = useGT();
  const setting = useSearchableSetting();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  if (serverConfig === null) return null;
  const name = serverConfig.settings.forkEnvironmentName;
  const save = (value: string) => {
    if (value !== name) updateSettings({ forkEnvironmentName: value });
  };

  return (
    <SettingsRow
      {...setting("fork-environment-name")}
      description={gt(
        "Shown for this machine in every app connected to it and in linked environments. Leave empty to use the computer's name.",
      )}
      resetAction={
        canWrite && name !== "" ? (
          <SettingResetButton
            ariaLabel={gt("Reset environment name")}
            onClick={() => updateSettings({ forkEnvironmentName: "" })}
          />
        ) : null
      }
      control={
        <Input
          key={name}
          className="w-full sm:w-44"
          aria-label={gt("Environment name")}
          spellCheck={false}
          disabled={!canWrite}
          placeholder={name === "" ? serverConfig.environment.label : undefined}
          defaultValue={name}
          onBlur={(event) => save(event.target.value.trim())}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      }
    />
  );
}
