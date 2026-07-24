import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  ClaudeSessionCatalogEntry,
  ClaudeSessionCatalogueMode,
  ClaudeSessionCatalogueQuery,
  ClaudeSessionCatalogueSourceStatus,
  EnvironmentId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  isClaudeSessionEnvironmentUnavailable,
  mergeFederatedClaudeSessions,
  type FederatedClaudeSession,
} from "../claudeSessionSurfaces.logic";
import { claudeSessionEnvironment } from "../state/claudeSessions";
import type { EnvironmentPresentation } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";

export type ClaudeSessionEnvironmentPageStatus = "loading" | "ready" | "unavailable";

export interface ClaudeSessionEnvironmentPageState {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly queryKey: string;
  readonly status: ClaudeSessionEnvironmentPageStatus;
  readonly sessions: ReadonlyArray<ClaudeSessionCatalogEntry>;
  readonly nextCursor: string | null;
  readonly sourceStatus: ClaudeSessionCatalogueSourceStatus | null;
  readonly mode: ClaudeSessionCatalogueMode | null;
  readonly error: string | null;
  readonly isRefreshing: boolean;
  readonly isLoadingMore: boolean;
}

interface UseClaudeSessionCatalogueInput {
  readonly enabled: boolean;
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
  readonly queriesByEnvironment: ReadonlyMap<EnvironmentId, ClaudeSessionCatalogueQuery>;
  readonly sort: ClaudeSessionCatalogueQuery["sort"];
}

function failureMessage(result: {
  readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
}): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "This environment did not provide a live Claude session catalogue.";
}

function queryKey(query: ClaudeSessionCatalogueQuery): string {
  return JSON.stringify(query);
}

