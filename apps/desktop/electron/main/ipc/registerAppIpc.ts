import { app, clipboard, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import {
  appUsersSnapshotReadArgsSchema,
  createAppUserSchema,
  deleteAppUserSchema,
  LOCAL_FALLBACK_WORKSPACE_ID,
  emptyReadArgsSchema,
  revokeTelegramLinkSchema,
  setAppUserActiveSchema,
  updateAppUserSchema,
} from "@contracts";
import { ipcChannels } from "@contracts/ipc/channels";
import { assertAllowedExternalUrl } from "../security/securityConfig";
import { getDesktopLogsDirectory, listRecentLogFiles } from "../services/logger";
import type { WorkspaceAccessGuard } from "../services/auth/workspaceAccessGuard";
import {
  getFreshStoredUserClaims,
  getFreshStoredUserId,
  invokeSupabaseEdgeFunction,
  buildSupabaseRestQuery,
  requestSupabaseRest,
  uploadUserAvatarObject,
  uploadWorkspaceImageObject,
} from "../services/auth/supabaseAuthBridge";
import { safeHandle, safeHandleRead, safeHandleReadWithSchema } from "./ipcSafeHandler";

type RegisterAppIpcOptions = {
  database: DatabaseSync;
  workspaceAccess: WorkspaceAccessGuard;
  appSettings: {
    getDocumentsRoot: () => string;
    getDocumentsRootSetting: () => string | null;
    setDocumentsRoot: (next: string | null) => void;
    defaultDocumentsRoot: () => string;
  };
  getDiagnosticsSnapshot: () => import("@contracts").AppDiagnosticsSnapshot;
  getSupportSnapshot: () => import("@contracts").AppSupportSnapshot;
  getUsersSnapshot: (query?: import("@contracts").AppUsersSnapshotQuery) => import("@contracts").AppUsersSnapshot;
  createUser: (input: import("@contracts").CreateAppUserCommand) => import("@contracts").AppUserMutationResult;
  updateUser: (input: import("@contracts").UpdateAppUserCommand) => import("@contracts").AppUserMutationResult;
  setUserActive: (input: import("@contracts").SetAppUserActiveCommand) => import("@contracts").AppUserMutationResult;
  revokeTelegramLink: (input: import("@contracts").RevokeTelegramLinkCommand) => import("@contracts").AppUserMutationResult;
  deleteUser: (input: import("@contracts").DeleteAppUserCommand) => import("@contracts").AppUserMutationResult;
  createBackupNow: () => import("@contracts").AppDiagnosticsSnapshot;
  restoreFromBackupNow: () => import("@contracts").AppDiagnosticsSnapshot;
  runIntegrityCheckNow: () => import("@contracts").AppDiagnosticsSnapshot;
  ensureLocalWorkspaces: (workspaces: import("@contracts").EnsureLocalWorkspaceInput[]) => import("@contracts").AppDiagnosticsSnapshot;
  getLocalWorkspaces: (query?: { userId?: string | null }) => import("@contracts").AppLocalWorkspaceRow[];
  runLocalSyncNow: () => Promise<import("@contracts").AppDiagnosticsSnapshot>;
  getSyncOutboxRows: () => import("@contracts").AppSyncOutboxRow[];
  getSyncPullCursors: () => import("@contracts").AppSyncPullCursorRow[];
  retrySyncOutboxRow: (id: string) => Promise<import("@contracts").AppDiagnosticsSnapshot>;
  retryAllFailedSyncOutboxRows: () => Promise<import("@contracts").AppDiagnosticsSnapshot>;
  getSyncConflicts: (workspaceId: string) => import("@contracts").AppSyncConflictRow[];
  resolveSyncConflict: (
    command: import("@contracts").AppSyncConflictResolveCommand,
  ) => import("@contracts").AppSyncConflictResolveResult;
  backfillOperationalSnapshots: (
    input: import("@contracts").AppOperationalBackfillCommand,
  ) => Promise<import("@contracts").AppOperationalBackfillResult>;
  exportRecentLogs: (filePath: string) => import("@contracts").AppExportResult;
  exportSupportBundle: (directoryPath: string) => import("@contracts").AppExportResult;
  applyRemoteCatalogRows: (
    input: import("@contracts").AppApplyRemoteCatalogRowsCommand,
  ) => import("@contracts").AppApplyRemoteCatalogRowsResult;
  applyRemoteSyncTombstones: (
    input: import("@contracts").AppApplyRemoteSyncTombstonesCommand,
  ) => import("@contracts").AppApplyRemoteSyncTombstonesResult;
  applyRemoteExchangeRates: (
    input: import("@contracts").AppApplyRemoteExchangeRatesCommand,
  ) => import("@contracts").AppApplyRemoteExchangeRatesResult;
  applyRemoteAssetSnapshots: (
    input: import("@contracts").AppApplyRemoteAssetSnapshotsCommand,
  ) => import("@contracts").AppApplyRemoteAssetSnapshotsResult;
  applyRemoteOperationalSnapshots: (
    input: import("@contracts").AppApplyRemoteOperationalSnapshotsCommand,
  ) => import("@contracts").AppApplyRemoteOperationalSnapshotsResult;
  applyRemoteWorkspaceFiles: (
    input: import("@contracts").AppApplyRemoteWorkspaceFilesCommand,
  ) => import("@contracts").AppApplyRemoteWorkspaceFilesResult;
  applyRemoteTreasuryRows: (
    input: import("@contracts").AppApplyRemoteTreasuryRowsCommand,
  ) => import("@contracts").AppApplyRemoteTreasuryRowsResult;
  applyRemoteCollaboratorPaymentRows: (
    input: import("@contracts").AppApplyRemoteCollaboratorPaymentRowsCommand,
  ) => import("@contracts").AppApplyRemoteCollaboratorPaymentRowsResult;
  applyRemoteFinanceBusinessRows: (
    input: import("@contracts").AppApplyRemoteFinanceBusinessRowsCommand,
  ) => import("@contracts").AppApplyRemoteFinanceBusinessRowsResult;
  applyRemoteAutomationControlPlaneRows: (
    input: import("@contracts").AppApplyRemoteAutomationControlPlaneRowsCommand,
  ) => import("@contracts").AppApplyRemoteAutomationControlPlaneRowsResult;
};

const remoteRecordSchema = z.record(z.string(), z.unknown());
const fileBytesSchema = z.custom<ArrayBuffer>((value) => value instanceof ArrayBuffer, {
  message: "File bytes must be sent as an ArrayBuffer.",
});

const createRemoteWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80),
  baseCurrency: z.string().trim().min(2).max(8),
  iconColor: z.string().trim().min(1).max(80).nullable().optional(),
});

