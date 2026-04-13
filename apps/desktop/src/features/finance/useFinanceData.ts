import type {
  CreateFinancialEntryCommand,
  FinanceCostLinkRow,
  FinanceEntryListQuery,
  FinanceEntryMutationResult,
  FinanceEntryRow,
  FinanceOverviewQuery,
  FinanceOverviewSnapshot,
  UpdateFinancialEntryCommand,
} from "@contracts";
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

const defaultFinanceEntryListQuery: FinanceEntryListQuery = {
  search: "",
  sortBy: "date",
  sortDirection: "desc",
};

export const useFinanceOverview = (query?: FinanceOverviewQuery) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiFinance) {
        return emptyOverview;
      }

      return window.bukowskiFinance.getOverview(query);
    },
    emptyOverview,
    [query?.period, query?.customStartDate, query?.customEndDate],
  );

export const useFinanceCostLinks = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiFinance) {
        return emptyCostLinks;
      }

      return window.bukowskiFinance.getCostLinks();
    },
    emptyCostLinks,
    [],
  );

export const useFinanceEntries = (query: FinanceEntryListQuery = defaultFinanceEntryListQuery) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiFinance) {
        return emptyEntries;
      }

      return window.bukowskiFinance.getEntries(query);
    },
    emptyEntries,
    [query.search, query.sortBy, query.sortDirection],
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
