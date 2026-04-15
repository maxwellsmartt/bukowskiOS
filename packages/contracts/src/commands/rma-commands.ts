import type { RmaCaseStatus } from "../queries/rma-queries";

export type RmaCaseAssetInput = {
  assetId: string;
  equipmentYear?: string;
  issueSummary: string;
};

export type CreateRmaCaseCommand = {
  commandId: string;
  workspaceId: string;
  actorUserId?: string;
  manufacturerId: string;
  supportEmail?: string;
  title: string;
  problemSummary: string;
  notes?: string;
  assetItems: RmaCaseAssetInput[];
  actorType: string;
  sourceChannel: string;
};

export type UpdateRmaCaseCommand = {
  commandId: string;
  workspaceId: string;
  actorUserId?: string;
  rmaCaseId: string;
  manufacturerId: string;
  supportEmail?: string;
  title: string;
  problemSummary: string;
  notes?: string;
  status: RmaCaseStatus;
  assetItems: RmaCaseAssetInput[];
  actorType: string;
  sourceChannel: string;
};

export type RmaCaseMutationResult = {
  rmaCaseId: string;
  summary: string;
};
