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
  project: string;
  responsible: string;
  serialNumber: string;
  qrCode: string;
  warehouseSlot: string;
  folderPath: string;
  hasAccessories: string;
  source: string;
  incidentsOpen: number;
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
};
