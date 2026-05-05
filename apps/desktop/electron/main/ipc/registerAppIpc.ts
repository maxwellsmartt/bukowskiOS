import { app, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import {
  appUsersSnapshotReadArgsSchema,
  createAppUserSchema,
  deleteAppUserSchema,
  emptyReadArgsSchema,
  revokeTelegramLinkSchema,
  setAppUserActiveSchema,
  updateAppUserSchema,
} from "@contracts";
import { ipcChannels } from "@contracts/ipc/channels";
import { assertAllowedExternalUrl, assertTrustedIpcSender, sanitizeIpcError } from "../security/securityConfig";
import { safeHandle, safeHandleReadWithSchema } from "./ipcSafeHandler";

type RegisterAppIpcOptions = {
  database: DatabaseSync;
  getDiagnosticsSnapshot: () => import("@contracts").AppDiagnosticsSnapshot;
  getSupportSnapshot: () => import("@contracts").AppSupportSnapshot;
  getUsersSnapshot: (query?: import("@contracts").AppUsersSnapshotQuery) => import("@contracts").AppUsersSnapshot;
  createUser: (input: import("@contracts").CreateAppUserCommand) => import("@contracts").AppUserMutationResult;
  updateUser: (input: import("@contracts").UpdateAppUserCommand) => import("@contracts").AppUserMutationResult;
  setUserActive: (input: import("@contracts").SetAppUserActiveCommand) => import("@contracts").AppUserMutationResult;
  revokeTelegramLink: (input: import("@contracts").RevokeTelegramLinkCommand) => import("@contracts").AppUserMutationResult;
  deleteUser: (input: import("@contracts").DeleteAppUserCommand) => import("@contracts").AppUserMutationResult;
  createBackupNow: () => import("@contracts").AppDiagnosticsSnapshot;
  runIntegrityCheckNow: () => import("@contracts").AppDiagnosticsSnapshot;
  ensureLocalWorkspaces: (workspaces: import("@contracts").EnsureLocalWorkspaceInput[]) => import("@contracts").AppDiagnosticsSnapshot;
  getLocalWorkspaces: () => import("@contracts").AppLocalWorkspaceRow[];
  runLocalSyncNow: () => Promise<import("@contracts").AppDiagnosticsSnapshot>;
  getSyncOutboxRows: () => import("@contracts").AppSyncOutboxRow[];
  getSyncPullCursors: () => import("@contracts").AppSyncPullCursorRow[];
  retrySyncOutboxRow: (id: string) => Promise<import("@contracts").AppDiagnosticsSnapshot>;
  retryAllFailedSyncOutboxRows: () => Promise<import("@contracts").AppDiagnosticsSnapshot>;
  exportRecentLogs: (filePath: string) => import("@contracts").AppExportResult;
  exportSupportBundle: (directoryPath: string) => import("@contracts").AppExportResult;
  applyRemoteCatalogRows: (
    input: import("@contracts").AppApplyRemoteCatalogRowsCommand,
  ) => import("@contracts").AppApplyRemoteCatalogRowsResult;
  applyRemoteExchangeRates: (
    input: import("@contracts").AppApplyRemoteExchangeRatesCommand,
  ) => import("@contracts").AppApplyRemoteExchangeRatesResult;
  applyRemoteAssetSnapshots: (
    input: import("@contracts").AppApplyRemoteAssetSnapshotsCommand,
  ) => import("@contracts").AppApplyRemoteAssetSnapshotsResult;
};

const applyRemoteCatalogRowsSchema = z.object({
  workspaceId: z.string().trim().min(1),
  entityType: z.enum(["asset_categories", "locations", "clients", "manufacturers", "production_companies"]),
  rows: z.array(
    z.object({
      id: z.string().trim().min(1),
      workspace_id: z.string().trim().min(1),
      code: z.string().trim().min(1),
      name: z.string().trim().min(1),
      description: z.string().nullable().optional(),
      parent_category_id: z.string().nullable().optional(),
      type: z.string().nullable().optional(),
      is_active: z.boolean().nullable().optional(),
      updated_at: z.string().min(1),
    }),
  ),
});

const applyRemoteExchangeRatesSchema = z.object({
  workspaceId: z.string().trim().min(1),
  rows: z.array(
    z.object({
      id: z.string().trim().min(1),
      workspace_id: z.string().trim().min(1),
      base_currency: z.string().trim().min(2).max(8),
      quote_currency: z.string().trim().min(2).max(8),
      rate: z.number().finite().positive(),
      rate_type: z.string().trim().min(1),
      source: z.string().trim().min(1),
      source_label: z.string().nullable().optional(),
      effective_date: z.string().trim().min(1),
      fetched_at: z.string().nullable().optional(),
      created_by_user_id: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      created_at: z.string().trim().min(1),
      updated_at: z.string().trim().min(1).optional(),
    }),
  ),
});

const applyRemoteAssetSnapshotsSchema = z.object({
  workspaceId: z.string().trim().min(1),
  assets: z.array(
    z.object({
      id: z.string().trim().min(1),
      workspace_id: z.string().trim().min(1),
      category_id: z.string().trim().min(1),
      name: z.string().trim().min(1),
      brand: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
      serial_number: z.string().nullable().optional(),
      internal_code: z.string().trim().min(1),
      description: z.string().nullable().optional(),
      purchase_date: z.string().nullable().optional(),
      purchase_price: z.number().nullable().optional(),
      additional_costs: z.number().nullable().optional(),
      currency: z.string().nullable().optional(),
      replacement_value: z.number().nullable().optional(),
      current_book_value: z.number().nullable().optional(),
      ownership_type: z.string().nullable().optional(),
      default_location_id: z.string().nullable().optional(),
      qr_code_value: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      is_active: z.boolean().nullable().optional(),
      created_at: z.string().min(1),
      updated_at: z.string().min(1),
    }),
  ),
  states: z.array(
    z.object({
      asset_id: z.string().trim().min(1),
      workspace_id: z.string().trim().min(1),
      current_location_id: z.string().nullable().optional(),
      current_project_id: z.string().nullable().optional(),
      current_department_id: z.string().nullable().optional(),
      current_responsible_user_id: z.string().nullable().optional(),
      active_assignment_id: z.string().nullable().optional(),
      condition_status: z.string().trim().min(1),
      operational_status: z.string().trim().min(1),
      custody_status: z.string().trim().min(1),
      last_event_id: z.string().trim().min(1),
      version: z.number().int().nullable().optional(),
      updated_at: z.string().min(1),
      project_unit_id: z.string().nullable().optional(),
      total_quantity: z.number().int().nullable().optional(),
      available_quantity: z.number().int().nullable().optional(),
      assigned_quantity: z.number().int().nullable().optional(),
      checked_out_quantity: z.number().int().nullable().optional(),
    }),
  ),
});

const ensureLocalWorkspacesSchema = z.array(
  z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    slug: z.string().trim().min(1),
    baseCurrency: z.string().trim().min(1),
    iconColor: z.string().trim().nullable().optional(),
  }),
);

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
  deleteUser,
  createBackupNow,
  runIntegrityCheckNow,
  ensureLocalWorkspaces,
  getLocalWorkspaces,
  runLocalSyncNow,
  getSyncOutboxRows,
  getSyncPullCursors,
  retrySyncOutboxRow,
  retryAllFailedSyncOutboxRows,
  exportRecentLogs,
  exportSupportBundle,
  applyRemoteCatalogRows,
  applyRemoteExchangeRates,
  applyRemoteAssetSnapshots,
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
  safeHandleReadWithSchema(ipcChannels.app.getUsersSnapshot, appUsersSnapshotReadArgsSchema, (_event, query) =>
    getUsersSnapshot(query as import("@contracts").AppUsersSnapshotQuery | undefined),
  );
  safeHandleReadWithSchema(
    ipcChannels.app.getLocalWorkspaces,
    emptyReadArgsSchema,
    () => getLocalWorkspaces(),
    "The app could not load the local workspace cache.",
  );
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
  ipcMain.handle(ipcChannels.app.deleteUser, (event, input) => {
    try {
      assertTrustedIpcSender(event);
      const parsed = deleteAppUserSchema.parse(input);
      return deleteUser(parsed);
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not remove that user.");
    }
  });
  ipcMain.handle(ipcChannels.app.ensureLocalWorkspaces, (event, input) => {
    try {
      assertTrustedIpcSender(event);
      const parsed = ensureLocalWorkspacesSchema.parse(input);
      return {
        summary: "Remote workspaces cached locally.",
        diagnostics: ensureLocalWorkspaces(parsed),
      };
    } catch (error) {
      throw sanitizeIpcError(error, "The app could not cache remote workspaces locally.");
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
  safeHandleReadWithSchema(
    ipcChannels.app.getSyncPullCursors,
    emptyReadArgsSchema,
    () => getSyncPullCursors(),
    "The app could not load inbound sync status.",
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

  safeHandle(
    ipcChannels.app.applyRemoteCatalogRows,
    applyRemoteCatalogRowsSchema,
    (_event, input) => applyRemoteCatalogRows(input),
    "The app could not apply remote catalog updates.",
  );
  safeHandle(
    ipcChannels.app.applyRemoteExchangeRates,
    applyRemoteExchangeRatesSchema,
    (_event, input) =>
      applyRemoteExchangeRates(input as import("@contracts").AppApplyRemoteExchangeRatesCommand),
    "The app could not apply remote exchange rates.",
  );
  safeHandle(
    ipcChannels.app.applyRemoteAssetSnapshots,
    applyRemoteAssetSnapshotsSchema,
    (_event, input) =>
      applyRemoteAssetSnapshots(input as import("@contracts").AppApplyRemoteAssetSnapshotsCommand),
    "The app could not apply remote asset snapshots.",
  );
};
