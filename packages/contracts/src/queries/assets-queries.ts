import type { ListSortDirection } from "./list-controls-queries";
import type { OverviewOperationalCard, RecentMovementRow } from "./overview-queries";

export type AssetListRow = {
  id: string;
  name: string;
  code: string;
  category: string;
  quantity: number;
  tracking: string;
  status: string;
  condition: string;
  custody: string;
  location: string;
  projectId: string | null;
  project: string;
  projectUnitId: string | null;
  projectUnit: string;
  responsible: string;
  serialNumber: string;
  qrCode: string;
  warehouseSlot: string;
  folderPath: string;
  hasAccessories: string;
  source: string;
  incidentsOpen: number;
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
  scopeProjectId?: string | null;
  search?: string;
  sortBy: AssetSortField;
  sortDirection: ListSortDirection;
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
  tracking: string;
  location: string;
  project: string;
  responsible: string;
  replacementValue: string;
  condition: string;
  custody: string;
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
  replacementValue: number | null;
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

export type AssetDetailSnapshot = {
  asset: AssetDetailRow | null;
  legacy: AssetLegacySnapshot | null;
  timeline: AssetTimelineItem[];
  linkedIncidents: AssetLinkedIncidentRow[];
  editor: AssetEditorSnapshot | null;
  scannableCodes: AssetScannableCodeRow[];
};
