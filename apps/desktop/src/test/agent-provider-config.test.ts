import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { bootstrapAIGatewayFoundation } from "../../electron/main/services/data/aiGatewayFoundationBootstrap";
import { applyAIGatewayFoundationMigration } from "../../electron/main/services/data/aiGatewayFoundationBootstrap";
import { reconcileLiveProviderEnablement } from "../../electron/main/services/data/aiGatewayFoundationBootstrap";
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
      .prepare(
        "SELECT provider_key, supports_live_requests, default_model_key FROM ai_provider_configs WHERE workspace_id = ? ORDER BY provider_key",
      )
      .all("workspace-metadata") as Array<{
      provider_key: string;
      supports_live_requests: number;
      default_model_key: string;
    }>;
    const agentRows = database
      .prepare("SELECT agent_key FROM agents WHERE workspace_id = ? ORDER BY sort_order")
      .all("workspace-metadata") as Array<{ agent_key: string }>;

    expect(rows.map((row) => row.provider_key)).toEqual(["anthropic", "custom", "openai", "openclaw"]);
    expect(rows.find((row) => row.provider_key === "anthropic")).toMatchObject({
      supports_live_requests: 1,
      default_model_key: "anthropic:claude-sonnet-4-20250514",
    });
    expect(agentRows.map((row) => row.agent_key)).toEqual([
      "supervisor-agent",
      "assets-agent",
      "incidents-maintenance-agent",
      "finance-agent",
      "treasury-agent",
      "communications-agent",
      "projects-scheduling-agent",
      "bugs-agent",
      "product-agent",
    ]);

    cleanup();
  });

  it("additively merges new default tools on a version bump while preserving admin customizations", () => {
    const { cleanup, database } = createTestDatabase("bukowski-allowlist-reseed");

    // Simulate a pre-existing install (older seed_version) where an admin had a
    // narrow tool list plus one custom tool not in the config defaults.
    database
      .prepare(
        `UPDATE agents
           SET seed_version = 'v1',
               allowed_tools_json = ?
         WHERE workspace_id = 'workspace-metadata' AND agent_key = 'assets-agent'`,
      )
      .run(JSON.stringify(["search_assets", "custom_admin_tool"]));

    bootstrapAIGatewayFoundation(database);

    const row = database
      .prepare("SELECT seed_version, allowed_tools_json FROM agents WHERE workspace_id = 'workspace-metadata' AND agent_key = 'assets-agent'")
      .get() as { seed_version: string; allowed_tools_json: string };
    const tools = JSON.parse(row.allowed_tools_json) as string[];

    expect(row.seed_version).toBe("v11");
    // Admin's custom tool preserved.
    expect(tools).toContain("custom_admin_tool");
    // New default capabilities merged in.
    expect(tools).toContain("get_asset_availability");
    expect(tools).toContain("get_maintenance_queue");

    cleanup();
  });

  it("saves and tests Anthropic as a live provider", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-provider-anthropic-config");
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
    const calls: string[] = [];
    const mutations = createAgentMutationService(database, {
      secretStore,
      openaiProviderService: {
        createResponse: async () => ({
          ok: false as const,
          status: "unavailable" as const,
          summary: "OpenAI should not be used for Anthropic.",
        }),
        testConnection: async () => ({
          ok: false as const,
          status: "unavailable" as const,
          summary: "OpenAI should not be used for Anthropic.",
        }),
      },
      anthropicProviderService: {
        listModels: async () => [
          {
            key: "anthropic:claude-sonnet-4-20250514",
            label: "Claude Sonnet 4",
          },
          {
            key: "anthropic:claude-opus-4-1-20250805",
            label: "Claude Opus 4.1",
          },
        ],
        createResponse: async () => ({
          ok: true as const,
          responseId: "msg-test",
          status: "completed",
          outputText: "OK",
          functionCalls: [],
        }),
        testConnection: async (config) => {
          calls.push(config.defaultModelKey);
          return {
            ok: true as const,
            status: "healthy" as const,
            summary: "Anthropic responded successfully.",
          };
        },
      },
      assistantGatewayService: {
        sendMessage: async () => {
          throw new Error("Not used in this test.");
        },
        generateThreadTitle: async () => null,
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
    });

    const saveResult = mutations.saveAIProviderConfig({
      commandId: "cmd-provider-save-anthropic",
      workspaceId: "workspace-metadata",
      providerKey: "anthropic",
      enabled: true,
      apiKey: "sk-ant-test",
      baseUrl: "",
      defaultModelKey: "anthropic:claude-sonnet-4-20250514",
      fallbackModelKey: "anthropic:claude-opus-4-1-20250805",
      timeoutMs: 45000,
      retryCount: 2,
    });

    expect(saveResult.status).toBe("configured");
    expect(secretStore.hasProviderSecret("workspace-metadata", "anthropic")).toBe(true);

    const testResult = await mutations.testAIProviderConnection({
      workspaceId: "workspace-metadata",
      providerKey: "anthropic",
    });

    expect(testResult.status).toBe("healthy");
    expect(calls).toEqual(["anthropic:claude-sonnet-4-20250514"]);

    const refreshResult = await mutations.refreshAIProviderModels({
      workspaceId: "workspace-metadata",
      providerKey: "anthropic",
    });
    expect(refreshResult.summary).toContain("2 models");

    const modelsSnapshot = createAgentReadService(database, secretStore).getModelsSnapshot();
    const anthropicProvider = modelsSnapshot.providers.find((provider) => provider.providerKey === "anthropic");
    expect(anthropicProvider?.fallbackModelKey).toBe("anthropic:claude-opus-4-1-20250805");
    expect(anthropicProvider?.modelOptions.map((model) => model.key)).toEqual([
      "anthropic:claude-opus-4-1-20250805",
      "anthropic:claude-sonnet-4-20250514",
    ]);

    cleanup();
  });

  it("scopes provider settings to the requested workspace and rejects unavailable assignments", () => {
    const { cleanup, database } = createTestDatabase("bukowski-provider-workspace-scope");
    const secondaryWorkspaceId = "workspace-secondary-agents";
    const now = new Date().toISOString();
    database
      .prepare(
        `
          INSERT INTO workspaces (id, slug, name, base_currency, is_active, created_at, updated_at)
          VALUES (?, ?, ?, 'USD', 1, ?, ?)
        `,
      )
      .run(secondaryWorkspaceId, "secondary-agents", "Secondary Agents", now, now);
    bootstrapAIGatewayFoundation(database);

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
        generateThreadTitle: async () => null,
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
    });
    const reads = createAgentReadService(database, secretStore);

    mutations.saveAIProviderConfig({
      commandId: "cmd-provider-secondary-save",
      workspaceId: secondaryWorkspaceId,
      providerKey: "openai",
      enabled: true,
      apiKey: "sk-secondary",
      baseUrl: "",
      defaultModelKey: "openai:gpt-5.4-secondary",
      timeoutMs: 45000,
      retryCount: 2,
    });

    const defaultSnapshot = reads.getModelsSnapshot({ workspaceId: "workspace-metadata" });
    const secondarySnapshot = reads.getModelsSnapshot({ workspaceId: secondaryWorkspaceId });
    expect(defaultSnapshot.providers.find((provider) => provider.providerKey === "openai")?.defaultModelKey).not.toBe(
      "openai:gpt-5.4-secondary",
    );
    expect(secondarySnapshot.providers.find((provider) => provider.providerKey === "openai")?.defaultModelKey).toBe(
      "openai:gpt-5.4-secondary",
    );
    expect(secretStore.hasProviderSecret(secondaryWorkspaceId, "openai")).toBe(true);
    expect(secretStore.hasProviderSecret("workspace-metadata", "openai")).toBe(false);

    const secondaryAgent = database
      .prepare("SELECT id FROM agents WHERE workspace_id = ? AND agent_key = 'assets-agent' LIMIT 1")
      .get(secondaryWorkspaceId) as { id: string } | undefined;
    expect(secondaryAgent?.id).toBeTruthy();

    expect(() =>
      mutations.assignAgentModel({
        commandId: "cmd-assign-disabled-provider",
        workspaceId: secondaryWorkspaceId,
        agentId: secondaryAgent?.id ?? "",
        providerKey: "anthropic",
        modelKey: "anthropic:claude-sonnet-4-20250514",
        modelLabel: "Claude Sonnet 4",
      }),
    ).toThrow(/configured AI provider/u);

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
        generateThreadTitle: async () => null,
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

    const outboxRows = database
      .prepare(
        `
          SELECT entity_type, entity_id, operation_type
          FROM sync_outbox
          WHERE workspace_id = ?
            AND entity_type IN ('ai_provider_config', 'agent')
          ORDER BY created_at ASC
        `,
      )
      .all("workspace-metadata") as Array<{ entity_type: string; entity_id: string; operation_type: string }>;

    expect(outboxRows.some((row) => row.entity_type === "ai_provider_config" && row.operation_type === "upsert")).toBe(true);
    expect(
      outboxRows.some(
        (row) => row.entity_type === "agent" && row.entity_id === "agent-assets" && row.operation_type === "upsert",
      ),
    ).toBe(true);

    cleanup();
  });

  it("re-enables healthy live providers on startup when a secret is already stored", () => {
    const { cleanup, database } = createTestDatabase("bukowski-provider-enablement-repair");
    const secrets = new Map<string, string>();
    const secretStore = {
      hasProviderSecret: (workspaceId: string, providerKey: string) => secrets.has(`${workspaceId}:${providerKey}`),
      getProviderSecret: (_workspaceId: string, _providerKey: string) => null,
      setProviderSecret: (workspaceId: string, providerKey: string, secret: string) => {
        secrets.set(`${workspaceId}:${providerKey}`, secret);
      },
      clearProviderSecret: (workspaceId: string, providerKey: string) => {
        secrets.delete(`${workspaceId}:${providerKey}`);
      },
    };

    database
      .prepare(
        `
          UPDATE ai_provider_configs
          SET enabled = 0,
              status = 'healthy',
              updated_at = CURRENT_TIMESTAMP
          WHERE workspace_id = ?
            AND provider_key = 'openai'
        `,
      )
      .run("workspace-metadata");

    secretStore.setProviderSecret("workspace-metadata", "openai", "sk-test");

    reconcileLiveProviderEnablement(database, secretStore);

    const row = database
      .prepare(
        `
          SELECT enabled, status
          FROM ai_provider_configs
          WHERE workspace_id = ?
            AND provider_key = 'openai'
        `,
      )
      .get("workspace-metadata") as { enabled: number; status: string } | undefined;

    expect(row).toEqual({
      enabled: 1,
      status: "healthy",
    });

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
