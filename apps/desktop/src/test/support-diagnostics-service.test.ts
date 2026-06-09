import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

import type { AppDiagnosticsSnapshot } from "@contracts";
import { afterEach, expect, test } from "vitest";

import { initializeDesktopLogger } from "../../electron/main/services/logger";
import { createRuntimeDiagnosticsService } from "../../electron/main/services/data/runtimeDiagnosticsService";
import { createSupportDiagnosticsService } from "../../electron/main/services/data/supportDiagnosticsService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const emptyDiagnostics: AppDiagnosticsSnapshot = {
  databaseSizeBytes: 0,
  backupSizeBytes: 0,
  databaseExists: true,
  backupExists: false,
  lastBackupAt: null,
  lastIntegrityCheckAt: null,
  lastIntegrityCheckStatus: "never",
  lastRetentionRunAt: null,
  lastRetentionSummary: null,
  lastSyncRunAt: null,
  lastSyncSummary: null,
  lastSyncStatus: "idle",
  syncOutboxPendingCount: 0,
  syncOutboxProcessingCount: 0,
  syncOutboxFailedCount: 0,
  databaseEncrypted: false,
  encryptionAvailable: false,
  internalBuildArtifacts: [],
};

const tempDirectories: string[] = [];
const assertSupportArtifactIsSafe = (text: string, leakedValues: string[]) => {
  for (const leakedValue of leakedValues) {
    expect(text).not.toContain(leakedValue);
  }

  expect(text).not.toMatch(/\/Users\/[^\s"']+/);
  expect(text).not.toMatch(/[A-Za-z]:\\Users\\/);
};

afterEach(() => {
  tempDirectories.splice(0).forEach((directoryPath) => {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  });
});

test("support diagnostics snapshot and exports include recent runtime failures and logs", () => {
  const { database, cleanup } = createTestDatabase("support-diagnostics");
  const logsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-support-logs-"));
  const exportDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-support-export-"));
  tempDirectories.push(logsDirectory, exportDirectory);
  initializeDesktopLogger(logsDirectory);
  const leakedPath = "/Users/ernestomaxwell/Secrets/workspace.sqlite";
  const leakedToken = "sk-12345678901234567890";
  const leakedJwt =
    "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyLXJlbW90ZSIsImV4cCI6OTk5OTk5OTk5OX0.signature";
  const leakedSignedUrl = "https://files.example.test/download?token=signed-url-secret-value-1234567890";
  const leakedValues = [leakedPath, leakedToken, leakedJwt, "signed-url-secret-value-1234567890"];
  fs.writeFileSync(
    path.join(logsDirectory, "bukowski-test.log"),
    `support line\npath=${leakedPath}\napiKey=${leakedToken}\njwt=${leakedJwt}\nurl=${leakedSignedUrl}\n`,
    "utf8",
  );

  try {
    const runtimeDiagnostics = createRuntimeDiagnosticsService(database);
    runtimeDiagnostics.recordRuntimeError({
      sourceKind: "webcontents",
      processLabel: "Renderer host",
      errorName: "render-process-gone",
      message: `crashed while reading ${leakedPath}`,
      severity: "critical",
    });
    runtimeDiagnostics.recordRuntimeError({
      sourceKind: "webcontents",
      processLabel: "Renderer host",
      errorName: "did-fail-load",
      message: `net::ERR_FAILED bearer=${leakedToken}`,
      severity: "medium",
    });

    const supportDiagnostics = createSupportDiagnosticsService({
      database,
      getDiagnosticsSnapshot: () => ({
        ...emptyDiagnostics,
        internalBuildArtifacts: [leakedPath],
      }),
      getAppInfo: () => ({
        appName: "bukowskiOS",
        platform: "darwin",
        isPackaged: false,
        version: "0.2.1",
        shellVersion: "Beta 2",
      }),
      runtimeDiagnostics,
    });

    const snapshot = supportDiagnostics.getSupportSnapshot();
    expect(snapshot.lastCrash?.errorName).toBe("render-process-gone");
    expect(snapshot.lastLoadFailure?.errorName).toBe("did-fail-load");
    expect(snapshot.recentCriticalEvents.length).toBeGreaterThan(0);
    expect(snapshot.recentLogFiles.length).toBeGreaterThan(0);

    const logsExportPath = path.join(exportDirectory, "recent-logs.txt");
    const logsExport = supportDiagnostics.exportRecentLogs(logsExportPath);
    expect(logsExport.saved).toBe(true);
    expect(fs.existsSync(logsExportPath)).toBe(true);
    const logsExportText = fs.readFileSync(logsExportPath, "utf8");
    assertSupportArtifactIsSafe(logsExportText, leakedValues);
    expect(logsExportText).toContain("[redacted-path]");

    const bundleDirectory = path.join(exportDirectory, "bundle");
    const bundleExport = supportDiagnostics.exportSupportBundle(bundleDirectory);
    expect(bundleExport.saved).toBe(true);
    expect(fs.existsSync(path.join(bundleDirectory, "support-summary.json"))).toBe(true);
    expect(fs.existsSync(path.join(bundleDirectory, "recent-logs.txt"))).toBe(true);
    expect(fs.existsSync(path.join(bundleDirectory, "runtime-errors.json"))).toBe(true);
    expect(fs.existsSync(path.join(bundleDirectory, "support-manifest.json"))).toBe(true);

    const bundleFileNames = fs.readdirSync(bundleDirectory).sort();
    expect(bundleFileNames).toEqual([
      "recent-logs.txt",
      "runtime-errors.json",
      "support-manifest.json",
      "support-summary.json",
    ]);

    for (const fileName of bundleFileNames) {
      assertSupportArtifactIsSafe(fs.readFileSync(path.join(bundleDirectory, fileName), "utf8"), leakedValues);
    }

    const supportSummaryText = fs.readFileSync(path.join(bundleDirectory, "support-summary.json"), "utf8");
    expect(supportSummaryText).toContain("[redacted-path]");

    const manifest = JSON.parse(fs.readFileSync(path.join(bundleDirectory, "support-manifest.json"), "utf8")) as {
      files: Array<{ name: string; sizeBytes: number; sha256: string }>;
    };
    expect(manifest.files.map((file) => file.name).sort()).toEqual([
      "recent-logs.txt",
      "runtime-errors.json",
      "support-summary.json",
    ]);
    for (const file of manifest.files) {
      const buffer = fs.readFileSync(path.join(bundleDirectory, file.name));
      expect(file.sizeBytes).toBe(buffer.byteLength);
      expect(file.sha256).toBe(crypto.createHash("sha256").update(buffer).digest("hex"));
    }
  } finally {
    cleanup();
  }
});
