import type { ContextMenuItem, ForkBotsListResult } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";

export type ForkBotMenuId = "bot" | "bot:none" | "bot:make" | `bot:set:${string}`;

/** The Claude Code skill that turns a thread into a bot, sent like the composer's `/q`. */
export const FORK_MAKE_BOT_PROMPT = "/make-bot";

export interface ForkBotMenuState {
  readonly current: string | null;
  /** Null until the environment answers, or when it cannot list bots. */
  readonly list: ForkBotsListResult | null;
}

export function forkBotMenuItems(
  state: ForkBotMenuState | undefined,
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<ForkBotMenuId>> {
  if (state === undefined) return [];
  const bots = state.list?.bots ?? [];
  const hint =
    state.list === null
      ? resolve(msg("Loading bots…"))
      : state.list.directory === null
        ? resolve(msg("Set a bots directory in Settings"))
        : undefined;
  return [
    {
      id: "bot",
      label: resolve(msg("Bot", { $context: "submenu: the standing job a thread runs" })),
      icon: "bot",
      ...(hint === undefined
        ? {
            children: [
              ...bots.map((bot) => ({
                id: `bot:set:${bot.id}` as const,
                label: bot.name,
                checked: bot.id === state.current,
              })),
              state.current === null
                ? {
                    id: "bot:make" as const,
                    label: resolve(msg("Make this thread a bot…")),
                    separatorBefore: bots.length > 0,
                  }
                : {
                    id: "bot:none" as const,
                    label: resolve(msg("No bot")),
                    separatorBefore: bots.length > 0,
                  },
            ],
          }
        : { disabled: true, detail: hint }),
    },
  ];
}

export type ForkBotMenuAction =
  | { readonly kind: "set"; readonly botId: string | null }
  | { readonly kind: "make" };

/** What a Bot submenu id does, or undefined for any other id. */
export function forkBotMenuAction(id: string): ForkBotMenuAction | undefined {
  if (id === "bot:make") return { kind: "make" };
  if (id === "bot:none") return { kind: "set", botId: null };
  return id.startsWith("bot:set:")
    ? { kind: "set", botId: id.slice("bot:set:".length) }
    : undefined;
}
