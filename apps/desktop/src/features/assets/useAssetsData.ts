import type {
  ArchiveAssetCommand,
  AssetDetailSnapshot,
  AssetEditorMutationResult,
  AssetListRow,
  AssignMoveAssetsInput,
  AssignMoveAssetsResult,
  CreateAssetCommand,
  UpdateAssetCommand,
} from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyAssetList: AssetListRow[] = [];

const emptyAssetDetail: AssetDetailSnapshot = {
  asset: null,
  legacy: null,
  timeline: [],
  linkedIncidents: [],
  editor: null,
  scannableCodes: [],
};

export const useAssetsList = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiAssets) {
        return emptyAssetList;
      }

      return window.bukowskiAssets.getList();
    },
    emptyAssetList,
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
