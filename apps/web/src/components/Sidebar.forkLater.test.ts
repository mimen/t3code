import { describe, expect, it } from "vite-plus/test";

import { projectSnoozeShelves } from "./Sidebar.forkLater";
import type { SidebarListItem, SidebarListMarker, SidebarSection } from "./Sidebar.logic";

const marker = (name: SidebarListMarker): SidebarListItem => ({ kind: "marker", marker: name });
const row = (key: string, section: SidebarSection): SidebarListItem => ({
  kind: "thread",
  key,
  section,
});
const names = (items: readonly SidebarListItem[]) =>
  items.map((item) => (item.kind === "thread" ? item.key : item.marker));

describe("projectSnoozeShelves", () => {
  it("drops the Later header when its only thread is dragged out", () => {
    const items = [
      marker("pinned-divider"),
      row("active", "active"),
      marker("snoozed-header"),
      row("timed", "snoozed"),
      marker("later-header"),
      row("later", "snoozed"),
      marker("settled-header"),
    ];
    const projected = [
      marker("pinned-divider"),
      row("active", "active"),
      row("later", "active"),
      marker("snoozed-header"),
      row("timed", "snoozed"),
      marker("settled-header"),
    ];
    projectSnoozeShelves(projected, items, "later", { timed: 1, later: 1 });
    expect(names(projected)).toEqual([
      "pinned-divider",
      "active",
      "later",
      "snoozed-header",
      "timed",
      "settled-header",
    ]);
  });

  it("keeps a collapsed Later shelf and drops an emptied Snoozed one", () => {
    const items = [
      marker("pinned-divider"),
      marker("snoozed-header"),
      row("timed", "snoozed"),
      marker("later-header"),
      marker("settled-header"),
    ];
    const projected = [
      marker("pinned-divider"),
      row("timed", "active"),
      marker("snoozed-header"),
      marker("settled-header"),
    ];
    projectSnoozeShelves(projected, items, "timed", { timed: 1, later: 2 });
    expect(names(projected)).toEqual(["pinned-divider", "timed", "later-header", "settled-header"]);
  });
});
