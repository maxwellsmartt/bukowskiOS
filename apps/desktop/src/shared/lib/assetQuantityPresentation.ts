type AssetStockBuckets = {
  availableQuantity: number;
  assignedQuantity: number;
  checkedOutQuantity: number;
  totalQuantity: number;
};

const formatCountLabel = (value: number, label: string) => `${value} ${label}`;

export const formatAssetStockInline = ({
  availableQuantity,
  assignedQuantity,
  checkedOutQuantity,
}: Pick<AssetStockBuckets, "availableQuantity" | "assignedQuantity" | "checkedOutQuantity">) => {
  const parts: string[] = [];

  if (availableQuantity > 0 || (assignedQuantity === 0 && checkedOutQuantity === 0)) {
    parts.push(formatCountLabel(availableQuantity, "available"));
  }

  if (assignedQuantity > 0) {
    parts.push(formatCountLabel(assignedQuantity, "reserved"));
  }

  if (checkedOutQuantity > 0) {
    parts.push(formatCountLabel(checkedOutQuantity, "out"));
  }

  return parts.join(" · ");
};

export const formatAssetStockDetailRows = ({
  totalQuantity,
  availableQuantity,
  assignedQuantity,
  checkedOutQuantity,
}: AssetStockBuckets) => [
  { label: "Total", value: String(totalQuantity) },
  { label: "Available", value: String(availableQuantity) },
  { label: "Reserved on project", value: String(assignedQuantity) },
  { label: "Checked out on slip", value: String(checkedOutQuantity) },
];

export const formatProjectAssignmentInline = ({
  totalQuantity,
  assignedQuantity,
  checkedOutQuantity,
}: Pick<AssetStockBuckets, "totalQuantity" | "assignedQuantity" | "checkedOutQuantity">) => {
  const parts = [`Assigned ${assignedQuantity} / ${totalQuantity}`];

  if (checkedOutQuantity > 0) {
    parts.push(`Out ${checkedOutQuantity}`);
  }

  return parts.join(" · ");
};
