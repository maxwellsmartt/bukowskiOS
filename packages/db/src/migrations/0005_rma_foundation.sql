CREATE TABLE IF NOT EXISTS manufacturers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  contact_name TEXT,
  support_email TEXT,
  phone TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS rma_cases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  manufacturer_id TEXT NOT NULL REFERENCES manufacturers(id),
  title TEXT NOT NULL,
  support_email TEXT,
  problem_summary TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rma_cases_status_updated
  ON rma_cases(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS rma_case_assets (
  id TEXT PRIMARY KEY,
  rma_case_id TEXT NOT NULL REFERENCES rma_cases(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  equipment_year TEXT,
  issue_summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (rma_case_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_rma_case_assets_case
  ON rma_case_assets(rma_case_id, asset_id);
