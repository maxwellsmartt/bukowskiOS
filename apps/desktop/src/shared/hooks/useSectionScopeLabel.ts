import { useShellContext } from "@shared/hooks/useShellContext";

export const useSectionScopeLabel = () => {
  const { activeProject, scopeMode } = useShellContext();

  if (scopeMode === "project" && activeProject) {
    return `${activeProject.code} · ${activeProject.name}`;
  }

  return "Global workspace";
};
