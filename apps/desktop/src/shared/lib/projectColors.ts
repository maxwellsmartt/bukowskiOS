// Muted, premium swatch colors for the project palette keys. The keys are
// semantic (teal, amber, coral…) so each value matches its name and stays
// consistent with how a project reads elsewhere. Used as an identity cue —
// a small dot on the project's row and detail header so a non-technical user
// can tell projects apart at a glance.
const PROJECT_COLOR_HEX: Record<string, string> = {
  ice: "#9ec7e6",
  steel: "#8ea4bd",
  teal: "#5fb8ad",
  moss: "#9bb872",
  amber: "#d9b36a",
  coral: "#e08a72",
  rose: "#d98aaa",
  copper: "#cc8d5e",
  violet: "#a99cda",
  slate: "#8b93a3",
};

const DEFAULT_PROJECT_COLOR = "#8b93a3";

export const resolveProjectColor = (colorKey?: string | null): string =>
  (colorKey ? PROJECT_COLOR_HEX[colorKey] : undefined) ?? DEFAULT_PROJECT_COLOR;

type StatusTone = "success" | "info" | "warning" | "critical" | "neutral";

/**
 * Semantic tone for a project status chip so the lifecycle reads at a glance:
 * green = live, amber = getting ready / paused, grey = done/archived.
 */
export const projectStatusTone = (status: string): StatusTone => {
  switch (status) {
    case "Active":
      return "success";
    case "Prep":
    case "On hold":
    case "In review":
      return "warning";
    case "Open":
      return "info";
    case "Wrapped":
    case "Archived":
      return "neutral";
    default:
      return "neutral";
  }
};
