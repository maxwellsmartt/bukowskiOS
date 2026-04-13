export type CommandActorType = "user" | "agent" | "integration";
export type CommandSourceChannel = "desktop" | "mobile" | "api" | "whatsapp" | "telegram";

export type AssignAssetCommand = {
  commandId: string;
  workspaceId: string;
  assetId: string;
  projectId?: string;
  projectUnitId?: string;
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
  projectUnitId?: string;
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

export type UpdateIncidentCommand = {
  commandId: string;
  workspaceId: string;
  incidentId: string;
  title?: string;
  description?: string;
  severity?: string;
  status?: string;
  responsibleUserId?: string | null;
  costEstimate?: number | null;
  financialStatus?: string | null;
  notes?: string | null;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type ResolveIncidentCommand = {
  commandId: string;
  workspaceId: string;
  incidentId: string;
  resolutionNotes?: string;
  costEstimate?: number;
  financialStatus?: string;
  resolvedByUserId?: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type IncidentMutationResult = {
  commandId: string;
  incidentId: string;
  repeated: boolean;
  summary: string;
};

export type FileUploadMutationResult = {
  uploadedCount: number;
  summary: string;
};

export type AssignMoveAssetsInput = {
  commandId: string;
  workspaceId: string;
  assetIds: string[];
  mode: "assign" | "move";
  projectId?: string;
  projectUnitId?: string;
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
  conflictCount: number;
  warningSummary?: string;
  warnings?: string[];
};

export type AssetEditorInput = {
  name: string;
  internalCode: string;
  categoryId: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  description?: string;
  defaultLocationId?: string;
  conditionStatus: string;
  notes?: string;
  replacementValue?: number;
  ownershipType?: string;
  qrCodeValue?: string;
  isActive?: boolean;
};

export type CreateAssetCommand = AssetEditorInput & {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type UpdateAssetCommand = AssetEditorInput & {
  commandId: string;
  workspaceId: string;
  assetId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type ArchiveAssetCommand = {
  commandId: string;
  workspaceId: string;
  assetId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type AssetEditorMutationResult = {
  commandId: string;
  assetId: string;
  repeated: boolean;
  summary: string;
};
