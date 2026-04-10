export type CompareEntityType = "asset" | "project" | "financial_entry";

export type CompareItem = {
  id: string;
  entityType: CompareEntityType;
  label: string;
  subtitle: string;
  meta?: string;
  colorKey?: string | null;
};

export type CompareTrayGroup = {
  entityType: CompareEntityType;
  itemIds: string[];
  count: number;
  comparable: boolean;
};

export type CompareTrayState = {
  items: CompareItem[];
  groups: CompareTrayGroup[];
  activeComparableType: CompareEntityType | null;
  disabledReason: string | null;
};