export function useClaudeSessionCatalogue(input: UseClaudeSessionCatalogueInput): {
  readonly pages: ReadonlyMap<EnvironmentId, ClaudeSessionEnvironmentPageState>;
  readonly sessions: ReadonlyArray<FederatedClaudeSession>;
  readonly isLoading: boolean;
  readonly hasMore: boolean;
  readonly refresh: () => void;
  readonly loadMore: () => Promise<void>;
} {
  const listPage = useAtomCommand(claudeSessionEnvironment.listPage, { reportFailure: false });
  const [pages, setPages] = useState<ReadonlyMap<EnvironmentId, ClaudeSessionEnvironmentPageState>>(
    () => new Map(),
  );
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const forceFreshGenerationRef = useRef<number | null>(null);
  const requestGenerationRef = useRef(0);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  const environmentById = useMemo(
    () =>
      new Map(input.environments.map((environment) => [environment.environmentId, environment])),
    [input.environments],
  );
  const requestSignature = useMemo(
    () =>
      JSON.stringify(
        [...input.queriesByEnvironment.entries()].map(([environmentId, query]) => {
          const environment = environmentById.get(environmentId);
          return [environmentId, environment?.connection.phase ?? "missing", query] as const;
        }),
      ),
    [environmentById, input.queriesByEnvironment],
  );

  useEffect(() => {
    if (!input.enabled) {
      requestGenerationRef.current += 1;
      setPages(new Map());
      return;
    }

    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    const forceFresh = forceFreshGenerationRef.current === refreshGeneration;
    if (forceFresh) {
      forceFreshGenerationRef.current = null;
    }
    const queries = [...input.queriesByEnvironment.entries()];
    setPages((current) => {
      const next = new Map<EnvironmentId, ClaudeSessionEnvironmentPageState>();
      for (const [environmentId, query] of queries) {
        const environment = environmentById.get(environmentId);
        const key = queryKey(query);
        if (!environment || isClaudeSessionEnvironmentUnavailable(environment.connection.phase)) {
          next.set(environmentId, {
            environmentId,
            environmentLabel: environment?.label ?? environmentId,
            queryKey: key,
            status: "unavailable",
            sessions: [],
            nextCursor: null,
            sourceStatus: null,
            mode: null,
            error:
              environment?.connection.error ??
              (environment ? "This environment is not live." : "This environment is unavailable."),
            isRefreshing: false,
            isLoadingMore: false,
          });
          continue;
        }
        const previous = current.get(environmentId);
        const retained =
          previous?.queryKey === key && previous.status === "ready" ? previous : null;
        next.set(environmentId, {
          environmentId,
          environmentLabel: environment.label,
          queryKey: key,
          status: "loading",
          sessions: retained?.sessions ?? [],
          nextCursor: retained?.nextCursor ?? null,
          sourceStatus: retained?.sourceStatus ?? null,
          mode: retained?.mode ?? null,
          error: null,
          isRefreshing: retained !== null,
          isLoadingMore: false,
        });
      }
      return next;
    });

    for (const [environmentId, query] of queries) {
      const environment = environmentById.get(environmentId);
      if (!environment || isClaudeSessionEnvironmentUnavailable(environment.connection.phase)) {
        continue;
      }
      void listPage({
        environmentId,
        input: forceFresh ? { ...query, freshness: "require-fresh" } : query,
      }).then((result) => {
        if (requestGenerationRef.current !== generation) {
          return;
        }
        setPages((current) => {
          const active = current.get(environmentId);
          if (!active || active.queryKey !== queryKey(query)) {
            return current;
          }
          const next = new Map(current);
          if (result._tag === "Failure") {
            next.set(environmentId, {
              ...active,
              status: "unavailable",
              sessions: [],
              nextCursor: null,
              sourceStatus: null,
              mode: null,
              error: failureMessage(result),
              isRefreshing: false,
            });
          } else {
            next.set(environmentId, {
              ...active,
              status: "ready",
              sessions: result.value.sessions,
              nextCursor: result.value.nextCursor,
              sourceStatus: result.value.sourceStatus,
              mode: result.value.mode,
              error: null,
              isRefreshing: false,
            });
          }
          return next;
        });
      });
    }
  }, [environmentById, input.enabled, listPage, refreshGeneration, requestSignature]);

  const refresh = useCallback(() => {
    setRefreshGeneration((generation) => {
      const nextGeneration = generation + 1;
      forceFreshGenerationRef.current = nextGeneration;
      return nextGeneration;
    });
  }, []);

  const loadMore = useCallback(async () => {
    const generation = requestGenerationRef.current;
    const requests: Array<Promise<void>> = [];
    for (const [environmentId, page] of pagesRef.current) {
      if (page.status !== "ready" || page.nextCursor === null || page.isLoadingMore) {
        continue;
      }
      const baseQuery = input.queriesByEnvironment.get(environmentId);
      if (!baseQuery) {
        continue;
      }
      setPages((current) => {
        const active = current.get(environmentId);
        if (!active) {
          return current;
        }
        const next = new Map(current);
        next.set(environmentId, { ...active, isLoadingMore: true });
        return next;
      });
      requests.push(
        listPage({
          environmentId,
          input: { ...baseQuery, cursor: page.nextCursor },
        }).then((result) => {
          if (requestGenerationRef.current !== generation) {
            return;
          }
          setPages((current) => {
            const active = current.get(environmentId);
            if (!active) {
              return current;
            }
            const next = new Map(current);
            if (result._tag === "Failure") {
              next.set(environmentId, {
                ...active,
                error: failureMessage(result),
                isLoadingMore: false,
              });
            } else {
              const sessionsByIdentity = new Map(
                active.sessions.map((session) => [
                  `${session.providerInstanceId}:${session.localSourceHost}:${session.nativeSessionId}`,
                  session,
                ]),
              );
              for (const session of result.value.sessions) {
                sessionsByIdentity.set(
                  `${session.providerInstanceId}:${session.localSourceHost}:${session.nativeSessionId}`,
                  session,
                );
              }
              next.set(environmentId, {
                ...active,
                status: "ready",
                sessions: [...sessionsByIdentity.values()],
                nextCursor: result.value.nextCursor,
                sourceStatus: result.value.sourceStatus,
                mode: result.value.mode,
                error: null,
                isLoadingMore: false,
              });
            }
            return next;
          });
        }),
      );
    }
    await Promise.all(requests);
  }, [input.queriesByEnvironment, listPage]);

  const sessions = useMemo(
    () =>
      mergeFederatedClaudeSessions(
        [...pages.values()].flatMap((page) =>
          page.status === "ready"
            ? [
                {
                  environmentId: page.environmentId,
                  environmentLabel: page.environmentLabel,
                  sessions: page.sessions,
                },
              ]
            : [],
        ),
        input.sort ?? "nativeActivity",
      ),
    [input.sort, pages],
  );
  const isLoading = [...pages.values()].some((page) => page.status === "loading");
  const hasMore = [...pages.values()].some(
    (page) => page.status === "ready" && page.nextCursor !== null,
  );

  return { pages, sessions, isLoading, hasMore, refresh, loadMore };
}
