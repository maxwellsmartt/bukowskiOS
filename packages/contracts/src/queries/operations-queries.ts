import type { OverviewMetric } from "./overview-queries";
import type { ListSortDirection } from "./list-controls-queries";

export type PackingSlipRow = {
  id: string;
  number: string;
  projectId: string | null;
  project: string;
  department: string;
  responsible: string;
  issuedDate: string;
  dueDate: string;
  itemCount: number;
  returnedCount: number;
  status: string;
  lifecycleState: "operational" | "staging";
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
  workspaceId?: string;
  scopeProjectId?: string | null;
  search?: string;
  sortBy: PackingSlipSortField;
  sortDirection: ListSortDirection;
};

export type PackingSlipDetailSummary = {
  id: string;
  number: string;
  projectId: string | null;
  projectCode: string;
  project: string;
  departmentCode: string;
  department: string;
  responsible: string;
  preparedBy: string;
  issueDate: string;
  issueDateCompact: string;
  dueDate: string;
  status: string;
  notes: string;
  itemCount: number;
  returnedCount: number;
  pendingCount: number;
  insuredTotal: string;
  primaryCodeValue: string;
  lifecycleState: "operational" | "staging";
};

export type PackingSlipItemRow = {
  id: string;
  assetId: string;
  asset: string;
  code: string;
  serialNumber: string;
  quantity: number;
  conditionOut: string;
  conditionIn: string;
  returnedAt: string;
  status: string;
  location: string;
  responsible: string;
  purchasePriceAmount: number | null;
  purchasePrice: string;
  additionalCostsAmount: number | null;
  additionalCosts: string;
  unitInsuredValueAmount: number | null;
  unitInsuredValue: string;
  insuredTotalAmount: number | null;
  insuredTotal: string;
};

export type PackingSlipDetailSnapshot = {
  slip: PackingSlipDetailSummary | null;
  items: PackingSlipItemRow[];
};

export type IncidentListRow = {
  id: string;
  title: string;
  asset: string;
  assetCode: string;
  assetName: string;
  assetId: string | null;
  projectId: string | null;
  project: string;
  responsible: string;
  severity: string;
  costEstimate: string;
  status: string;
};

export type IncidentSortField = "title" | "asset" | "project" | "responsible" | "severity" | "costEstimate" | "status" | "reportedAt";

export type IncidentListQuery = {
  workspaceId?: string;
  scopeProjectId?: string | null;
  search?: string;
  sortBy: IncidentSortField;
  sortDirection: ListSortDirection;
};

export type IncidentDetailSnapshot = {
  incident: {
    id: string;
    assetId: string | null;
    asset: string;
    projectId: string | null;
    project: string;
    departmentId: string | null;
    department: string;
    assignmentId: string | null;
    responsibleUserId: string | null;
    responsible: string;
    incidentType: string;
    severity: string;
    status: string;
    title: string;
    description: string;
    reportedAt: string;
    resolvedAt: string | null;
    costEstimate: string;
    costEstimateValue: number | null;
    currency: string | null;
    financialStatus: string;
    notes: string | null;
  } | null;
  files: {
    id: string;
    fileType: string;
    originalName: string;
    mimeType: string;
    byteSize: number;
    status: "available" | "missing" | "deleted";
    createdAt: string;
    isPreviewable: boolean;
  }[];
};

export type ProjectCardRow = {
  id: string;
  code: string;
  name: string;
  clientId: string | null;
  client: string;
  productionCompanyId: string | null;
  productionCompany: string;
  status: string;
  isArchived: boolean;
  archivedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  hasPreproduction: boolean;
  preproductionStartDate: string | null;
  preproductionEndDate: string | null;
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
  workspaceId?: string;
  search?: string;
  sortBy: ProjectSortField;
  sortDirection: ListSortDirection;
  includeArchived?: boolean;
};

