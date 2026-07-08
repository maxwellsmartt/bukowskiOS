import type { ListSortDirection } from "./list-controls-queries";
import type { OverviewOperationalCard, RecentMovementRow } from "./overview-queries";

export type AssetListRow = {
  id: string;
  name: string;
  code: string;
  category: string;
  quantity: number;
  totalQuantity: number;
  assignedQuantity: number;
  checkedOutQuantity: number;
  tracking: string;
  status: string;
  condition: string;
  custody: string;
  location: string;
  projectId: string | null;
  project: string;
  projectUnitId: string | null;
  projectUnit: string;
  currentDepartmentId: string | null;
  currentDepartment: string;
  responsible: string;
  serialNumber: string;
  qrCode: string;
  warehouseSlot: string;
  folderPath: string;
  hasAccessories: string;
  source: string;
  purchasePrice: string;
  additionalCosts: string;
  currentBookValue: string;
  replacementValue: string;
  incidentsOpen: number;
  linkedKitCount: number;
  linkedKitCodes: string[];
  linkedKitNames: string[];
};

export type AssetSortField =
  | "name"
  | "code"
  | "category"
  | "status"
  | "condition"
  | "location"
  | "project"
  | "projectUnit"
  | "responsible"
  | "serialNumber"
  | "qrCode"
  | "incidentsOpen"
  | "createdAt"
  | "updatedAt";

export type AssetListQuery = {
  workspaceId?: string;
  scopeProjectId?: string | null;
  search?: string;
  sortBy: AssetSortField;
  sortDirection: ListSortDirection;
};

export type AssetWorkspaceQuery = {
  workspaceId?: string;
};

export type AssetSummarySnapshot = {
  totalAssets: string;
  assignedAssets: string;
};

export type AssetsOverviewSnapshot = {
  totalAssets: string;
  assignedAssets: string;
  cards: {
    overdueReturns: OverviewOperationalCard;
    openPackingSlips: OverviewOperationalCard;
    activeIncidents: OverviewOperationalCard;
    maintenanceWatch: OverviewOperationalCard;
  };
  recentMovements: RecentMovementRow[];
};

export type AssetDuplicateAuditStrategy = "archive_duplicates" | "reconcile_quantity" | "review";

export type AssetDuplicateAuditConfidence = "high" | "medium" | "review";

export type AssetDuplicateAuditItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  location: string;
  project: string;
  projectStatus: string | null;
  serialNumber: string;
  qrCode: string;
  totalQuantity: number;
  availableQuantity: number;
  assignedQuantity: number;
  checkedOutQuantity: number;
  custody: string;
  incidentsOpen: number;
  fileCount: number;
  createdAt: string;
  role: "canonical" | "duplicate" | "review";
  blockers: string[];
};

export type AssetDuplicateAuditGroup = {
  id: string;
  strategy: AssetDuplicateAuditStrategy;
  confidence: AssetDuplicateAuditConfidence;
  canonicalAssetId: string;
  duplicateAssetIds: string[];
  reasons: string[];
  blockers: string[];
  totalQuantityAfter: number | null;
  items: AssetDuplicateAuditItem[];
};

export type AssetDuplicateAuditPreview = {
  workspaceId?: string;
  generatedAt: string;
  groups: AssetDuplicateAuditGroup[];
  summary: {
    totalGroups: number;
    safeArchiveGroups: number;
    reconcileGroups: number;
    reviewGroups: number;
    affectedAssets: number;
    archivableDuplicates: number;
  };
};

export type AssetTimelineItem = {
  timestamp: string;
  title: string;
  body: string;
};

export type AssetLinkedIncidentRow = {
  id: string;
  title: string;
  project: string;
  costEstimate: string;
  severity: string;
};

export type AssetDetailRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  quantity: number;
  totalQuantity: number;
  assignedQuantity: number;
  checkedOutQuantity: number;
  tracking: string;
  location: string;
  project: string;
  responsible: string;
  purchasePrice: string;
  additionalCosts: string;
  currentBookValue: string;
  replacementValue: string;
  insuredValue: string;
  condition: string;
  custody: string;
  linkedKitCount: number;
  linkedKitCodes: string[];
  linkedKitNames: string[];
};

export type AssetEditorSnapshot = {
  id: string;
  name: string;
  internalCode: string;
  categoryId: string;
  brand: string;
  model: string;
  serialNumber: string;
  description: string;
  defaultLocationId: string | null;
  conditionStatus: string;
  notes: string;
  purchasePrice: number | null;
  additionalCosts: number | null;
  replacementValue: number | null;
  currentBookValue: number | null;
  ownershipType: string;
  isActive: boolean;
  qrCodeValue: string;
  primaryCodeValue: string;
};

export type AssetScannableCodeRow = {
  id: string;
  symbology: string;
  codeValue: string;
  isPrimary: boolean;
};

export type AssetLegacySnapshot = {
  source: string;
  legacyCode: string;
  qrCode: string;
  warehouseSlot: string;
  folderPath: string;
  hasAccessories: string;
};

export type AssetFileRow = {
  id: string;
  fileType: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  status: "available" | "missing" | "deleted";
  createdAt: string;
  isPreviewable: boolean;
  previewDataUrl?: string | null;
};

export type AssetDetailSnapshot = {
  asset: AssetDetailRow | null;
  legacy: AssetLegacySnapshot | null;
  timeline: AssetTimelineItem[];
  linkedIncidents: AssetLinkedIncidentRow[];
  editor: AssetEditorSnapshot | null;
  scannableCodes: AssetScannableCodeRow[];
  files: AssetFileRow[];
};
