import type {
  ArchiveProjectInput,
  AssignCrewToProjectUnitInput,
  CatalogCsvImportPreview,
  CatalogCsvImportResult,
  CatalogListQuery,
  CreateProjectBlueprintInput,
  CreateCatalogEntityInput,
  CreateProjectUnitInput,
  DeleteCatalogEntitiesInput,
  DeleteCatalogEntityInput,
  ExportCatalogCsvInput,
  ImportCatalogCsvInput,
  PreviewCatalogCsvImportInput,
  DeleteProjectUnitInput,
  ProjectDeletePreview,
  ProjectCreationConflictsSnapshot,
  ProjectListQuery,
  StagingPackingSlipRow,
  UnarchiveProjectInput,
  UnassignCrewFromProjectUnitInput,
  UpdateCatalogEntityInput,
  UpdateProjectUnitInput,
} from "@contracts";
import type { CatalogSnapshot, ProjectCardRow, ProjectDetailSnapshot } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";
import { useShellContext } from "@shared/hooks/useShellContext";
import { useWorkspaceDataRefreshVersion } from "@shared/hooks/useWorkspaceDataRefresh";
import { useEffect, useState } from "react";

const catalogRefreshEvent = "bukowski:catalog-changed";

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
  workspaceId: undefined,
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

const useCatalogRefreshVersion = () => {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handleRefresh = () => {
      setVersion((current) => current + 1);
    };

    window.addEventListener(catalogRefreshEvent, handleRefresh);
    return () => {
      window.removeEventListener(catalogRefreshEvent, handleRefresh);
    };
  }, []);

  return version;
};

export const notifyCatalogChanged = () => {
  window.dispatchEvent(new Event(catalogRefreshEvent));
};

export const useProjectsRegistry = (query: ProjectListQuery = defaultProjectListQuery) => {
  const refreshVersion = useWorkspaceDataRefreshVersion();

  return useAsyncValue(
    async () => {
      if (!window.bukowskiProjects) {
        return emptyProjects;
      }

      return window.bukowskiProjects.getList(query);
    },
    emptyProjects,
    [query.includeArchived, query.search, query.sortBy, query.sortDirection, query.workspaceId, refreshVersion],
  );
};

export const useCatalogData = (query: CatalogListQuery = defaultCatalogListQuery) => {
  const { activeWorkspaceId } = useWorkspace();
  const refreshVersion = useCatalogRefreshVersion();
  const workspaceId = query.workspaceId ?? activeWorkspaceId;
  const scopedQuery = { ...query, workspaceId };

  return useAsyncValue(
    async () => {
      if (!window.bukowskiProjects) {
        if (window.bukowskiCatalog) {
          return window.bukowskiCatalog.getSnapshot(scopedQuery);
        }

        return emptyCatalog;
      }

      return window.bukowskiCatalog ? window.bukowskiCatalog.getSnapshot(scopedQuery) : window.bukowskiProjects.getCatalog({ workspaceId });
    },
    emptyCatalog,
    [query.entityType, query.search, query.sortBy, query.sortDirection, workspaceId, refreshVersion],
  );
};

export const useProjectDetail = (projectId: string | null) => {
  const refreshVersion = useWorkspaceDataRefreshVersion();

  return useAsyncValue(
    async () => {
      if (!window.bukowskiProjects || !projectId) {
        return emptyProjectDetail;
      }

      return window.bukowskiProjects.getDetail(projectId);
    },
    emptyProjectDetail,
    [projectId, refreshVersion],
  );
};

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

export const deleteCatalogEntities = async (input: DeleteCatalogEntitiesInput): Promise<CatalogSnapshot> => {
  if (!window.bukowskiCatalog) {
    throw new Error("Catalog bridge unavailable");
  }

  return window.bukowskiCatalog.removeMany(input);
};

export const exportCatalogCsv = async (input: ExportCatalogCsvInput) => {
  if (!window.bukowskiCatalog) {
    throw new Error("Catalog bridge unavailable");
  }

  return window.bukowskiCatalog.exportCsv(input);
};

export const previewCatalogCsvImport = async (input: PreviewCatalogCsvImportInput): Promise<CatalogCsvImportPreview> => {
  if (!window.bukowskiCatalog) {
    throw new Error("Catalog bridge unavailable");
  }

  return window.bukowskiCatalog.previewImportCsv(input);
};

export const importCatalogCsv = async (
  input: ImportCatalogCsvInput,
): Promise<{ result: CatalogCsvImportResult; snapshot: CatalogSnapshot }> => {
  if (!window.bukowskiCatalog) {
    throw new Error("Catalog bridge unavailable");
  }

  return window.bukowskiCatalog.importCsv(input);
};

export const uploadCrewCatalogDocuments = async (workspaceId: string, crewMemberId: string, sourceFilePaths?: string[]) => {
  if (!window.bukowskiCatalog) {
    throw new Error("Catalog bridge unavailable");
  }

  return window.bukowskiCatalog.uploadCrewDocuments(workspaceId, crewMemberId, sourceFilePaths);
};

export const openCrewCatalogDocument = async (fileId: string) => {
  if (!window.bukowskiCatalog) {
    throw new Error("Catalog bridge unavailable");
  }

  return window.bukowskiCatalog.openCrewDocument(fileId);
};

export const deleteCrewCatalogDocument = async (fileId: string) => {
  if (!window.bukowskiCatalog) {
    throw new Error("Catalog bridge unavailable");
  }

  return window.bukowskiCatalog.deleteCrewDocument(fileId);
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

export const getProjectDeletePreview = async (projectId: string): Promise<ProjectDeletePreview> => {
  if (!window.bukowskiProjects) {
    throw new Error("Projects bridge unavailable");
  }

  return window.bukowskiProjects.getDeletePreview(projectId);
};

export const archiveProject = async (input: ArchiveProjectInput): Promise<ProjectCardRow[]> => {
  if (!window.bukowskiProjects) {
    throw new Error("Projects bridge unavailable");
  }

  return window.bukowskiProjects.archive(input);
};

export const unarchiveProject = async (input: UnarchiveProjectInput): Promise<ProjectCardRow[]> => {
  if (!window.bukowskiProjects) {
    throw new Error("Projects bridge unavailable");
  }

  return window.bukowskiProjects.unarchive(input);
};

export const exportProjectBlueprintPdf = async (input: CreateProjectBlueprintInput) => {
  if (!window.bukowskiProjects) {
    throw new Error("Projects bridge unavailable");
  }

  return window.bukowskiProjects.exportBlueprintPdf(input);
};
