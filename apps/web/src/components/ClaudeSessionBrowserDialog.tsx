import type {
  ClaudeSessionCatalogueActivityWindow,
  ClaudeSessionCatalogueSort,
} from "@t3tools/contracts";
import { ChevronDownIcon, LoaderIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import {
  ALL_CLAUDE_SESSION_ENVIRONMENTS,
  buildExactClaudeSessionQueries,
  buildGlobalClaudeSessionQueries,
  buildProjectClaudeSessionQueries,
  federatedClaudeSessionKey,
  formatClaudeCatalogueAge,
  groupClaudeSessionsByProject,
  splitClaudeSessionsForProjectScope,
  type ClaudeSessionEnvironmentSelection,
  type ClaudeSessionProjectScope,
  type FederatedClaudeSession,
} from "../claudeSessionSurfaces.logic";
import { useClaudeSessionCatalogue } from "../hooks/useClaudeSessionCatalogue";
import { useClaudeSessionPreview } from "../hooks/useClaudeSessionPreview";
import { useOpenClaudeSession } from "../hooks/useOpenClaudeSession";
import { useEnvironments } from "../state/environments";
import { ClaudeSessionPreviewPanel } from "./claude-sessions/ClaudeSessionPreviewPanel";
import { ClaudeSessionRow } from "./claude-sessions/ClaudeSessionRow";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

interface ClaudeSessionBrowserDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projectScope?: ClaudeSessionProjectScope | null;
}

const PAGE_SIZE = 40;

