export type CommandActorType = "user" | "agent" | "integration";
export type CommandSourceChannel = "desktop" | "mobile" | "api" | "whatsapp" | "telegram";

export type AssignAssetCommand = {
  commandId: string;
  workspaceId: string;
  assetId: string;
  projectId?: string;
  departmentId?: string;
  assignedToUserId?: string;
  sourceLocationId?: string;
  targetLocationId?: string;
  expectedReturnAt?: string;
  notes?: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type ReportIncidentCommand = {
  commandId: string;
  workspaceId: string;
  assetId?: string;
  assignmentId?: string;
  projectId?: string;
  departmentId?: string;
  responsibleUserId?: string;
  incidentType: string;
  severity: string;
  title: string;
  description: string;
  costEstimate?: number;
  currency?: string;
  financialStatus?: string;
  notes?: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type ReportIncidentResult = {
  commandId: string;
  incidentId: string;
  repeated: boolean;
  summary: string;
};

export type AssignMoveAssetsInput = {
  commandId: string;
  workspaceId: string;
  assetIds: string[];
  mode: "assign" | "move";
  projectId?: string;
  departmentId?: string;
  assignedToUserId?: string;
  targetLocationId?: string;
  expectedReturnAt?: string;
  notes?: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type AssignMoveAssetsResult = {
  commandId: string;
  eventType: "assigned" | "moved";
  processedAssetIds: string[];
  repeated: boolean;
  summary: string;
};
