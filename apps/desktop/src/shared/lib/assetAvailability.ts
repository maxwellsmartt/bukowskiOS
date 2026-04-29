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
      reason: linkedKitCodes.length ? `Part of active kit ${linkedKitCodes.join(", ")}.` : "Part of an active kit.",
      nextAction: "Remove it from the kit before assigning or issuing it individually.",
      tone: "warning",
    };
  }

  if (asset.status === "Retired") {
    return {
      isAvailable: false,
      label: "Retired",
      reason: "Retired assets stay in history but cannot be assigned or issued.",
      nextAction: "Use replacement equipment or review the linked incident/repair record.",
      tone: "critical",
    };
  }

  if (asset.status === "Maintenance") {
    return {
      isAvailable: false,
      label: "In repair",
      reason: "This asset is in maintenance and out of available inventory.",
      nextAction: "Open the repair case or mark it repaired before assigning it again.",
      tone: "warning",
    };
  }

  if (asset.checkedOutQuantity && asset.checkedOutQuantity > 0) {
    return {
      isAvailable: false,
      label: "Checked out",
      reason: `${asset.checkedOutQuantity} checked out${hasMeaningfulProject(asset.project) ? ` on ${asset.project}` : ""}.`,
      nextAction: "Return the asset before assigning or issuing it again.",
      tone: "warning",
    };
  }

  if (asset.quantity <= 0 && asset.assignedQuantity && asset.assignedQuantity > 0) {
    return {
      isAvailable: false,
      label: "Assigned",
      reason: `${asset.assignedQuantity} reserved${hasMeaningfulProject(asset.project) ? ` for ${asset.project}` : ""}.`,
      nextAction: "Use the existing project context or release/reassign the reservation first.",
      tone: "info",
    };
  }

  if (asset.quantity <= 0) {
    return {
      isAvailable: false,
      label: "No stock",
      reason: "There are no available units right now.",
      nextAction: "Wait for a return or add available stock before using this asset.",
      tone: "neutral",
    };
  }

  return {
    isAvailable: true,
    label: "Available",
    reason: asset.quantity === 1 ? "1 unit available." : `${asset.quantity} units available.`,
    nextAction: "Ready for assignment or packing.",
    tone: "success",
  };
};

export const summarizeUnavailableAssets = (assets: AvailabilityAsset[]) => {
  const unavailable = assets.map((asset) => resolveAssetAvailability(asset)).filter((availability) => !availability.isAvailable);
  const counts = unavailable.reduce<Record<string, number>>((summary, availability) => {
    summary[availability.label] = (summary[availability.label] ?? 0) + 1;
    return summary;
  }, {});

  return Object.entries(counts)
    .map(([label, count]) => `${count} ${label.toLowerCase()}`)
    .join(", ");
};
