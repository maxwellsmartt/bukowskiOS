-- Migration 0023: Treasury undo journal (local-only, multi-level Cmd+Z).
--
-- Carlos and Jeannette make delicate edits to imported financial data
-- (classifying movements, adjusting the DGII-deductible amount, splitting
-- expenses across projects, correcting rows, deleting import batches). This
-- table captures the BEFORE state of each reversible edit so the desktop app
-- can offer a multi-level undo. It is intentionally NOT synced — each machine
-- keeps its own local undo history; restoring re-enqueues the resulting
-- upsert/delete so the outcome still propagates through the normal sync path.

CREATE TABLE IF NOT EXISTS treasury_undo_journal (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,                 -- the mutation that produced this entry
  -- annotation | annotation_bulk | allocations | transaction_correction |
  -- account | import_delete
  kind TEXT NOT NULL,
  label TEXT NOT NULL,                       -- human description shown in the toast/button
  prior_state_json TEXT,                     -- snapshot of the rows to restore (null = none existed)
  created_at TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0,
  undone_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_treasury_undo_journal_stack
  ON treasury_undo_journal(workspace_id, undone, created_at DESC);