export function ClaudeSessionBrowserDialog({
  open,
  onOpenChange,
  projectScope,
}: ClaudeSessionBrowserDialogProps) {
  const { environments } = useEnvironments();
  const isProjectScoped = projectScope !== undefined;
  const [environmentSelection, setEnvironmentSelection] =
    useState<ClaudeSessionEnvironmentSelection>(ALL_CLAUDE_SESSION_ENVIRONMENTS);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [activityWindow, setActivityWindow] = useState<ClaudeSessionCatalogueActivityWindow>("30d");
  const [sort, setSort] = useState<ClaudeSessionCatalogueSort>("nativeActivity");
  const [openingSessionKey, setOpeningSessionKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const preview = useClaudeSessionPreview();
  const closeBeforeNavigate = useCallback(() => onOpenChange(false), [onOpenChange]);
  const openClaudeSession = useOpenClaudeSession({ beforeNavigate: closeBeforeNavigate });

  const filters = useMemo(
    () => ({
      query: deferredSearch,
      activityWindow,
      sort,
      limit: PAGE_SIZE,
    }),
    [activityWindow, deferredSearch, sort],
  );
  const queriesByEnvironment = useMemo(
    () =>
      isProjectScoped
        ? buildProjectClaudeSessionQueries({ scope: projectScope ?? null, filters })
        : buildGlobalClaudeSessionQueries({
            environmentIds: environments.map((environment) => environment.environmentId),
            selection: environmentSelection,
            filters,
          }),
    [environmentSelection, environments, filters, isProjectScoped, projectScope],
  );
  const exactQueriesByEnvironment = useMemo(
    () => buildExactClaudeSessionQueries({ scope: projectScope ?? null, filters }),
    [filters, projectScope],
  );
  const catalogue = useClaudeSessionCatalogue({
    enabled: open && (!isProjectScoped || projectScope !== null),
    environments,
    queriesByEnvironment,
    sort,
  });
  const exactCatalogue = useClaudeSessionCatalogue({
    enabled: open && isProjectScoped && projectScope !== null,
    environments,
    queriesByEnvironment: exactQueriesByEnvironment,
    sort,
  });
  const projectSessions = useMemo(
    () =>
      splitClaudeSessionsForProjectScope({
        sessions: catalogue.sessions,
        scope: projectScope ?? null,
      }),
    [catalogue.sessions, projectScope],
  );
  const globalGroups = useMemo(
    () => groupClaudeSessionsByProject(catalogue.sessions),
    [catalogue.sessions],
  );
  const pageStates = useMemo(
    () => [...catalogue.pages.values(), ...(isProjectScoped ? exactCatalogue.pages.values() : [])],
    [catalogue.pages, exactCatalogue.pages, isProjectScoped],
  );
  const problemPages = pageStates.filter((page) => page.error !== null);
  const showEnvironment = isProjectScoped
    ? new Set(projectScope?.locations.map((location) => location.environmentId) ?? []).size > 1
    : environmentSelection === ALL_CLAUDE_SESSION_ENVIRONMENTS;
  const exactCwdLabels = projectScope?.locations.map((location) => location.exactCwd) ?? [];

  useEffect(() => {
    if (open) {
      return;
    }
    setErrorMessage(null);
    setOpeningSessionKey(null);
    preview.clearPreview();
  }, [open, preview.clearPreview]);

  const handlePreview = useCallback(
    (session: FederatedClaudeSession): void => {
      const sessionKey = federatedClaudeSessionKey(session);
      if (preview.state.sessionKey === sessionKey) {
        preview.clearPreview();
        return;
      }
      void preview.requestPreview(session);
    },
    [preview],
  );

  const handleOpen = useCallback(
    async (session: FederatedClaudeSession): Promise<void> => {
      const sessionKey = federatedClaudeSessionKey(session);
      setErrorMessage(null);
      setOpeningSessionKey(sessionKey);
      try {
        await openClaudeSession(session);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Could not attach and open this Claude session.",
        );
      } finally {
        setOpeningSessionKey(null);
      }
    },
    [openClaudeSession],
  );

  const renderSession = (session: FederatedClaudeSession) => {
    const sessionKey = federatedClaudeSessionKey(session);
    const isPreviewed = preview.state.sessionKey === sessionKey;
    return (
      <div className="space-y-2" key={sessionKey}>
        <ClaudeSessionRow
          session={session}
          showEnvironment={showEnvironment}
          isOpening={openingSessionKey === sessionKey}
          previewSessionKey={preview.state.sessionKey}
          onOpen={(selected) => void handleOpen(selected)}
          onPreview={handlePreview}
          selected={isPreviewed}
        />
        {isPreviewed ? (
          <ClaudeSessionPreviewPanel
            preview={preview.state.preview}
            isLoading={preview.state.isLoading}
            error={preview.state.error}
          />
        ) : null}
      </div>
    );
  };

  const hasSessions = catalogue.sessions.length > 0;
  const isLoading = catalogue.isLoading || (isProjectScoped && exactCatalogue.isLoading);
  const isLoadingMore = pageStates.some((page) => page.isLoadingMore);
  const hasMore = catalogue.hasMore || (isProjectScoped && exactCatalogue.hasMore);
  const loadMore = useCallback(async (): Promise<void> => {
    await Promise.all([catalogue.loadMore(), exactCatalogue.loadMore()]);
  }, [catalogue.loadMore, exactCatalogue.loadMore]);
  const refresh = useCallback((): void => {
    catalogue.refresh();
    if (isProjectScoped) {
      exactCatalogue.refresh();
    }
  }, [catalogue.refresh, exactCatalogue.refresh, isProjectScoped]);
  const title = isProjectScoped
    ? `Continue a Claude session in ${projectScope?.title ?? "this project"}`
    : "Browse Claude sessions";
  const description = isProjectScoped
    ? "Sessions from this exact working directory come first. Repository siblings stay in a separate worktree group."
    : "Search native Claude Code sessions across every reachable environment, then attach or open one in T3.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl overflow-hidden">
        <DialogHeader className="border-b bg-background">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="max-h-[70vh] space-y-4 overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="Search Claude sessions"
              className="min-w-52 flex-1"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, working directory, or session ID"
            />
            {!isProjectScoped ? (
              <Select
                value={environmentSelection as string}
                onValueChange={(value) => {
                  if (value) {
                    setEnvironmentSelection(value as ClaudeSessionEnvironmentSelection);
                  }
                }}
              >
                <SelectTrigger size="sm" aria-label="Claude session environment">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={ALL_CLAUDE_SESSION_ENVIRONMENTS}>All environments</SelectItem>
                  {environments.map((environment) => (
                    <SelectItem key={environment.environmentId} value={environment.environmentId}>
                      {environment.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null}
            <Select
              value={activityWindow}
              onValueChange={(value) => {
                if (value) {
                  setActivityWindow(value as ClaudeSessionCatalogueActivityWindow);
                }
              }}
            >
              <SelectTrigger size="sm" aria-label="Claude session activity window">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">7 days</SelectItem>
                <SelectItem value="30d">30 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectPopup>
            </Select>
            <Select
              value={sort}
              onValueChange={(value) => {
                if (value) {
                  setSort(value as ClaudeSessionCatalogueSort);
                }
              }}
            >
              <SelectTrigger size="sm" aria-label="Sort Claude sessions">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="nativeActivity">Recent</SelectItem>
                <SelectItem value="cwd">Working directory</SelectItem>
                <SelectItem value="title">Title</SelectItem>
              </SelectPopup>
            </Select>
          </div>

          {pageStates.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground/75">
              {pageStates.map((page) => (
                <span key={`${page.environmentId}:${page.queryKey}`}>
                  <span className="font-medium text-muted-foreground">{page.environmentLabel}</span>
                  {page.status === "ready" && page.sourceStatus
                    ? ` · ${page.mode?.kind === "ccs-daemon" ? "indexed" : "degraded scan"} · ${formatClaudeCatalogueAge(page.sourceStatus.ageMs)}`
                    : page.status === "loading"
                      ? " · loading"
                      : " · unavailable"}
                </span>
              ))}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          ) : null}
          {problemPages.length > 0 ? (
            <div className="rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning-foreground">
              {problemPages.map((page) => (
                <div key={`${page.environmentId}:${page.queryKey}`}>
                  <span className="font-medium">{page.environmentLabel}:</span>{" "}
                  {page.error ?? "This environment is unavailable."}
                </div>
              ))}
            </div>
          ) : null}

          {isProjectScoped ? (
            <div className="space-y-4">
              <section className="space-y-2">
                <div>
                  <h3 className="text-xs font-semibold text-foreground">This working directory</h3>
                  <p className="truncate font-mono text-[10px] text-muted-foreground/70">
                    {exactCwdLabels.join(" · ")}
                  </p>
                </div>
                {exactCatalogue.sessions.length > 0 ? (
                  exactCatalogue.sessions.map(renderSession)
                ) : exactCatalogue.isLoading ? (
                  <LoadingSessions />
                ) : (
                  <EmptySessions message="No native Claude sessions matched this exact working directory." />
                )}
              </section>

              <Collapsible className="group rounded-lg border border-border/80 bg-muted/15">
                <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
                  <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform group-data-open:rotate-180" />
                  Sibling worktrees
                  <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {projectSessions.siblingWorktrees.length}
                  </span>
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <div className="space-y-2 border-t border-border/70 px-3 py-3">
                    <p className="text-[10px] leading-relaxed text-muted-foreground/75">
                      These sessions belong to another worktree in the same repository. Opening one
                      keeps its original working directory.
                    </p>
                    {projectSessions.siblingWorktrees.length > 0 ? (
                      projectSessions.siblingWorktrees.map(renderSession)
                    ) : catalogue.isLoading ? (
                      <LoadingSessions />
                    ) : (
                      <EmptySessions message="No sibling-worktree Claude sessions matched." />
                    )}
                  </div>
                </CollapsiblePanel>
              </Collapsible>
            </div>
          ) : hasSessions ? (
            <div className="space-y-4">
              {globalGroups.map((group) => (
                <section className="space-y-2" key={group.key}>
                  <h3 className="text-xs font-semibold text-foreground">{group.label}</h3>
                  {group.sessions.map(renderSession)}
                </section>
              ))}
            </div>
          ) : catalogue.isLoading ? (
            <LoadingSessions />
          ) : (
            <EmptySessions message="No native Claude sessions matched these filters." />
          )}

          {hasMore ? (
            <Button
              className="w-full"
              variant="outline"
              disabled={isLoadingMore}
              onClick={() => void loadMore()}
            >
              {isLoadingMore ? <LoaderIcon className="size-3.5 animate-spin" /> : null}
              Load more from available environments
            </Button>
          ) : null}
        </DialogPanel>
        <DialogFooter className="items-center justify-between gap-3 sm:justify-between">
          <p className="text-[10px] leading-relaxed text-muted-foreground/70">
            Attach/open only. T3 will not send a prompt or start a Claude turn until you submit one.
          </p>
          <Button variant="outline" disabled={isLoading} onClick={refresh}>
            <RefreshCwIcon className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function LoadingSessions() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-8 text-sm text-muted-foreground">
      <LoaderIcon className="size-4 animate-spin" />
      Loading native Claude sessions…
    </div>
  );
}

function EmptySessions({ message }: { readonly message: string }) {
  return (
    <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}
