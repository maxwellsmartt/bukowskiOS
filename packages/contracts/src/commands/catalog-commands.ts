export type CatalogEntityType = "location" | "department" | "crew" | "client" | "category" | "kit";

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
  roleLabel?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

export type CreateCatalogClientInput = {
  entityType: "client";
  name: string;
  contactName?: string;
  email?: string;
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
};

export type CreateCatalogEntityInput =
  | CreateCatalogLocationInput
  | CreateCatalogDepartmentInput
  | CreateCatalogCrewInput
  | CreateCatalogClientInput
  | CreateCatalogCategoryInput
  | CreateCatalogKitInput;

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

export type UpdateCatalogCategoryInput = CreateCatalogCategoryInput & {
  id: string;
};

export type UpdateCatalogKitInput = CreateCatalogKitInput & {
  id: string;
};

export type UpdateCatalogEntityInput =
  | UpdateCatalogLocationInput
  | UpdateCatalogDepartmentInput
  | UpdateCatalogCrewInput
  | UpdateCatalogClientInput
  | UpdateCatalogCategoryInput
  | UpdateCatalogKitInput;

export type DeleteCatalogEntityInput = {
  entityType: CatalogEntityType;
  id: string;
};
