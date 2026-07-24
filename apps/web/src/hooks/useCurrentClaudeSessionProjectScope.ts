import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";

import { buildClaudeSessionProjectScope } from "../claudeSessionSurfaces.logic";
import { useComposerDraftStore } from "../composerDraftStore";
import { useProjects, useThreadShell } from "../state/entities";
import { resolveThreadRouteTarget } from "../threadRoutes";

export function useCurrentClaudeSessionProjectScope() {
  const projects = useProjects();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThread = useThreadShell(
    routeTarget?.kind === "server"
      ? scopeThreadRef(routeTarget.threadRef.environmentId, routeTarget.threadRef.threadId)
      : null,
  );
  const routeDraft = useComposerDraftStore((state) => {
    if (!routeTarget) {
      return null;
    }
    return routeTarget.kind === "server"
      ? state.getDraftThread(routeTarget.threadRef)
      : state.getDraftSession(routeTarget.draftId);
  });
  const activeEnvironmentId = routeThread?.environmentId ?? routeDraft?.environmentId ?? null;
  const activeProjectId = routeThread?.projectId ?? routeDraft?.projectId ?? null;
  const activeCwd = routeThread?.worktreePath ?? routeDraft?.worktreePath ?? null;

  return useMemo(() => {
    const activeProject =
      activeEnvironmentId === null || activeProjectId === null
        ? null
        : (projects.find(
            (project) =>
              project.environmentId === activeEnvironmentId && project.id === activeProjectId,
          ) ?? null);
    return buildClaudeSessionProjectScope({ activeProject, projects, activeCwd });
  }, [activeCwd, activeEnvironmentId, activeProjectId, projects]);
}
