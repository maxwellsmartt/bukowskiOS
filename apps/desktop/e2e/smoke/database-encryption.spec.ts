import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { launchDesktopApp } from "../helpers/electronApp";

const SQLITE_HEADER = "SQLite format 3\u0000";

const fixedDatabaseKey = Buffer.alloc(32, 31).toString("base64");

const readFileHeader = (filePath: string) => {
  const descriptor = fs.openSync(filePath, "r");

  try {
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
};

test.describe("database encryption smoke", () => {
  test("boots with an encrypted local database and creates encrypted backups", async () => {
    const app = await launchDesktopApp({
      env: {
        BUKOWSKI_E2E_DATABASE_KEY_BASE64: fixedDatabaseKey,
      },
    });

    try {
      const userDataPath = await app.getUserDataPath();
      const databasePath = path.join(userDataPath, "bukowski-foundation.sqlite");
      const backupPath = path.join(userDataPath, "bukowski-foundation.backup.sqlite");
      const diagnostics = await app.page.evaluate(() => window.bukowskiApp!.getDiagnostics());

      expect(diagnostics.databaseEncrypted).toBe(true);
      expect(fs.existsSync(databasePath)).toBe(true);
      expect(readFileHeader(databasePath)).not.toBe(SQLITE_HEADER);

      const backupResult = await app.page.evaluate(() => window.bukowskiApp!.createBackup());
      expect(backupResult.diagnostics.databaseEncrypted).toBe(true);
      expect(fs.existsSync(backupPath)).toBe(true);
      expect(readFileHeader(backupPath)).not.toBe(SQLITE_HEADER);
    } finally {
      await app.cleanup();
    }
  });

  test("recovers an encrypted database from an encrypted startup backup", async () => {
    const homePath = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-desktop-e2e-recovery-"));

    try {
      const app = await launchDesktopApp({
        cleanupHome: false,
        env: {
          BUKOWSKI_E2E_DATABASE_KEY_BASE64: fixedDatabaseKey,
        },
        homePath,
      });

      const userDataPath = await app.getUserDataPath();
      const databasePath = path.join(userDataPath, "bukowski-foundation.sqlite");
      const backupPath = path.join(userDataPath, "bukowski-foundation.backup.sqlite");

      await app.page.evaluate(() => window.bukowskiApp!.createBackup());
      await app.cleanup();

      expect(fs.existsSync(backupPath)).toBe(true);
      expect(readFileHeader(backupPath)).not.toBe(SQLITE_HEADER);

      fs.writeFileSync(databasePath, Buffer.from("not a valid sqlite database"));

      const recoveredApp = await launchDesktopApp({
        cleanupHome: false,
        env: {
          BUKOWSKI_E2E_DATABASE_KEY_BASE64: fixedDatabaseKey,
        },
        homePath,
      });

      try {
        const diagnostics = await recoveredApp.page.evaluate(() => window.bukowskiApp!.getDiagnostics());
        expect(diagnostics.databaseEncrypted).toBe(true);
        expect(readFileHeader(databasePath)).not.toBe(SQLITE_HEADER);
      } finally {
        await recoveredApp.cleanup();
      }
    } finally {
      fs.rmSync(homePath, { force: true, recursive: true });
    }
  });
});
