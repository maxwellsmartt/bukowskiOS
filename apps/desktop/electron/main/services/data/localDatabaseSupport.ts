import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

type SqlMigration = {
  version: string;
  sql: string;
};

const migrationTableSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`;

const escapeSqliteString = (value: string) => value.replaceAll("'", "''");

const hasMigration = (database: DatabaseSync, version: string) => {
  const row = database
    .prepare(
      `
        SELECT version
        FROM schema_migrations
        WHERE version = ?
        LIMIT 1
      `,
    )
    .get(version) as { version: string } | undefined;

  return Boolean(row);
};

const markMigrationApplied = (database: DatabaseSync, version: string) => {
  database
    .prepare(
      `
        INSERT OR REPLACE INTO schema_migrations (version, applied_at)
        VALUES (?, ?)
      `,
    )
    .run(version, new Date().toISOString());
};

export const ensureMigrationTracking = (database: DatabaseSync) => {
  database.exec(migrationTableSql);
};

export const applyTrackedSqlMigrations = (database: DatabaseSync, migrations: readonly SqlMigration[]) => {
  ensureMigrationTracking(database);

  migrations.forEach((migration) => {
    if (hasMigration(database, migration.version)) {
      return;
    }

    database.exec(migration.sql);
    markMigrationApplied(database, migration.version);
  });
};

export const applyTrackedStep = (database: DatabaseSync, version: string, step: () => void) => {
  ensureMigrationTracking(database);

  if (hasMigration(database, version)) {
    return;
  }

  step();
  markMigrationApplied(database, version);
};

export const runIntegrityChecks = (database: DatabaseSync) => {
  const integrityResult = database.prepare("PRAGMA integrity_check;").get() as Record<string, string> | undefined;
  const integrityStatus = Object.values(integrityResult ?? {})[0];

  if (integrityStatus !== "ok") {
    throw new Error(`Local database integrity check failed: ${integrityStatus ?? "unknown error"}.`);
  }

  const foreignKeyRows = database.prepare("PRAGMA foreign_key_check;").all() as Array<Record<string, unknown>>;
  if (foreignKeyRows.length > 0) {
    throw new Error("Local database foreign key check failed.");
  }
};

export const createDatabaseBackup = (database: DatabaseSync, backupPath: string) => {
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }

  database.exec(`VACUUM INTO '${escapeSqliteString(backupPath)}';`);
};

export const shouldRefreshBackup = (backupPath: string, maxAgeMs: number) => {
  if (!fs.existsSync(backupPath)) {
    return true;
  }

  const stats = fs.statSync(backupPath);
  return Date.now() - stats.mtimeMs > maxAgeMs;
};
