import type { OverviewMetric } from "./overview-queries";

export type PackingSlipRow = {
  number: string;
  project: string;
  department: string;
  responsible: string;
  dueDate: string;
  status: string;
};

export type IncidentListRow = {
  title: string;
  asset: string;
  project: string;
  responsible: string;
  severity: string;
  costEstimate: string;
  status: string;
};

export type ProjectCardRow = {
  id: string;
  code: string;
  name: string;
  client: string;
  status: string;
  departments: string;
  exposure: string;
  assetCount: number;
  incidentCount: number;
  description: string;
};

export type CatalogLocationRow = {
  id: string;
  code: string;
  name: string;
  type: string;
};

export type CatalogDepartmentRow = {
  id: string;
  code: string;
  name: string;
};

export type CatalogUserRow = {
  id: string;
  fullName: string;
};

export type CatalogSnapshot = {
  locations: CatalogLocationRow[];
  departments: CatalogDepartmentRow[];
  users: CatalogUserRow[];
};

export type ProjectDetailAssetRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  location: string;
  responsible: string;
  condition: string;
  replacementValue: string;
};

export type ProjectDetailIncidentRow = {
  title: string;
  asset: string;
  responsible: string;
  severity: string;
  costEstimate: string;
  status: string;
};

export type ProjectResponsibleRow = {
  name: string;
  assetCount: number;
  incidentCount: number;
};

export type ProjectBudgetShell = {
  totalEntries: string;
  reserve: string;
  exposure: string;
  status: string;
  note: string;
};

export type ProjectDetailSnapshot = {
  project: ProjectCardRow | null;
  metrics: OverviewMetric[];
  assets: ProjectDetailAssetRow[];
  incidents: ProjectDetailIncidentRow[];
  responsibles: ProjectResponsibleRow[];
  budget: ProjectBudgetShell;
};
