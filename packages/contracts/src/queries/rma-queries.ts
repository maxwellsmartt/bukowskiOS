export type RmaCaseStatus = "Draft" | "Ready" | "Sent" | "Closed";

export type RmaManufacturerRow = {
  id: string;
  name: string;
  contactName: string;
  supportEmail: string;
  phone: string;
  notes: string;
  isActive: boolean;
};

export type RmaMaintenanceAssetRow = {
  id: string;
  name: string;
  brand: string;
  model: string;
  serialNumber: string;
  location: string;
  latestIssue: string;
};

export type RmaCaseListRow = {
  id: string;
  title: string;
  manufacturerName: string;
  supportEmail: string;
  status: RmaCaseStatus;
  assetCount: number;
  updatedAtLabel: string;
};

export type RmaCaseAssetRow = {
  assetId: string;
  assetName: string;
  brand: string;
  model: string;
  serialNumber: string;
  equipmentYear: string;
  issueSummary: string;
};

export type RmaCaseDetailRow = {
  id: string;
  title: string;
  manufacturerId: string;
  manufacturerName: string;
  contactName: string;
  supportEmail: string;
  phone: string;
  problemSummary: string;
  notes: string;
  status: RmaCaseStatus;
  createdAtLabel: string;
  updatedAtLabel: string;
};

export type RmaSnapshot = {
  cases: RmaCaseListRow[];
  maintenanceAssets: RmaMaintenanceAssetRow[];
  manufacturers: RmaManufacturerRow[];
};

export type RmaCaseDetailSnapshot = {
  caseRecord: RmaCaseDetailRow | null;
  assets: RmaCaseAssetRow[];
};
