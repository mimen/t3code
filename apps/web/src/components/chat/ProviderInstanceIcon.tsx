import { type CSSProperties, memo } from "react";
import { type ProviderDriverKind, type ProviderInstanceIconKey } from "@t3tools/contracts";

import { resolveProviderIcon } from "./providerIconUtils";
import { cn } from "~/lib/utils";

export function providerInstanceInitials(label: string): string {
  const words = label.replace(/[_-]+/g, " ").split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export const ProviderInstanceIcon = memo(function ProviderInstanceIcon(props: {
  driverKind: ProviderDriverKind;
  iconKey?: ProviderInstanceIconKey | undefined;
  displayName: string;
  accentColor?: string | undefined;
  className?: string;
  iconClassName?: string;
  statusDotClassName?: string;
  indicatorBackground?: string;
}) {
  const Icon = resolveProviderIcon(props.iconKey, props.driverKind) ?? null;
  const indicatorBackground = props.indicatorBackground ?? "var(--card)";
  const accentStyle = props.accentColor
    ? ({
        "--provider-accent": props.accentColor,
        boxShadow: "inset 0 0 0 1px var(--provider-accent)",
      } as CSSProperties)
    : undefined;

  return (
    <span
      className={cn(
        "relative isolate inline-flex shrink-0 items-center justify-center overflow-visible rounded-[0.35rem]",
        props.className,
      )}
      style={accentStyle}
      data-provider-accent-color={props.accentColor}
    >
      {Icon ? (
        <Icon className={cn("size-5 shrink-0", props.iconClassName)} aria-hidden />
      ) : (
        <span
          className={cn("text-[10px] font-semibold leading-none", props.iconClassName)}
          style={props.accentColor ? { color: props.accentColor } : undefined}
        >
          {providerInstanceInitials(props.displayName)}
        </span>
      )}
      {props.statusDotClassName ? (
        <span
          className={cn(
            "pointer-events-none absolute -left-0.5 -top-0.5 z-10 size-2 rounded-full",
            props.statusDotClassName,
          )}
          style={{ boxShadow: `0 0 0 2px ${indicatorBackground}` }}
          aria-hidden
        />
      ) : null}
    </span>
  );
});
