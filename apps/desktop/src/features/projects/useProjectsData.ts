import type { CatalogSnapshot, ProjectCardRow, ProjectDetailSnapshot } from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";
import { useShellContext } from "@shared/hooks/useShellContext";

const emptyProjects: ProjectCardRow[] = [];

const emptyCatalog: CatalogSnapshot = {
  locations: [],
  departments: [],
  users: [],
};

const emptyProjectDetail: ProjectDetailSnapshot = {
  project: null,
  metrics: [],
  assets: [],
  incidents: [],
  responsibles: [],
  budget: {
    totalEntries: "$0",
    reserve: "$0",
    exposure: "$0",
    status: "No project selected",
    note: "Select a project from the sidebar or registry to inspect operational detail.",
  },
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

export const useProjectDetail = (projectId: string | null) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiProjects || !projectId) {
        return emptyProjectDetail;
      }

      return window.bukowskiProjects.getDetail(projectId);
    },
    emptyProjectDetail,
    [projectId],
  );
