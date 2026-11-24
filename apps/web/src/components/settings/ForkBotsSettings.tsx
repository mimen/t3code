import { resolvePastedPath } from "@t3tools/shared/path";
import { useGT } from "gt-react";
import { useRef } from "react";

import { Input } from "../ui/input";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

// Bots are per machine, so the row edits server settings only.
export function ForkBotsSettingsSection() {
  const gt = useGT();
  const setting = useSearchableSetting();
  const { scope, targets } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["forkBotsDirectory"]);
  const edited = useRef(false);
  const draft = useRef("");
  if (scope.kind !== "all" && scope.kind !== "environment") return null;
  const scopeKey = targets.map((target) => target.environmentId).join(",");
  return (
    <SettingsSection title={gt("Bots", { $context: "settings section" })}>
      <SettingsRow
        {...setting("fork-bots-directory")}
        description={gt(
          "Folder of bot files, one Markdown file per bot. A thread given a bot keeps that standing job. Leave empty to turn bots off.",
        )}
        serverScoped
        settingKeys={["forkBotsDirectory"]}
        resetAction={
          mixed || settings.forkBotsDirectory !== "" ? (
            <SettingResetButton
              ariaLabel={gt("Clear the bots directory")}
              onClick={() => updateSettings({ forkBotsDirectory: "" })}
            />
          ) : null
        }
        control={
          <Input
            key={`${scopeKey}:${mixed}:${settings.forkBotsDirectory}`}
            aria-label={gt("Bots directory")}
            autoCapitalize="none"
            spellCheck={false}
            placeholder={mixed ? gt("Mixed") : gt("Off", { $context: "bots directory is unset" })}
            defaultValue={mixed ? "" : settings.forkBotsDirectory}
            onFocus={(event) => {
              draft.current = event.target.value;
            }}
            onChange={(event) => {
              edited.current = true;
              draft.current = resolvePastedPath(draft.current, event.target.value);
              event.target.value = draft.current;
            }}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (edited.current && (mixed || value !== settings.forkBotsDirectory))
                updateSettings({ forkBotsDirectory: value });
              edited.current = false;
            }}
          />
        }
      />
    </SettingsSection>
  );
}
