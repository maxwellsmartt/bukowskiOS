import type {
  CreateRmaCaseCommand,
  RmaCaseDetailSnapshot,
  RmaCaseMutationResult,
  RmaSnapshot,
  UpdateRmaCaseCommand,
} from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptyRmaSnapshot: RmaSnapshot = {
  cases: [],
  maintenanceAssets: [],
  manufacturers: [],
};

const emptyRmaDetail: RmaCaseDetailSnapshot = {
  caseRecord: null,
  assets: [],
};

export const useRmaSnapshot = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiRma) {
        return emptyRmaSnapshot;
      }

      return window.bukowskiRma.getSnapshot();
    },
    emptyRmaSnapshot,
    [],
  );

export const useRmaCaseDetail = (rmaCaseId: string | null) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiRma || !rmaCaseId) {
        return emptyRmaDetail;
      }

      return window.bukowskiRma.getDetail(rmaCaseId);
    },
    emptyRmaDetail,
    [rmaCaseId ?? ""],
  );

export const createRmaCase = async (input: CreateRmaCaseCommand): Promise<RmaCaseMutationResult> => {
  if (!window.bukowskiRma) {
    throw new Error("RMA bridge unavailable");
  }

  return window.bukowskiRma.create(input);
};

export const updateRmaCase = async (input: UpdateRmaCaseCommand): Promise<RmaCaseMutationResult> => {
  if (!window.bukowskiRma) {
    throw new Error("RMA bridge unavailable");
  }

  return window.bukowskiRma.update(input);
};
