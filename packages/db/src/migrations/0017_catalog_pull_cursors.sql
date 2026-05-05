-- Catalog pull cursors: per-workspace, per-entity-type checkpoint for inbound sync
-- (Supabase remote → local SQLite). Used by catalogPullService to know which
-- remote rows need to be applied locally on the next pass.

CREATE TABLE IF NOT EXISTS sync_pull_cursors (
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  last_synced_at TEXT,
  last_pulled_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_sync_pull_cursors_updated_at
  ON sync_pull_cursors (updated_at);

-- Ensure catalog tables expose updated_at so we can do last-write-wins reconciliation
-- with remote rows. SQLite ignores ADD COLUMN if it already exists in some forks; we
-- guard by checking the schema in a conditional pragma lookup at app boot. For
-- migrations that re-run, missing columns are appended here with sensible defaults.

ALTER TABLE locations ADD COLUMN updated_at TEXT;
ALTER TABLE asset_categories ADD COLUMN updated_at TEXT;
