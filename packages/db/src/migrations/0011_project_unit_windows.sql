CREATE TABLE IF NOT EXISTS project_unit_windows (
  id TEXT PRIMARY KEY,
  project_unit_id TEXT NOT NULL REFERENCES project_units(id) ON DELETE CASCADE,
  start_date TEXT,
  end_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_unit_windows_unit_sort
  ON project_unit_windows(project_unit_id, sort_order, start_date, end_date);

INSERT INTO project_unit_windows (
  id,
  project_unit_id,
  start_date,
  end_date,
  sort_order,
  label,
  created_at,
  updated_at
)
SELECT
  'unit-window-' || project_units.id || '-primary',
  project_units.id,
  project_units.start_date,
  project_units.end_date,
  0,
  NULL,
  project_units.created_at,
  project_units.updated_at
FROM project_units
WHERE project_units.start_date IS NOT NULL
  AND project_units.end_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM project_unit_windows
    WHERE project_unit_windows.project_unit_id = project_units.id
  );
