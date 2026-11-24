import { msg } from "gt-react";

export const FORK_BOTS_SETTINGS_SEARCH_ITEMS = [
  {
    id: "fork-bots-directory",
    title: msg("Bots directory"),
    to: "/settings/scheduled-tasks",
    scope: "environment-defaults",
    searchTerms: [msg("bots bot briefs folder path standing job agent")],
  },
] as const;
