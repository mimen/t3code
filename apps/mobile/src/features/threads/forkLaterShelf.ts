import { isSomedaySnooze } from "@t3tools/client-runtime/state/thread-settled";
import { useSyncExternalStore } from "react";

import type { ThreadListV2ListItem } from "./threadListV2";

export interface ThreadListV2LaterShelfListItem {
  readonly type: "v2-later-shelf";
  readonly key: "v2-later-shelf";
  readonly count: number;
  readonly expanded: boolean;
  readonly disabled: boolean;
}

// ponytail: session-only, starts collapsed on each launch; persist via mobile preferences if that annoys.
let laterExpanded = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const toggleLaterShelf = () => {
  laterExpanded = !laterExpanded;
  for (const listener of listeners) listener();
};

export function useLaterShelfExpanded(): boolean {
  return useSyncExternalStore(subscribe, () => laterExpanded);
}

const isThreadRow = (entry: ThreadListV2ListItem | undefined) =>
  entry?.type === "v2-thread" && entry.item.snoozed;

// The layout is built with every snoozed row; this shelves Later rows apart and collapses each shelf.
export function splitLaterShelf(
  items: ThreadListV2ListItem[],
  options: {
    readonly snoozedExpanded: boolean;
    readonly laterExpanded: boolean;
    readonly selectedThreadKey: string | null;
  },
): ThreadListV2ListItem[] {
  const shelfAt = items.findIndex((entry) => entry.type === "v2-snoozed-shelf");
  const shelf = items[shelfAt];
  if (shelf?.type !== "v2-snoozed-shelf") return items;
  let end = shelfAt + 1;
  while (isThreadRow(items[end])) end += 1;
  const rows = items
    .slice(shelfAt + 1, end)
    .flatMap((entry) => (entry.type === "v2-thread" ? [entry] : []));
  const shown = (expanded: boolean) => (entry: (typeof rows)[number]) =>
    expanded ||
    `${entry.item.thread.environmentId}:${entry.item.thread.id}` === options.selectedThreadKey;
  const later = rows.filter((entry) => isSomedaySnooze(entry.item.thread.snoozedUntil));
  const timed = rows.filter((entry) => !later.includes(entry));
  const block: ThreadListV2ListItem[] = [
    ...(timed.length > 0 ? [{ ...shelf, count: timed.length }] : []),
    ...timed.filter(shown(options.snoozedExpanded)),
    ...(later.length > 0
      ? [
          {
            type: "v2-later-shelf",
            key: "v2-later-shelf",
            count: later.length,
            expanded: options.laterExpanded,
            disabled: shelf.disabled,
          } as const,
        ]
      : []),
    ...later.filter(shown(options.laterExpanded)),
  ];
  const result = [...items.slice(0, shelfAt), ...block, ...items.slice(end)];
  return result.map((entry, index) => {
    if (entry.type !== "v2-thread" && entry.type !== "v2-pending") return entry;
    const next = result[index + 1];
    const showTrailingDivider =
      next?.type === "v2-thread" || (next?.type === "v2-pending" && !next.showPendingDivider);
    return showTrailingDivider === entry.showTrailingDivider
      ? entry
      : { ...entry, showTrailingDivider };
  });
}
