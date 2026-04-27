import type {
  AppExportResult,
  CreatePackingSlipCommand,
  CreatePackingSlipResult,
  PackingSlipDetailSnapshot,
  PackingSlipListQuery,
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

const defaultPackingListQuery: PackingSlipListQuery = {
  scopeProjectId: null,
  search: "",
  sortBy: "issuedDate",
  sortDirection: "desc",
};

export const usePackingList = (query: PackingSlipListQuery = defaultPackingListQuery) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiPacking) {
        return emptyPackingSlips;
      }

      return window.bukowskiPacking.getList(query);
    },
    emptyPackingSlips,
    [query.workspaceId, query.scopeProjectId, query.search, query.sortBy, query.sortDirection],
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

export const exportPackingSlipPdf = async (packingSlipId: string): Promise<AppExportResult> => {
  if (!window.bukowskiPacking) {
    throw new Error("Packing bridge unavailable");
  }

  return window.bukowskiPacking.exportPdf(packingSlipId);
};

export const exportPackingSlipInsurancePdf = async (packingSlipId: string): Promise<AppExportResult> => {
  if (!window.bukowskiPacking) {
    throw new Error("Packing bridge unavailable");
  }

  return window.bukowskiPacking.exportInsurancePdf(packingSlipId);
};
