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
  it("does not read, open or delete persisted storage_path values without the path safety guard", () => {
    const riskyOperations = /\b(?:readFileSync|unlinkSync|openPath)\s*\(/;
    const persistedPathReference = /\b(?:row|attachment|file|cached)\.storage_path\b/;
    const safeGuardReference = /assertPathWithinRoot|ensureSafePath|resolveStoredPath|resolveAttachmentPath|resolveCachedPath|safePath|safeStoragePath/;
    const violations: string[] = [];

    for (const relativePath of listFiles("apps/desktop/electron/main")) {
      if (!relativePath.endsWith(".ts")) continue;
      const lines = toLines(readText(relativePath));
      lines.forEach((line, index) => {
        if (!riskyOperations.test(line) || !persistedPathReference.test(line)) return;
        const localContext = lines.slice(Math.max(0, index - 5), Math.min(lines.length, index + 2)).join("\n");
        if (!safeGuardReference.test(localContext)) {
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
});
