type AvailabilityAsset = {
  status: string;
  quantity: number;
  assignedQuantity?: number;
  checkedOutQuantity?: number;
  linkedKitCount?: number;
  linkedKitCodes?: string[];
  project?: string;
};

export type AssetAvailability = {
  isAvailable: boolean;
  label: string;
  reason: string;
  nextAction: string;
  tone: "success" | "info" | "warning" | "critical" | "neutral";
};

const hasMeaningfulProject = (project?: string | null) => Boolean(project && project !== "—");

export const resolveAssetAvailability = (asset: AvailabilityAsset): AssetAvailability => {
  const linkedKitCodes = asset.linkedKitCodes?.filter(Boolean) ?? [];

  if ((asset.linkedKitCount ?? 0) > 0) {
    return {
      isAvailable: false,
      label: "In kit",
      reason: linkedKitCodes.length ? `In kit ${linkedKitCodes.join(", ")}.` : "Part of an active kit.",
      nextAction: "Remove from kit to use separately.",
      tone: "warning",
    };
  }

  if (asset.status === "Retired") {
    return {
      isAvailable: false,
      label: "Retired",
      reason: "Unavailable; kept for history.",
      nextAction: "Use replacement equipment.",
      tone: "critical",
    };
  }

  if (asset.status === "Maintenance") {
    return {
      isAvailable: false,
      label: "In repair",
      reason: "Out for repair.",
      nextAction: "Close repair case to return it to stock.",
      tone: "warning",
    };
  }

  if (asset.checkedOutQuantity && asset.checkedOutQuantity > 0) {
    return {
      isAvailable: false,
      label: "Checked out",
      reason: `${asset.checkedOutQuantity} checked out${hasMeaningfulProject(asset.project) ? ` on ${asset.project}` : ""}.`,
      nextAction: "Process return before reusing.",
      tone: "warning",
    };
  }

  if (asset.quantity <= 0 && asset.assignedQuantity && asset.assignedQuantity > 0) {
    return {
      isAvailable: false,
      label: "Assigned",
      reason: `${asset.assignedQuantity} reserved${hasMeaningfulProject(asset.project) ? ` for ${asset.project}` : ""}.`,
      nextAction: "Release or move the reservation first.",
      tone: "info",
    };
  }

  if (asset.quantity <= 0) {
    return {
      isAvailable: false,
      label: "No stock",
      reason: "No units available.",
      nextAction: "Wait for return or add stock.",
      tone: "neutral",
    };
  }

  return {
    isAvailable: true,
    label: "Available",
    reason: asset.quantity === 1 ? "1 unit available." : `${asset.quantity} units available.`,
    nextAction: "Ready to use.",
    tone: "success",
  };
};

const unavailableSummaryLabel: Record<string, string> = {
  Assigned: "assigned",
  "Checked out": "checked out",
  "In kit": "in kit",
  "In repair": "in repair",
  "No stock": "out of stock",
  Retired: "retired",
};

export const summarizeUnavailableAssets = (assets: AvailabilityAsset[]) => {
  const unavailable = assets.map((asset) => resolveAssetAvailability(asset)).filter((availability) => !availability.isAvailable);
  const counts = unavailable.reduce<Record<string, number>>((summary, availability) => {
    summary[availability.label] = (summary[availability.label] ?? 0) + 1;
    return summary;
  }, {});

  return Object.entries(counts)
    .map(([label, count]) => `${count} ${unavailableSummaryLabel[label] ?? label.toLowerCase()}`)
    .join(", ");
};
