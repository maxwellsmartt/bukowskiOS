CREATE TABLE IF NOT EXISTS project_units (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  status_source TEXT NOT NULL DEFAULT 'derived',
  color_key TEXT,
  start_date TEXT,
  end_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, code)
);

CREATE INDEX IF NOT EXISTS idx_project_units_project_sort
  ON project_units(project_id, sort_order, start_date, name);

CREATE TABLE IF NOT EXISTS project_unit_crew_assignments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_unit_id TEXT NOT NULL REFERENCES project_units(id),
  crew_member_id TEXT NOT NULL REFERENCES crew_members(id),
  role_label TEXT,
  start_date TEXT,
  end_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_unit_crew_assignments_unit
  ON project_unit_crew_assignments(project_unit_id, crew_member_id);
