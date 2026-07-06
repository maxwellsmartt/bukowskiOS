import type { TFunction } from "i18next";

type AvailabilityAsset = {
  status: string;
  quantity: number;
  assignedQuantity?: number;
  checkedOutQuantity?: number;
  linkedKitCount?: number;
  linkedKitCodes?: string[];
  projectId?: string | null;
  project?: string;
};

export type AssetAvailability = {
  key: "inKit" | "retired" | "inRepair" | "checkedOut" | "assigned" | "noStock" | "available";
  isAvailable: boolean;
  label: string;
  reason: string;
  nextAction: string;
  values?: {
    count?: number;
    project?: string;
    kitCodes?: string;
  };
  tone: "success" | "info" | "warning" | "critical" | "neutral";
};

const hasMeaningfulProject = (project?: string | null) => Boolean(project && project !== "—");

export const resolveAssetAvailability = (asset: AvailabilityAsset): AssetAvailability => {
  const linkedKitCodes = asset.linkedKitCodes?.filter(Boolean) ?? [];

  if ((asset.linkedKitCount ?? 0) > 0) {
    return {
      key: "inKit",
      isAvailable: false,
      label: "In kit",
      reason: linkedKitCodes.length ? `In kit ${linkedKitCodes.join(", ")}.` : "Part of an active kit.",
      nextAction: "Remove from kit to use separately.",
      values: { kitCodes: linkedKitCodes.join(", ") },
      tone: "warning",
    };
  }

  if (asset.status === "Retired") {
    return {
      key: "retired",
      isAvailable: false,
      label: "Retired",
      reason: "Unavailable; kept for history.",
      nextAction: "Use replacement equipment.",
      tone: "critical",
    };
  }

  if (asset.status === "Maintenance") {
    return {
      key: "inRepair",
      isAvailable: false,
      label: "In repair",
      reason: "Out for repair.",
      nextAction: "Close repair case to return it to stock.",
      tone: "warning",
    };
  }

  if (asset.checkedOutQuantity && asset.checkedOutQuantity > 0) {
    return {
      key: "checkedOut",
      isAvailable: false,
      label: "Checked out",
      reason: `${asset.checkedOutQuantity} checked out${hasMeaningfulProject(asset.project) ? ` on ${asset.project}` : ""}.`,
      nextAction: "Process return before reusing.",
      values: { count: asset.checkedOutQuantity, project: hasMeaningfulProject(asset.project) ? asset.project : undefined },
      tone: "warning",
    };
  }

  if (asset.quantity <= 0 && asset.assignedQuantity && asset.assignedQuantity > 0) {
    return {
      key: "assigned",
      isAvailable: false,
      label: "Assigned",
      reason: `${asset.assignedQuantity} reserved${hasMeaningfulProject(asset.project) ? ` for ${asset.project}` : ""}.`,
      nextAction: "Release or move the reservation first.",
      values: { count: asset.assignedQuantity, project: hasMeaningfulProject(asset.project) ? asset.project : undefined },
      tone: "info",
    };
  }

  if (asset.quantity <= 0) {
    return {
      key: "noStock",
      isAvailable: false,
      label: "No stock",
      reason: "No units available.",
      nextAction: "Wait for return or add stock.",
      tone: "neutral",
    };
  }

  return {
    key: "available",
    isAvailable: true,
    label: "Available",
    reason: asset.quantity === 1 ? "1 unit available." : `${asset.quantity} units available.`,
    nextAction: "Ready to use.",
    values: { count: asset.quantity },
    tone: "success",
  };
};

export const resolveAssetPackingAvailability = (
  asset: AvailabilityAsset,
  projectId?: string | null,
  sourceKitId?: string | null,
): AssetAvailability => {
  if ((asset.linkedKitCount ?? 0) > 0 && sourceKitId) {
    return {
      key: "available",
      isAvailable: true,
      label: "Kit ready",
      reason: "This kit will be packed as a complete unit.",
      nextAction: "Ready to issue.",
      values: { count: asset.assignedQuantity ?? asset.quantity },
      tone: "success",
    };
  }

  const baseAvailability = resolveAssetAvailability(asset);
  if (baseAvailability.key === "retired" || baseAvailability.key === "inRepair" || baseAvailability.key === "checkedOut") {
    return baseAvailability;
  }

  const assignedQuantity = asset.assignedQuantity ?? 0;
  const isReservedForSelectedProject = Boolean(projectId && asset.projectId === projectId && assignedQuantity > 0);

  if (isReservedForSelectedProject && !asset.checkedOutQuantity) {
    return {
      key: "available",
      isAvailable: true,
      label: "Reserved for project",
      reason: "Reserved for this project and ready to issue on a packing slip.",
      nextAction: "Ready to issue.",
      values: { count: assignedQuantity },
      tone: "success",
    };
  }

  if (projectId && asset.projectId && asset.projectId !== projectId && assignedQuantity > 0) {
    return {
      key: "assigned",
      isAvailable: false,
      label: "Assigned",
      reason: `${assignedQuantity} reserved${hasMeaningfulProject(asset.project) ? ` for ${asset.project}` : " for another project"}.`,
      nextAction: "Move the reservation before issuing this packing slip.",
      values: { count: assignedQuantity, project: hasMeaningfulProject(asset.project) ? asset.project : undefined },
      tone: "info",
    };
  }

  return baseAvailability;
};

export const translateAssetAvailabilityLabel = (availability: AssetAvailability, t: TFunction) =>
  t(`assets.availability.${availability.key}.label`, { defaultValue: availability.label });

export const translateAssetAvailabilityReason = (availability: AssetAvailability, t: TFunction) => {
  const reasonKey =
    availability.key === "inKit" && availability.values?.kitCodes
      ? "reasonWithKit"
      : (availability.key === "checkedOut" || availability.key === "assigned") && availability.values?.project
        ? "reasonWithProject"
        : "reason";

  return t(`assets.availability.${availability.key}.${reasonKey}`, {
    count: availability.values?.count ?? 0,
    defaultValue: availability.reason,
    kitCodes: availability.values?.kitCodes,
    project: availability.values?.project,
  });
};

export const translateAssetAvailabilityNextAction = (availability: AssetAvailability, t: TFunction) =>
  t(`assets.availability.${availability.key}.nextAction`, { defaultValue: availability.nextAction });

const unavailableSummaryLabel: Record<string, string> = {
  assigned: "assigned",
  checkedOut: "checked out",
  inKit: "in kit",
  inRepair: "in repair",
  noStock: "out of stock",
  retired: "retired",
};

export const summarizeUnavailableAssets = (assets: AvailabilityAsset[], t?: TFunction) => {
  const unavailable = assets.map((asset) => resolveAssetAvailability(asset)).filter((availability) => !availability.isAvailable);
  const counts = unavailable.reduce<Record<string, number>>((summary, availability) => {
    summary[availability.key] = (summary[availability.key] ?? 0) + 1;
    return summary;
  }, {});

  return Object.entries(counts)
    .map(([key, count]) =>
      t
        ? t(`assets.availability.summary.${key}`, { count })
        : `${count} ${unavailableSummaryLabel[key] ?? key.toLowerCase()}`,
    )
    .join(", ");
};
