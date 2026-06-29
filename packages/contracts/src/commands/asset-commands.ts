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
  actorUserId?: string;
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
  actorUserId?: string;
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
  actorUserId?: string;
  incidentId: string;
  resolutionNotes?: string;
  costEstimate?: number;
  financialStatus?: string;
  resolvedByUserId?: string;
  retireAsset?: boolean;
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

export type FileDeleteMutationResult = {
  deletedCount: number;
  summary: string;
};

export type AssignMoveAssetsInput = {
  commandId: string;
  workspaceId: string;
  assetIds: string[];
  assetSelections?: Array<{
    assetId: string;
    quantity: number;
  }>;
  sourceKitId?: string;
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
  purchasePrice?: number;
  additionalCosts?: number;
  replacementValue?: number;
  currentBookValue?: number;
  ownershipType?: string;
  qrCodeValue?: string;
  isActive?: boolean;
  totalQuantity?: number;
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

export type ArchiveAssetsCommand = {
  commandId: string;
  workspaceId: string;
  assetIds: string[];
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type ArchiveAssetsResult = {
  commandId: string;
  archivedCount: number;
  blockedCount: number;
  assetIds: string[];
  repeated: boolean;
  summary: string;
};

export type ReconcileAssetQuantityInput = {
  assetId: string;
  totalQuantity: number;
  reason?: string;
};

export type ReconcileAssetQuantitiesCommand = {
  commandId: string;
  workspaceId: string;
  sourceLabel: string;
  rows: ReconcileAssetQuantityInput[];
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type ReconcileAssetQuantitiesResult = {
  commandId: string;
  reconciledCount: number;
  skippedCount: number;
  repeated: boolean;
  summary: string;
};

export type ApplyAssetDuplicateAuditCommand = {
  commandId: string;
  workspaceId: string;
  groupIds: string[];
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type ApplyAssetDuplicateAuditResult = {
  commandId: string;
  appliedGroups: number;
  archivedAssets: number;
  reconciledAssets: number;
  skippedGroups: number;
  repeated: boolean;
  summary: string;
};

export type AssetEditorMutationResult = {
  commandId: string;
  assetId: string;
  repeated: boolean;
  summary: string;
};

export type InventoryResetReference = {
  table: string;
  column: string;
  rowCount: number;
  action: "delete" | "null";
};

export type InventoryResetReport = {
  workspaceId: string;
  dryRun: boolean;
  assetCount: number;
  inUseCount: number;
  references: InventoryResetReference[];
  legacyImports: number;
  legacyItems: number;
  scannableCodes: number;
  clearedOutbox: number;
};

export type InventoryResetCommand = {
  workspaceId: string;
};
