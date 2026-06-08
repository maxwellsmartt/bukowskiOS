import type { TFunction } from "i18next";

type StatusTone = "success" | "info" | "warning" | "critical" | "neutral";

/**
 * Turns the main-process custody/status string (English, e.g. "Available",
 * "Partial assigned (1/8)", "Checked out") into a localized label plus a
 * semantic tone, so the asset table and detail show a colored status chip that
 * guides the eye — and never leaks raw English into a Spanish UI.
 */
export const presentAssetStatus = (status: string, t: TFunction): { label: string; tone: StatusTone } => {
  const partial = status.match(/^Partial\s+(assigned|checkout)\s*\((\d+\/\d+)\)$/i);
  if (partial) {
    const kind = partial[1].toLowerCase() === "assigned" ? "assigned" : "checkout";
    return { label: t(`assets.status.partial.${kind}`, { ratio: partial[2] }), tone: "warning" };
  }

  return presentAssetStatusBase(status, t);
};

/**
 * Asset condition as a localized, semantically-toned chip. "Good" stays calm
 * (neutral) so a healthy inventory doesn't shout; only worse conditions pop.
 */
export const presentAssetCondition = (condition: string, t: TFunction): { label: string; tone: StatusTone } => {
  switch (condition) {
    case "Good":
      return { label: t("assets.condition.good"), tone: "success" };
    case "Review":
      return { label: t("assets.condition.review"), tone: "warning" };
    case "Fair":
      return { label: t("assets.condition.fair"), tone: "warning" };
    case "Poor":
      return { label: t("assets.condition.poor"), tone: "critical" };
    case "Damaged":
      return { label: t("assets.condition.damaged"), tone: "critical" };
    case "Needs repair":
    case "Needs Repair":
      return { label: t("assets.condition.needsRepair"), tone: "critical" };
    default:
      return { label: condition, tone: "neutral" };
  }
};

const presentAssetStatusBase = (status: string, t: TFunction): { label: string; tone: StatusTone } => {
  switch (status) {
    case "Available":
      return { label: t("assets.status.available"), tone: "success" };
    case "Assigned":
      return { label: t("assets.status.assigned"), tone: "info" };
    case "Checked out":
      return { label: t("assets.status.checkedOut"), tone: "warning" };
    case "Split allocation":
      return { label: t("assets.status.split"), tone: "warning" };
    case "Maintenance":
      return { label: t("assets.status.maintenance"), tone: "warning" };
    case "Retired":
      return { label: t("assets.status.retired"), tone: "critical" };
    default:
      return { label: status, tone: "neutral" };
  }
};
