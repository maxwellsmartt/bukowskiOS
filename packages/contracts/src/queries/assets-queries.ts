export type AssetListRow = {
  id: string;
  name: string;
  code: string;
  category: string;
  status: string;
  location: string;
  project: string;
  responsible: string;
  incidentsOpen: number;
};

export type AssetTimelineItem = {
  timestamp: string;
  title: string;
  body: string;
};

export type AssetLinkedIncidentRow = {
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
  location: string;
  project: string;
  responsible: string;
  replacementValue: string;
  condition: string;
  custody: string;
};

export type AssetDetailSnapshot = {
  asset: AssetDetailRow | null;
  timeline: AssetTimelineItem[];
  linkedIncidents: AssetLinkedIncidentRow[];
};
