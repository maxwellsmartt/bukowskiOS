import type {
  CreateFinancialEntryCommand,
  FinanceCostLinkRow,
  FinanceEntryListQuery,
  FinanceEntryMutationResult,
  FinanceEntryRow,
  FinanceOverviewSnapshot,
  UpdateFinancialEntryCommand,
} from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyOverview: FinanceOverviewSnapshot = {
  metrics: [],
  exposureByProject: [],
  costLinks: [],
};

const emptyCostLinks: FinanceCostLinkRow[] = [];
const emptyEntries: FinanceEntryRow[] = [];

const defaultFinanceEntryListQuery: FinanceEntryListQuery = {
  search: "",
  sortBy: "date",
  sortDirection: "desc",
};

export const useFinanceOverview = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiFinance) {
        return emptyOverview;
      }

      return window.bukowskiFinance.getOverview();
    },
    emptyOverview,
    [],
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
