PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_system_role INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  status TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission_id TEXT NOT NULL REFERENCES permissions(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  client_name TEXT,
  status TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS asset_categories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  parent_category_id TEXT REFERENCES asset_categories(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  category_id TEXT NOT NULL REFERENCES asset_categories(id),
  name TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  internal_code TEXT NOT NULL,
  description TEXT,
  purchase_date TEXT,
  purchase_price REAL,
  currency TEXT,
  replacement_value REAL,
  current_book_value REAL,
  ownership_type TEXT,
  default_location_id TEXT REFERENCES locations(id),
  qr_code_value TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, internal_code)
);

CREATE TABLE IF NOT EXISTS asset_files (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  file_type TEXT NOT NULL,
  file_url TEXT,
  external_url TEXT,
  label TEXT,
  uploaded_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_assignments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  project_id TEXT REFERENCES projects(id),
  department_id TEXT REFERENCES departments(id),
  assigned_to_user_id TEXT REFERENCES users(id),
  assigned_by_user_id TEXT NOT NULL REFERENCES users(id),
  source_location_id TEXT REFERENCES locations(id),
  target_location_id TEXT REFERENCES locations(id),
  assignment_status TEXT NOT NULL,
  checked_out_at TEXT,
  expected_return_at TEXT,
  returned_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  assignment_id TEXT REFERENCES asset_assignments(id),
  project_id TEXT REFERENCES projects(id),
  department_id TEXT REFERENCES departments(id),
  performed_by_user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  location_id TEXT REFERENCES locations(id),
  from_location_id TEXT REFERENCES locations(id),
  to_location_id TEXT REFERENCES locations(id),
  event_timestamp TEXT NOT NULL,
  command_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  source_channel TEXT NOT NULL,
  notes TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_asset_events_asset_time
  ON asset_events(workspace_id, asset_id, event_timestamp);

CREATE TABLE IF NOT EXISTS asset_current_state (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  current_location_id TEXT REFERENCES locations(id),
  current_project_id TEXT REFERENCES projects(id),
  current_department_id TEXT REFERENCES departments(id),
  current_responsible_user_id TEXT REFERENCES users(id),
  active_assignment_id TEXT REFERENCES asset_assignments(id),
  condition_status TEXT NOT NULL,
  operational_status TEXT NOT NULL,
  custody_status TEXT NOT NULL,
  last_event_id TEXT NOT NULL REFERENCES asset_events(id),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packing_slips (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  department_id TEXT REFERENCES departments(id),
  prepared_by_user_id TEXT NOT NULL REFERENCES users(id),
  approved_by_user_id TEXT REFERENCES users(id),
  responsible_user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  return_due_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packing_slip_items (
  id TEXT PRIMARY KEY,
  packing_slip_id TEXT NOT NULL REFERENCES packing_slips(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  condition_out TEXT,
  condition_in TEXT,
  returned_at TEXT,
  notes TEXT,
  UNIQUE (packing_slip_id, asset_id)
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  asset_id TEXT REFERENCES assets(id),
  project_id TEXT REFERENCES projects(id),
  department_id TEXT REFERENCES departments(id),
  assignment_id TEXT REFERENCES asset_assignments(id),
  reported_by_user_id TEXT NOT NULL REFERENCES users(id),
  incident_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  resolved_at TEXT,
  responsible_user_id TEXT REFERENCES users(id),
  cost_estimate REAL,
  currency TEXT,
  financial_status TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incident_files (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL,
  uploaded_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS financial_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  entry_type TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  exchange_rate REAL,
  base_currency_amount REAL,
  status TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  asset_id TEXT REFERENCES assets(id),
  incident_id TEXT REFERENCES incidents(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  entry_date TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collaborator_fees (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT REFERENCES projects(id),
  department_id TEXT REFERENCES departments(id),
  fee_type TEXT NOT NULL,
  agreed_amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS command_receipts (
  command_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  actor_user_id TEXT REFERENCES users(id),
  actor_type TEXT NOT NULL,
  source_channel TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  outcome_status TEXT NOT NULL,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_id TEXT REFERENCES asset_events(id),
  operation_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_retry
  ON sync_outbox(status, next_retry_at);
