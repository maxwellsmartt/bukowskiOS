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
  name: string;
  client: string;
  status: string;
  departments: string;
  exposure: string;
};

export type CatalogLocationRow = {
  code: string;
  name: string;
  type: string;
};

export type CatalogDepartmentRow = {
  code: string;
  name: string;
};

export type CatalogSnapshot = {
  locations: CatalogLocationRow[];
  departments: CatalogDepartmentRow[];
};
