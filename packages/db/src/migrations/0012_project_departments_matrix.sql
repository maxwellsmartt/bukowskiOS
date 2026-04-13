CREATE TABLE IF NOT EXISTS project_departments (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, department_id)
);

CREATE TABLE IF NOT EXISTS project_unit_departments (
  project_unit_id TEXT NOT NULL REFERENCES project_units(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_unit_id, department_id)
);

ALTER TABLE project_unit_crew_assignments ADD COLUMN department_id TEXT REFERENCES departments(id);

CREATE INDEX IF NOT EXISTS idx_project_departments_department
  ON project_departments(department_id, project_id);

CREATE INDEX IF NOT EXISTS idx_project_unit_departments_department
  ON project_unit_departments(department_id, project_unit_id);

CREATE INDEX IF NOT EXISTS idx_project_unit_crew_assignments_department
  ON project_unit_crew_assignments(department_id, project_unit_id);
