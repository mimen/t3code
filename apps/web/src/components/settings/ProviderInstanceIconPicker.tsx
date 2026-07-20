import { ProviderInstanceIconKey, type ProviderDriverKind } from "@t3tools/contracts";

import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { cn } from "../../lib/utils";

const ICON_OPTIONS: ReadonlyArray<{
  readonly key: ProviderInstanceIconKey;
  readonly label: string;
}> = [
  { key: ProviderInstanceIconKey.make("openai"), label: "OpenAI" },
  { key: ProviderInstanceIconKey.make("claude"), label: "Claude" },
  { key: ProviderInstanceIconKey.make("cursor"), label: "Cursor" },
  { key: ProviderInstanceIconKey.make("grok"), label: "Grok" },
  { key: ProviderInstanceIconKey.make("opencode"), label: "OpenCode" },
];

export function ProviderInstanceIconPicker(props: {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly value: ProviderInstanceIconKey | undefined;
  readonly onCommit: (value: ProviderInstanceIconKey | undefined) => void;
  readonly description?: string;
}) {
  const options = [{ key: undefined, label: "Driver default" }, ...ICON_OPTIONS] as const;

  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium text-foreground">Icon</span>
      <div className="flex min-w-0 flex-wrap gap-1.5" aria-label="Provider icon">
        {options.map((option) => {
          const selected = option.key === props.value;
          return (
            <button
              key={option.key ?? "driver-default"}
              type="button"
              aria-pressed={selected}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                selected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground",
              )}
              onClick={() => props.onCommit(option.key)}
            >
              <ProviderInstanceIcon
                driverKind={props.driverKind}
                iconKey={option.key}
                displayName={props.displayName}
                className="size-4"
                iconClassName="size-4"
              />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      {props.description ? (
        <span className="text-xs text-muted-foreground">{props.description}</span>
      ) : null}
    </div>
  );
}
