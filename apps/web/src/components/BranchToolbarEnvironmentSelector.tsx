import type { EnvironmentId } from "@t3tools/contracts";
import { CloudIcon, MonitorIcon } from "lucide-react";
import { memo, useMemo } from "react";

import {
  isRemoteOnlyDesktop,
  REMOTE_ONLY_LOCAL_ENVIRONMENT_ITEM,
} from "../desktopRuntimeCapabilities";
import { filterSelectableEnvironments, type EnvironmentOption } from "./BranchToolbar.logic";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface BranchToolbarEnvironmentSelectorProps {
  envLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly EnvironmentOption[];
  // Absent when there is only one environment to show: the indicator still
  // renders (as a static label) so remote projects are always identifiable.
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
}

export const BranchToolbarEnvironmentSelector = memo(function BranchToolbarEnvironmentSelector({
  envLocked,
  environmentId,
  availableEnvironments,
  onEnvironmentChange,
}: BranchToolbarEnvironmentSelectorProps) {
  const activeEnvironment = useMemo(() => {
    return availableEnvironments.find((env) => env.environmentId === environmentId) ?? null;
  }, [availableEnvironments, environmentId]);

  const remoteOnly = isRemoteOnlyDesktop();
  const selectableEnvironments = useMemo(
    () => filterSelectableEnvironments(availableEnvironments, remoteOnly),
    [availableEnvironments, remoteOnly],
  );
  const environmentItems = useMemo(
    () => [
      ...(remoteOnly
        ? [
            {
              value: REMOTE_ONLY_LOCAL_ENVIRONMENT_ITEM,
              label: "This device (unavailable)",
            },
          ]
        : []),
      ...selectableEnvironments.map((env) => ({
        value: env.environmentId,
        label: env.label,
      })),
    ],
    [remoteOnly, selectableEnvironments],
  );

  if (envLocked || onEnvironmentChange === undefined) {
    return (
      <span className="inline-flex items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs">
        {activeEnvironment?.isPrimary ? (
          <MonitorIcon className="size-3" />
        ) : (
          <CloudIcon className="size-3" />
        )}
        {activeEnvironment?.label ?? "Run on"}
      </span>
    );
  }

  return (
    <Select
      modal={false}
      value={environmentId}
      onValueChange={(value) => {
        if (value !== REMOTE_ONLY_LOCAL_ENVIRONMENT_ITEM) {
          onEnvironmentChange(value as EnvironmentId);
        }
      }}
      items={environmentItems}
    >
      <SelectTrigger variant="ghost" size="xs" className="font-medium" aria-label="Run on">
        {activeEnvironment?.isPrimary ? (
          <MonitorIcon className="size-3" />
        ) : (
          <CloudIcon className="size-3" />
        )}
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectGroupLabel>Run on</SelectGroupLabel>
          {remoteOnly ? (
            <SelectItem disabled hideIndicator value={REMOTE_ONLY_LOCAL_ENVIRONMENT_ITEM}>
              <span className="inline-flex items-center gap-1.5">
                <MonitorIcon className="size-3" />
                This device
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                Unavailable in remote-only mode
              </span>
            </SelectItem>
          ) : null}
          {selectableEnvironments.map((env) => (
            <SelectItem key={env.environmentId} value={env.environmentId}>
              <span className="inline-flex items-center gap-1.5">
                {env.isPrimary ? (
                  <MonitorIcon className="size-3" />
                ) : (
                  <CloudIcon className="size-3" />
                )}
                {env.label}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
