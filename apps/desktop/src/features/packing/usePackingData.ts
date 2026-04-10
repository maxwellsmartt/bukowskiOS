import type {
  CreatePackingSlipCommand,
  CreatePackingSlipResult,
  PackingSlipDetailSnapshot,
  PackingSlipRow,
  ReturnPackingSlipItemsCommand,
  ReturnPackingSlipItemsResult,
} from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyPackingSlips: PackingSlipRow[] = [];
const emptyPackingSlipDetail: PackingSlipDetailSnapshot = {
  slip: null,
  items: [],
};

export const usePackingList = (projectId: string | null = null) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiPacking) {
        return emptyPackingSlips;
      }

      const rows = await window.bukowskiPacking.getList();
      return projectId ? rows.filter((row) => row.projectId === projectId) : rows;
    },
    emptyPackingSlips,
    [projectId],
  );

export const usePackingDetail = (packingSlipId: string | null) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiPacking || !packingSlipId) {
        return emptyPackingSlipDetail;
      }

      return window.bukowskiPacking.getDetail(packingSlipId);
    },
    emptyPackingSlipDetail,
    [packingSlipId],
  );

export const createPackingSlip = async (input: CreatePackingSlipCommand): Promise<CreatePackingSlipResult> => {
  if (!window.bukowskiPacking) {
    throw new Error("Packing bridge unavailable");
  }

  return window.bukowskiPacking.create(input);
};

export const returnPackingSlipItems = async (
  input: ReturnPackingSlipItemsCommand,
): Promise<ReturnPackingSlipItemsResult> => {
  if (!window.bukowskiPacking) {
    throw new Error("Packing bridge unavailable");
  }

  return window.bukowskiPacking.returnItems(input);
};
