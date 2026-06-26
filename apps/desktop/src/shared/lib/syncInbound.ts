import type { TFunction } from "i18next";

// Operational-snapshot pull cursors are keyed by the singular entity_type
// (project, packing_slip, incident, rma_case), while the coverage tiles and
// their i18n labels use the plural family name. Bridge the two so an inbound
// error on those entities renders with a friendly name everywhere it's shown.
const COVERAGE_KEY_BY_CURSOR_ENTITY: Record<string, string> = {
  project: "projects",
  packing_slip: "packing_slips",
  incident: "incidents",
  rma_case: "rma_cases",
};

export const coverageKeyForCursor = (entityType: string): string =>
  COVERAGE_KEY_BY_CURSOR_ENTITY[entityType] ?? entityType;

const titleCaseEntity = (entityType: string): string =>
  entityType
    .split("_")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");

/** Friendly, localized label for an inbound (pull-cursor) entity type. */
export const inboundCursorLabel = (t: TFunction, entityType: string): string =>
  t(`settings.sync.coverage.${coverageKeyForCursor(entityType)}.label`, {
    defaultValue: titleCaseEntity(entityType),
  });
