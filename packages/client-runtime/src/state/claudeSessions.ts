import {
  ORCHESTRATION_WS_METHODS,
  type ClaudeSessionCatalogueQuery,
  type ClaudeSessionOpenInput,
  type ClaudeSessionPreviewInput,
  type ClaudeSessionSyncInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { listClaudeSessions, previewClaudeSession } from "../operations/commands.ts";
import { request } from "../rpc/client.ts";
import { createAtomCommandScheduler, createEnvironmentCommand } from "./runtime.ts";

export type {
  ClaudeSessionCatalogueQuery,
  ClaudeSessionOpenInput,
  ClaudeSessionPreviewInput,
  ClaudeSessionSyncInput,
} from "@t3tools/contracts";

export function createClaudeSessionEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  return {
    // Compatibility for the existing local browser: first page only. New callers should use listPage.
    list: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:claude-sessions:list",
      execute: (input: ClaudeSessionCatalogueQuery) =>
        listClaudeSessions(input).pipe(Effect.map((page) => page.sessions)),
      scheduler,
      concurrency: {
        mode: "singleFlight" as const,
        key: ({ environmentId, input }) => JSON.stringify(["list", environmentId, input]),
      },
    }),
    listPage: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:claude-sessions:list-page",
      execute: (input: ClaudeSessionCatalogueQuery) => listClaudeSessions(input),
      scheduler,
      concurrency: {
        mode: "singleFlight" as const,
        key: ({ environmentId, input }) => JSON.stringify(["list-page", environmentId, input]),
      },
    }),
    preview: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:claude-sessions:preview",
      execute: (input: ClaudeSessionPreviewInput) => previewClaudeSession(input),
      scheduler,
      concurrency: {
        mode: "singleFlight" as const,
        key: ({ environmentId, input }) =>
          JSON.stringify(["preview", environmentId, input.nativeSessionId, input.cwd]),
      },
    }),
    open: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:claude-sessions:open",
      execute: (input: ClaudeSessionOpenInput) =>
        request(ORCHESTRATION_WS_METHODS.openClaudeSession, input),
      scheduler,
      concurrency: {
        mode: "singleFlight" as const,
        key: ({ environmentId, input }) =>
          JSON.stringify(["open", environmentId, input.nativeSessionId, input.cwd]),
      },
    }),
    sync: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:claude-sessions:sync",
      execute: (input: ClaudeSessionSyncInput) =>
        request(ORCHESTRATION_WS_METHODS.syncClaudeSession, input),
      scheduler,
      concurrency: {
        mode: "singleFlight" as const,
        key: ({ environmentId, input }) => JSON.stringify(["sync", environmentId, input.sourceId]),
      },
    }),
  };
}
