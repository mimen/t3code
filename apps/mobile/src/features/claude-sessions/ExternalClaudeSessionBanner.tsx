import type { OrchestrationExternalSessionSummary } from "@t3tools/contracts";
import { ActivityIndicator, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import { presentExternalClaudeSession } from "./claudeSessionBrowser";

export function ExternalClaudeSessionBanner(props: {
  readonly enabled: boolean;
  readonly error: string | null;
  readonly isSyncing: boolean;
  readonly onSync: () => void;
  readonly session: OrchestrationExternalSessionSummary;
}) {
  const presentation = presentExternalClaudeSession(props.session);
  const iconColor = useThemeColor(
    presentation.problem ? "--color-danger-foreground" : "--color-icon-muted",
  );

  return (
    <View
      className={cn(
        "border-b px-4 py-3",
        presentation.problem
          ? "border-amber-400/35 bg-amber-100/70 dark:border-amber-400/25 dark:bg-amber-500/10"
          : "border-border bg-subtle/80",
      )}
    >
      <View className="mx-auto w-full max-w-[780px] gap-2.5">
        <View className="flex-row items-start gap-2.5">
          <SymbolView
            name={presentation.problem ? "exclamationmark.triangle" : "terminal"}
            size={16}
            tintColor={iconColor}
            type="monochrome"
            style={{ marginTop: 2 }}
          />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-sm font-t3-bold text-foreground">{presentation.title}</Text>
            <Text className="text-xs leading-relaxed text-foreground-muted">
              {presentation.detail}
            </Text>
            <Text
              className="font-mono text-2xs leading-relaxed text-foreground-muted"
              ellipsizeMode="middle"
              numberOfLines={1}
            >
              {props.session.sourceCwd}
            </Text>
            {props.error ? (
              <Text className="text-xs leading-relaxed text-rose-600 dark:text-rose-300">
                {props.error}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityLabel="Sync attached Claude session now"
            accessibilityRole="button"
            className={cn(
              "min-h-9 shrink-0 flex-row items-center gap-1.5 rounded-full bg-card px-3 active:opacity-70",
              (!props.enabled || props.isSyncing) && "opacity-50",
            )}
            disabled={!props.enabled || props.isSyncing}
            onPress={props.onSync}
          >
            {props.isSyncing ? (
              <ActivityIndicator color={iconColor} size="small" />
            ) : (
              <SymbolView
                name="arrow.clockwise"
                size={13}
                tintColor={iconColor}
                type="monochrome"
              />
            )}
            <Text className="text-xs font-t3-bold text-foreground">
              {props.isSyncing ? "Syncing" : "Sync now"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
