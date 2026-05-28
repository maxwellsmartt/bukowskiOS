export type SoftwareLicenseStatus = "active" | "expiring" | "expired" | "permanent" | "archived";
export type SoftwareLicenseType =
  | "subscription"
  | "perpetual"
  | "trial"
  | "usage_based"
  | "web_service"
  | "other";

/**
 * Row shape returned by the licenses read service. Kept in snake_case to match
 * the columns and the existing UI (the page was previously reading Supabase
 * rows directly), so moving to local-first didn't require re-shaping the view.
 */
export type SoftwareLicenseRow = {
  id: string;
  workspace_id: string;
  software_name: string;
  vendor: string | null;
  status: SoftwareLicenseStatus;
  license_type: SoftwareLicenseType;
  seat_count: number;
  seat_assignments: string[];
  license_key: string | null;
  account_email: string | null;
  starts_at: string | null;
  expires_at: string | null;
  renewal_url: string | null;
  payment_url: string | null;
  invoice_url: string | null;
  reminder_days_before: number;
  notes: string | null;
  updated_at: string;
};

export type UpsertSoftwareLicenseCommand = {
  workspaceId: string;
  /** Omit/null to create; pass an id to update. */
  licenseId?: string | null;
  softwareName: string;
  vendor?: string | null;
  status: SoftwareLicenseStatus;
  licenseType: SoftwareLicenseType;
  seatCount: number;
  seatAssignments: string[];
  licenseKey?: string | null;
  accountEmail?: string | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  renewalUrl?: string | null;
  paymentUrl?: string | null;
  invoiceUrl?: string | null;
  reminderDaysBefore: number;
  notes?: string | null;
};

export type ArchiveSoftwareLicenseCommand = {
  workspaceId: string;
  licenseId: string;
};

export type SetLicenseSeatsCommand = {
  workspaceId: string;
  licenseId: string;
  seatAssignments: string[];
};

export type SoftwareLicenseMutationResult = {
  licenseId: string;
  summary: string;
};
