CREATE TABLE IF NOT EXISTS production_companies (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_production_companies_workspace_name
  ON production_companies(workspace_id, lower(name));

ALTER TABLE projects ADD COLUMN production_company_id TEXT REFERENCES production_companies(id);
ALTER TABLE projects ADD COLUMN production_company_name TEXT;
ALTER TABLE projects ADD COLUMN has_preproduction INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN preproduction_start_date TEXT;
ALTER TABLE projects ADD COLUMN preproduction_end_date TEXT;
ALTER TABLE project_units ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS packing_slips_project_setup_next (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT REFERENCES projects(id),
  project_unit_id TEXT REFERENCES project_units(id),
  department_id TEXT REFERENCES departments(id),
  prepared_by_user_id TEXT NOT NULL REFERENCES users(id),
  approved_by_user_id TEXT REFERENCES users(id),
  responsible_user_id TEXT REFERENCES users(id),
  lifecycle_state TEXT NOT NULL DEFAULT 'operational',
  status TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  return_due_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO packing_slips_project_setup_next (
  id,
  workspace_id,
  project_id,
  project_unit_id,
  department_id,
  prepared_by_user_id,
  approved_by_user_id,
  responsible_user_id,
  lifecycle_state,
  status,
  issue_date,
  return_due_date,
  notes,
  created_at,
  updated_at
)
SELECT
  id,
  workspace_id,
  project_id,
  NULL,
  department_id,
  prepared_by_user_id,
  approved_by_user_id,
  responsible_user_id,
  'operational',
  status,
  issue_date,
  return_due_date,
  notes,
  created_at,
  updated_at
FROM packing_slips;

DROP TABLE packing_slips;
ALTER TABLE packing_slips_project_setup_next RENAME TO packing_slips;

CREATE INDEX IF NOT EXISTS idx_packing_slips_project_id
  ON packing_slips(project_id, lifecycle_state, issue_date);

CREATE INDEX IF NOT EXISTS idx_packing_slips_project_unit_id
  ON packing_slips(project_unit_id, lifecycle_state, issue_date);

PRAGMA foreign_keys = ON;
