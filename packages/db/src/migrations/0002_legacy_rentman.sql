CREATE TABLE IF NOT EXISTS legacy_rentman_imports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  source_label TEXT NOT NULL,
  source_file_name TEXT NOT NULL,
  source_row_count INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS legacy_rentman_items (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES legacy_rentman_imports(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  source_row_number INTEGER NOT NULL,
  serial_number TEXT,
  serial_identifier TEXT,
  primary_name TEXT NOT NULL,
  current_quantity INTEGER NOT NULL DEFAULT 1,
  warehouse_slot TEXT,
  has_accessories INTEGER NOT NULL DEFAULT 0,
  qr_code_value TEXT,
  folder_path TEXT,
  folder_type TEXT,
  legacy_code TEXT,
  secondary_name TEXT,
  position_type TEXT,
  external_note TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (import_id, source_row_number)
);

CREATE INDEX IF NOT EXISTS idx_legacy_rentman_items_import
  ON legacy_rentman_items(import_id, source_row_number);

CREATE TABLE IF NOT EXISTS legacy_rentman_asset_links (
  legacy_item_id TEXT PRIMARY KEY REFERENCES legacy_rentman_items(id),
  asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id),
  import_strategy TEXT NOT NULL,
  created_at TEXT NOT NULL
);
