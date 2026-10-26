import { memo } from "react";

import { toggleLaterShelf, type ThreadListV2LaterShelfListItem } from "./forkLaterShelf";
import { ThreadListV2ShelfHeader } from "./thread-list-v2-items";

export const ThreadListV2LaterShelfHeader = memo(function ThreadListV2LaterShelfHeader(props: {
  readonly item: ThreadListV2LaterShelfListItem;
  readonly pane?: "screen" | "sidebar";
}) {
  return (
    <ThreadListV2ShelfHeader
      kind="later"
      count={props.item.count}
      disabled={props.item.disabled}
      expanded={props.item.expanded}
      onToggle={toggleLaterShelf}
      pane={props.pane}
    />
  );
});
