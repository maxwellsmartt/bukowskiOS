import type { PackingSlipRow } from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyPackingSlips: PackingSlipRow[] = [];

export const usePackingData = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiPacking) {
        return emptyPackingSlips;
      }

      return window.bukowskiPacking.getList();
    },
    emptyPackingSlips,
    [],
  );
