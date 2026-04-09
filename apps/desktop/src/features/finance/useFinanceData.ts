import type { FinanceCostLinkRow, FinanceEntryRow, FinanceOverviewSnapshot } from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyOverview: FinanceOverviewSnapshot = {
  metrics: [],
  exposureByProject: [],
  costLinks: [],
};

const emptyCostLinks: FinanceCostLinkRow[] = [];
const emptyEntries: FinanceEntryRow[] = [];

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

export const useFinanceEntries = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiFinance) {
        return emptyEntries;
      }

      return window.bukowskiFinance.getEntries();
    },
    emptyEntries,
    [],
  );
