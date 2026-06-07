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
    expect(financePullSource).toContain("!canPullFinanceBusiness");
    expect(collaboratorPullSource).toContain("!canPullCollaboratorPayments");
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
    expect(projectDetailPanelSource).toContain("canAccessFinance ? (");
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
});
