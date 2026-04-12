import type {
  ArchiveAssetCommand,
  AssetDetailSnapshot,
  AssetEditorMutationResult,
  AssetListQuery,
  AssetListRow,
  AssetsOverviewSnapshot,
  AssetSummarySnapshot,
  AssignMoveAssetsInput,
  AssignMoveAssetsResult,
  CreateAssetCommand,
  UpdateAssetCommand,
} from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

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
};

const defaultAssetListQuery: AssetListQuery = {
  scopeProjectId: null,
  search: "",
  sortBy: "name",
  sortDirection: "asc",
};

export const useAssetsList = (query: AssetListQuery = defaultAssetListQuery) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiAssets) {
        return emptyAssetList;
      }

      return window.bukowskiAssets.getList(query);
    },
    emptyAssetList,
    [query.scopeProjectId, query.search, query.sortBy, query.sortDirection],
  );

export const useAssetSummary = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiAssets) {
        return emptyAssetSummary;
      }

      return window.bukowskiAssets.getSummary();
    },
    emptyAssetSummary,
    [],
  );

export const useAssetsOverview = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiAssets) {
        return emptyAssetsOverview;
      }

      return window.bukowskiAssets.getOverview();
    },
    emptyAssetsOverview,
    [],
  );

export const useAssetDetail = (assetId: string | undefined) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiAssets || !assetId) {
        return emptyAssetDetail;
      }

      return window.bukowskiAssets.getDetail(assetId);
    },
    emptyAssetDetail,
    [assetId],
  );

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
