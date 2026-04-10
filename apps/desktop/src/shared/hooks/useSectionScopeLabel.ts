import { useShellContext } from "@shared/hooks/useShellContext";

export const useSectionScopeLabel = () => {
  const { activeProject } = useShellContext();

  return activeProject ? `${activeProject.code} · ${activeProject.name}` : "Global workspace";
};
