import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd(), "../..");

const readText = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const listFiles = (directory: string): string[] => {
  const absoluteDirectory = path.join(repoRoot, directory);
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(relativePath) : [relativePath];
  });
};

const toLines = (text: string) => text.split(/\r?\n/);

describe("security regression checks", () => {
  it("does not touch persisted storage_path values with filesystem APIs before the path safety guard", () => {
    const riskyOperations = /\b(?:readFileSync|createReadStream|existsSync|statSync|copyFileSync|renameSync|unlinkSync|openPath)\s*\(/;
    const persistedPathReference = /\b(?:row|attachment|file|cached)\.storage_path\b/;
    const safeGuardReference = /assertPathWithinRoot|ensureSafePath|resolveStoredPath|resolveAttachmentPath|resolveCachedPath|safePath|safeStoragePath/;
    const violations: string[] = [];

    for (const relativePath of listFiles("apps/desktop/electron/main")) {
      if (!relativePath.endsWith(".ts")) continue;
      const lines = toLines(readText(relativePath));
      lines.forEach((line, index) => {
        if (!riskyOperations.test(line) || !persistedPathReference.test(line)) return;
        if (!safeGuardReference.test(line)) {
          violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("keeps public Supabase tables granted to authenticated behind RLS", () => {
    const migrationText = listFiles("supabase/migrations")
      .filter((relativePath) => relativePath.endsWith(".sql"))
      .map(readText)
      .join("\n");
    const grantedTables = new Set<string>();
    const rlsTables = new Set<string>();

    for (const match of migrationText.matchAll(/GRANT\s+[^;]*?\s+ON\s+public\.([a-zA-Z0-9_]+)\s+TO\s+authenticated/gi)) {
      grantedTables.add(match[1]!);
    }

    for (const match of migrationText.matchAll(/ALTER\s+TABLE\s+public\.([a-zA-Z0-9_]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)) {
      rlsTables.add(match[1]!);
    }

    const defensiveAssert = migrationText.match(/target_tables\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\];/i)?.[1] ?? "";
    for (const match of defensiveAssert.matchAll(/'([a-zA-Z0-9_]+)'/g)) {
      rlsTables.add(match[1]!);
    }

    const missingRls = Array.from(grantedTables)
      .filter((tableName) => !rlsTables.has(tableName))
      .sort();

    expect(missingRls).toEqual([]);
  });

  it("requires workspace access checks around agent write IPC handlers", () => {
    const source = readText("apps/desktop/electron/main/ipc/registerFoundationIpc.ts");
    const expectedGuardedChannels = [
      "ipcChannels.agents.create",
      "ipcChannels.agents.update",
      "ipcChannels.agents.setStatus",
      "ipcChannels.agents.setApprovalMode",
      "ipcChannels.agents.saveAIProviderConfig",
      "ipcChannels.agents.saveConnectorConfig",
      "ipcChannels.agents.testAIProviderConnection",
      "ipcChannels.agents.refreshAIProviderModels",
      "ipcChannels.agents.testConnectorConnection",
      "ipcChannels.agents.createConnectorLinkToken",
      "ipcChannels.agents.assignAgentModel",
      "ipcChannels.agents.createAssistantThread",
      "ipcChannels.agents.deleteAssistantThread",
      "ipcChannels.agents.setActiveAssistantThread",
      "ipcChannels.agents.updateAssistantThreadPreferences",
      "ipcChannels.agents.renameAssistantThread",
      "ipcChannels.agents.sendAssistantChatTurn",
      "ipcChannels.agents.transcribeAudio",
      "ipcChannels.agents.reviewRun",
      "ipcChannels.agents.sendAssistantMessage",
      "ipcChannels.agents.createDraftRunFromChat",
    ];

    const missingGuard = expectedGuardedChannels.filter((channel) => {
      const channelIndex = source.indexOf(channel);
      if (channelIndex < 0) return true;
      const handlerBlock = source.slice(channelIndex, source.indexOf(");", channelIndex) + 2);
      return !/assertAgent(?:Admin|Workspace)Access/.test(handlerBlock);
    });

    expect(missingGuard).toEqual([]);
  });

  it("requires workspace admin access checks around remote admin app IPC handlers", () => {
    const source = readText("apps/desktop/electron/main/ipc/registerAppIpc.ts");
    const expectedGuardedChannels = [
      "ipcChannels.app.sendWorkspaceInvite",
      "ipcChannels.app.uploadWorkspaceImageAsset",
      "ipcChannels.app.updateRemoteWorkspaceIdentity",
      "ipcChannels.app.updateWorkspaceMemberRole",
      "ipcChannels.app.setWorkspaceMemberStatus",
      "ipcChannels.app.revokeWorkspaceInvite",
      "ipcChannels.app.createCustomRole",
      "ipcChannels.app.updateCustomRole",
      "ipcChannels.app.deleteCustomRole",
      "ipcChannels.app.setRolePermission",
    ];

    const missingGuard = expectedGuardedChannels.filter((channel) => {
      const channelIndex = source.indexOf(channel);
      if (channelIndex < 0) return true;
      const handlerBlock = source.slice(channelIndex, channelIndex + 900);
      return !handlerBlock.includes("assertWorkspaceAdminAccess(");
    });

    expect(missingGuard).toEqual([]);
    expect(source).toContain('requiredPermission: "users.invite"');
  });

  it("re-checks the conflict workspace before resolving sync conflicts", () => {
    const source = readText("apps/desktop/electron/main/ipc/registerAppIpc.ts");
    const handlerIndex = source.indexOf("ipcChannels.app.resolveSyncConflict");
    const handlerBlock = source.slice(handlerIndex, handlerIndex + 800);

    expect(handlerIndex).toBeGreaterThan(-1);
    expect(source).toContain("getSyncConflictWorkspaceId");
    expect(handlerBlock).toContain("getSyncConflictWorkspaceId(database, input.conflictId)");
    expect(handlerBlock).toContain('throw new Error("That sync conflict no longer exists.")');
    expect(handlerBlock).toContain('assertWorkspaceAdminAccess(workspaceId, "resolve sync conflicts")');
    expect(handlerBlock).not.toContain('assertSensitiveAppAccess("resolve sync conflicts")');
  });

  it("re-verifies cached local workspace memberships in the main process", () => {
    const source = readText("apps/desktop/electron/main/ipc/registerAppIpc.ts");
    const handlerIndex = source.indexOf("ipcChannels.app.ensureLocalWorkspaces");
    const handlerBlock = source.slice(handlerIndex, handlerIndex + 1200);

    expect(handlerIndex).toBeGreaterThan(-1);
    expect(source).toContain("sanitizeEnsureLocalWorkspacesInput");
    expect(source).toContain("getFreshStoredUserId()");
    expect(source).toContain('table: "workspace_memberships"');
    expect(source).toContain("roles!workspace_memberships_workspace_role_fk");
    expect(handlerBlock).toContain("sanitizeEnsureLocalWorkspacesInput(input)");
  });

  it("requires workspace access before applying remote pull rows locally", () => {
    const source = readText("apps/desktop/electron/main/ipc/registerAppIpc.ts");
    const guardedChannels = [
      "ipcChannels.app.applyRemoteCatalogRows",
      "ipcChannels.app.applyRemoteKits",
      "ipcChannels.app.applyRemoteSyncTombstones",
      "ipcChannels.app.applyRemoteExchangeRates",
      "ipcChannels.app.applyRemoteAssetSnapshots",
      "ipcChannels.app.applyRemoteOperationalSnapshots",
      "ipcChannels.app.applyRemoteWorkspaceFiles",
      "ipcChannels.app.applyRemoteTreasuryRows",
      "ipcChannels.app.applyRemoteCollaboratorPaymentRows",
      "ipcChannels.app.applyRemoteFinanceBusinessRows",
      "ipcChannels.app.applyRemoteAutomationControlPlaneRows",
    ];

    const missingGuard = guardedChannels.filter((channel) => {
      const channelIndex = source.indexOf(channel);
      if (channelIndex < 0) return true;
      const handlerBlock = source.slice(channelIndex, channelIndex + 1000);
      return !handlerBlock.includes("assertWorkspaceReadAccess(");
    });

    expect(missingGuard).toEqual([]);
    expect(source).toContain('accessLevel: "read"');
    expect(source).toContain('action: "apply remote automation updates"');
  });

  it("does not let plain workspace membership mutate the remote automation control plane", () => {
    const migrationText = listFiles("supabase/migrations")
      .filter((relativePath) => relativePath.endsWith(".sql"))
      .map(readText)
      .join("\n");
    const hardeningMigration = readText(
      "supabase/migrations/20260617113000_automation_control_plane_admin_write_hardening.sql",
    );

    expect(migrationText).toContain('CREATE POLICY "admins can insert agents control plane"');
    expect(migrationText).toContain('WITH CHECK (public.has_permission(workspace_id, \'users.invite\'))');
    expect(migrationText).toContain('CREATE POLICY "admins can update ai provider configs"');
    expect(migrationText).toContain('CREATE POLICY "admins can delete agent connector configs"');
    expect(hardeningMigration).toContain('DROP POLICY IF EXISTS "members can insert agents control plane" ON public.agents;');
    expect(hardeningMigration).toContain('DROP POLICY IF EXISTS "members can update ai provider configs" ON public.ai_provider_configs;');
    expect(hardeningMigration).toContain(
      'DROP POLICY IF EXISTS "members can delete agent connector configs" ON public.agent_connector_configs;',
    );
  });

  it("does not let plain workspace membership mutate remote asset assignments", () => {
    const hardeningMigration = readText(
      "supabase/migrations/20260708103000_asset_assignments_write_hardening.sql",
    );
    const foundationIpcSource = readText("apps/desktop/electron/main/ipc/registerFoundationIpc.ts");

    expect(foundationIpcSource).toContain('requiredPermission: "assets.manage"');
    expect(hardeningMigration).toContain(
      'DROP POLICY IF EXISTS "members can insert workspace asset assignments" ON public.asset_assignments;',
    );
    expect(hardeningMigration).toContain("public.has_permission(workspace_id, 'assets.read')");
    expect(hardeningMigration).toContain(
      'CREATE POLICY "admins can insert workspace asset assignments"',
    );
    expect(hardeningMigration).toContain(
      "WITH CHECK (public.has_permission(workspace_id, 'assets.manage'));",
    );
    expect(hardeningMigration).toContain(
      'CREATE POLICY "admins can update workspace asset assignments"',
    );
    expect(hardeningMigration).toContain(
      'CREATE POLICY "admins can delete workspace asset assignments"',
    );
  });

  it("does not bootstrap existing workspaces by slug upsert", () => {
    const source = readText("supabase/functions/admin-workspace-bootstrap/index.ts");

    expect(source).not.toMatch(/\.from\("workspaces"\)\s*[\s\S]{0,500}\.upsert\(/);
    expect(source).toMatch(/\.from\("workspaces"\)\s*[\s\S]{0,500}\.insert\(/);
    expect(source).toContain("workspace_slug_already_exists");
    expect(source).toContain('"finance.manage"');
    expect(source).toContain('"treasury.transactions.read"');
  });

  it("keeps membership roles scoped to their workspace", () => {
    const migrationText = listFiles("supabase/migrations")
      .filter((relativePath) => relativePath.endsWith(".sql"))
      .map(readText)
      .join("\n");
    const sendInviteSource = readText("supabase/functions/send-invite/index.ts");

    expect(migrationText).toMatch(/FOREIGN KEY\s*\(\s*workspace_id\s*,\s*role_id\s*\)\s*REFERENCES\s+public\.roles\s*\(\s*workspace_id\s*,\s*id\s*\)/i);
    expect(migrationText).toMatch(/JOIN\s+public\.roles\s+r\s+ON\s+r\.id\s*=\s*wm\.role_id\s+AND\s+r\.workspace_id\s*=\s*wm\.workspace_id/i);
    expect(sendInviteSource).toMatch(/\.from\("roles"\)[\s\S]*?\.eq\("id",\s*payload\.roleId\)[\s\S]*?\.eq\("workspace_id",\s*payload\.workspaceId\)/);
  });

  it("protects workspace document storage with domain permissions instead of membership only", () => {
    const migrationText = listFiles("supabase/migrations")
      .filter((relativePath) => relativePath.endsWith(".sql"))
      .map(readText)
      .join("\n");

    expect(migrationText).toContain("can_access_workspace_document");
    expect(migrationText).toContain("treasury.transactions.read");
    expect(migrationText).toContain("treasury.import");
    expect(migrationText).not.toMatch(/CREATE POLICY "workspace_documents_read"[\s\S]*?public\.workspace_memberships[\s\S]*?split_part\(name,\s*'\/',\s*1\)/i);
  });

  it("does not allow finance read permission to satisfy write IPC handlers", () => {
    const source = readText("apps/desktop/electron/main/ipc/registerFoundationIpc.ts");
    const writeChannelExpectations = [
      ["ipcChannels.finance.create", "finance.manage"],
      ["ipcChannels.finance.update", "finance.manage"],
      ["ipcChannels.currency.upsertSettings", "currency.manage_rates"],
      ["ipcChannels.currency.createRate", "currency.manage_rates"],
      ["ipcChannels.currency.deleteRate", "currency.manage_rates"],
      ["ipcChannels.currency.saveProviderConfig", "currency.manage_rates"],
      ["ipcChannels.currency.refreshRates", "currency.manage_rates"],
      ["ipcChannels.quotes.create", "quotes.create"],
      ["ipcChannels.quotes.update", "quotes.edit"],
      ["ipcChannels.quotes.setStatus", "quotes.edit"],
      ["ipcChannels.quotes.duplicate", "quotes.create"],
      ["ipcChannels.quotes.delete", "quotes.cancel"],
    ] as const;

    const missingPermissions = writeChannelExpectations.filter(([channel, permission]) => {
      const channelIndex = source.indexOf(channel);
      if (channelIndex < 0) return true;
      const handlerBlock = source.slice(channelIndex, channelIndex + 700);
      return !handlerBlock.includes(`requiredPermission: "${permission}"`) && !handlerBlock.includes(`"${permission}"`);
    });

    expect(missingPermissions).toEqual([]);
  });

  it("does not expose persisted Supabase refresh tokens to the renderer", () => {
    const preloadSource = readText("apps/desktop/electron/preload/index.ts");
    const channelsSource = readText("packages/contracts/src/ipc/channels.ts");
    const sessionProviderSource = readText("apps/desktop/src/app/providers/SessionProvider.tsx");

    expect(preloadSource).not.toContain("getStoredTokens");
    expect(channelsSource).not.toContain("getStoredTokens");
    expect(sessionProviderSource).not.toContain("getStoredTokens");
    expect(preloadSource).toContain("getAccessToken");
  });

  it("does not treat Supabase's empty initial renderer session as a stored-session logout", () => {
    const sessionProviderSource = readText("apps/desktop/src/app/providers/SessionProvider.tsx");

    expect(sessionProviderSource).toContain('event === "INITIAL_SESSION" && !nextSession');
    expect(sessionProviderSource).toContain("buildCachedSessionUser(storedAccessToken)");
  });

  it("uses the workspace-scoped role relationship when embedding membership roles", () => {
    const remoteWorkspaceSources = [
      "apps/desktop/src/app/providers/WorkspaceProvider.tsx",
      "apps/desktop/src/features/admin/WorkspaceSettingsPage.tsx",
    ];
    const ambiguousEmbeds: string[] = [];

    for (const relativePath of remoteWorkspaceSources) {
      const lines = toLines(readText(relativePath));
      lines.forEach((line, index) => {
        if (/\.select\([^)]*roles\(/.test(line)) {
          ambiguousEmbeds.push(`${relativePath}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(ambiguousEmbeds).toEqual([]);
    expect(readText("apps/desktop/src/app/providers/WorkspaceProvider.tsx")).toContain(
      "roles!workspace_memberships_workspace_role_fk",
    );
  });

  it("scopes notification IPC to the main-process session user, not the renderer-supplied id", () => {
    const source = readText("apps/desktop/electron/main/ipc/registerNotificationIpc.ts");

    // The trusted-id helper must exist and be derived from the signed-in session.
    expect(source).toContain("resolveTrustedUserId");
    expect(source).toContain("getFreshStoredUserId");

    // Every write/read handler must override userId via the helper instead of
    // forwarding the renderer-provided id verbatim.
    const forwardsRawUserId = /service\.(?:listNotifications|createNotification|markRead|markAllRead|listTodos|createTodo|updateTodo|deleteTodo|listReminders|createReminder|updateReminder|deleteReminder)\((?:input|query)\b/;
    expect(forwardsRawUserId.test(source)).toBe(false);

    const handlerCount = (source.match(/await resolveTrustedUserId\(/g) ?? []).length;
    expect(handlerCount).toBeGreaterThanOrEqual(12);
  });

  it("keeps sensitive workspace Edge Function calls behind main-process IPC", () => {
    const workspaceProviderSource = readText("apps/desktop/src/app/providers/WorkspaceProvider.tsx");
    const inviteServiceSource = readText("apps/desktop/src/features/admin/inviteService.ts");
    const combinedRendererSource = `${workspaceProviderSource}\n${inviteServiceSource}`;

    expect(combinedRendererSource).not.toContain("/functions/v1/admin-workspace-bootstrap");
    expect(combinedRendererSource).not.toContain("/functions/v1/send-invite");
    expect(combinedRendererSource).not.toContain("getAccessToken()");
    expect(workspaceProviderSource).toContain("createRemoteWorkspace");
    expect(inviteServiceSource).toContain("sendWorkspaceInvite");
  });

  it("narrows cached offline workspace permissions for sensitive finance domains", () => {
    const workspaceProviderSource = readText("apps/desktop/src/app/providers/WorkspaceProvider.tsx");
    const workspaceAccessGuardSource = readText("apps/desktop/electron/main/services/auth/workspaceAccessGuard.ts");

    expect(workspaceProviderSource).toContain("onlineOnlyPermissionPrefixes");
    expect(workspaceProviderSource).toContain("roleKey: null");
    expect(workspaceProviderSource).toContain("roleName: \"Cached access\"");
    expect(workspaceProviderSource).toContain("!onlineOnlyPermissionKeys.has(permissionKey)");
    expect(workspaceAccessGuardSource).toContain("requiresOnlinePermissionCheck(requiredPermission)");
    expect(workspaceAccessGuardSource).toContain("Supabase must be reachable");
  });

  it("uses refreshed main-process Supabase tokens for online finance and storage checks", () => {
    const localDatabaseSource = readText("apps/desktop/electron/main/services/data/localDatabase.ts");

    expect(localDatabaseSource).toContain("getFreshStoredAccessToken");
    expect(localDatabaseSource).toContain("getTokens: async () => ({ accessToken: await getFreshStoredAccessToken() })");
    expect(localDatabaseSource).toContain("getAccessToken: getFreshStoredAccessToken");
    expect(localDatabaseSource).not.toContain("supabaseTokenStore.getTokens()");
  });

  it("sanitizes sync outbox payload previews before they reach the renderer", () => {
    const source = readText("apps/desktop/electron/main/services/data/syncOutboxWorkerService.ts");

    expect(source).toContain("sanitizeOutboxPayloadJson(row.payload_json)");
    expect(source).not.toContain("payloadJson: row.payload_json");
  });

  it("keeps XLSX imports behind bounded parsing helpers", () => {
    const documentExtractionSource = readText("apps/desktop/electron/main/services/data/documentExtractionService.ts");
    const bankParserSource = readText("apps/desktop/src/features/finance/treasury/bankStatementParsers.ts");
    const xlsxSafetySource = readText("apps/desktop/src/shared/lib/xlsxSafety.ts");

    expect(documentExtractionSource).toContain("parseBoundedXlsxGrid");
    expect(bankParserSource).toContain("parseBoundedXlsxGrid");
    expect(xlsxSafetySource).toContain("MAX_XLSX_BYTES");
    expect(xlsxSafetySource).toContain("sheetRows: MAX_XLSX_ROWS + 1");
  });

  it("keeps sensitive exports behind an explicit confirmation step in Settings", () => {
    const settingsSource = readText("apps/desktop/src/features/admin/SettingsPage.tsx");
    const supportDiagnosticsSource = readText("apps/desktop/electron/main/services/data/supportDiagnosticsService.ts");

    expect(settingsSource).toContain('const confirmSensitiveExport = async (kind: "workspaceData" | "supportBundle" | "logs") =>');
    expect(settingsSource).toContain('const confirmed = await confirmSensitiveExport("supportBundle")');
    expect(settingsSource).toContain('const confirmed = await confirmSensitiveExport("logs")');
    expect(settingsSource).toContain('const confirmed = await confirmSensitiveExport("workspaceData")');
    expect(supportDiagnosticsSource).toContain("support-manifest.json");
    expect(supportDiagnosticsSource).toContain("crypto.createHash(\"sha256\")");
    expect(supportDiagnosticsSource).toContain("sanitizeStructuredValue");
  });

  it("gates app-level diagnostics, export, sync, and documents-root IPC behind a sensitive access guard", () => {
    const appIpcSource = readText("apps/desktop/electron/main/ipc/registerAppIpc.ts");
    const expectedGuardedChannels = [
      "ipcChannels.app.createBackup",
      "ipcChannels.app.restoreBackup",
      "ipcChannels.app.runIntegrityCheck",
      "ipcChannels.app.runLocalSync",
      "ipcChannels.app.getSyncOutboxRows",
      "ipcChannels.app.getSyncPullCursors",
      "ipcChannels.app.getSyncStatusSnapshot",
      "ipcChannels.app.retrySyncOutboxRow",
      "ipcChannels.app.retryAllFailedSyncOutboxRows",
      "ipcChannels.app.exportWorkspaceData",
      "ipcChannels.app.exportRecentLogs",
      "ipcChannels.app.exportSupportBundle",
      "ipcChannels.app.chooseDocumentsRoot",
      "ipcChannels.app.resetDocumentsRoot",
    ];

    expect(appIpcSource).toContain("const assertSensitiveAppAccess = async");
    expect(appIpcSource).toContain('requiredPermission: "users.invite"');

    const missingSensitiveGuard = expectedGuardedChannels.filter((channel) => {
      const channelIndex = appIpcSource.indexOf(channel);
      if (channelIndex < 0) return true;
      const handlerBlock = appIpcSource.slice(channelIndex, channelIndex + 700);
      return !handlerBlock.includes("assertSensitiveAppAccess(");
    });

    expect(missingSensitiveGuard).toEqual([]);

    const workspaceScopedChannels = [
      "ipcChannels.app.getSyncConflicts",
      "ipcChannels.app.backfillOperationalSnapshots",
      // Resolving a conflict requires admin of the workspace that owns it,
      // which is narrower than the app-wide sensitive gate.
      "ipcChannels.app.resolveSyncConflict",
    ];
    const missingWorkspaceGuard = workspaceScopedChannels.filter((channel) => {
      const channelIndex = appIpcSource.indexOf(channel);
      if (channelIndex < 0) return true;
      const handlerBlock = appIpcSource.slice(channelIndex, channelIndex + 500);
      return !handlerBlock.includes("assertWorkspaceAdminAccess(");
    });

    expect(missingWorkspaceGuard).toEqual([]);
  });

  it("keeps local at-rest hardening centralized in the storage privacy helper", () => {
    const backupSource = readText("apps/desktop/electron/main/services/data/localDatabaseSupport.ts");
    const secretStoreSource = readText("apps/desktop/electron/main/services/ai/aiSecretStore.ts");
    const fileUploadSource = readText("apps/desktop/electron/main/services/data/fileUploadService.ts");
    const invoiceInboxSource = readText("apps/desktop/electron/main/services/data/invoiceInboxService.ts");
    const assistantChatSource = readText("apps/desktop/electron/main/services/data/assistantChatService.ts");
    const helperSource = readText("apps/desktop/electron/main/security/storagePrivacy.ts");

    expect(helperSource).toContain("PRIVATE_FILE_MODE = 0o600");
    expect(helperSource).toContain("PRIVATE_DIRECTORY_MODE = 0o700");
    expect(backupSource).toContain("ensurePrivateFile(backupPath)");
    expect(secretStoreSource).toContain("writePrivateFile(getSecretFilePath()");
    expect(fileUploadSource).toContain("ensurePrivateFile(storagePath)");
    expect(invoiceInboxSource).toContain("writePrivateFile(storagePath, buffer)");
    expect(assistantChatSource).toContain("writePrivateFile(storagePath, buffer)");
  });

  it("does not silently downgrade encrypted local database failures to plaintext", () => {
    const encryptionSource = readText("apps/desktop/electron/main/services/data/databaseEncryption.ts");

    expect(encryptionSource).not.toContain("openPlaintextDatabase");
    expect(encryptionSource).not.toContain("databaseEncrypted: false");
    expect(encryptionSource).not.toMatch(/opening plaintext/i);
  });

  it("keeps trusted avatar and workspace image uploads behind main-process IPC", () => {
    const rendererUploadSources = [
      "apps/desktop/src/features/admin/UserAccountSettings.tsx",
      "apps/desktop/src/features/admin/WorkspaceBrandingCard.tsx",
      "apps/desktop/src/features/admin/WorkspaceSettingsPage.tsx",
    ];
    const combinedRendererSource = rendererUploadSources.map(readText).join("\n");
    const appIpcSource = readText("apps/desktop/electron/main/ipc/registerAppIpc.ts");

    expect(combinedRendererSource).not.toContain("supabase.storage");
    expect(combinedRendererSource).not.toContain(".storage.from(");
    expect(combinedRendererSource).toContain("uploadUserAvatar");
    expect(combinedRendererSource).toContain("uploadWorkspaceImageAsset");
    expect(appIpcSource).toContain("ipcChannels.app.uploadUserAvatar");
    expect(appIpcSource).toContain("ipcChannels.app.uploadWorkspaceImageAsset");
  });

  it("keeps user profile writes behind main-process IPC", () => {
    const rendererProfileSource = readText("apps/desktop/src/features/admin/UserAccountSettings.tsx");
    const appIpcSource = readText("apps/desktop/electron/main/ipc/registerAppIpc.ts");

    expect(rendererProfileSource).not.toMatch(
      /\.from\("user_profiles"\)[\s\S]{0,500}\.(?:insert|update|upsert|delete)\(/,
    );
    expect(rendererProfileSource).toContain("upsertUserProfile");
    expect(appIpcSource).toContain("ipcChannels.app.upsertUserProfile");
    expect(appIpcSource).toContain('table: "user_profiles"');
  });

  it("keeps workspace admin mutations behind main-process IPC", () => {
    const rendererAdminSources = [
      "apps/desktop/src/features/admin/inviteService.ts",
      "apps/desktop/src/features/admin/customRolesService.ts",
      "apps/desktop/src/features/admin/WorkspaceSettingsPage.tsx",
    ];
    const combinedRendererSource = rendererAdminSources.map(readText).join("\n");
    const appIpcSource = readText("apps/desktop/electron/main/ipc/registerAppIpc.ts");

    expect(combinedRendererSource).not.toMatch(/\.from\("workspace_memberships"\)[\s\S]{0,500}\.(?:insert|update|upsert|delete)\(/);
    expect(combinedRendererSource).not.toMatch(/\.from\("roles"\)[\s\S]{0,500}\.(?:insert|update|upsert|delete)\(/);
    expect(combinedRendererSource).not.toMatch(/\.from\("role_permissions"\)[\s\S]{0,500}\.(?:insert|update|upsert|delete)\(/);
    expect(combinedRendererSource).not.toMatch(/\.from\("workspaces"\)[\s\S]{0,500}\.(?:insert|update|upsert|delete)\(/);
    expect(combinedRendererSource).toContain("updateRemoteWorkspaceIdentity");
    expect(combinedRendererSource).toContain("updateWorkspaceMemberRole");
    expect(combinedRendererSource).toContain("setRolePermission");
    expect(appIpcSource).toContain("assertWorkspaceRole");
    expect(appIpcSource).toContain("ipcChannels.app.updateRemoteWorkspaceIdentity");
    expect(appIpcSource).toContain("ipcChannels.app.setRolePermission");
  });

  it("keeps Finance routes, sidebar, project budget, and sync pulls behind finance permissions", () => {
    const routesSource = readText("apps/desktop/src/app/routing/routes.tsx");
    const sidebarSource = readText("apps/desktop/src/app/shell/ShellSidebar.tsx");
    const appShellSource = readText("apps/desktop/src/app/shell/AppShell.tsx");
    const treasuryPullSource = readText("apps/desktop/src/shared/hooks/useTreasuryPull.ts");
    const financePullSource = readText("apps/desktop/src/shared/hooks/useFinanceBusinessPull.ts");
    const collaboratorPullSource = readText("apps/desktop/src/shared/hooks/useCollaboratorPaymentPull.ts");

    expect(routesSource).toContain("FinanceAccessGuard");
    expect(routesSource).toContain('route.domain === "finance" || route.projectSection === "budget"');
    expect(sidebarSource).toContain("hasFinanceAccess(activeMembership)");
    expect(sidebarSource).toContain('item.path.startsWith("/finance") && !canAccessFinance');
    expect(appShellSource).toContain("buildProjectSubnav(activeProjectId, { includeBudget: canAccessFinance })");
    expect(treasuryPullSource).toContain("!canPullTreasury");
    expect(treasuryPullSource).toContain(
      '{ table: "transaction_links", cursorColumn: "updated_at", idColumn: "id" }',
    );
    expect(treasuryPullSource).toContain('transaction_links: "v3"');
    expect(financePullSource).toContain("!canPullFinanceBusiness");
    expect(collaboratorPullSource).toContain("!canPullCollaboratorPayments");
  });

  it("keeps treasury card reminder sync compatible with Supabase uuid ids", () => {
    const treasuryMutationSource = readText("apps/desktop/electron/main/services/data/treasuryMutationService.ts");
    const localDatabaseSource = readText("apps/desktop/electron/main/services/data/localDatabase.ts");

    expect(treasuryMutationSource).toContain("uuidFromStableKey(`treasury-card-payment:${paymentInstrumentId}`)");
    expect(treasuryMutationSource).toContain("legacyCardPaymentReminderId");
    expect(localDatabaseSource).toContain('row.entity_id.startsWith("treasury-card-payment-")');
    expect(treasuryMutationSource).not.toContain("const cardPaymentReminderId = (paymentInstrumentId: string) => `treasury-card-payment-${paymentInstrumentId}`;");
  });

  it("does not expose project budget targets to generic workspace members", () => {
    const migrationText = readText("supabase/migrations/20260605130000_finance_access_role_hardening.sql");

    expect(migrationText).toContain('DROP POLICY IF EXISTS "members can read project budget targets"');
    expect(migrationText).toContain('CREATE POLICY "finance can read project budget targets"');
    expect(migrationText).toContain("public.has_permission(workspace_id, 'finance.read')");
    expect(migrationText).toContain('CREATE POLICY "finance can manage project budget targets"');
    expect(migrationText).toContain("public.has_permission(workspace_id, 'finance.manage')");
    expect(migrationText).not.toContain("public.is_workspace_member(workspace_id)");
  });

  it("sanitizes project finance fields outside Finance access", () => {
    const foundationIpcSource = readText("apps/desktop/electron/main/ipc/registerFoundationIpc.ts");
    const projectReadSource = readText("apps/desktop/electron/main/services/data/projectReadService.ts");
    const projectPageSource = readText("apps/desktop/src/features/projects/ProjectsPage.tsx");
    const projectDetailPanelSource = readText("apps/desktop/src/features/projects/ProjectDetailPanel.tsx");

    expect(foundationIpcSource).toContain("canReadFinanceForWorkspace");
    expect(foundationIpcSource).toContain("getProjectListForWorkspace");
    expect(foundationIpcSource).toContain("foundationReads.getProjects(safeQuery, { includeFinancials })");
    expect(foundationIpcSource).toContain("getProjectDetailForWorkspace");
    expect(foundationIpcSource).toContain("foundationReads.getProjectDetail(projectId, { includeFinancials })");
    expect(foundationIpcSource).not.toContain("foundationReads.getProjectDetail(input.projectId)");
    expect(foundationIpcSource).not.toContain("foundationReads.getProjects(normalizeProjectListQuery({ workspaceId");
    expect(projectReadSource).toContain('exposure: includeFinancials ? deps.formatCurrency(row.exposure) : "—"');
    expect(projectReadSource).toContain('replacementValue: includeFinancials ? deps.formatCurrency(row.replacement_value) : "—"');
    expect(projectReadSource).toContain('costEstimate: includeFinancials ? deps.formatCurrency(row.cost_estimate) : "—"');
    expect(projectReadSource).toContain("includeFinancials ? (hasBudgetEntries ? \"Finance hooks linked\" : \"No finance entries yet\") : \"Restricted\"");
    expect(projectPageSource).toContain('option.value !== "exposure"');
    // Exposure (a finance field) is only rendered inside the budget quick action,
    // which is gated behind canAccessFinance.
    expect(projectDetailPanelSource).toContain("...(canAccessFinance");
    expect(projectDetailPanelSource).toContain("exposure: project.exposure");
  });

  it("keeps cached workspace users idempotent when a local user already owns the same email", () => {
    const localDatabaseSource = readText("apps/desktop/electron/main/services/data/localDatabase.ts");

    expect(localDatabaseSource).toContain("findUserByEmail");
    expect(localDatabaseSource).toContain("LOWER(email) = LOWER(?)");
    expect(localDatabaseSource).toContain("@cached.bukowskios.local");
    expect(localDatabaseSource).toContain("emailOwner && emailOwner.id !== workspace.userId");
  });

  it("reuses existing local role keys when caching remote workspace memberships", () => {
    const localDatabaseSource = readText("apps/desktop/electron/main/services/data/localDatabase.ts");

    expect(localDatabaseSource).toContain("findRoleByWorkspaceAndKey");
    expect(localDatabaseSource).toContain("WHERE workspace_id = ?");
    expect(localDatabaseSource).toContain("AND key = ?");
    expect(localDatabaseSource).toContain("const cachedRoleId = existingRole?.id");
    expect(localDatabaseSource).toContain("if (!existingRole)");
    expect(localDatabaseSource).toContain("if (!existingRole?.isSystemRole)");
  });

  it("requires user permissions on finance and treasury agent read tools", () => {
    const source = readText("apps/desktop/electron/main/services/ai/agentToolRegistry.ts");
    const expectedPermissions = [
      ["get_financial_exposure_summary", "finance.read"],
      ["get_budget_vs_actual", "finance.read"],
      ["get_monthly_burn_rate", "finance.read"],
      ["get_expense_breakdown", "finance.read"],
      ["get_financial_health", "finance.read"],
      ["get_project_financials", "finance.read"],
      ["get_incident_costs", "finance.read"],
      ["get_asset_exposure", "finance.read"],
      ["get_open_invoices", "finance.read"],
      ["get_reserves_status", "finance.read"],
      ["get_treasury_overview", "treasury.transactions.read"],
      ["list_bank_accounts", "treasury.transactions.read"],
      ["list_bank_movements", "treasury.transactions.read"],
      ["get_treasury_review_queue", "treasury.transactions.read"],
      ["get_deductible_ledger", "treasury.transactions.read"],
      ["get_dgii_report", "treasury.transactions.read"],
      ["get_project_pnl", "treasury.transactions.read"],
    ] as const;

    const missingGuards = expectedPermissions.filter(([toolName, permission]) => {
      const toolIndex = source.indexOf(`name: "${toolName}"`);
      if (toolIndex < 0) return true;
      const definitionPreview = source.slice(toolIndex, toolIndex + 220);
      return !definitionPreview.includes(`requiredPermission: "${permission}"`);
    });

    expect(missingGuards).toEqual([]);
    expect(source).toContain("assertToolPermission(tool, context)");
  });

  it("hardens tombstone recreation for all 30 synchronized targets", () => {
    const migration = readText(
      "supabase/migrations/20260621152401_sync_tombstone_recreation_hardening.sql",
    );
    const targetArray = migration.match(/target_tables CONSTANT text\[\] := ARRAY\[([\s\S]*?)\];/)?.[1] ?? "";
    const targetNames = Array.from(targetArray.matchAll(/'([a-z_]+)'/g), (match) => match[1]);

    expect(targetNames).toHaveLength(30);
    expect(new Set(targetNames).size).toBe(30);
    expect(targetNames).toEqual(expect.arrayContaining(["exchange_rates", "todos", "reminders"]));
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.clear_sync_tombstone_on_recreation()");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.clear_sync_tombstone_on_recreation() FROM PUBLIC, anon, authenticated;",
    );
    expect(migration).toContain("CREATE TRIGGER record_sync_tombstone_after_delete AFTER DELETE");
    expect(migration).toContain("CREATE TRIGGER clear_sync_tombstone_after_insert AFTER INSERT");
    expect(migration).toContain("DELETE FROM public.sync_tombstones AS tombstone");
    expect(migration).toContain("to_regclass(format('%I.%I', 'public', target_table))");
    expect(migration).toContain("live.%I::text = tombstone.entity_id");
  });

  it("pulls asset metadata with a cursor independent from current state", () => {
    const source = readText("apps/desktop/src/shared/hooks/useAssetSnapshotPull.ts");

    expect(source).toContain("bukowski:asset-metadata-pull-cursor:");
    expect(source).toContain('.from("assets")');
    expect(source).toContain('applyCompositePullCursor(assetQuery, assetCursor, "updated_at", "id")');
    expect(source).toContain('.from("asset_current_state")');
    expect(source).toContain('.in("asset_id", assetIds)');
  });

  it("never copies local demo project shells into remote workspaces", () => {
    const source = readText("apps/desktop/electron/main/services/data/localDatabase.ts");

    expect(source).not.toContain("seedProjectShellForWorkspace");
    expect(source).not.toContain("Seeded project shell rows for remote workspaces");
  });

  it("uses server-authoritative clocks across synchronized streams", () => {
    const migration = readText("supabase/migrations/20260621192648_sync_server_clock_authority.sql");
    const guardedServices = [
      "catalogPullService.ts",
      "assetSnapshotPullService.ts",
      "operationalSnapshotService.ts",
      "financialDomainPullService.ts",
      "automationControlPlanePullService.ts",
      "syncTombstonePullService.ts",
    ];

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.stamp_sync_updated_at()");
    expect(migration).toContain("NEW.updated_at := statement_timestamp()");
    expect(migration).toContain("NEW.created_at := statement_timestamp()");
    expect(migration).toContain("BEFORE INSERT OR UPDATE");
    expect(migration).toContain("NEW.created_at := OLD.created_at");
    expect(migration).toContain("stamp_sync_created_at_before_write BEFORE INSERT OR UPDATE");
    expect(migration).toContain("interval ''5 minutes''");
    expect(migration).toContain("'operational_snapshots'");
    expect(migration).toContain("'asset_current_state'");
    expect(migration).toContain("'agent_connector_configs'");

    guardedServices.forEach((fileName) => {
      const source = readText(`apps/desktop/electron/main/services/data/${fileName}`);
      expect(source, fileName).toContain("syncTimestampPolicy");
    });
  });
});
