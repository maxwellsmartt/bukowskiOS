import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  ArchiveSoftwareLicenseCommand,
  SetLicenseSeatsCommand,
  SoftwareLicenseMutationResult,
  SoftwareLicenseRow,
  SoftwareLicenseStatus,
  SoftwareLicenseType,
  UpsertSoftwareLicenseCommand,
} from "@contracts";

type Row = {
  id: string;
  workspace_id: string;
  software_name: string;
  vendor: string | null;
  status: string;
  license_type: string;
  seat_count: number;
  seat_assignments: string | null;
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

const parseSeats = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

const mapRow = (row: Row): SoftwareLicenseRow => ({
  id: row.id,
  workspace_id: row.workspace_id,
  software_name: row.software_name,
  vendor: row.vendor,
  status: row.status as SoftwareLicenseStatus,
  license_type: row.license_type as SoftwareLicenseType,
  seat_count: Number(row.seat_count ?? 0),
  seat_assignments: parseSeats(row.seat_assignments),
  license_key: row.license_key,
  account_email: row.account_email,
  starts_at: row.starts_at,
  expires_at: row.expires_at,
  renewal_url: row.renewal_url,
  payment_url: row.payment_url,
  invoice_url: row.invoice_url,
  reminder_days_before: Number(row.reminder_days_before ?? 0),
  notes: row.notes,
  updated_at: row.updated_at,
});

export const createSoftwareLicenseService = (db: DatabaseSync) => {
  const enqueueOutbox = (workspaceId: string, licenseId: string, operation: "upsert" | "delete") => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sync_outbox (
         id, workspace_id, entity_type, entity_id, operation_type,
         payload_json, status, attempt_count, last_error, next_retry_at,
         created_at, updated_at
       ) VALUES (?, ?, 'software_license', ?, ?, ?, 'pending', 0, NULL, ?, ?, ?)`,
    ).run(
      `sync-license-${licenseId}-${randomUUID().slice(0, 8)}`,
      workspaceId,
      licenseId,
      operation,
      JSON.stringify({ id: licenseId }),
      now,
      now,
      now,
    );
  };

  return {
    listLicenses(workspaceId: string): SoftwareLicenseRow[] {
      const rows = db
        .prepare(
          `SELECT * FROM software_licenses
             WHERE workspace_id = ? AND status <> 'archived'
             ORDER BY (expires_at IS NULL), expires_at ASC, software_name COLLATE NOCASE ASC`,
        )
        .all(workspaceId) as Row[];
      return rows.map(mapRow);
    },

    upsertLicense(input: UpsertSoftwareLicenseCommand): SoftwareLicenseMutationResult {
      const licenseId = input.licenseId?.trim() || `license-${randomUUID()}`;
      const now = new Date().toISOString();
      const existing = db
        .prepare(`SELECT created_at FROM software_licenses WHERE id = ? LIMIT 1`)
        .get(licenseId) as { created_at: string } | undefined;
      db.prepare(
        `INSERT INTO software_licenses (
           id, workspace_id, software_name, vendor, status, license_type, seat_count,
           seat_assignments, license_key, account_email, starts_at, expires_at,
           renewal_url, payment_url, invoice_url, reminder_days_before, notes,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           software_name = excluded.software_name,
           vendor = excluded.vendor,
           status = excluded.status,
           license_type = excluded.license_type,
           seat_count = excluded.seat_count,
           seat_assignments = excluded.seat_assignments,
           license_key = excluded.license_key,
           account_email = excluded.account_email,
           starts_at = excluded.starts_at,
           expires_at = excluded.expires_at,
           renewal_url = excluded.renewal_url,
           payment_url = excluded.payment_url,
           invoice_url = excluded.invoice_url,
           reminder_days_before = excluded.reminder_days_before,
           notes = excluded.notes,
           updated_at = excluded.updated_at`,
      ).run(
        licenseId,
        input.workspaceId,
        input.softwareName.trim(),
        input.vendor?.trim() || null,
        input.status,
        input.licenseType,
        Math.max(0, input.seatCount),
        JSON.stringify(input.seatAssignments ?? []),
        input.licenseKey?.trim() || null,
        input.accountEmail?.trim() || null,
        input.startsAt || null,
        input.expiresAt || null,
        input.renewalUrl?.trim() || null,
        input.paymentUrl?.trim() || null,
        input.invoiceUrl?.trim() || null,
        Math.max(0, input.reminderDaysBefore),
        input.notes?.trim() || null,
        existing?.created_at ?? now,
        now,
      );
      enqueueOutbox(input.workspaceId, licenseId, "upsert");
      return { licenseId, summary: "License saved." };
    },

    archiveLicense(input: ArchiveSoftwareLicenseCommand): SoftwareLicenseMutationResult {
      db.prepare(
        `UPDATE software_licenses SET status = 'archived', updated_at = ? WHERE id = ? AND workspace_id = ?`,
      ).run(new Date().toISOString(), input.licenseId, input.workspaceId);
      enqueueOutbox(input.workspaceId, input.licenseId, "upsert");
      return { licenseId: input.licenseId, summary: "License archived." };
    },

    setSeats(input: SetLicenseSeatsCommand): SoftwareLicenseMutationResult {
      db.prepare(
        `UPDATE software_licenses SET seat_assignments = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
      ).run(
        JSON.stringify(input.seatAssignments ?? []),
        new Date().toISOString(),
        input.licenseId,
        input.workspaceId,
      );
      enqueueOutbox(input.workspaceId, input.licenseId, "upsert");
      return { licenseId: input.licenseId, summary: "Seats updated." };
    },
  };
};

export type SoftwareLicenseService = ReturnType<typeof createSoftwareLicenseService>;
