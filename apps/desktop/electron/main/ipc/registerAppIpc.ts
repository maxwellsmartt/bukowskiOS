import { app, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { ipcChannels } from "@contracts/ipc/channels";
import { assertAllowedExternalUrl, assertTrustedIpcSender, sanitizeIpcError } from "../security/securityConfig";

type RegisterAppIpcOptions = {
  database: DatabaseSync;
  getDiagnosticsSnapshot: () => import("@contracts").AppDiagnosticsSnapshot;
  getSupportSnapshot: () => import("@contracts").AppSupportSnapshot;
  createBackupNow: () => import("@contracts").AppDiagnosticsSnapshot;
  runIntegrityCheckNow: () => import("@contracts").AppDiagnosticsSnapshot;
  runLocalSyncNow: () => import("@contracts").AppDiagnosticsSnapshot;
  getSyncOutboxRows: () => import("@contracts").AppSyncOutboxRow[];
  retrySyncOutboxRow: (id: string) => import("@contracts").AppDiagnosticsSnapshot;
  retryAllFailedSyncOutboxRows: () => import("@contracts").AppDiagnosticsSnapshot;
  exportRecentLogs: (filePath: string) => import("@contracts").AppExportResult;
  exportSupportBundle: (directoryPath: string) => import("@contracts").AppExportResult;
};

const exportDatabaseJson = async (database: RegisterAppIpcOptions["database"]) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export BukowskiOS data",
    defaultPath: path.join(app.getPath("documents"), `bukowski-export-${new Date().toISOString().slice(0, 10)}.json`),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (canceled || !filePath) {
    return {
      saved: false,
      fileName: null,
      savedPath: null,
      summary: "Export cancelled.",
    };
  }

  const tables = database
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
      `,
    )
    .all() as Array<{ name: string }>;

  const payload = Object.fromEntries(
    tables.map((table) => [
      table.name,
      database.prepare(`SELECT * FROM ${table.name}`).all(),
    ]),
  );

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        tables: payload,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    saved: true,
    fileName: path.basename(filePath),
    savedPath: filePath,
    summary: `Exported workspace data to ${path.basename(filePath)}.`,
  };
};

export const registerAppIpc = ({
  database,
  getDiagnosticsSnapshot,
  getSupportSnapshot,
  createBackupNow,
  runIntegrityCheckNow,
  runLocalSyncNow,
  getSyncOutboxRows,
  retrySyncOutboxRow,
  retryAllFailedSyncOutboxRows,
  exportRecentLogs,
  exportSupportBundle,
}: RegisterAppIpcOptions) => {
  ipcMain.handle(ipcChannels.app.getInfo, (event) => {
    assertTrustedIpcSender(event);

    return {
    appName: "bukowskiOS",
    platform: process.platform,
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    shellVersion: "foundation-v1",
    };
  });
  ipcMain.handle(ipcChannels.app.getDiagnostics, (event) => {
    assertTrustedIpcSender(event);
    return getDiagnosticsSnapshot();
  });
  ipcMain.handle(ipcChannels.app.getSupportSnapshot, (event) => {
    assertTrustedIpcSender(event);
    return getSupportSnapshot();
  });
  ipcMain.handle(ipcChannels.app.createBackup, (event) => {
    try {
      assertTrustedIpcSender(event);
      return {
        summary: "Backup created successfully.",
        diagnostics: createBackupNow(),
      };
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not create a backup.");
    }
  });
  ipcMain.handle(ipcChannels.app.runIntegrityCheck, (event) => {
    try {
      assertTrustedIpcSender(event);
      return {
        summary: "Integrity check completed successfully.",
        diagnostics: runIntegrityCheckNow(),
      };
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not complete the integrity check.");
    }
  });
  ipcMain.handle(ipcChannels.app.runLocalSync, (event) => {
    try {
      assertTrustedIpcSender(event);
      return {
        summary: "Local sync pass completed.",
        diagnostics: runLocalSyncNow(),
      };
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not complete the local sync pass.");
    }
  });
  ipcMain.handle(ipcChannels.app.getSyncOutboxRows, (event) => {
    try {
      assertTrustedIpcSender(event);
      return getSyncOutboxRows();
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not load the local sync queue.");
    }
  });
  ipcMain.handle(ipcChannels.app.retrySyncOutboxRow, (event, id: string) => {
    try {
      assertTrustedIpcSender(event);
      return {
        summary: "Sync row retried locally.",
        diagnostics: retrySyncOutboxRow(id),
      };
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not retry that local sync row.");
    }
  });
  ipcMain.handle(ipcChannels.app.retryAllFailedSyncOutboxRows, (event) => {
    try {
      assertTrustedIpcSender(event);
      return {
        summary: "All failed sync rows were queued again locally.",
        diagnostics: retryAllFailedSyncOutboxRows(),
      };
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not retry the failed local sync rows.");
    }
  });
  ipcMain.handle(ipcChannels.app.exportWorkspaceData, async (event) => {
    try {
      assertTrustedIpcSender(event);
      return await exportDatabaseJson(database);
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not export local data.");
    }
  });
  ipcMain.handle(ipcChannels.app.exportRecentLogs, async (event) => {
    try {
      assertTrustedIpcSender(event);
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Export recent BukowskiOS logs",
        defaultPath: path.join(app.getPath("documents"), `bukowski-logs-${new Date().toISOString().slice(0, 10)}.txt`),
        filters: [{ name: "Text", extensions: ["txt"] }],
      });

      if (canceled || !filePath) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "Log export cancelled.",
        };
      }

      return exportRecentLogs(filePath);
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not export recent logs.");
    }
  });
  ipcMain.handle(ipcChannels.app.exportSupportBundle, async (event) => {
    try {
      assertTrustedIpcSender(event);
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: "Choose where to save the BukowskiOS support bundle",
        buttonLabel: "Save support bundle here",
        properties: ["openDirectory", "createDirectory"],
      });

      if (canceled || !filePaths[0]) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "Support bundle export cancelled.",
        };
      }

      const bundleDirectory = path.join(
        filePaths[0],
        `bukowski-support-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      );

      return exportSupportBundle(bundleDirectory);
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not export the support bundle.");
    }
  });
  ipcMain.handle(ipcChannels.app.openExternal, (event, url: string) => {
    try {
      assertTrustedIpcSender(event);
      assertAllowedExternalUrl(url);
      return shell.openExternal(url);
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not open that external link.");
    }
  });
};
