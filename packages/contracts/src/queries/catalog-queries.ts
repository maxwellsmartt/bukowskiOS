import type { CatalogEntityType } from "../commands/catalog-commands";
import type {
  CatalogCategoryRow,
  CatalogClientRow,
  CatalogCrewRow,
  CatalogDepartmentRow,
  CatalogKitRow,
  CatalogLocationRow,
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
  | "email"
  | "phone"
  | "assetCount";

export type CatalogListQuery = {
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
  category: CatalogCategoryRow;
  kit: CatalogKitRow;
};
