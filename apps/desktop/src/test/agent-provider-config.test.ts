import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { bootstrapAIGatewayFoundation } from "../../electron/main/services/data/aiGatewayFoundationBootstrap";
import { applyAIGatewayFoundationMigration } from "../../electron/main/services/data/aiGatewayFoundationBootstrap";
import { createAgentMutationService } from "../../electron/main/services/data/agentMutationService";
import { createAgentReadService } from "../../electron/main/services/data/agentReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("agent provider config", () => {
  it("bootstraps missing provider rows for existing workspaces", () => {
    const { cleanup, database } = createTestDatabase("bukowski-provider-bootstrap");

    database.prepare("DELETE FROM agent_activity_events").run();
    database.prepare("DELETE FROM agent_runs").run();
    database.prepare("DELETE FROM ai_provider_configs").run();
    database.prepare("DELETE FROM agents").run();
    bootstrapAIGatewayFoundation(database);

    const rows = database
      .prepare("SELECT provider_key FROM ai_provider_configs WHERE workspace_id = ? ORDER BY provider_key")
      .all("workspace-metadata") as Array<{ provider_key: string }>;
    const agentRows = database
      .prepare("SELECT agent_key FROM agents WHERE workspace_id = ? ORDER BY sort_order")
      .all("workspace-metadata") as Array<{ agent_key: string }>;

    expect(rows.map((row) => row.provider_key)).toEqual(["anthropic", "custom", "openai", "openclaw"]);
    expect(agentRows.map((row) => row.agent_key)).toEqual([
      "supervisor-agent",
      "assets-agent",
      "incidents-maintenance-agent",
      "finance-agent",
      "communications-agent",
      "projects-scheduling-agent",
      "bugs-agent",
      "product-agent",
    ]);

    cleanup();
  });

  it("persists provider config, stores the secret locally and updates agent assignments", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-provider-config");
    const secrets = new Map<string, string>();
    const secretStore = {
      hasProviderSecret: (workspaceId: string, providerKey: string) => secrets.has(`${workspaceId}:${providerKey}`),
      getProviderSecret: (workspaceId: string, providerKey: string) => secrets.get(`${workspaceId}:${providerKey}`) ?? null,
      setProviderSecret: (workspaceId: string, providerKey: string, secret: string) => {
        secrets.set(`${workspaceId}:${providerKey}`, secret);
      },
      clearProviderSecret: (workspaceId: string, providerKey: string) => {
        secrets.delete(`${workspaceId}:${providerKey}`);
      },
    };
    const mutations = createAgentMutationService(database, {
      secretStore,
      openaiProviderService: {
        createResponse: async () => ({
          ok: true as const,
          responseId: "resp-test",
          status: "completed",
          outputText: "{}",
          functionCalls: [],
        }),
        testConnection: async () => ({
          ok: true as const,
          status: "healthy" as const,
          summary: "OpenAI responded successfully.",
        }),
      },
      assistantGatewayService: {
        sendMessage: async () => {
          throw new Error("Not used in this test.");
        },
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
    });
    const reads = createAgentReadService(database, secretStore);

    const saveResult = mutations.saveAIProviderConfig({
      commandId: "cmd-provider-save",
      workspaceId: "workspace-metadata",
      providerKey: "openai",
      enabled: true,
      apiKey: "sk-test",
      baseUrl: "",
      defaultModelKey: "openai:gpt-5.4",
      timeoutMs: 45000,
      retryCount: 2,
    });

    expect(saveResult.status).toBe("configured");
    expect(secretStore.hasProviderSecret("workspace-metadata", "openai")).toBe(true);

    const assignResult = mutations.assignAgentModel({
      commandId: "cmd-assign-provider",
      workspaceId: "workspace-metadata",
      agentId: "agent-assets",
      providerKey: "openai",
      modelKey: "openai:gpt-5.4",
      modelLabel: "GPT-5.4",
    });

    expect(assignResult.summary).toContain("OpenAI");

    const testResult = await mutations.testAIProviderConnection({
      workspaceId: "workspace-metadata",
      providerKey: "openai",
    });

    expect(testResult.status).toBe("healthy");

    const modelsSnapshot = reads.getModelsSnapshot();
    const openaiProvider = modelsSnapshot.providers.find((provider) => provider.providerKey === "openai");
    const assetsAssignment = modelsSnapshot.assignments.find((assignment) => assignment.agentId === "agent-assets");

    expect(openaiProvider?.hasStoredSecret).toBe(true);
    expect(openaiProvider?.enabled).toBe(true);
    expect(openaiProvider?.status).toBe("healthy");
    expect(openaiProvider?.isActiveProvider).toBe(true);
    expect(openaiProvider?.lastSuccessAtLabel).not.toBe("Never");
    expect(assetsAssignment?.providerKey).toBe("openai");
    expect(assetsAssignment?.modelKey).toBe("openai:gpt-5.4");

    cleanup();
  });

  it("backfills durable chat soft-delete columns for legacy local databases", () => {
    const databasePath = path.join(os.tmpdir(), `bukowski-legacy-chat-${Date.now()}-${Math.random()}.sqlite`);
    const database = new DatabaseSync(databasePath);

    database.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY
      );
      INSERT INTO workspaces (id) VALUES ('workspace-metadata');

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        agent_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        emoji TEXT,
        role_summary TEXT,
        domain_key TEXT,
        model_key TEXT,
        model_label TEXT,
        status TEXT DEFAULT 'active',
        approval_mode TEXT DEFAULT 'supervised',
        allowed_tools_json TEXT DEFAULT '[]',
        allowed_domains_json TEXT DEFAULT '[]',
        notes TEXT,
        is_supervisor INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE agent_activity_events (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE assistant_chat_threads (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        context_key TEXT NOT NULL,
        context_label TEXT NOT NULL,
        summary_text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE assistant_chat_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        body TEXT NOT NULL,
        message_state TEXT NOT NULL DEFAULT 'completed',
        state_payload_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE assistant_chat_attachments (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        byte_size INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'available',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    applyAIGatewayFoundationMigration(database);

    const threadColumns = database.prepare("PRAGMA table_info(assistant_chat_threads)").all() as Array<{ name: string }>;
    const messageColumns = database.prepare("PRAGMA table_info(assistant_chat_messages)").all() as Array<{ name: string }>;
    const attachmentColumns = database.prepare("PRAGMA table_info(assistant_chat_attachments)").all() as Array<{ name: string }>;

    expect(threadColumns.some((column) => column.name === "deleted_at")).toBe(true);
    expect(messageColumns.some((column) => column.name === "deleted_at")).toBe(true);
    expect(attachmentColumns.some((column) => column.name === "deleted_at")).toBe(true);

    database.close();
    fs.unlinkSync(databasePath);
  });
});
