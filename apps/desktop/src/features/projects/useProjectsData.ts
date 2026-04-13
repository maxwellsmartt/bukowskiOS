import type {
  AssignCrewToProjectUnitInput,
  CatalogListQuery,
  CreateProjectBlueprintInput,
  CreateCatalogEntityInput,
  CreateProjectUnitInput,
  DeleteCatalogEntityInput,
  DeleteProjectUnitInput,
  ProjectCreationConflictsSnapshot,
  ProjectListQuery,
  StagingPackingSlipRow,
  UnassignCrewFromProjectUnitInput,
  UpdateCatalogEntityInput,
  UpdateProjectUnitInput,
} from "@contracts";
import type { CatalogSnapshot, ProjectCardRow, ProjectDetailSnapshot } from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";
import { useShellContext } from "@shared/hooks/useShellContext";

const emptyProjects: ProjectCardRow[] = [];

const emptyCatalog: CatalogSnapshot = {
  locations: [],
  departments: [],
  users: [],
  crewMembers: [],
  clients: [],
  productionCompanies: [],
  manufacturers: [],
  categories: [],
  kits: [],
  assetOptions: [],
};

const emptyProjectDetail: ProjectDetailSnapshot = {
  project: null,
  schedule: null,
  units: [],
  timelineSummary: null,
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

const defaultProjectListQuery: ProjectListQuery = {
  search: "",
  sortBy: "name",
  sortDirection: "asc",
};

const defaultCatalogListQuery: CatalogListQuery = {
  entityType: "location",
  search: "",
  sortBy: "name",
  sortDirection: "asc",
};

export const useProjectsRegistry = (query: ProjectListQuery = defaultProjectListQuery) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiProjects) {
        return emptyProjects;
      }

      return window.bukowskiProjects.getList(query);
    },
    emptyProjects,
    [query.search, query.sortBy, query.sortDirection],
  );

export const useCatalogData = (query: CatalogListQuery = defaultCatalogListQuery) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiProjects) {
        if (window.bukowskiCatalog) {
          return window.bukowskiCatalog.getSnapshot(query);
        }

        return emptyCatalog;
      }

      return window.bukowskiCatalog ? window.bukowskiCatalog.getSnapshot(query) : window.bukowskiProjects.getCatalog();
    },
    emptyCatalog,
    [query.entityType, query.search, query.sortBy, query.sortDirection],
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

export const createCatalogEntity = async (input: CreateCatalogEntityInput): Promise<CatalogSnapshot> => {
  if (!window.bukowskiCatalog) {
    throw new Error("Catalog bridge unavailable");
  }

  return window.bukowskiCatalog.create(input);
};

export const updateCatalogEntity = async (input: UpdateCatalogEntityInput): Promise<CatalogSnapshot> => {
  if (!window.bukowskiCatalog) {
    throw new Error("Catalog bridge unavailable");
  }

  return window.bukowskiCatalog.update(input);
};

export const deleteCatalogEntity = async (input: DeleteCatalogEntityInput): Promise<CatalogSnapshot> => {
  if (!window.bukowskiCatalog) {
    throw new Error("Catalog bridge unavailable");
  }

  return window.bukowskiCatalog.remove(input);
};

export const createProjectUnit = async (input: CreateProjectUnitInput): Promise<ProjectDetailSnapshot> => {
  if (!window.bukowskiProjects) {
    throw new Error("Projects bridge unavailable");
  }

  return window.bukowskiProjects.createUnit(input);
};

export const updateProjectUnit = async (input: UpdateProjectUnitInput): Promise<ProjectDetailSnapshot> => {
  if (!window.bukowskiProjects) {
    throw new Error("Projects bridge unavailable");
  }

  return window.bukowskiProjects.updateUnit(input);
};

export const deleteProjectUnit = async (input: DeleteProjectUnitInput): Promise<ProjectDetailSnapshot> => {
  if (!window.bukowskiProjects) {
    throw new Error("Projects bridge unavailable");
  }

  return window.bukowskiProjects.removeUnit(input);
};

export const assignCrewToProjectUnit = async (input: AssignCrewToProjectUnitInput): Promise<ProjectDetailSnapshot> => {
  if (!window.bukowskiProjects) {
    throw new Error("Projects bridge unavailable");
  }

  return window.bukowskiProjects.assignCrewToUnit(input);
};

export const unassignCrewFromProjectUnit = async (
  input: UnassignCrewFromProjectUnitInput,
): Promise<ProjectDetailSnapshot> => {
  if (!window.bukowskiProjects) {
    throw new Error("Projects bridge unavailable");
  }

  return window.bukowskiProjects.unassignCrewFromUnit(input);
};

export const getStagingPackingSlips = async (): Promise<StagingPackingSlipRow[]> => {
  if (!window.bukowskiProjects) {
    throw new Error("Projects bridge unavailable");
  }

  return window.bukowskiProjects.getStagingPackingSlips();
};

export const getProjectCreationConflicts = async (
  input: CreateProjectBlueprintInput,
): Promise<ProjectCreationConflictsSnapshot> => {
  if (!window.bukowskiProjects) {
    throw new Error("Projects bridge unavailable");
  }

  return window.bukowskiProjects.getCreationConflicts(input);
};

export const exportProjectBlueprintPdf = async (input: CreateProjectBlueprintInput) => {
  if (!window.bukowskiProjects) {
    throw new Error("Projects bridge unavailable");
  }

  return window.bukowskiProjects.exportBlueprintPdf(input);
};
