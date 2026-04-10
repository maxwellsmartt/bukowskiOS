import type { CommandActorType, CommandSourceChannel } from "./asset-commands";

export type CreatePackingSlipCommand = {
  commandId: string;
  workspaceId: string;
  assetIds: string[];
  projectId: string;
  departmentId?: string;
  responsibleUserId?: string;
  returnDueAt?: string;
  notes?: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type CreatePackingSlipResult = {
  commandId: string;
  packingSlipId: string;
  slipNumber: string;
  processedAssetIds: string[];
  repeated: boolean;
  summary: string;
};

export type ReturnPackingSlipItemsCommand = {
  commandId: string;
  workspaceId: string;
  packingSlipId: string;
  assetIds?: string[];
  conditionIn?: string;
  notes?: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type ReturnPackingSlipItemsResult = {
  commandId: string;
  packingSlipId: string;
  processedAssetIds: string[];
  repeated: boolean;
  slipStatus: string;
  summary: string;
};
