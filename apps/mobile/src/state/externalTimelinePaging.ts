import { type OrchestrationThreadTimelinePage, type ThreadId } from "@t3tools/contracts";

export type ExternalTimelinePage = OrchestrationThreadTimelinePage & {
  readonly threadId: ThreadId;
};

type TimelineItem = OrchestrationThreadTimelinePage["items"][number];

function timelineItemKey(item: TimelineItem): string {
  return item.kind === "message" ? `message:${item.message.id}` : `activity:${item.activity.id}`;
}

export function mergeTimelinePages(input: {
  readonly existing: ExternalTimelinePage | null;
  readonly page: OrchestrationThreadTimelinePage;
  readonly threadId: ThreadId;
}): ExternalTimelinePage {
  const byKey = new Map<string, TimelineItem>();
  for (const item of input.existing?.threadId === input.threadId ? input.existing.items : []) {
    byKey.set(timelineItemKey(item), item);
  }
  for (const item of input.page.items) {
    byKey.set(timelineItemKey(item), item);
  }
  return {
    threadId: input.threadId,
    items: [...byKey.values()],
    nextCursor: input.page.nextCursor,
  };
}

export function mergeRefreshedTimelinePage(input: {
  readonly existing: ExternalTimelinePage | null;
  readonly page: OrchestrationThreadTimelinePage;
  readonly threadId: ThreadId;
}): ExternalTimelinePage {
  if (input.existing?.threadId !== input.threadId) {
    return { ...input.page, threadId: input.threadId };
  }
  const existingKeys = new Set(input.existing.items.map(timelineItemKey));
  const hasOverlap = input.page.items.some((item) => existingKeys.has(timelineItemKey(item)));
  if (!hasOverlap) {
    return { ...input.page, threadId: input.threadId };
  }
  return {
    ...mergeTimelinePages(input),
    nextCursor: input.existing.nextCursor,
  };
}
