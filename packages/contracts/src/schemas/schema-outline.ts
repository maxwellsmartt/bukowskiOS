export const assetEventTypes = [
  "asset_created",
  "assigned",
  "unassigned",
  "moved",
  "check_out",
  "check_in",
  "incident_reported",
  "maintenance_started",
  "maintenance_completed",
  "status_changed",
  "value_updated",
  "file_attached",
] as const;

export const financialStatuses = ["draft", "linked", "approved", "ignored"] as const;
