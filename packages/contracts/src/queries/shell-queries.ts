export type ShellBootstrap = {
  workspaceName: string;
  projectScope: string;
  syncLabel: string;
};

export type ShellAppAction =
  | {
      type: "open-search";
    }
  | {
      type: "navigate";
      path: string;
    };

export type GlobalSearchEntityType = "asset" | "project" | "project_unit" | "packing_slip" | "incident" | "financial_entry";

export type GlobalSearchQuery = {
  query: string;
  recentEntityKeys?: string[];
  limit?: number;
};

export type GlobalSearchResult = {
  entityType: GlobalSearchEntityType;
  entityId: string;
  title: string;
  subtitle: string;
  meta?: string;
  navigationPath: string;
  recent: boolean;
};

export type GlobalSearchGroup = {
  entityType: GlobalSearchEntityType;
  label: string;
  results: GlobalSearchResult[];
};
