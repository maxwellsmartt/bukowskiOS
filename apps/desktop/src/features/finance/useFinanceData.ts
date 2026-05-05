import type {
  AppExportResult,
  CreateFinancialEntryCommand,
  FileUploadMutationResult,
  FinanceCostLinkRow,
  FinancialDocumentRow,
  FinanceEntryListQuery,
  FinanceEntryMutationResult,
  FinanceEntryRow,
  FinanceOverviewQuery,
  FinanceOverviewSnapshot,
  UpdateFinancialEntryCommand,
} from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyOverview: FinanceOverviewSnapshot = {
  activePeriodLabel: "This month",
  metrics: [],
  totals: {
    trackedSpend: "$0",
    trackedSpendValue: 0,
    reserve: "$0",
    reserveValue: 0,
    incidentExposure: "$0",
    incidentExposureValue: 0,
    burnRateAverage: "$0",
    burnRateAverageValue: 0,
  },
  exposureByProject: [],
  costLinks: [],
  monthlyBurn: [],
  categoryBreakdown: [],
};

const emptyCostLinks: FinanceCostLinkRow[] = [];
const emptyEntries: FinanceEntryRow[] = [];
const emptyDocuments: FinancialDocumentRow[] = [];

const defaultFinanceEntryListQuery: FinanceEntryListQuery = {
  search: "",
  sortBy: "date",
  sortDirection: "desc",
};

export const useFinanceOverview = (query?: FinanceOverviewQuery) =>
  {
    const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
    return useAsyncValue(
      async () => {
        if (!window.bukowskiFinance || !isWorkspaceReady) {
          return emptyOverview;
        }

        return window.bukowskiFinance.getOverview({
          period: query?.period ?? "month",
          customStartDate: query?.customStartDate ?? null,
          customEndDate: query?.customEndDate ?? null,
          workspaceId: activeWorkspaceId,
        });
      },
      emptyOverview,
      [activeWorkspaceId, isWorkspaceReady, query?.period, query?.customStartDate, query?.customEndDate],
    );
  };

export const useFinanceCostLinks = () =>
  {
    const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
    return useAsyncValue(
      async () => {
        if (!window.bukowskiFinance || !isWorkspaceReady) {
          return emptyCostLinks;
        }

        return window.bukowskiFinance.getCostLinks(activeWorkspaceId);
      },
      emptyCostLinks,
      [activeWorkspaceId, isWorkspaceReady],
    );
  };

export const useFinanceEntries = (query: FinanceEntryListQuery = defaultFinanceEntryListQuery) =>
  {
    const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
    return useAsyncValue(
      async () => {
        if (!window.bukowskiFinance || !isWorkspaceReady) {
          return emptyEntries;
        }

        return window.bukowskiFinance.getEntries({ ...query, workspaceId: activeWorkspaceId });
      },
      emptyEntries,
      [activeWorkspaceId, isWorkspaceReady, query.search, query.sortBy, query.sortDirection],
    );
  };

export const useFinanceEntryDocuments = (entryId: string | null) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiFinance || !entryId) {
        return emptyDocuments;
      }

      return window.bukowskiFinance.getDocuments(entryId);
    },
    emptyDocuments,
    [entryId],
  );

export const createFinanceEntry = async (input: CreateFinancialEntryCommand): Promise<FinanceEntryMutationResult> => {
  if (!window.bukowskiFinance) {
    throw new Error("Finance bridge unavailable");
  }

  return window.bukowskiFinance.create(input);
};

export const updateFinanceEntry = async (input: UpdateFinancialEntryCommand): Promise<FinanceEntryMutationResult> => {
  if (!window.bukowskiFinance) {
    throw new Error("Finance bridge unavailable");
  }

  return window.bukowskiFinance.update(input);
};

export const exportFinanceReportPdf = async (query?: FinanceOverviewQuery): Promise<AppExportResult> => {
  if (!window.bukowskiFinance) {
    throw new Error("Finance bridge unavailable");
  }

  return window.bukowskiFinance.exportReportPdf(query);
};

export const uploadFinanceDocuments = async (entryId: string): Promise<FileUploadMutationResult> => {
  if (!window.bukowskiFinance) {
    throw new Error("Finance bridge unavailable");
  }

  return window.bukowskiFinance.uploadDocuments(entryId);
};

export const openFinanceDocument = async (fileId: string): Promise<void> => {
  if (!window.bukowskiFinance) {
    throw new Error("Finance bridge unavailable");
  }

  return window.bukowskiFinance.openDocument(fileId);
};
