import type { DatabaseSync } from "node:sqlite";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

type TableInfoRow = {
  name: string;
  notnull: number;
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
      project_id,
      ${hasProjectUnitId ? "project_unit_id" : "NULL"},
      department_id,
      prepared_by_user_id,
      approved_by_user_id,
      responsible_user_id,
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
    FROM packing_slips;
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
};
