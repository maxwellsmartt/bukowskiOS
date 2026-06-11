import type { CatalogEntityType } from "../commands/catalog-commands";
import type {
  CatalogCategoryRow,
  CatalogClientRow,
  CatalogCrewRow,
  CatalogDepartmentRow,
  CatalogKitRow,
  CatalogLocationRow,
  CatalogManufacturerRow,
  CatalogProductionCompanyRow,
} from "./operations-queries";
import type { ListSortDirection } from "./list-controls-queries";

export type CatalogSortField =
  | "code"
  | "name"
  | "fullName"
  | "status"
  | "type"
  | "description"
  | "roleLabel"
  | "contactName"
  | "supportEmail"
  | "email"
  | "phone"
  | "rnc"
  | "pur"
  | "assetCount";

export type CatalogListQuery = {
  workspaceId?: string;
  entityType: CatalogEntityType;
  search?: string;
  sortBy: CatalogSortField;
  sortDirection: ListSortDirection;
};

export type CatalogListRowMap = {
  location: CatalogLocationRow;
  department: CatalogDepartmentRow;
  crew: CatalogCrewRow;
  client: CatalogClientRow;
  production_company: CatalogProductionCompanyRow;
  manufacturer: CatalogManufacturerRow;
  category: CatalogCategoryRow;
  kit: CatalogKitRow;
};
