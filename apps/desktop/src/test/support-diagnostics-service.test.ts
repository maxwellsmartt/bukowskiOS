import fs from "node:fs";
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
  fs.writeFileSync(
    path.join(logsDirectory, "bukowski-test.log"),
    `support line\npath=${leakedPath}\napiKey=${leakedToken}\n`,
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
      getDiagnosticsSnapshot: () => emptyDiagnostics,
      getAppInfo: () => ({
        appName: "bukowskiOS",
        platform: "darwin",
        isPackaged: false,
        version: "0.1.0",
        shellVersion: "foundation-v1",
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
    expect(logsExportText).not.toContain(leakedPath);
    expect(logsExportText).not.toContain(leakedToken);
    expect(logsExportText).toContain("[redacted-path]");

    const bundleDirectory = path.join(exportDirectory, "bundle");
    const bundleExport = supportDiagnostics.exportSupportBundle(bundleDirectory);
    expect(bundleExport.saved).toBe(true);
    expect(fs.existsSync(path.join(bundleDirectory, "support-summary.json"))).toBe(true);
    expect(fs.existsSync(path.join(bundleDirectory, "recent-logs.txt"))).toBe(true);
    expect(fs.existsSync(path.join(bundleDirectory, "runtime-errors.json"))).toBe(true);

    const supportSummaryText = fs.readFileSync(path.join(bundleDirectory, "support-summary.json"), "utf8");
    const runtimeErrorsText = fs.readFileSync(path.join(bundleDirectory, "runtime-errors.json"), "utf8");
    expect(supportSummaryText).not.toContain(leakedPath);
    expect(supportSummaryText).not.toContain(leakedToken);
    expect(runtimeErrorsText).not.toContain(leakedPath);
    expect(runtimeErrorsText).not.toContain(leakedToken);
    expect(supportSummaryText).toContain("[redacted-path]");
  } finally {
    cleanup();
  }
});
