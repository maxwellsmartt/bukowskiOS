import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LocalDatabaseKeyStore } from "../../electron/main/services/auth/databaseKeyStore";
import {
  createEncryptedDatabaseBackup,
  isPlaintextSqliteDatabase,
  openOrMigrateEncryptedDatabase,
} from "../../electron/main/services/data/databaseEncryption";
import { DatabaseSync, type DatabaseSyncOptions } from "../../electron/main/services/data/nodeSqliteShim";

const tempFiles: string[] = [];

const createTempPath = (prefix: string) => {
  const filePath = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random()}.sqlite`);
  tempFiles.push(filePath);
  return filePath;
};

const createInMemoryKeyStore = (): LocalDatabaseKeyStore => {
  let storedKey: Buffer | null = null;

  return {
    async getKey() {
      return storedKey ? Buffer.from(storedKey) : null;
    },
    async ensureKey() {
      if (!storedKey) {
        storedKey = Buffer.alloc(32, 7);
      }
      return Buffer.from(storedKey);
    },
    async setKey(key: Buffer) {
      storedKey = Buffer.from(key);
    },
    async clearKey() {
      storedKey = null;
    },
  };
};

const createPlaintextDatabase = (databasePath: string) => {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("CREATE TABLE sample (id TEXT PRIMARY KEY, name TEXT NOT NULL);");
  database.prepare("INSERT INTO sample (id, name) VALUES (?, ?)").run("sample-1", "Bukowski");
  database.close();
};

afterEach(() => {
  tempFiles.splice(0).forEach((filePath) => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
});

const encryptedRuntimeAvailable = (() => {
  try {
    const database = new DatabaseSync(":memory:", {
      cipher: {
        key: Buffer.alloc(32, 9),
        profile: "sqlcipher-legacy4",
      },
    } satisfies DatabaseSyncOptions);
    database.close();
    return true;
  } catch {
    return false;
  }
})();

const describeEncryption = encryptedRuntimeAvailable ? describe : describe.skip;

describeEncryption("database encryption bootstrap", () => {
  it("migrates a plaintext database in place and requires the stored key afterwards", async () => {
    const databasePath = createTempPath("bukowski-plaintext-migration");
    const keyStore = createInMemoryKeyStore();
    createPlaintextDatabase(databasePath);

    expect(isPlaintextSqliteDatabase(databasePath)).toBe(true);

    const result = await openOrMigrateEncryptedDatabase({
      databasePath,
      keyStore,
    });

    expect(result.migrationPerformed).toBe(true);
    expect(result.databaseEncrypted).toBe(true);
    expect(result.database.prepare("SELECT name FROM sample WHERE id = ?").get("sample-1")).toEqual({
      name: "Bukowski",
    });
    result.database.close();

    expect(isPlaintextSqliteDatabase(databasePath)).toBe(false);

    const plainDatabase = new DatabaseSync(databasePath);
    expect(() => plainDatabase.prepare("SELECT name FROM sample").get()).toThrow();
    plainDatabase.close();

    const reopened = await openOrMigrateEncryptedDatabase({
      databasePath,
      keyStore,
    });
    expect(reopened.migrationPerformed).toBe(false);
    expect(reopened.database.prepare("SELECT COUNT(*) AS count FROM sample").get()).toEqual({ count: 1 });
    reopened.database.close();
  });

  it("creates encrypted backups that can be reopened only with the same key", async () => {
    const databasePath = createTempPath("bukowski-encrypted-backup");
    const backupPath = createTempPath("bukowski-encrypted-backup-copy");
    const keyStore = createInMemoryKeyStore();

    const databaseResult = await openOrMigrateEncryptedDatabase({
      databasePath,
      keyStore,
    });
    databaseResult.database.exec("CREATE TABLE sample (id TEXT PRIMARY KEY, name TEXT NOT NULL);");
    databaseResult.database.prepare("INSERT INTO sample (id, name) VALUES (?, ?)").run("sample-1", "Encrypted backup");

    createEncryptedDatabaseBackup(databaseResult.database, backupPath);
    databaseResult.database.close();

    expect(isPlaintextSqliteDatabase(backupPath)).toBe(false);

    const reopenedBackup = await openOrMigrateEncryptedDatabase({
      databasePath: backupPath,
      keyStore,
    });
    expect(reopenedBackup.database.prepare("SELECT name FROM sample WHERE id = ?").get("sample-1")).toEqual({
      name: "Encrypted backup",
    });
    reopenedBackup.database.close();
  });
});
