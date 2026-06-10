import type {
  AppExportResult,
  AppPrintResult,
  CreatePackingSlipCommand,
  CreatePackingSlipResult,
  ExportPackingSlipInsurancePdfInput,
  PackingSlipDetailSnapshot,
  PackingSlipListQuery,
  PackingSlipRow,
  ReturnPackingSlipItemsCommand,
  ReturnPackingSlipItemsResult,
} from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";
import { useWorkspaceDataRefreshVersion } from "@shared/hooks/useWorkspaceDataRefresh";

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

export const usePackingList = (query: PackingSlipListQuery = defaultPackingListQuery) => {
  const refreshVersion = useWorkspaceDataRefreshVersion();

  return useAsyncValue(
    async () => {
      if (!window.bukowskiPacking) {
        return emptyPackingSlips;
      }

      return window.bukowskiPacking.getList(query);
    },
    emptyPackingSlips,
    [query.workspaceId, query.scopeProjectId, query.search, query.sortBy, query.sortDirection, refreshVersion],
  );
};

export const usePackingDetail = (packingSlipId: string | null) => {
  const refreshVersion = useWorkspaceDataRefreshVersion();

  return useAsyncValue(
    async () => {
      if (!window.bukowskiPacking || !packingSlipId) {
        return emptyPackingSlipDetail;
      }

      return window.bukowskiPacking.getDetail(packingSlipId);
    },
    emptyPackingSlipDetail,
    [packingSlipId, refreshVersion],
  );
};

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

export const exportPackingSlipInsurancePdf = async (
  packingSlipId: string,
  options?: ExportPackingSlipInsurancePdfInput["options"],
): Promise<AppExportResult> => {
  if (!window.bukowskiPacking) {
    throw new Error("Packing bridge unavailable");
  }

  return window.bukowskiPacking.exportInsurancePdf({ packingSlipId, options });
};

export const printPackingSlipPdf = async (packingSlipId: string): Promise<AppPrintResult> => {
  if (!window.bukowskiPacking) {
    throw new Error("Packing bridge unavailable");
  }

  return window.bukowskiPacking.printPdf(packingSlipId);
};

export const printPackingSlipInsurancePdf = async (
  packingSlipId: string,
  options?: ExportPackingSlipInsurancePdfInput["options"],
): Promise<AppPrintResult> => {
  if (!window.bukowskiPacking) {
    throw new Error("Packing bridge unavailable");
  }

  return window.bukowskiPacking.printInsurancePdf({ packingSlipId, options });
};
