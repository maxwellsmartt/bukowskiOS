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
});
