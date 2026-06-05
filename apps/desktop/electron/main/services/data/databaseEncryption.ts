import fs from "node:fs";
import type { DatabaseSync as NativeDatabaseSync } from "node:sqlite";

import { ensurePrivateFile } from "../../security/storagePrivacy";
import type { LocalDatabaseKeyStore } from "../auth/databaseKeyStore";
import { createDatabaseBackup, runIntegrityChecks } from "./localDatabaseSupport";
import { DatabaseSync } from "./nodeSqliteShim";

const SQLITE_HEADER = "SQLite format 3\u0000";
const rollbackSuffix = ".plaintext-migration.sqlite";

const createCipherOptions = (key: Buffer) => ({
  key,
  profile: "sqlcipher-legacy4" as const,
});

const openMigrationDatabase = (databasePath: string) => {
  // Open the still-plaintext file through the cipher-capable driver with the
  // target cipher scheme configured but NO key yet. Crucially do NOT switch to
  // WAL or run other statements first: SQLCipher's `rekey` must rewrite every
  // page of a rollback-journal database, and rekeying a WAL connection fails
  // with "SQL logic error". WAL is (re)enabled by openEncryptedDatabase once
  // the database is encrypted.
  return new DatabaseSync(databasePath, {
    cipher: {
      profile: "sqlcipher-legacy4",
    },
  });
};

const openEncryptedDatabase = (databasePath: string, key: Buffer) => {
  const database = new DatabaseSync(databasePath, {
    cipher: createCipherOptions(key),
  });
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  return database;
};

const readDatabaseHeader = (databasePath: string) => {
  if (!fs.existsSync(databasePath)) {
    return null;
  }

  const descriptor = fs.openSync(databasePath, "r");

  try {
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
};

export const isPlaintextSqliteDatabase = (databasePath: string) => readDatabaseHeader(databasePath) === SQLITE_HEADER;

const migratePlaintextDatabaseInPlace = (databasePath: string, rollbackPath: string, key: Buffer) => {
  // SQLCipher's `rekey` must run on a FRESH connection that has not executed any
  // data query — integrity_check or the VACUUM-INTO backup on the same
  // connection leave it in a state where rekey fails with "SQL logic error".
  // So we use two connections: one to verify + back up, a second (untouched
  // except for the cipher config) to encrypt in place. Neither uses WAL —
  // rekey requires a rollback-journal database.
  try {
    const verifyConnection = openMigrationDatabase(databasePath);
    try {
      runIntegrityChecks(verifyConnection as unknown as NativeDatabaseSync);
      createDatabaseBackup(verifyConnection as unknown as NativeDatabaseSync, rollbackPath);
    } finally {
      verifyConnection.close();
    }

    const rekeyConnection = openMigrationDatabase(databasePath);
    try {
      rekeyConnection.rekey(key);
    } finally {
      rekeyConnection.close();
    }
  } catch (error) {
    if (fs.existsSync(rollbackPath)) {
      fs.copyFileSync(rollbackPath, databasePath);
      ensurePrivateFile(databasePath);
    }
    throw error;
  }
};

export type OpenEncryptedDatabaseResult = {
  database: DatabaseSync;
  databaseEncrypted: boolean;
  migrationPerformed: boolean;
};

export const openOrMigrateEncryptedDatabase = async ({
  databasePath,
  keyStore,
}: {
  databasePath: string;
  keyStore: LocalDatabaseKeyStore;
}): Promise<OpenEncryptedDatabaseResult> => {
  const databaseExists = fs.existsSync(databasePath);
  const startedPlaintext = databaseExists ? isPlaintextSqliteDatabase(databasePath) : false;

  const key = await keyStore.ensureKey();

  if (!databaseExists) {
    return {
      database: openEncryptedDatabase(databasePath, key),
      databaseEncrypted: true,
      migrationPerformed: false,
    };
  }

  if (!startedPlaintext) {
    return {
      database: openEncryptedDatabase(databasePath, key),
      databaseEncrypted: true,
      migrationPerformed: false,
    };
  }

  const rollbackPath = `${databasePath}${rollbackSuffix}`;
  if (fs.existsSync(rollbackPath)) {
    fs.unlinkSync(rollbackPath);
  }

  migratePlaintextDatabaseInPlace(databasePath, rollbackPath, key);

  const encryptedDatabase = openEncryptedDatabase(databasePath, key);
  const encryptedDatabaseHandle = encryptedDatabase as unknown as NativeDatabaseSync;

  try {
    runIntegrityChecks(encryptedDatabaseHandle);
  } catch (error) {
    encryptedDatabase.close();
    if (fs.existsSync(rollbackPath)) {
      fs.copyFileSync(rollbackPath, databasePath);
      ensurePrivateFile(databasePath);
    }
    throw error;
  }

  if (fs.existsSync(rollbackPath)) {
    fs.unlinkSync(rollbackPath);
  }

  return {
    database: encryptedDatabase,
    databaseEncrypted: true,
    migrationPerformed: true,
  };
};

export const createEncryptedDatabaseBackup = (database: DatabaseSync, backupPath: string) => {
  createDatabaseBackup(database as unknown as NativeDatabaseSync, backupPath);
};
