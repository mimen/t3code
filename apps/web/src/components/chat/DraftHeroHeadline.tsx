import type { ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { FolderPlusIcon, HistoryIcon, SquarePenIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { ClaudeSessionProjectScope } from "~/claudeSessionSurfaces.logic";
import { useOpenAddProjectCommandPalette } from "~/commandPaletteContext";
import { useCurrentClaudeSessionProjectScope } from "~/hooks/useCurrentClaudeSessionProjectScope";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useProjects, useThreadShells } from "~/state/entities";
import { ClaudeSessionBrowserDialog } from "../ClaudeSessionBrowserDialog";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";

interface DraftHeroHeadlineProps {
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  const projects = useProjects();
  const threads = useThreadShells();
  const handleNewThread = useNewThreadHandler();
  const openAddProject = useOpenAddProjectCommandPalette();
  const projectScope = useCurrentClaudeSessionProjectScope();
  const [openClaudeSessionProjectScope, setOpenClaudeSessionProjectScope] =
    useState<ClaudeSessionProjectScope | null>(null);

  const orderedProjects = useMemo(
    () => sortScopedProjectsForSidebar(projects, threads, "updated_at"),
    [projects, threads],
  );
  const projectByKey = useMemo(
    () =>
      new Map(
        orderedProjects.map(
          (project) =>
            [
              scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
              project,
            ] as const,
        ),
      ),
    [orderedProjects],
  );
  const activeProjectKey = activeProjectRef === null ? "" : scopedProjectKey(activeProjectRef);
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = orderedProjects.length > 0;
  const shouldShowProjectMenu = canChooseProject;

  const projectSelector = shouldShowProjectMenu ? (
    <Menu>
      <MenuTrigger
        aria-label={hasResolvedProject ? "Change project" : "Choose a project"}
        className="pointer-events-auto inline cursor-pointer border-current border-b border-dotted text-foreground underline-offset-8 transition-opacity hover:opacity-75 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        {activeProjectTitle ?? "Choose a project"}
      </MenuTrigger>
      <MenuPopup align="center" className="max-h-80 w-64 overflow-y-auto">
        <MenuRadioGroup
          value={activeProjectKey}
          onValueChange={(value) => {
            const project = projectByKey.get(value as string);
            if (!project || value === activeProjectKey) {
              return;
            }
            void handleNewThread(scopeProjectRef(project.environmentId, project.id), {
              replace: true,
            });
          }}
        >
          {orderedProjects.map((project) => {
            const key = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
            return (
              <MenuRadioItem key={key} value={key} closeOnClick>
                <span className="min-w-0 truncate">{project.title}</span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onClick={openAddProject}>
          <FolderPlusIcon />
          New project
        </MenuItem>
      </MenuPopup>
    </Menu>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="pointer-events-auto inline cursor-pointer border-current border-b border-dotted text-muted-foreground/60 underline-offset-8 transition-opacity hover:opacity-75 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {activeProjectTitle ?? "Add a project"}
    </button>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 text-center">
      <h1 className="w-full font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
        {hasResolvedProject ? (
          <>What should we build in {projectSelector}?</>
        ) : canChooseProject ? (
          <>{projectSelector} to start</>
        ) : (
          <>Add a project to start</>
        )}
      </h1>
      {projectScope ? (
        <div
          className="pointer-events-auto inline-flex items-center rounded-lg border border-border/70 bg-muted/25 p-0.5 text-xs shadow-sm"
          role="group"
          aria-label="Choose a new task or continue a Claude session"
        >
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-background px-2.5 font-medium text-foreground shadow-sm">
            <SquarePenIcon className="size-3.5" />
            New task
          </span>
          <button
            type="button"
            aria-haspopup="dialog"
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 font-medium text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setOpenClaudeSessionProjectScope(projectScope)}
          >
            <HistoryIcon className="size-3.5" />
            Continue Claude session
          </button>
        </div>
      ) : null}
      <ClaudeSessionBrowserDialog
        open={openClaudeSessionProjectScope !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOpenClaudeSessionProjectScope(null);
          }
        }}
        projectScope={openClaudeSessionProjectScope}
      />
    </div>
  );
}
