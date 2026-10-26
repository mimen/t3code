import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { splitLaterShelf } from "./forkLaterShelf";
import { buildThreadListV2Items, buildThreadListV2ListItems } from "./threadListV2";

const environmentId = EnvironmentId.make("environment-1");
const NOW = "2026-06-02T00:00:00.000Z";
const LATER = "9999-12-31T00:00:00.000Z";

const thread = (id: string, snoozedUntil: string | null): EnvironmentThreadShell =>
  makeThreadShellFixture({
    environmentId,
    id: ThreadId.make(id),
    title: id,
    snoozedAt: snoozedUntil === null ? null : NOW,
    snoozedUntil,
  });

function shelves(
  threads: EnvironmentThreadShell[],
  options: { snoozedExpanded: boolean; laterExpanded: boolean },
) {
  const layout = buildThreadListV2Items({
    threads,
    environmentId: null,
    searchQuery: "",
    now: NOW,
    snoozedShelfExpanded: true,
  });
  const items = buildThreadListV2ListItems({
    items: layout.items,
    pendingTasks: [],
    snoozedCount: layout.snoozedCount,
    snoozedShelfExpanded: options.snoozedExpanded,
    snoozedShelfHeaderIndex: layout.snoozedShelfHeaderIndex,
    settledCount: layout.settledCount,
    settledShelfHeaderIndex: layout.settledShelfHeaderIndex,
  });
  return splitLaterShelf(items, { ...options, selectedThreadKey: null }).map((entry) =>
    entry.type === "v2-thread"
      ? entry.item.thread.title
      : "count" in entry
        ? `${entry.type}:${entry.count}`
        : entry.type,
  );
}

describe("later shelf", () => {
  const threads = [
    thread("active", null),
    thread("later-a", LATER),
    thread("tomorrow", "2026-06-03T09:00:00.000Z"),
    thread("later-b", LATER),
  ];

  it("counts later threads under their own collapsed shelf", () => {
    expect(shelves(threads, { snoozedExpanded: false, laterExpanded: false })).toEqual([
      "active",
      "v2-snoozed-shelf:1",
      "v2-later-shelf:2",
    ]);
  });

  it("expands each shelf on its own", () => {
    expect(shelves(threads, { snoozedExpanded: false, laterExpanded: true })).toEqual([
      "active",
      "v2-snoozed-shelf:1",
      "v2-later-shelf:2",
      "later-a",
      "later-b",
    ]);
  });

  it("drops the Snoozed shelf when only later threads remain", () => {
    expect(
      shelves([threads[0]!, threads[1]!], { snoozedExpanded: true, laterExpanded: false }),
    ).toEqual(["active", "v2-later-shelf:1"]);
  });
});
