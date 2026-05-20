export type CatalogEntityType =
  | "location"
  | "department"
  | "crew"
  | "client"
  | "production_company"
  | "manufacturer"
  | "category"
  | "kit";

export type CatalogKitAssetSelectionInput = {
  assetId: string;
  quantity: number;
};

type CatalogWorkspaceInput = {
  workspaceId: string;
};

export type CreateCatalogLocationInput = {
  entityType: "location";
  code: string;
  name: string;
  locationType: string;
  description?: string;
};

export type CreateCatalogDepartmentInput = {
  entityType: "department";
  code: string;
  name: string;
  description?: string;
};

export type CreateCatalogCrewInput = {
  entityType: "crew";
  fullName: string;
  primaryDepartmentId?: string;
  linkedUserId?: string;
  documentId?: string;
  roleLabel?: string;
  email?: string;
  phone?: string;
  notes?: string;
  bankAccounts?: CatalogCrewBankAccountInput[];
};

export type UploadCrewCatalogDocumentsInput = {
  workspaceId: string;
  crewMemberId: string;
  sourceFilePaths?: string[];
};

export type CatalogCrewBankAccountInput = {
  bankName?: string;
  accountHolder?: string;
  accountNumber: string;
  accountType?: string;
  routingNumber?: string;
  notes?: string;
  maskInPreview?: boolean;
};

export type CreateCatalogClientInput = {
  entityType: "client";
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  rnc?: string;
  notes?: string;
};

export type CreateCatalogProductionCompanyInput = {
  entityType: "production_company";
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  pur?: string;
  notes?: string;
};

export type CreateCatalogManufacturerInput = {
  entityType: "manufacturer";
  name: string;
  contactName?: string;
  supportEmail?: string;
  phone?: string;
  notes?: string;
};

export type CreateCatalogCategoryInput = {
  entityType: "category";
  code: string;
  name: string;
  description?: string;
};

export type CreateCatalogKitInput = {
  entityType: "kit";
  code: string;
  name: string;
  description?: string;
  notes?: string;
  assetIds?: string[];
  assetSelections?: CatalogKitAssetSelectionInput[];
};

export type CreateCatalogEntityInput = CatalogWorkspaceInput &
  (
    | CreateCatalogLocationInput
    | CreateCatalogDepartmentInput
    | CreateCatalogCrewInput
    | CreateCatalogClientInput
    | CreateCatalogProductionCompanyInput
    | CreateCatalogManufacturerInput
    | CreateCatalogCategoryInput
    | CreateCatalogKitInput
  );

export type UpdateCatalogLocationInput = CreateCatalogLocationInput & {
  id: string;
};

export type UpdateCatalogDepartmentInput = CreateCatalogDepartmentInput & {
  id: string;
};

export type UpdateCatalogCrewInput = CreateCatalogCrewInput & {
  id: string;
};

export type UpdateCatalogClientInput = CreateCatalogClientInput & {
  id: string;
};

export type UpdateCatalogProductionCompanyInput = CreateCatalogProductionCompanyInput & {
  id: string;
};

export type UpdateCatalogManufacturerInput = CreateCatalogManufacturerInput & {
  id: string;
};

export type UpdateCatalogCategoryInput = CreateCatalogCategoryInput & {
  id: string;
};

export type UpdateCatalogKitInput = CreateCatalogKitInput & {
  id: string;
};

export type UpdateCatalogEntityInput = CatalogWorkspaceInput &
  (
    | UpdateCatalogLocationInput
    | UpdateCatalogDepartmentInput
    | UpdateCatalogCrewInput
    | UpdateCatalogClientInput
    | UpdateCatalogProductionCompanyInput
    | UpdateCatalogManufacturerInput
    | UpdateCatalogCategoryInput
    | UpdateCatalogKitInput
  );

export type DeleteCatalogEntityInput = CatalogWorkspaceInput & {
  entityType: CatalogEntityType;
  id: string;
};

export type DeleteCatalogEntitiesInput = CatalogWorkspaceInput & {
  entityType: CatalogEntityType;
  ids: string[];
};

export type CatalogCsvExportMode = "template" | "data";

export type ExportCatalogCsvInput = CatalogWorkspaceInput & {
  entityType: CatalogEntityType;
  mode: CatalogCsvExportMode;
  ids?: string[];
};

export type CatalogCsvImportStrategy = "merge" | "replace";

export type PreviewCatalogCsvImportInput = CatalogWorkspaceInput & {
  entityType: CatalogEntityType;
  csvText: string;
  strategy: CatalogCsvImportStrategy;
};

export type CatalogCsvImportError = {
  rowNumber: number;
  message: string;
  key: string | null;
};

export type CatalogCsvImportPreview = {
  entityType: CatalogEntityType;
  strategy: CatalogCsvImportStrategy;
  totalRows: number;
  created: number;
  updated: number;
  deactivated: number;
  skipped: number;
  invalid: number;
  errors: CatalogCsvImportError[];
};

export type ImportCatalogCsvInput = PreviewCatalogCsvImportInput;

export type CatalogCsvImportResult = CatalogCsvImportPreview & {
  summary: string;
};

export type CreateAppUserCommand = {
  workspaceId: string;
  fullName: string;
  email?: string;
  phone?: string;
  roleId: string;
  linkedCrewMemberId?: string;
};

export type UpdateAppUserCommand = {
  workspaceId: string;
  userId: string;
  fullName: string;
  email?: string;
  phone?: string;
  roleId: string;
  linkedCrewMemberId?: string;
};

export type SetAppUserActiveCommand = {
  workspaceId: string;
  userId: string;
  isActive: boolean;
};

export type RevokeTelegramLinkCommand = {
  workspaceId: string;
  userId: string;
};

export type DeleteAppUserCommand = {
  workspaceId: string;
  userId: string;
};
