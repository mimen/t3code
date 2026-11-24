import { AuthSettingsWriteScope, type EnvironmentId, type ServerConfig } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";

export function ForkEnvironmentNameSection({
  environmentId,
  config,
}: {
  readonly environmentId: EnvironmentId;
  readonly config: Pick<ServerConfig, "environment" | "settings">;
}) {
  const gt = useGT();
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "environment name update",
    reportFailure: true,
  });
  const name = config.settings.forkEnvironmentName;
  const [draft, setDraft] = useState<string | null>(null);
  const save = (value: string) => {
    setDraft(null);
    if (value !== name) {
      void updateSettings({ environmentId, input: { patch: { forkEnvironmentName: value } } });
    }
  };

  return (
    <SettingsSection
      title={gt("Environment name")}
      footer={gt(
        "Shown for this machine in every app connected to it and in linked environments. Leave empty to use the computer's name.",
      )}
    >
      <View className="flex-row items-center gap-3 p-4">
        <AppTextInput
          accessibilityLabel={gt("Environment name")}
          className="min-h-11 min-w-0 flex-1 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
          value={draft ?? name}
          placeholder={name === "" ? config.environment.label : undefined}
          placeholderTextColorClassName="accent-foreground-muted"
          onChangeText={setDraft}
          onEndEditing={() => {
            if (draft !== null) save(draft.trim());
          }}
          returnKeyType="done"
          autoCorrect={false}
          editable={canWrite}
        />
        {canWrite && name !== "" ? (
          <Button
            label={gt("Reset", { $context: "verb, clears the environment name" })}
            accessibilityHint={gt("Reset environment name")}
            tone="secondary"
            onPress={() => save("")}
          />
        ) : null}
      </View>
    </SettingsSection>
  );
}