const sendWorkspaceInviteSchema = z.object({
  workspaceId: z.string().trim().min(1),
  email: z.string().trim().email(),
  roleId: z.string().trim().min(1),
  message: z.string().trim().max(2000).nullable().optional(),
});

const upsertUserProfileSchema = z
  .object({
    avatarUrl: z.string().trim().url().nullable().optional(),
    fullName: z.string().trim().max(160).nullable().optional(),
  })
  .refine((input) => input.avatarUrl !== undefined || input.fullName !== undefined, {
    message: "At least one user profile field is required.",
  });

const trustedImageUploadFileSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(100),
  bytes: fileBytesSchema,
});

const uploadWorkspaceImageAssetSchema = trustedImageUploadFileSchema.extend({
  workspaceId: z.string().trim().min(1),
  assetKind: z.enum(["avatar", "logo", "seal", "signature"]),
});

const updateRemoteWorkspaceIdentitySchema = z
  .object({
    workspaceId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    baseCurrency: z.string().trim().min(2).max(8).optional(),
    iconColor: z.string().trim().min(1).max(80).nullable().optional(),
    avatarUrl: z.string().trim().url().nullable().optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.baseCurrency !== undefined ||
      input.iconColor !== undefined ||
      input.avatarUrl !== undefined,
    { message: "At least one workspace field is required." },
  );

const updateWorkspaceMemberRoleSchema = z.object({
  workspaceId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  roleId: z.string().trim().min(1),
});

const setWorkspaceMemberStatusSchema = z.object({
  workspaceId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  status: z.enum(["active", "inactive"]),
});

const revokeWorkspaceInviteSchema = z.object({
  workspaceId: z.string().trim().min(1),
  membershipId: z.string().trim().min(1),
});

const createCustomRoleSchema = z.object({
  workspaceId: z.string().trim().min(1),
  key: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
});

const updateCustomRoleSchema = z.object({
  workspaceId: z.string().trim().min(1),
  roleId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
});

const deleteCustomRoleSchema = z.object({
  workspaceId: z.string().trim().min(1),
  roleId: z.string().trim().min(1),
});

const setRolePermissionSchema = z.object({
  workspaceId: z.string().trim().min(1),
  roleId: z.string().trim().min(1),
  permissionId: z.string().trim().min(1),
  enabled: z.boolean(),
});

const assertWorkspaceRole = async (input: { workspaceId: string; roleId: string; requireCustom?: boolean }) => {
  const filters: Record<string, string> = {
    id: `eq.${input.roleId}`,
    workspace_id: `eq.${input.workspaceId}`,
  };
  if (input.requireCustom) {
    filters.is_system_role = "eq.false";
  }

  const roles = await requestSupabaseRest<Array<{ id: string }>>({
    table: "roles",
    query: buildSupabaseRestQuery(filters, "id"),
  });

  if (!roles.length) {
    throw new Error("That role is not available in this workspace.");
  }
};

const applyRemoteCatalogRowsSchema = z.object({
  workspaceId: z.string().trim().min(1),
  entityType: z.enum([
    "asset_categories",
    "locations",
    "clients",
    "manufacturers",
    "production_companies",
    "crew_members",
    "departments",
  ]),
  // code/name are optional: crew_members carries full_name instead of code/name.
  rows: z.array(
    z.object({
      id: z.string().trim().min(1),
      workspace_id: z.string().trim().min(1),
      code: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      parent_category_id: z.string().nullable().optional(),
      type: z.string().nullable().optional(),
      // PostgREST returns integer is_active columns (crew_members, clients…) as
      // numbers and boolean columns (locations) as booleans — accept both.
      is_active: z.union([z.boolean(), z.number()]).nullable().optional(),
      updated_at: z.string().min(1),
      contact_name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      support_email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      rnc: z.string().nullable().optional(),
      pur: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      full_name: z.string().nullable().optional(),
      role_label: z.string().nullable().optional(),
      default_daily_rate: z.number().nullable().optional(),
      default_weekly_rate: z.number().nullable().optional(),
      default_overtime_rate: z.number().nullable().optional(),
      rate_currency: z.string().nullable().optional(),
    }),
  ),
});

const applyRemoteSyncTombstonesSchema = z.object({
  workspaceId: z.string().trim().min(1),
  rows: z.array(
    z.object({
      workspace_id: z.string().trim().min(1),
      table_name: z.string().trim().min(1),
      entity_id: z.string().trim().min(1),
      deleted_at: z.string().trim().min(1),
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

const applyRemoteWorkspaceFilesSchema = z.object({
  workspaceId: z.string().trim().min(1),
  pullError: z.string().trim().min(1).nullable().optional(),
  rows: z.array(z.object({
    id: z.string().trim().min(1),
    workspace_id: z.string().trim().min(1),
    domain: z.enum(["assets", "incidents", "finance", "crew"]),
    entity_id: z.string().trim().min(1),
    storage_object_key: z.string().trim().min(1),
    original_name: z.string().trim().min(1),
    mime_type: z.string().trim().min(1),
    byte_size: z.number().int().nonnegative(),
    content_hash: z.string().nullable().optional(),
    status: z.enum(["pending_upload", "available", "missing", "deleted"]),
    created_by_user_id: z.string().nullable().optional(),
    created_at: z.string().trim().min(1),
    updated_at: z.string().trim().min(1),
    deleted_at: z.string().nullable().optional(),
  })),
});

const applyRemoteOperationalSnapshotsSchema = z.object({
  workspaceId: z.string().trim().min(1),
  entityType: z.enum(["project", "packing_slip", "incident", "rma_case"]),
  rows: z.array(
    z.object({
      workspace_id: z.string().trim().min(1),
      entity_type: z.enum(["project", "packing_slip", "incident", "rma_case"]),
      entity_id: z.string().trim().min(1),
      snapshot_json: z.record(z.string(), z.unknown()),
      updated_at: z.string().min(1),
      deleted_at: z.string().nullable().optional(),
    }),
  ),
});

const applyRemoteTreasuryRowsSchema = z.object({
  workspaceId: z.string().trim().min(1),
  table: z.enum([
    "bank_accounts",
    "bank_statement_imports",
    "bank_transactions",
    "transaction_annotations",
    "transaction_project_allocations",
    "transaction_links",
    "counterparty_rules",
  ]),
  rows: z.array(remoteRecordSchema),
});

const applyRemoteCollaboratorPaymentRowsSchema = z.object({
  workspaceId: z.string().trim().min(1),
  table: z.enum(["collaborator_fees", "collaborator_payment_batches", "collaborator_fee_payments"]),
  rows: z.array(remoteRecordSchema),
});

const applyRemoteFinanceBusinessRowsSchema = z.object({
  workspaceId: z.string().trim().min(1),
  table: z.enum([
    "currency_settings",
    "quotes",
    "quote_items",
    "quote_versions",
    "invoices",
    "invoice_items",
    "invoice_payments",
    "invoice_extractions",
    "financial_entries",
    "software_licenses",
  ]),
  rows: z.array(remoteRecordSchema),
  childRows: z.array(remoteRecordSchema).optional(),
});

const applyRemoteAutomationControlPlaneRowsSchema = z.object({
  workspaceId: z.string().trim().min(1),
  entityType: z.enum(["agents", "ai_provider_configs", "agent_connector_configs"]),
  rows: z.array(
    z.object({
      id: z.string().trim().min(1),
      workspace_id: z.string().trim().min(1),
      updated_at: z.string().trim().min(1),
    }).catchall(z.unknown()),
  ),
});

const backfillOperationalSnapshotsSchema = z.object({
  workspaceId: z.string().trim().min(1),
});

const getSyncConflictsReadArgsSchema = z.tuple([z.string().trim().min(1)]);

const resolveSyncConflictSchema = z.object({
  conflictId: z.string().trim().min(1),
  resolution: z.enum(["keep_local", "take_remote"]),
});

const ensureLocalWorkspacesSchema = z.array(
  z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    slug: z.string().trim().min(1),
    baseCurrency: z.string().trim().min(1),
    iconColor: z.string().trim().nullable().optional(),
    userId: z.string().trim().nullable().optional(),
    userEmail: z.string().trim().nullable().optional(),
    roleKey: z.string().trim().nullable().optional(),
    roleName: z.string().trim().nullable().optional(),
    permissions: z.array(z.string().trim().min(1)).optional(),
  }),
);

const localWorkspacesReadArgsSchema = z.object({
  userId: z.string().trim().nullable().optional(),
}).optional();

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
  workspaceAccess,
  appSettings,
  getDiagnosticsSnapshot,
  getSupportSnapshot,
  getUsersSnapshot,
  createUser,
  updateUser,
  setUserActive,
  revokeTelegramLink,
  deleteUser,
  createBackupNow,
  restoreFromBackupNow,
  runIntegrityCheckNow,
  ensureLocalWorkspaces,
  getLocalWorkspaces,
  runLocalSyncNow,
  getSyncOutboxRows,
  getSyncPullCursors,
  retrySyncOutboxRow,
  retryAllFailedSyncOutboxRows,
  getSyncConflicts,
  resolveSyncConflict,
  backfillOperationalSnapshots,
  exportRecentLogs,
  exportSupportBundle,
  applyRemoteCatalogRows,
  applyRemoteSyncTombstones,
  applyRemoteExchangeRates,
  applyRemoteAssetSnapshots,
  applyRemoteOperationalSnapshots,
  applyRemoteWorkspaceFiles,
  applyRemoteTreasuryRows,
  applyRemoteCollaboratorPaymentRows,
  applyRemoteFinanceBusinessRows,
  applyRemoteAutomationControlPlaneRows,
}: RegisterAppIpcOptions) => {
  const assertWorkspaceAdminAccess = (workspaceId: string, action: string) =>
    workspaceAccess.assertWorkspaceAccess({
      workspaceId,
      action,
      accessLevel: "write",
      requiredPermission: "users.invite",
    });
  // Sensitive app-level access (sync internals, backups, exports) requires the
  // user to be an admin. Granting requires passing the admin check for at least
  // ONE local workspace — not every one. The old "must pass for every
  // workspace" loop hard-failed whenever a single workspace could not be
  // verified (a stale/demo seed workspace the user does not administer, or a
  // remote workspace whose membership check needs the network while offline),
  // which broke the sync popover and Settings sync panel entirely. We still
  // deny when the user is not an admin of any workspace.
  const assertSensitiveAppAccess = async (action: string) => {
    const workspaceIds = Array.from(
      new Set(
        getLocalWorkspaces()
          .map((workspace) => workspace.id?.trim())
          .filter((workspaceId): workspaceId is string => Boolean(workspaceId)),
      ),
    );

    if (workspaceIds.length === 0) {
      return;
    }

    let lastError: unknown = null;
    for (const workspaceId of workspaceIds) {
      try {
        await assertWorkspaceAdminAccess(workspaceId, action);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error(`You do not have access to ${action}.`);
  };

  safeHandleReadWithSchema(ipcChannels.app.getInfo, emptyReadArgsSchema, () => ({
    appName: "bukowskiOS",
    platform: process.platform,
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    shellVersion: "Beta 1",
  }));
  safeHandleReadWithSchema(ipcChannels.app.getDiagnostics, emptyReadArgsSchema, () => getDiagnosticsSnapshot());
  safeHandleReadWithSchema(ipcChannels.app.getSupportSnapshot, emptyReadArgsSchema, () => getSupportSnapshot());
  safeHandleReadWithSchema(ipcChannels.app.getUsersSnapshot, appUsersSnapshotReadArgsSchema, async (_event, query) => {
    const workspaceId = (query as import("@contracts").AppUsersSnapshotQuery | undefined)?.workspaceId ?? LOCAL_FALLBACK_WORKSPACE_ID;
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId,
      action: "view workspace users",
      accessLevel: "read",
      requiredPermission: "users.manage",
    });
    return getUsersSnapshot(query as import("@contracts").AppUsersSnapshotQuery | undefined);
  },
  );
  safeHandleReadWithSchema(
    ipcChannels.app.getLocalWorkspaces,
    localWorkspacesReadArgsSchema,
    (_event, query) => getLocalWorkspaces(query as z.infer<typeof localWorkspacesReadArgsSchema>),
    "The app could not load the local workspace cache.",
  );
  safeHandle(
    ipcChannels.app.createUser,
    createAppUserSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "create workspace users",
        accessLevel: "write",
        requiredPermission: "users.manage",
      });
      return createUser(input);
    },
    "The app could not create that user.",
  );
  safeHandle(
    ipcChannels.app.updateUser,
    updateAppUserSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "update workspace users",
        accessLevel: "write",
        requiredPermission: "users.manage",
      });
      return updateUser(input);
    },
    "The app could not update that user.",
  );
  safeHandle(
    ipcChannels.app.setUserActive,
    setAppUserActiveSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "update workspace users",
        accessLevel: "write",
        requiredPermission: "users.manage",
      });
      return setUserActive(input);
    },
    "The app could not change that user state.",
  );
  safeHandle(
    ipcChannels.app.revokeTelegramLink,
    revokeTelegramLinkSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "update workspace users",
        accessLevel: "write",
        requiredPermission: "users.manage",
      });
      return revokeTelegramLink(input);
    },
    "The app could not revoke Telegram access for that user.",
  );
  safeHandle(
    ipcChannels.app.deleteUser,
    deleteAppUserSchema,
    async (_event, input) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "delete workspace users",
        accessLevel: "write",
        requiredPermission: "users.manage",
      });
      return deleteUser(input);
    },
    "The app could not remove that user.",
  );
  safeHandle(
    ipcChannels.app.ensureLocalWorkspaces,
    ensureLocalWorkspacesSchema,
    (_event, input) => ({
      summary: "Remote workspaces cached locally.",
      diagnostics: ensureLocalWorkspaces(input),
    }),
    "The app could not cache remote workspaces locally.",
  );
  safeHandle(
    ipcChannels.app.createRemoteWorkspace,
    createRemoteWorkspaceSchema,
    async (_event, input) => {
      const result = await invokeSupabaseEdgeFunction<Partial<import("@contracts").AppCreateRemoteWorkspaceResult>>(
        "admin-workspace-bootstrap",
        {
          name: input.name.trim(),
          slug: input.slug.trim().toLowerCase(),
          baseCurrency: input.baseCurrency.trim().toUpperCase(),
          iconColor: input.iconColor?.trim() || null,
        },
      );

      if (!result.workspaceId) {
        throw new Error("Workspace was created but Supabase did not return a workspace id.");
      }

      return { workspaceId: result.workspaceId };
    },
    "The app could not create that workspace.",
  );
  safeHandle(
    ipcChannels.app.sendWorkspaceInvite,
    sendWorkspaceInviteSchema,
    async (_event, input) => {
      await assertWorkspaceAdminAccess(input.workspaceId, "send workspace invites");
      const result = await invokeSupabaseEdgeFunction<Partial<import("@contracts").AppSendWorkspaceInviteResult>>(
        "send-invite",
        {
          workspaceId: input.workspaceId,
          email: input.email.trim().toLowerCase(),
          roleId: input.roleId,
          message: input.message?.trim() ? input.message.trim() : null,
        },
      );

      if (!result.userId) {
        throw new Error("Invite was sent but Supabase did not return a user id.");
      }

      return {
        alreadyRegistered: Boolean(result.alreadyRegistered),
        magicLinkSent: result.magicLinkSent !== false,
        membershipStatus: result.membershipStatus ?? "invited",
        warning: result.warning ?? null,
        userId: result.userId,
      };
    },
    "The app could not send that invite.",
  );
  safeHandle(
    ipcChannels.app.upsertUserProfile,
    upsertUserProfileSchema,
    async (_event, input) => {
      const user = await getFreshStoredUserClaims();
      const payload: Record<string, string | null> = {
        email: user.email,
        updated_at: new Date().toISOString(),
        user_id: user.userId,
      };

      if (input.avatarUrl !== undefined) {
        payload.avatar_url = input.avatarUrl?.trim() || null;
      }
      if (input.fullName !== undefined) {
        payload.full_name = input.fullName?.trim() || null;
      }

      await requestSupabaseRest({
        table: "user_profiles",
        method: "POST",
        query: new URLSearchParams({ on_conflict: "user_id" }),
        body: payload,
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    },
    "The app could not update that profile.",
  );
  safeHandle(
    ipcChannels.app.uploadUserAvatar,
    trustedImageUploadFileSchema,
    async (_event, input) =>
      uploadUserAvatarObject({
        userId: await getFreshStoredUserId(),
        fileName: input.fileName,
        contentType: input.contentType,
        bytes: input.bytes,
      }),
    "The app could not upload that avatar.",
  );
  safeHandle(
    ipcChannels.app.uploadWorkspaceImageAsset,
    uploadWorkspaceImageAssetSchema,
    async (_event, input) => {
      await assertWorkspaceAdminAccess(input.workspaceId, "upload workspace branding assets");
      return uploadWorkspaceImageObject({
        workspaceId: input.workspaceId,
        assetKind: input.assetKind,
        fileName: input.fileName,
        contentType: input.contentType,
        bytes: input.bytes,
      });
    },
    "The app could not upload that workspace image.",
  );
  safeHandle(
    ipcChannels.app.updateRemoteWorkspaceIdentity,
    updateRemoteWorkspaceIdentitySchema,
    async (_event, input) => {
      await assertWorkspaceAdminAccess(input.workspaceId, "update workspace settings");
      const payload: Record<string, string | null> = {
        updated_at: new Date().toISOString(),
      };
      if (input.name !== undefined) payload.name = input.name.trim();
      if (input.baseCurrency !== undefined) payload.base_currency = input.baseCurrency.trim().toUpperCase();
      if (input.iconColor !== undefined) payload.icon_color = input.iconColor?.trim() || null;
      if (input.avatarUrl !== undefined) payload.avatar_url = input.avatarUrl?.trim() || null;

      await requestSupabaseRest({
        table: "workspaces",
        method: "PATCH",
        query: buildSupabaseRestQuery({ id: `eq.${input.workspaceId}` }),
        body: payload,
      });
    },
    "The app could not update that workspace.",
  );
  safeHandle(
    ipcChannels.app.updateWorkspaceMemberRole,
    updateWorkspaceMemberRoleSchema,
    async (_event, input) => {
      await assertWorkspaceAdminAccess(input.workspaceId, "change workspace member roles");
      await assertWorkspaceRole({ workspaceId: input.workspaceId, roleId: input.roleId });
      await requestSupabaseRest({
        table: "workspace_memberships",
        method: "PATCH",
        query: buildSupabaseRestQuery({
          workspace_id: `eq.${input.workspaceId}`,
          user_id: `eq.${input.userId}`,
        }),
        body: { role_id: input.roleId, updated_at: new Date().toISOString() },
      });
    },
    "The app could not update that member role.",
  );
  safeHandle(
    ipcChannels.app.setWorkspaceMemberStatus,
    setWorkspaceMemberStatusSchema,
    async (_event, input) => {
      await assertWorkspaceAdminAccess(input.workspaceId, "change workspace member status");
      await requestSupabaseRest({
        table: "workspace_memberships",
        method: "PATCH",
        query: buildSupabaseRestQuery({
          workspace_id: `eq.${input.workspaceId}`,
          user_id: `eq.${input.userId}`,
        }),
        body: { status: input.status, updated_at: new Date().toISOString() },
      });
    },
    "The app could not update that member status.",
  );
  safeHandle(
    ipcChannels.app.revokeWorkspaceInvite,
    revokeWorkspaceInviteSchema,
    async (_event, input) => {
      await assertWorkspaceAdminAccess(input.workspaceId, "revoke workspace invites");
      await requestSupabaseRest({
        table: "workspace_memberships",
        method: "DELETE",
        query: buildSupabaseRestQuery({
          id: `eq.${input.membershipId}`,
          workspace_id: `eq.${input.workspaceId}`,
          status: "eq.invited",
        }),
      });
    },
    "The app could not revoke that invite.",
  );
  safeHandle(
    ipcChannels.app.createCustomRole,
    createCustomRoleSchema,
    async (_event, input) => {
      await assertWorkspaceAdminAccess(input.workspaceId, "create custom roles");
      const roles = await requestSupabaseRest<Array<{ id?: string }>>({
        table: "roles",
        method: "POST",
        query: buildSupabaseRestQuery({}, "id"),
        prefer: "return=representation",
        body: {
          workspace_id: input.workspaceId,
          key: input.key.trim(),
          name: input.name.trim(),
          description: input.description.trim() || null,
          is_system_role: false,
        },
      });
      const roleId = roles[0]?.id;
      if (!roleId) {
        throw new Error("Role was created but Supabase did not return a role id.");
      }
      return { roleId };
    },
    "The app could not create that custom role.",
  );
  safeHandle(
    ipcChannels.app.updateCustomRole,
    updateCustomRoleSchema,
    async (_event, input) => {
      await assertWorkspaceAdminAccess(input.workspaceId, "update custom roles");
      await assertWorkspaceRole({ workspaceId: input.workspaceId, roleId: input.roleId, requireCustom: true });
      await requestSupabaseRest({
        table: "roles",
        method: "PATCH",
        query: buildSupabaseRestQuery({
          id: `eq.${input.roleId}`,
          workspace_id: `eq.${input.workspaceId}`,
          is_system_role: "eq.false",
        }),
        body: {
          name: input.name.trim(),
          description: input.description.trim() || null,
          updated_at: new Date().toISOString(),
        },
      });
    },
    "The app could not update that custom role.",
  );
  safeHandle(
    ipcChannels.app.deleteCustomRole,
    deleteCustomRoleSchema,
    async (_event, input) => {
      await assertWorkspaceAdminAccess(input.workspaceId, "delete custom roles");
      await assertWorkspaceRole({ workspaceId: input.workspaceId, roleId: input.roleId, requireCustom: true });
      await requestSupabaseRest({
        table: "roles",
        method: "DELETE",
        query: buildSupabaseRestQuery({
          id: `eq.${input.roleId}`,
          workspace_id: `eq.${input.workspaceId}`,
          is_system_role: "eq.false",
        }),
      });
    },
    "The app could not delete that custom role.",
  );
  safeHandle(
    ipcChannels.app.setRolePermission,
    setRolePermissionSchema,
    async (_event, input) => {
      await assertWorkspaceAdminAccess(input.workspaceId, "change custom role permissions");
      await assertWorkspaceRole({ workspaceId: input.workspaceId, roleId: input.roleId, requireCustom: true });

      if (input.enabled) {
        await requestSupabaseRest({
          table: "role_permissions",
          method: "POST",
          body: { role_id: input.roleId, permission_id: input.permissionId },
        });
        return;
      }

      await requestSupabaseRest({
        table: "role_permissions",
        method: "DELETE",
        query: buildSupabaseRestQuery({
          role_id: `eq.${input.roleId}`,
          permission_id: `eq.${input.permissionId}`,
        }),
      });
    },
    "The app could not update that role permission.",
  );
  safeHandleRead(
    ipcChannels.app.createBackup,
    async () => {
      await assertSensitiveAppAccess("create backups");
      return {
      summary: "Backup created successfully.",
      diagnostics: createBackupNow(),
      };
    },
    "The app could not create a backup.",
  );
  safeHandleRead(
    ipcChannels.app.restoreBackup,
    async () => {
      await assertSensitiveAppAccess("restore backups");
      return {
      summary: "Backup restored. The app will restart now.",
      diagnostics: restoreFromBackupNow(),
      };
    },
    "The app could not restore the backup.",
  );
  safeHandleRead(
    ipcChannels.app.runIntegrityCheck,
    async () => {
      await assertSensitiveAppAccess("run integrity checks");
      return {
      summary: "Integrity check completed successfully.",
      diagnostics: runIntegrityCheckNow(),
      };
    },
    "The app could not complete the integrity check.",
  );
  safeHandleRead(
    ipcChannels.app.runLocalSync,
    async () => {
      await assertSensitiveAppAccess("run local sync");
      return {
      summary: "Local sync pass completed.",
      diagnostics: await runLocalSyncNow(),
      };
    },
    "The app could not complete the local sync pass.",
  );
  safeHandleReadWithSchema(
    ipcChannels.app.getSyncOutboxRows,
    emptyReadArgsSchema,
    async () => {
      await assertSensitiveAppAccess("review local sync queue");
      return getSyncOutboxRows();
    },
    "The app could not load the local sync queue.",
  );
  safeHandleReadWithSchema(
    ipcChannels.app.getSyncPullCursors,
    emptyReadArgsSchema,
    async () => {
      await assertSensitiveAppAccess("review inbound sync status");
      return getSyncPullCursors();
    },
    "The app could not load inbound sync status.",
  );
  safeHandleReadWithSchema(
    ipcChannels.app.getSyncStatusSnapshot,
    emptyReadArgsSchema,
    async () => {
      await assertSensitiveAppAccess("review sync status");
      return {
        diagnostics: getDiagnosticsSnapshot(),
        pullCursors: getSyncPullCursors(),
      };
    },
    "The app could not load sync status.",
  );
  safeHandleRead(
    ipcChannels.app.retrySyncOutboxRow,
    async (_event, id: string) => {
      await assertSensitiveAppAccess("retry local sync rows");
      return {
        summary: "Sync row retried locally.",
        diagnostics: await retrySyncOutboxRow(id),
      };
    },
    "The app could not retry that local sync row.",
  );
  safeHandleRead(
    ipcChannels.app.retryAllFailedSyncOutboxRows,
    async () => {
      await assertSensitiveAppAccess("retry failed local sync rows");
      return {
        summary: "All failed sync rows were queued again locally.",
        diagnostics: await retryAllFailedSyncOutboxRows(),
      };
    },
    "The app could not retry the failed local sync rows.",
  );
  safeHandleReadWithSchema(
    ipcChannels.app.getSyncConflicts,
    getSyncConflictsReadArgsSchema,
    async (_event, workspaceId: string) => {
      await assertWorkspaceAdminAccess(workspaceId, "review sync conflicts");
      return getSyncConflicts(workspaceId);
    },
    "The app could not load sync conflicts.",
  );
  safeHandle(
    ipcChannels.app.resolveSyncConflict,
    resolveSyncConflictSchema,
    async (_event, input) => {
      await assertSensitiveAppAccess("resolve sync conflicts");
      return resolveSyncConflict(input as import("@contracts").AppSyncConflictResolveCommand);
    },
    "The app could not resolve that sync conflict.",
  );
  safeHandle(
    ipcChannels.app.backfillOperationalSnapshots,
    backfillOperationalSnapshotsSchema,
    async (_event, input) => {
      await assertWorkspaceAdminAccess(input.workspaceId, "backfill operational snapshots");
      return backfillOperationalSnapshots(input as import("@contracts").AppOperationalBackfillCommand);
    },
    "The app could not backfill operational sync snapshots.",
  );
  safeHandleRead(
    ipcChannels.app.exportWorkspaceData,
    async () => {
      await assertSensitiveAppAccess("export local workspace data");
      return exportDatabaseJson(database);
    },
    "The app could not export local data.",
  );
  safeHandleRead(
    ipcChannels.app.exportRecentLogs,
    async () => {
      await assertSensitiveAppAccess("export recent logs");
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
    },
    "The app could not export recent logs.",
  );
  safeHandleRead(
    ipcChannels.app.exportSupportBundle,
    async () => {
      await assertSensitiveAppAccess("export support bundles");
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
    },
    "The app could not export the support bundle.",
  );
  safeHandleRead(
    ipcChannels.app.openExternal,
    (_event, url: string) => {
      assertAllowedExternalUrl(url);
      return shell.openExternal(url);
    },
    "The app could not open that external link.",
  );

  // Reveal a recent log file in the OS file manager (Finder/Explorer). The name
  // is validated against the known log directory listing so the renderer can
  // never coax us into revealing an arbitrary path.
  safeHandleRead(
    ipcChannels.app.revealLogFile,
    (_event, name: unknown) => {
      const logsDirectory = getDesktopLogsDirectory();
      if (!logsDirectory) {
        return;
      }

      const requestedName = typeof name === "string" ? path.basename(name) : "";
      const knownFile = listRecentLogFiles().find((file) => file.name === requestedName);
      if (!knownFile) {
        return;
      }

      shell.showItemInFolder(path.join(logsDirectory, knownFile.name));
    },
    "The app could not open that log file.",
  );

  // Reliable clipboard write via Electron (navigator.clipboard can be denied
  // in packaged builds under file://). Renderer falls back to navigator only
  // if this is unavailable.
  safeHandleRead(
    ipcChannels.app.writeClipboard,
    (_event, text: unknown) => {
      clipboard.writeText(typeof text === "string" ? text : String(text ?? ""));
    },
    "The app could not copy to the clipboard.",
  );

  // Configurable local documents folder (per-machine; e.g. an iCloud folder).
  const documentsRootInfo = () => ({
    root: appSettings.getDocumentsRoot(),
    isCustom: appSettings.getDocumentsRootSetting() != null,
    defaultRoot: appSettings.defaultDocumentsRoot(),
  });
  safeHandleRead(
    ipcChannels.app.getDocumentsRoot,
    () => documentsRootInfo(),
    "The app could not load the documents folder setting.",
  );
  safeHandleRead(
    ipcChannels.app.chooseDocumentsRoot,
    async () => {
      await assertSensitiveAppAccess("change the documents folder");
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: "Carpeta de documentos",
        properties: ["openDirectory", "createDirectory"],
        defaultPath: appSettings.getDocumentsRoot(),
      });
      if (canceled || !filePaths[0]) return documentsRootInfo();
      appSettings.setDocumentsRoot(filePaths[0]);
      return documentsRootInfo();
    },
    "The app could not change the documents folder.",
  );
  safeHandleRead(
    ipcChannels.app.resetDocumentsRoot,
    async () => {
      await assertSensitiveAppAccess("reset the documents folder");
      appSettings.setDocumentsRoot(null);
      return documentsRootInfo();
    },
    "The app could not reset the documents folder.",
  );

  safeHandle(
    ipcChannels.app.applyRemoteCatalogRows,
    applyRemoteCatalogRowsSchema,
    (_event, input) => applyRemoteCatalogRows(input),
    "The app could not apply remote catalog updates.",
  );
  safeHandle(
    ipcChannels.app.applyRemoteSyncTombstones,
    applyRemoteSyncTombstonesSchema,
    (_event, input) =>
      applyRemoteSyncTombstones(input as import("@contracts").AppApplyRemoteSyncTombstonesCommand),
    "The app could not apply remote deletion markers.",
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
  safeHandle(
    ipcChannels.app.applyRemoteOperationalSnapshots,
    applyRemoteOperationalSnapshotsSchema,
    (_event, input) =>
      applyRemoteOperationalSnapshots(input as import("@contracts").AppApplyRemoteOperationalSnapshotsCommand),
    "The app could not apply remote operational snapshots.",
  );
  safeHandle(
    ipcChannels.app.applyRemoteWorkspaceFiles,
    applyRemoteWorkspaceFilesSchema,
    (_event, input) =>
      applyRemoteWorkspaceFiles(input as import("@contracts").AppApplyRemoteWorkspaceFilesCommand),
    "The app could not apply remote workspace files.",
  );
  safeHandle(
    ipcChannels.app.applyRemoteTreasuryRows,
    applyRemoteTreasuryRowsSchema,
    (_event, input) => applyRemoteTreasuryRows(input as import("@contracts").AppApplyRemoteTreasuryRowsCommand),
    "The app could not apply remote treasury rows.",
  );
  safeHandle(
    ipcChannels.app.applyRemoteCollaboratorPaymentRows,
    applyRemoteCollaboratorPaymentRowsSchema,
    (_event, input) =>
      applyRemoteCollaboratorPaymentRows(input as import("@contracts").AppApplyRemoteCollaboratorPaymentRowsCommand),
    "The app could not apply remote collaborator payment rows.",
  );
  safeHandle(
    ipcChannels.app.applyRemoteFinanceBusinessRows,
    applyRemoteFinanceBusinessRowsSchema,
    (_event, input) =>
      applyRemoteFinanceBusinessRows(input as import("@contracts").AppApplyRemoteFinanceBusinessRowsCommand),
    "The app could not apply remote finance business rows.",
  );
  safeHandle(
    ipcChannels.app.applyRemoteAutomationControlPlaneRows,
    applyRemoteAutomationControlPlaneRowsSchema,
    (_event, input) =>
      applyRemoteAutomationControlPlaneRows(input as import("@contracts").AppApplyRemoteAutomationControlPlaneRowsCommand),
    "The app could not apply remote automation control plane rows.",
  );
};
