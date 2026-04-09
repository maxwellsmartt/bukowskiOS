import type { CatalogSnapshot, ProjectCardRow } from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";
import { useShellContext } from "@shared/hooks/useShellContext";

const emptyProjects: ProjectCardRow[] = [];

const emptyCatalog: CatalogSnapshot = {
  locations: [],
  departments: [],
  users: [],
};

export const useProjectsData = () => {
  const { projects, projectsError } = useShellContext();

  return {
    data: projects.length ? projects : emptyProjects,
    error: projectsError,
  };
};

export const useCatalogData = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiProjects) {
        return emptyCatalog;
      }

      return window.bukowskiProjects.getCatalog();
    },
    emptyCatalog,
    [],
  );
