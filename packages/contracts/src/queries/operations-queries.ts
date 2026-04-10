import type { OverviewMetric } from "./overview-queries";
import type { ListSortDirection } from "./list-controls-queries";

export type PackingSlipRow = {
  id: string;
  number: string;
  projectId: string;
  project: string;
  department: string;
  responsible: string;
  issuedDate: string;
  dueDate: string;
  itemCount: number;
  returnedCount: number;
  status: string;
};

export type PackingSlipSortField =
  | "number"
  | "project"
  | "department"
  | "responsible"
  | "issuedDate"
  | "dueDate"
  | "itemCount"
  | "returnedCount"
  | "status";

export type PackingSlipListQuery = {
  scopeProjectId?: string | null;
  search?: string;
  sortBy: PackingSlipSortField;
  sortDirection: ListSortDirection;
};

export type PackingSlipDetailSummary = {
  id: string;
  number: string;
  project: string;
  department: string;
  responsible: string;
  preparedBy: string;
  issueDate: string;
  dueDate: string;
  status: string;
  notes: string;
  itemCount: number;
  returnedCount: number;
  pendingCount: number;
  primaryCodeValue: string;
};

export type PackingSlipItemRow = {
  id: string;
  assetId: string;
  asset: string;
  code: string;
  quantity: number;
  conditionOut: string;
  conditionIn: string;
  returnedAt: string;
  status: string;
  location: string;
  responsible: string;
};

export type PackingSlipDetailSnapshot = {
  slip: PackingSlipDetailSummary | null;
  items: PackingSlipItemRow[];
};

export type IncidentListRow = {
  id: string;
  title: string;
  asset: string;
  projectId: string | null;
  project: string;
  responsible: string;
  severity: string;
  costEstimate: string;
  status: string;
};

export type IncidentSortField = "title" | "asset" | "project" | "responsible" | "severity" | "costEstimate" | "status" | "reportedAt";

export type IncidentListQuery = {
  scopeProjectId?: string | null;
  search?: string;
  sortBy: IncidentSortField;
  sortDirection: ListSortDirection;
};

export type ProjectCardRow = {
  id: string;
  code: string;
  name: string;
  clientId: string | null;
  client: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  colorKey: string | null;
  departments: string;
  exposure: string;
  assetCount: number;
  incidentCount: number;
  activeUnitCount: number;
  description: string;
};

export type ProjectSortField =
  | "name"
  | "code"
  | "client"
  | "status"
  | "startDate"
  | "endDate"
  | "colorKey"
  | "assetCount"
  | "incidentCount"
  | "activeUnitCount"
  | "exposure"
  | "createdAt"
  | "updatedAt";

export type ProjectListQuery = {
  search?: string;
  sortBy: ProjectSortField;
  sortDirection: ListSortDirection;
};

export type CatalogLocationRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  description: string;
  isActive: boolean;
};

export type CatalogDepartmentRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
};

export type CatalogUserRow = {
  id: string;
  fullName: string;
};

export type CatalogCrewRow = {
  id: string;
  fullName: string;
  roleLabel: string;
  email: string;
  phone: string;
  notes: string;
  isActive: boolean;
  linkedUserId: string | null;
};

export type CatalogClientRow = {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  isActive: boolean;
};

export type CatalogCategoryRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
};

export type CatalogAssetOptionRow = {
  id: string;
  name: string;
  code: string;
  category: string;
  status: string;
};

export type CatalogKitRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  notes: string;
  isActive: boolean;
  assetCount: number;
  assetIds: string[];
  primaryCodeValue: string;
};

export type CatalogSnapshot = {
  locations: CatalogLocationRow[];
  departments: CatalogDepartmentRow[];
  users: CatalogUserRow[];
  crewMembers: CatalogCrewRow[];
  clients: CatalogClientRow[];
  categories: CatalogCategoryRow[];
  kits: CatalogKitRow[];
  assetOptions: CatalogAssetOptionRow[];
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
  projectUnitId: string | null;
  projectUnit: string;
};

export type ProjectDetailIncidentRow = {
  id: string;
  title: string;
  asset: string;
  responsible: string;
  severity: string;
  costEstimate: string;
  status: string;
  projectUnitId: string | null;
  projectUnit: string;
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

export type ProjectScheduleSummary = {
  startDate: string | null;
  endDate: string | null;
  colorKey: string | null;
  status: string;
  windowLabel: string;
};

export type ProjectUnitCrewAssignmentRow = {
  id: string;
  crewMemberId: string;
  fullName: string;
  linkedUserId: string | null;
  roleLabel: string;
  startDate: string | null;
  endDate: string | null;
  notes: string;
};

export type ProjectUnitRow = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  status: string;
  statusSource: "derived" | "manual_override";
  colorKey: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string;
  crewAssignments: ProjectUnitCrewAssignmentRow[];
};

export type ProjectTimelineSummary = {
  activeUnits: number;
  plannedUnits: number;
  wrappedUnits: number;
  cancelledUnits: number;
};

export type ProjectDetailSnapshot = {
  project: ProjectCardRow | null;
  schedule: ProjectScheduleSummary | null;
  units: ProjectUnitRow[];
  timelineSummary: ProjectTimelineSummary | null;
  metrics: OverviewMetric[];
  assets: ProjectDetailAssetRow[];
  incidents: ProjectDetailIncidentRow[];
  responsibles: ProjectResponsibleRow[];
  budget: ProjectBudgetShell;
};