export type ProjectDeletePreview = {
  projectId: string;
  name: string;
  status: string;
  isArchived: boolean;
  archivedAt: string | null;
  canArchive: boolean;
  canUnarchive: boolean;
  canHardDelete: boolean;
  backupWillRun: boolean;
  hardDeleteBlockedReasons: string[];
  operationalRelationSummary: {
    currentAssetCount: number;
    assignmentCount: number;
    incidentCount: number;
    packingCount: number;
    financeCount: number;
    collaboratorFeeCount: number;
  };
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

export type CatalogCrewDocumentRow = {
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

export type CatalogCrewBankAccountRow = {
  id: string;
  bankName: string;
  accountHolder: string;
  accountNumber?: string;
  accountType: string;
  routingNumber: string;
  notes: string;
  maskInPreview: boolean;
  maskedAccountNumber: string;
};

export type CatalogCrewRow = {
  id: string;
  fullName: string;
  primaryDepartmentId: string | null;
  primaryDepartment: string | null;
  documentId: string;
  roleLabel: string;
  email: string;
  phone: string;
  notes: string;
  isActive: boolean;
  linkedUserId: string | null;
  defaultDailyRate: number | null;
  defaultWeeklyRate: number | null;
  defaultOvertimeRate: number | null;
  rateCurrency: string | null;
  documents: CatalogCrewDocumentRow[];
  bankAccounts: CatalogCrewBankAccountRow[];
  activeAssignments: Array<{
    projectId: string;
    project: string;
    unitId: string | null;
    unit: string;
    departmentId: string | null;
    department: string | null;
    startDate: string | null;
    endDate: string | null;
  }>;
};

export type CatalogClientRow = {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  isActive: boolean;
  rnc: string | null;
};

export type CatalogProductionCompanyRow = {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  isActive: boolean;
  pur: string | null;
};

export type CatalogManufacturerRow = {
  id: string;
  name: string;
  contactName: string;
  supportEmail: string;
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
  quantity: number;
  totalQuantity: number;
  assignedQuantity: number;
  checkedOutQuantity: number;
  operationalStatus: string;
  custodyStatus: string;
  status: string;
  currentProjectId: string | null;
  currentProject: string | null;
  currentUnitId: string | null;
  currentUnit: string | null;
  currentDepartmentId: string | null;
  currentDepartment: string | null;
  linkedKitCount: number;
  linkedKitCodes: string[];
  linkedKitNames: string[];
};

export type CatalogKitAssetSelectionRow = {
  assetId: string;
  quantity: number;
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
  assetSelections: CatalogKitAssetSelectionRow[];
  primaryCodeValue: string;
};

export type CatalogSnapshot = {
  locations: CatalogLocationRow[];
  departments: CatalogDepartmentRow[];
  users: CatalogUserRow[];
  crewMembers: CatalogCrewRow[];
  clients: CatalogClientRow[];
  productionCompanies: CatalogProductionCompanyRow[];
  manufacturers: CatalogManufacturerRow[];
  categories: CatalogCategoryRow[];
  kits: CatalogKitRow[];
  assetOptions: CatalogAssetOptionRow[];
};

export type StagingPackingSlipRow = {
  id: string;
  number: string;
  itemCount: number;
  responsible: string;
  department: string;
  notes: string;
  updatedAt: string;
};

export type ProjectCreationConflictItem = {
  resourceId: string;
  resourceLabel: string;
  conflictingProjectId: string;
  conflictingProject: string;
  conflictingUnitId: string | null;
  conflictingUnit: string;
  conflictingDepartmentId: string | null;
  conflictingDepartment: string | null;
  overlapStart: string;
  overlapEnd: string;
};

export type ProjectCreationConflictGroup = {
  type: "crew" | "asset";
  label: string;
  items: ProjectCreationConflictItem[];
};

export type ProjectCreationConflictsSnapshot = {
  hasConflicts: boolean;
  groups: ProjectCreationConflictGroup[];
};

export type ProjectDetailAssetRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  totalQuantity: number;
  availableQuantity: number;
  assignedQuantity: number;
  checkedOutQuantity: number;
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
  assetCode: string;
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
  departmentId: string | null;
  crewMemberId: string;
  fullName: string;
  linkedUserId: string | null;
  roleLabel: string;
  startDate: string | null;
  endDate: string | null;
  notes: string;
};

export type ProjectUnitDepartmentRow = {
  departmentId: string | null;
  departmentName: string;
  crewAssignments: ProjectUnitCrewAssignmentRow[];
};

export type ProjectUnitWindowRow = {
  id: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  label: string | null;
};

export type ProjectUnitRow = {
  id: string;
  code: string;
  name: string;
  isPrimary: boolean;
  sortOrder: number;
  status: string;
  statusSource: "derived" | "manual_override";
  colorKey: string | null;
  startDate: string | null;
  endDate: string | null;
  windows: ProjectUnitWindowRow[];
  departments: string[];
  unitDepartments: ProjectUnitDepartmentRow[];
  notes: string;
  conflictCount: number;
  crewConflictCount: number;
  assetConflictCount: number;
  conflictSummary: string | null;
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
