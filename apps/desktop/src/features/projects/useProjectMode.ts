import { useParams } from "react-router-dom";

import { useShellContext } from "@shared/hooks/useShellContext";

export const useProjectMode = () => {
  const { activeProject, activeProjectId, activeProjectRouteSection, scopeMode } = useShellContext();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? activeProjectId ?? null;

  return {
    scopeMode,
    projectId,
    project: activeProject?.id === projectId ? activeProject : null,
    routeSection: activeProjectRouteSection,
  };
};
