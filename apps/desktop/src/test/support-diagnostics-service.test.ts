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
  fs.writeFileSync(path.join(logsDirectory, "bukowski-test.log"), "support line\n", "utf8");

  try {
    const runtimeDiagnostics = createRuntimeDiagnosticsService(database);
    runtimeDiagnostics.recordRuntimeError({
      sourceKind: "webcontents",
      processLabel: "Renderer host",
      errorName: "render-process-gone",
      message: "crashed",
      severity: "critical",
    });
    runtimeDiagnostics.recordRuntimeError({
      sourceKind: "webcontents",
      processLabel: "Renderer host",
      errorName: "did-fail-load",
      message: "net::ERR_FAILED",
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

    const bundleDirectory = path.join(exportDirectory, "bundle");
    const bundleExport = supportDiagnostics.exportSupportBundle(bundleDirectory);
    expect(bundleExport.saved).toBe(true);
    expect(fs.existsSync(path.join(bundleDirectory, "support-summary.json"))).toBe(true);
    expect(fs.existsSync(path.join(bundleDirectory, "recent-logs.txt"))).toBe(true);
    expect(fs.existsSync(path.join(bundleDirectory, "runtime-errors.json"))).toBe(true);
  } finally {
    cleanup();
  }
});
