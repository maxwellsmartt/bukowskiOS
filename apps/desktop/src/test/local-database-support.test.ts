import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { applyTrackedSqlMigrations, createDatabaseBackup, runIntegrityChecks, shouldRefreshBackup } from "../../electron/main/services/data/localDatabaseSupport";

const tempFiles: string[] = [];

const createTempDatabase = (prefix: string) => {
  const databasePath = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random()}.sqlite`);
  tempFiles.push(databasePath);
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  return { database, databasePath };
};

afterEach(() => {
  tempFiles.forEach((filePath) => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
  tempFiles.length = 0;
});

describe("local database support", () => {
  it("tracks SQL migrations exactly once", () => {
    const { database } = createTempDatabase("bukowski-migration-tracking");

    applyTrackedSqlMigrations(database, [
      {
        version: "0001_test",
        sql: "CREATE TABLE IF NOT EXISTS example_table (id TEXT PRIMARY KEY);",
      },
    ]);
    applyTrackedSqlMigrations(database, [
      {
        version: "0001_test",
        sql: "CREATE TABLE IF NOT EXISTS example_table (id TEXT PRIMARY KEY);",
      },
    ]);

    const rows = database.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: string }>;
    expect(rows).toEqual([{ version: "0001_test" }]);
  });

  it("creates a refreshable backup and keeps integrity checks green", () => {
    const { database, databasePath } = createTempDatabase("bukowski-backup");
    const backupPath = `${databasePath}.backup`;
    tempFiles.push(backupPath);

    database.exec("CREATE TABLE sample (id TEXT PRIMARY KEY, name TEXT NOT NULL);");
    database.prepare("INSERT INTO sample (id, name) VALUES (?, ?)").run("sample-1", "Local backup");

    runIntegrityChecks(database);
    createDatabaseBackup(database, backupPath);

    expect(fs.existsSync(backupPath)).toBe(true);
    expect(shouldRefreshBackup(backupPath, 24 * 60 * 60 * 1000)).toBe(false);
    if (process.platform !== "win32") {
      expect(fs.statSync(backupPath).mode & 0o777).toBe(0o600);
    }
  });
});
