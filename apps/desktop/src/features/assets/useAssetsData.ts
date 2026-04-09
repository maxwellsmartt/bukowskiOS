import type { AssignMoveAssetsInput, AssignMoveAssetsResult, AssetDetailSnapshot, AssetListRow } from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyAssetList: AssetListRow[] = [];

const emptyAssetDetail: AssetDetailSnapshot = {
  asset: null,
  legacy: null,
  timeline: [],
  linkedIncidents: [],
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
