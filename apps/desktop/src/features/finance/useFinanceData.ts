import type {
  AppExportResult,
  ApproveCollaboratorFeeCommand,
  CancelCollaboratorFeeCommand,
  CollaboratorFeeDetail,
  CollaboratorFeeListQuery,
  CollaboratorFeeMutationResult,
  CollaboratorFeeRow,
  CollaboratorFeeSummary,
  CollaboratorFeeSuggestion,
  CreateCollaboratorFeeCommand,
  CreateFinancialEntryCommand,
  FileUploadMutationResult,
  FinanceCostLinkRow,
  FinancialDocumentRow,
  FinanceEntryListQuery,
  FinanceEntryMutationResult,
  FinanceEntryRow,
  FinanceOverviewQuery,
  FinanceOverviewSnapshot,
  RecordCollaboratorPaymentCommand,
  UpdateCollaboratorFeeCommand,
  UpdateFinancialEntryCommand,
} from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";
import { useWorkspaceDataRefreshVersion } from "@shared/hooks/useWorkspaceDataRefresh";

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
const emptyCollaboratorFees: CollaboratorFeeRow[] = [];
const emptyCollaboratorSuggestions: CollaboratorFeeSuggestion[] = [];
const emptyCollaboratorSummary: CollaboratorFeeSummary = {
  pendingAmount: 0,
  approvedAmount: 0,
  paidThisMonth: 0,
  collaboratorsWithBalance: 0,
  byCollaborator: [],
  byProject: [],
};

const defaultFinanceEntryListQuery: FinanceEntryListQuery = {
  search: "",
  sortBy: "date",
  sortDirection: "desc",
};

const defaultCollaboratorFeeListQuery: CollaboratorFeeListQuery = {
  search: "",
  sortBy: "expectedDate",
  sortDirection: "desc",
  status: "all",
};

export const useFinanceOverview = (query?: FinanceOverviewQuery) =>
  {
    const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
    const refreshVersion = useWorkspaceDataRefreshVersion();
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
      [activeWorkspaceId, isWorkspaceReady, query?.period, query?.customStartDate, query?.customEndDate, refreshVersion],
    );
  };

export const useFinanceCostLinks = () =>
  {
    const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
    const refreshVersion = useWorkspaceDataRefreshVersion();
    return useAsyncValue(
      async () => {
        if (!window.bukowskiFinance || !isWorkspaceReady) {
          return emptyCostLinks;
        }

        return window.bukowskiFinance.getCostLinks(activeWorkspaceId);
      },
      emptyCostLinks,
      [activeWorkspaceId, isWorkspaceReady, refreshVersion],
    );
  };

export const useFinanceEntries = (query: FinanceEntryListQuery = defaultFinanceEntryListQuery) =>
  {
    const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
    const refreshVersion = useWorkspaceDataRefreshVersion();
    return useAsyncValue(
      async () => {
        if (!window.bukowskiFinance || !isWorkspaceReady) {
          return emptyEntries;
        }

        return window.bukowskiFinance.getEntries({ ...query, workspaceId: activeWorkspaceId });
      },
      emptyEntries,
      [activeWorkspaceId, isWorkspaceReady, query.search, query.sortBy, query.sortDirection, refreshVersion],
    );
  };

export const useFinanceEntryDocuments = (entryId: string | null) => {
  const refreshVersion = useWorkspaceDataRefreshVersion();

  return useAsyncValue(
    async () => {
      if (!window.bukowskiFinance || !entryId) {
        return emptyDocuments;
      }

      return window.bukowskiFinance.getDocuments(entryId);
    },
    emptyDocuments,
    [entryId, refreshVersion],
  );
};

