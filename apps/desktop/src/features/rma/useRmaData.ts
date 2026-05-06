import type {
  CreateRmaCaseCommand,
  RmaCaseDetailSnapshot,
  RmaCaseMutationResult,
  RmaSnapshotQuery,
  RmaSnapshot,
  UpdateRmaCaseCommand,
} from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";
import { useWorkspaceDataRefreshVersion } from "@shared/hooks/useWorkspaceDataRefresh";

const emptyRmaSnapshot: RmaSnapshot = {
  cases: [],
  maintenanceAssets: [],
  manufacturers: [],
};

const emptyRmaDetail: RmaCaseDetailSnapshot = {
  caseRecord: null,
  assets: [],
};

export const useRmaSnapshot = (query?: RmaSnapshotQuery) => {
  const refreshVersion = useWorkspaceDataRefreshVersion();

  return useAsyncValue(
    async () => {
      if (!window.bukowskiRma) {
        return emptyRmaSnapshot;
      }

      return window.bukowskiRma.getSnapshot(query);
    },
    emptyRmaSnapshot,
    [query?.workspaceId ?? "", refreshVersion],
  );
};

export const useRmaCaseDetail = (rmaCaseId: string | null) => {
  const refreshVersion = useWorkspaceDataRefreshVersion();

  return useAsyncValue(
    async () => {
      if (!window.bukowskiRma || !rmaCaseId) {
        return emptyRmaDetail;
      }

      return window.bukowskiRma.getDetail(rmaCaseId);
    },
    emptyRmaDetail,
    [rmaCaseId ?? "", refreshVersion],
  );
};

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
