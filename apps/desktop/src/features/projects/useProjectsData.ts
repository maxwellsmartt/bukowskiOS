import type { CatalogSnapshot, ProjectCardRow } from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyProjects: ProjectCardRow[] = [];

const emptyCatalog: CatalogSnapshot = {
  locations: [],
  departments: [],
};

export const useProjectsData = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiProjects) {
        return emptyProjects;
      }

      return window.bukowskiProjects.getList();
    },
    emptyProjects,
    [],
  );

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
