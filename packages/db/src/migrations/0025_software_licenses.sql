-- Migration 0025: Software licenses — local-first mirror.
--
-- Licenses were cloud-only (the page read/wrote Supabase directly), so they
-- vanished on machines running in local-first/offline mode. This local table
-- + the sync wiring brings them in line with every other entity: writes go to
-- SQLite and enqueue sync_outbox; the pull brings remote changes down.
--
-- Mirrors public.software_licenses; `seat_assignments` is stored as a JSON
-- text array (jsonb in Supabase).

CREATE TABLE IF NOT EXISTS software_licenses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  software_name TEXT NOT NULL,
  vendor TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  license_type TEXT NOT NULL DEFAULT 'subscription',
  seat_count INTEGER NOT NULL DEFAULT 1,
  seat_assignments TEXT NOT NULL DEFAULT '[]',
  license_key TEXT,
  account_email TEXT,
  starts_at TEXT,
  expires_at TEXT,
  renewal_url TEXT,
  payment_url TEXT,
  invoice_url TEXT,
  reminder_days_before INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_software_licenses_workspace
  ON software_licenses(workspace_id, status);