export const useCollaboratorFees = (query: CollaboratorFeeListQuery = defaultCollaboratorFeeListQuery) => {
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const refreshVersion = useWorkspaceDataRefreshVersion();
  return useAsyncValue(
    async () => {
      if (!window.bukowskiFinance || !isWorkspaceReady) {
        return emptyCollaboratorFees;
      }

      return window.bukowskiFinance.listCollaboratorFees({ ...query, workspaceId: activeWorkspaceId });
    },
    emptyCollaboratorFees,
    [
      activeWorkspaceId,
      isWorkspaceReady,
      query.search,
      query.sortBy,
      query.sortDirection,
      query.status,
      query.projectId,
      query.crewMemberId,
      refreshVersion,
    ],
  );
};

export const useCollaboratorFeeSummary = (projectId?: string | null) => {
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const refreshVersion = useWorkspaceDataRefreshVersion();
  return useAsyncValue(
    async () => {
      if (!window.bukowskiFinance || !isWorkspaceReady) {
        return emptyCollaboratorSummary;
      }

      return window.bukowskiFinance.getCollaboratorFeeSummary(activeWorkspaceId, projectId ?? null);
    },
    emptyCollaboratorSummary,
    [activeWorkspaceId, isWorkspaceReady, projectId, refreshVersion],
  );
};

export const useCollaboratorFeeDetail = (feeId: string | null) => {
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const refreshVersion = useWorkspaceDataRefreshVersion();
  return useAsyncValue<CollaboratorFeeDetail | null>(
    async () => {
      if (!window.bukowskiFinance || !isWorkspaceReady || !feeId) {
        return null;
      }

      return window.bukowskiFinance.getCollaboratorFeeDetail(activeWorkspaceId, feeId);
    },
    null,
    [activeWorkspaceId, isWorkspaceReady, feeId, refreshVersion],
  );
};

export const useCollaboratorFeeSuggestions = (input?: { projectId?: string | null; crewMemberId?: string | null }) => {
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const refreshVersion = useWorkspaceDataRefreshVersion();
  return useAsyncValue(
    async () => {
      if (!window.bukowskiFinance || !isWorkspaceReady) {
        return emptyCollaboratorSuggestions;
      }

      return window.bukowskiFinance.suggestCollaboratorFees({
        workspaceId: activeWorkspaceId,
        projectId: input?.projectId ?? null,
        crewMemberId: input?.crewMemberId ?? null,
      });
    },
    emptyCollaboratorSuggestions,
    [activeWorkspaceId, isWorkspaceReady, input?.projectId, input?.crewMemberId, refreshVersion],
  );
};

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

export const createCollaboratorFee = async (input: CreateCollaboratorFeeCommand): Promise<CollaboratorFeeMutationResult> => {
  if (!window.bukowskiFinance) {
    throw new Error("Finance bridge unavailable");
  }

  return window.bukowskiFinance.createCollaboratorFee(input);
};

export const updateCollaboratorFee = async (input: UpdateCollaboratorFeeCommand): Promise<CollaboratorFeeMutationResult> => {
  if (!window.bukowskiFinance) {
    throw new Error("Finance bridge unavailable");
  }

  return window.bukowskiFinance.updateCollaboratorFee(input);
};

export const approveCollaboratorFee = async (input: ApproveCollaboratorFeeCommand): Promise<CollaboratorFeeMutationResult> => {
  if (!window.bukowskiFinance) {
    throw new Error("Finance bridge unavailable");
  }

  return window.bukowskiFinance.approveCollaboratorFee(input);
};

export const cancelCollaboratorFee = async (input: CancelCollaboratorFeeCommand): Promise<CollaboratorFeeMutationResult> => {
  if (!window.bukowskiFinance) {
    throw new Error("Finance bridge unavailable");
  }

  return window.bukowskiFinance.cancelCollaboratorFee(input);
};

export const recordCollaboratorPayment = async (input: RecordCollaboratorPaymentCommand): Promise<CollaboratorFeeMutationResult> => {
  if (!window.bukowskiFinance) {
    throw new Error("Finance bridge unavailable");
  }

  return window.bukowskiFinance.recordCollaboratorPayment(input);
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
