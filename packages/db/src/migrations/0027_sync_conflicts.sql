-- Sync conflicts: per-device review queue for divergent edits on sensitive
-- entities. A conflict is recorded when an inbound remote change arrives for an
-- entity that still has an unpushed local change (a pending sync_outbox row).
-- Instead of silently dropping the remote update (last-writer-wins), the pull
-- captures both snapshots here so a human can choose which one to keep.
-- Local-only: a conflict is inherently per-device and never pushed remotely.

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  local_updated_at TEXT,
  remote_updated_at TEXT,
  local_snapshot_json TEXT,
  remote_snapshot_json TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

-- Only one open conflict per (workspace, entity) at a time; re-detection upserts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_conflicts_open_entity
  ON sync_conflicts (workspace_id, entity_type, entity_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_workspace_status
  ON sync_conflicts (workspace_id, status);
