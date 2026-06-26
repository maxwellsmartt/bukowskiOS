import type {
  ApplyAssetDuplicateAuditCommand,
  ApplyAssetDuplicateAuditResult,
  ArchiveAssetCommand,
  ArchiveAssetsCommand,
  ArchiveAssetsResult,
  AssetDetailSnapshot,
  AssetEditorMutationResult,
  AssetListQuery,
  AssetListRow,
  AssetWorkspaceQuery,
  AssetDuplicateAuditPreview,
  AssetsOverviewSnapshot,
  AssetSummarySnapshot,
  AssignMoveAssetsInput,
  AssignMoveAssetsResult,
  CreateAssetCommand,
  ReconcileAssetQuantitiesCommand,
  ReconcileAssetQuantitiesResult,
  UpdateAssetCommand,
} from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";
import { useWorkspaceDataRefreshVersion } from "@shared/hooks/useWorkspaceDataRefresh";

const emptyAssetList: AssetListRow[] = [];
const emptyAssetSummary: AssetSummarySnapshot = {
  totalAssets: "—",
  assignedAssets: "—",
};

const emptyAssetsOverview: AssetsOverviewSnapshot = {
  totalAssets: "—",
  assignedAssets: "—",
  cards: {
    overdueReturns: {
      label: "Overdue returns",
      value: "—",
      subtitle: "Slips nearing or past due return need review.",
      tone: "warning",
    },
    openPackingSlips: {
      label: "Open packing slips",
      value: "—",
      subtitle: "Issued slips still active across warehouse and set.",
      tone: "warning",
    },
    activeIncidents: {
      label: "Active incidents",
      value: "—",
      subtitle: "Open issues with pending follow-up or missing estimates.",
      tone: "critical",
    },
    maintenanceWatch: {
      label: "Maintenance watch",
      value: "—",
      subtitle: "Assets flagged for bench review or spare-part follow-up.",
      tone: "success",
    },
  },
  recentMovements: [],
};

const emptyAssetDetail: AssetDetailSnapshot = {
  asset: null,
  legacy: null,
  timeline: [],
  linkedIncidents: [],
  editor: null,
  scannableCodes: [],
  files: [],
};

const defaultAssetListQuery: AssetListQuery = {
  workspaceId: undefined,
  scopeProjectId: null,
  search: "",
  sortBy: "name",
  sortDirection: "asc",
};

const assetRefreshFilter = {
  entities: ["assets", "catalog", "deletions", "workspace_files"],
};

export const useAssetsList = (query: AssetListQuery = defaultAssetListQuery) => {
  const refreshVersion = useWorkspaceDataRefreshVersion(assetRefreshFilter);

  return useAsyncValue(
    async () => {
      if (!window.bukowskiAssets) {
        return emptyAssetList;
      }

      return window.bukowskiAssets.getList(query);
    },
    emptyAssetList,
    [query.workspaceId, query.scopeProjectId, query.search, query.sortBy, query.sortDirection, refreshVersion],
  );
};

export const useAssetSummary = (query: AssetWorkspaceQuery = {}) => {
  const refreshVersion = useWorkspaceDataRefreshVersion(assetRefreshFilter);

  return useAsyncValue(
    async () => {
      if (!window.bukowskiAssets) {
        return emptyAssetSummary;
      }

      return window.bukowskiAssets.getSummary(query);
    },
    emptyAssetSummary,
    [query.workspaceId, refreshVersion],
  );
};

export const useAssetsOverview = (query: AssetWorkspaceQuery = {}) => {
  const refreshVersion = useWorkspaceDataRefreshVersion(assetRefreshFilter);

  return useAsyncValue(
    async () => {
      if (!window.bukowskiAssets) {
        return emptyAssetsOverview;
      }

      return window.bukowskiAssets.getOverview(query);
    },
    emptyAssetsOverview,
    [query.workspaceId, refreshVersion],
  );
};

export const getAssetDuplicateAudit = async (query: AssetWorkspaceQuery = {}): Promise<AssetDuplicateAuditPreview> => {
  if (!window.bukowskiAssets) {
    throw new Error("Assets bridge unavailable");
  }

  return window.bukowskiAssets.getDuplicateAudit(query);
};

export const useAssetDetail = (assetId: string | undefined) => {
  const refreshVersion = useWorkspaceDataRefreshVersion(assetRefreshFilter);

  return useAsyncValue(
    async () => {
      if (!window.bukowskiAssets || !assetId) {
        return emptyAssetDetail;
      }

      return window.bukowskiAssets.getDetail(assetId);
    },
    emptyAssetDetail,
    [assetId, refreshVersion],
  );
};

export const assignMoveAssets = async (input: AssignMoveAssetsInput): Promise<AssignMoveAssetsResult> => {
  if (!window.bukowskiAssets) {
    throw new Error("Assets bridge unavailable");
  }

  return window.bukowskiAssets.assignMove(input);
};

export const createAsset = async (input: CreateAssetCommand): Promise<AssetEditorMutationResult> => {
  if (!window.bukowskiAssets) {
    throw new Error("Assets bridge unavailable");
  }

  return window.bukowskiAssets.create(input);
};

export const updateAsset = async (input: UpdateAssetCommand): Promise<AssetEditorMutationResult> => {
  if (!window.bukowskiAssets) {
    throw new Error("Assets bridge unavailable");
  }

  return window.bukowskiAssets.update(input);
};

export const archiveAsset = async (input: ArchiveAssetCommand): Promise<AssetEditorMutationResult> => {
  if (!window.bukowskiAssets) {
    throw new Error("Assets bridge unavailable");
  }

  return window.bukowskiAssets.archive(input);
};

export const archiveAssets = async (input: ArchiveAssetsCommand): Promise<ArchiveAssetsResult> => {
  if (!window.bukowskiAssets) {
    throw new Error("Assets bridge unavailable");
  }

  return window.bukowskiAssets.archiveMany(input);
};

export const reconcileAssetQuantities = async (
  input: ReconcileAssetQuantitiesCommand,
): Promise<ReconcileAssetQuantitiesResult> => {
  if (!window.bukowskiAssets) {
    throw new Error("Assets bridge unavailable");
  }

  return window.bukowskiAssets.reconcileQuantities(input);
};

export const applyAssetDuplicateAudit = async (
  input: ApplyAssetDuplicateAuditCommand,
): Promise<ApplyAssetDuplicateAuditResult> => {
  if (!window.bukowskiAssets) {
    throw new Error("Assets bridge unavailable");
  }

  return window.bukowskiAssets.applyDuplicateAudit(input);
};

export const uploadAssetFiles = async (assetId: string) => {
  if (!window.bukowskiAssets) {
    throw new Error("Assets bridge unavailable");
  }

  return window.bukowskiAssets.uploadFiles(assetId);
};

export const uploadAssetImages = async (assetId: string) => {
  if (!window.bukowskiAssets) {
    throw new Error("Assets bridge unavailable");
  }

  return window.bukowskiAssets.uploadImages(assetId);
};

export const openAssetFile = async (fileId: string) => {
  if (!window.bukowskiAssets) {
    throw new Error("Assets bridge unavailable");
  }

  return window.bukowskiAssets.openFile(fileId);
};

export const deleteAssetFile = async (fileId: string) => {
  if (!window.bukowskiAssets) {
    throw new Error("Assets bridge unavailable");
  }

  return window.bukowskiAssets.deleteFile(fileId);
};
