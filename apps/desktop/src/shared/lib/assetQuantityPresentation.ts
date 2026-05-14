import type { TFunction } from "i18next";

type AssetStockBuckets = {
  availableQuantity: number;
  assignedQuantity: number;
  checkedOutQuantity: number;
  totalQuantity: number;
};

const formatCountLabel = (value: number, label: string) => `${value} ${label}`;
const stockLabel = (t: TFunction | undefined, key: string, fallback: string, values: Record<string, unknown> = {}) =>
  t ? t(`assets.stock.${key}`, { ...values, defaultValue: fallback }) : fallback;

export const formatAssetStockInline = ({
  availableQuantity,
  assignedQuantity,
  checkedOutQuantity,
}: Pick<AssetStockBuckets, "availableQuantity" | "assignedQuantity" | "checkedOutQuantity">, t?: TFunction) => {
  const parts: string[] = [];

  if (availableQuantity > 0 || (assignedQuantity === 0 && checkedOutQuantity === 0)) {
    parts.push(formatCountLabel(availableQuantity, stockLabel(t, "available", "available", { count: availableQuantity })));
  }

  if (assignedQuantity > 0) {
    parts.push(formatCountLabel(assignedQuantity, stockLabel(t, "reserved", "reserved", { count: assignedQuantity })));
  }

  if (checkedOutQuantity > 0) {
    parts.push(formatCountLabel(checkedOutQuantity, stockLabel(t, "out", "out", { count: checkedOutQuantity })));
  }

  return parts.join(" · ");
};

export const formatAssetStockDetailRows = ({
  totalQuantity,
  availableQuantity,
  assignedQuantity,
  checkedOutQuantity,
}: AssetStockBuckets, t?: TFunction) => [
  { label: stockLabel(t, "total", "Total"), value: String(totalQuantity) },
  { label: stockLabel(t, "availableLabel", "Available"), value: String(availableQuantity) },
  { label: stockLabel(t, "reservedOnProject", "Reserved on project"), value: String(assignedQuantity) },
  { label: stockLabel(t, "checkedOutOnSlip", "Checked out on slip"), value: String(checkedOutQuantity) },
];

export const formatProjectAssignmentInline = ({
  totalQuantity,
  assignedQuantity,
  checkedOutQuantity,
}: Pick<AssetStockBuckets, "totalQuantity" | "assignedQuantity" | "checkedOutQuantity">, t?: TFunction) => {
  const parts = [stockLabel(t, "assignedRatio", `Assigned ${assignedQuantity} / ${totalQuantity}`, { count: assignedQuantity, total: totalQuantity })];

  if (checkedOutQuantity > 0) {
    parts.push(stockLabel(t, "outCount", `Out ${checkedOutQuantity}`, { count: checkedOutQuantity }));
  }

  return parts.join(" · ");
};
