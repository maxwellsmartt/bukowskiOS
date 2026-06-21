import type { DatabaseSync } from "node:sqlite";

import { LOCAL_FALLBACK_WORKSPACE_ID } from "@contracts";

const workspaceId = LOCAL_FALLBACK_WORKSPACE_ID;

type TableInfoRow = {
  name: string;
  notnull: number;
};

const hasRow = (db: DatabaseSync, tableName: string, id: string) => {
  if (!tableExists(db, tableName)) {
    return false;
  }

  const row = db.prepare(`SELECT id FROM ${tableName} WHERE id = ? LIMIT 1`).get(id) as { id: string } | undefined;
  return Boolean(row);
};

const tableExists = (db: DatabaseSync, tableName: string) => {
  const row = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = ?
        LIMIT 1
      `,
    )
    .get(tableName) as { name: string } | undefined;

  return Boolean(row);
};

const getTableInfo = (db: DatabaseSync, tableName: string) =>
  (db.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[]) ?? [];

const hasColumn = (db: DatabaseSync, tableName: string, columnName: string) =>
  getTableInfo(db, tableName).some((row) => row.name === columnName);

const rebuildPackingSlipsForProjectSetup = (db: DatabaseSync) => {
  const hasProjectUnitId = hasColumn(db, "packing_slips", "project_unit_id");
  const hasLifecycleState = hasColumn(db, "packing_slips", "lifecycle_state");

  db.exec(`
    CREATE TABLE packing_slips_project_setup_tmp (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      project_unit_id TEXT REFERENCES project_units(id) ON DELETE SET NULL,
      department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
      prepared_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      responsible_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'operational' CHECK (lifecycle_state IN ('operational', 'staging')),
      status TEXT NOT NULL CHECK (status IN ('Draft', 'Issued', 'Returned', 'Cancelled')),
      issue_date TEXT,
      return_due_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    INSERT INTO packing_slips_project_setup_tmp (
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
      CASE WHEN project_id IS NOT NULL AND EXISTS (SELECT 1 FROM projects WHERE projects.id = packing_slips.project_id) THEN project_id ELSE NULL END,
      ${
        hasProjectUnitId
          ? "CASE WHEN project_unit_id IS NOT NULL AND EXISTS (SELECT 1 FROM project_units WHERE project_units.id = packing_slips.project_unit_id) THEN project_unit_id ELSE NULL END"
          : "NULL"
      },
      CASE WHEN department_id IS NOT NULL AND EXISTS (SELECT 1 FROM departments WHERE departments.id = packing_slips.department_id) THEN department_id ELSE NULL END,
      CASE WHEN prepared_by_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE users.id = packing_slips.prepared_by_user_id) THEN prepared_by_user_id ELSE NULL END,
      CASE WHEN approved_by_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE users.id = packing_slips.approved_by_user_id) THEN approved_by_user_id ELSE NULL END,
      CASE WHEN responsible_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE users.id = packing_slips.responsible_user_id) THEN responsible_user_id ELSE NULL END,
      ${
        hasLifecycleState
          ? "COALESCE(lifecycle_state, 'operational')"
          : "CASE WHEN project_id IS NULL THEN 'staging' ELSE 'operational' END"
      },
      status,
      issue_date,
      return_due_date,
      notes,
      created_at,
      updated_at
    FROM packing_slips
    WHERE EXISTS (
      SELECT 1
      FROM workspaces
      WHERE workspaces.id = packing_slips.workspace_id
    );
  `);

  db.exec(`
    DROP TABLE packing_slips;
    ALTER TABLE packing_slips_project_setup_tmp RENAME TO packing_slips;
  `);
};

export const applyProjectCreationWizardFoundationMigration = (db: DatabaseSync) => {
  if (!tableExists(db, "production_companies")) {
    db.exec(`
      CREATE TABLE production_companies (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        contact_name TEXT,
        email TEXT,
        phone TEXT,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX idx_production_companies_workspace_name
        ON production_companies(workspace_id, lower(name));
    `);
  }

  if (!hasColumn(db, "projects", "production_company_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN production_company_id TEXT REFERENCES production_companies(id) ON DELETE SET NULL;");
  }

  if (!hasColumn(db, "projects", "production_company_name")) {
    db.exec("ALTER TABLE projects ADD COLUMN production_company_name TEXT;");
  }

  if (!hasColumn(db, "projects", "has_preproduction")) {
    db.exec("ALTER TABLE projects ADD COLUMN has_preproduction INTEGER NOT NULL DEFAULT 0;");
  }

  if (!hasColumn(db, "projects", "preproduction_start_date")) {
    db.exec("ALTER TABLE projects ADD COLUMN preproduction_start_date TEXT;");
  }

  if (!hasColumn(db, "projects", "preproduction_end_date")) {
    db.exec("ALTER TABLE projects ADD COLUMN preproduction_end_date TEXT;");
  }

  if (!hasColumn(db, "project_units", "is_primary")) {
    db.exec("ALTER TABLE project_units ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;");
  }

  const packingProjectInfo = getTableInfo(db, "packing_slips").find((row) => row.name === "project_id");
  const needsPackingRebuild =
    !hasColumn(db, "packing_slips", "project_unit_id") ||
    !hasColumn(db, "packing_slips", "lifecycle_state") ||
    Boolean(packingProjectInfo?.notnull);

  if (needsPackingRebuild) {
    rebuildPackingSlipsForProjectSetup(db);
  }

  db.prepare(
    `
      UPDATE project_units
      SET is_primary = 0
      WHERE is_primary IS NULL
    `,
  ).run();

  if (hasRow(db, "workspaces", workspaceId)) {
    const now = new Date().toISOString();
    db.prepare(
      `
        INSERT OR IGNORE INTO production_companies (
          id,
          workspace_id,
          name,
          contact_name,
          email,
          phone,
          notes,
          is_active,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, NULL, NULL, NULL, 'Default production company catalog seed.', 1, ?, ?)
      `,
    ).run("production-company-metadata-internal", workspaceId, "Metadata Internal", now, now);
  }
};

export const applyProjectArchiveFoundationMigration = (db: DatabaseSync) => {
  if (!hasColumn(db, "projects", "archived_at")) {
    db.exec("ALTER TABLE projects ADD COLUMN archived_at TEXT;");
  }
};

export const applyProjectUnitWindowsFoundationMigration = (db: DatabaseSync) => {
  if (!tableExists(db, "project_unit_windows")) {
    db.exec(`
      CREATE TABLE project_unit_windows (
        id TEXT PRIMARY KEY,
        project_unit_id TEXT NOT NULL REFERENCES project_units(id) ON DELETE CASCADE,
        start_date TEXT,
        end_date TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        label TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_project_unit_windows_unit_sort
        ON project_unit_windows(project_unit_id, sort_order, start_date, end_date);
    `);
  }

  db.exec(`
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
  `);
};

export const applyProjectDepartmentsMatrixFoundationMigration = (db: DatabaseSync) => {
  if (!tableExists(db, "project_departments")) {
    db.exec(`
      CREATE TABLE project_departments (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, department_id)
      );

      CREATE INDEX idx_project_departments_department
        ON project_departments(department_id, project_id);
    `);
  }

  if (!tableExists(db, "project_unit_departments")) {
    db.exec(`
      CREATE TABLE project_unit_departments (
        project_unit_id TEXT NOT NULL REFERENCES project_units(id) ON DELETE CASCADE,
        department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_unit_id, department_id)
      );

      CREATE INDEX idx_project_unit_departments_department
        ON project_unit_departments(department_id, project_unit_id);
    `);
  }

  if (!hasColumn(db, "project_unit_crew_assignments", "department_id")) {
    db.exec("ALTER TABLE project_unit_crew_assignments ADD COLUMN department_id TEXT REFERENCES departments(id) ON DELETE SET NULL;");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_unit_crew_assignments_department
      ON project_unit_crew_assignments(department_id, project_unit_id);
  `);

  const now = new Date().toISOString();

  db.exec(`
    INSERT OR IGNORE INTO project_departments (project_id, department_id, created_at)
    SELECT DISTINCT project_id, department_id, '${now}'
    FROM asset_assignments
    WHERE project_id IS NOT NULL
      AND department_id IS NOT NULL;

    INSERT OR IGNORE INTO project_departments (project_id, department_id, created_at)
    SELECT DISTINCT project_id, department_id, '${now}'
    FROM packing_slips
    WHERE project_id IS NOT NULL
      AND department_id IS NOT NULL;

    INSERT OR IGNORE INTO project_departments (project_id, department_id, created_at)
    SELECT DISTINCT project_id, department_id, '${now}'
    FROM incidents
    WHERE project_id IS NOT NULL
      AND department_id IS NOT NULL;

    INSERT OR IGNORE INTO project_unit_departments (project_unit_id, department_id, created_at)
    SELECT DISTINCT project_unit_id, department_id, '${now}'
    FROM asset_assignments
    WHERE project_unit_id IS NOT NULL
      AND department_id IS NOT NULL;

    INSERT OR IGNORE INTO project_unit_departments (project_unit_id, department_id, created_at)
    SELECT DISTINCT project_unit_id, department_id, '${now}'
    FROM packing_slips
    WHERE project_unit_id IS NOT NULL
      AND department_id IS NOT NULL;
  `);
};
