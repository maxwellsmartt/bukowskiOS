import { app, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  createAppUserSchema,
  emptyReadArgsSchema,
  revokeTelegramLinkSchema,
  setAppUserActiveSchema,
  updateAppUserSchema,
} from "@contracts";
import { ipcChannels } from "@contracts/ipc/channels";
import { assertAllowedExternalUrl, assertTrustedIpcSender, sanitizeIpcError } from "../security/securityConfig";
import { safeHandleReadWithSchema } from "./ipcSafeHandler";

type RegisterAppIpcOptions = {
  database: DatabaseSync;
  getDiagnosticsSnapshot: () => import("@contracts").AppDiagnosticsSnapshot;
  getSupportSnapshot: () => import("@contracts").AppSupportSnapshot;
  getUsersSnapshot: () => import("@contracts").AppUsersSnapshot;
  createUser: (input: import("@contracts").CreateAppUserCommand) => import("@contracts").AppUserMutationResult;
  updateUser: (input: import("@contracts").UpdateAppUserCommand) => import("@contracts").AppUserMutationResult;
  setUserActive: (input: import("@contracts").SetAppUserActiveCommand) => import("@contracts").AppUserMutationResult;
  revokeTelegramLink: (input: import("@contracts").RevokeTelegramLinkCommand) => import("@contracts").AppUserMutationResult;
  createBackupNow: () => import("@contracts").AppDiagnosticsSnapshot;
  runIntegrityCheckNow: () => import("@contracts").AppDiagnosticsSnapshot;
  runLocalSyncNow: () => Promise<import("@contracts").AppDiagnosticsSnapshot>;
  getSyncOutboxRows: () => import("@contracts").AppSyncOutboxRow[];
  retrySyncOutboxRow: (id: string) => Promise<import("@contracts").AppDiagnosticsSnapshot>;
  retryAllFailedSyncOutboxRows: () => Promise<import("@contracts").AppDiagnosticsSnapshot>;
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
  getUsersSnapshot,
  createUser,
  updateUser,
  setUserActive,
  revokeTelegramLink,
  createBackupNow,
  runIntegrityCheckNow,
  runLocalSyncNow,
  getSyncOutboxRows,
  retrySyncOutboxRow,
  retryAllFailedSyncOutboxRows,
  exportRecentLogs,
  exportSupportBundle,
}: RegisterAppIpcOptions) => {
  safeHandleReadWithSchema(ipcChannels.app.getInfo, emptyReadArgsSchema, () => ({
    appName: "bukowskiOS",
    platform: process.platform,
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    shellVersion: "foundation-v1",
  }));
  safeHandleReadWithSchema(ipcChannels.app.getDiagnostics, emptyReadArgsSchema, () => getDiagnosticsSnapshot());
  safeHandleReadWithSchema(ipcChannels.app.getSupportSnapshot, emptyReadArgsSchema, () => getSupportSnapshot());
  safeHandleReadWithSchema(ipcChannels.app.getUsersSnapshot, emptyReadArgsSchema, () => getUsersSnapshot());
  ipcMain.handle(ipcChannels.app.createUser, (event, input) => {
    try {
      assertTrustedIpcSender(event);
      const parsed = createAppUserSchema.parse(input);
      return createUser(parsed);
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not create that user.");
    }
  });
  ipcMain.handle(ipcChannels.app.updateUser, (event, input) => {
    try {
      assertTrustedIpcSender(event);
      const parsed = updateAppUserSchema.parse(input);
      return updateUser(parsed);
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not update that user.");
    }
  });
  ipcMain.handle(ipcChannels.app.setUserActive, (event, input) => {
    try {
      assertTrustedIpcSender(event);
      const parsed = setAppUserActiveSchema.parse(input);
      return setUserActive(parsed);
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not change that user state.");
    }
  });
  ipcMain.handle(ipcChannels.app.revokeTelegramLink, (event, input) => {
    try {
      assertTrustedIpcSender(event);
      const parsed = revokeTelegramLinkSchema.parse(input);
      return revokeTelegramLink(parsed);
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not revoke Telegram access for that user.");
    }
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
  ipcMain.handle(ipcChannels.app.runLocalSync, async (event) => {
    try {
      assertTrustedIpcSender(event);
      return {
        summary: "Local sync pass completed.",
        diagnostics: await runLocalSyncNow(),
      };
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not complete the local sync pass.");
    }
  });
  safeHandleReadWithSchema(
    ipcChannels.app.getSyncOutboxRows,
    emptyReadArgsSchema,
    () => getSyncOutboxRows(),
    "The app could not load the local sync queue.",
  );
  ipcMain.handle(ipcChannels.app.retrySyncOutboxRow, async (event, id: string) => {
    try {
      assertTrustedIpcSender(event);
      return {
        summary: "Sync row retried locally.",
        diagnostics: await retrySyncOutboxRow(id),
      };
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not retry that local sync row.");
    }
  });
  ipcMain.handle(ipcChannels.app.retryAllFailedSyncOutboxRows, async (event) => {
    try {
      assertTrustedIpcSender(event);
      return {
        summary: "All failed sync rows were queued again locally.",
        diagnostics: await retryAllFailedSyncOutboxRows(),
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
