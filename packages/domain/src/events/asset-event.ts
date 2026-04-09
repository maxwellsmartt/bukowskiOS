import type { CommandActorType, CommandSourceChannel } from "@contracts/commands/asset-commands";

export type AssetEvent = {
  id: string;
  workspaceId: string;
  assetId: string;
  assignmentId?: string;
  projectId?: string;
  departmentId?: string;
  performedByUserId: string;
  eventType: string;
  eventTimestamp: string;
  commandId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  notes?: string;
  metadataJson?: string;
};
