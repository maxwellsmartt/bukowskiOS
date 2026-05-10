import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createConnectorBridgeService } from "../../electron/main/services/connectors/connectorBridgeService";
import { createAssistantChatService } from "../../electron/main/services/data/assistantChatService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const createAttachmentsRoot = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));

describe("connector bridge service", () => {
  it("creates telegram link tokens for active users without ambiguous joins", () => {
    const { cleanup, database } = createTestDatabase("bukowski-connector-bridge-link-token");
    const attachmentsRootPath = createAttachmentsRoot("bukowski-connector-bridge-link-token");
    const assistantChatService = createAssistantChatService(database, {
      attachmentsRootPath,
      assistantGatewayService: {
        sendMessage: async () => {
          throw new Error("Not used in this test.");
        },
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
      memoryService: {
        extractAndPersist: () => [],
        getOverlay: () => ({ agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] }),
        pruneStaleEntries: () => undefined,
        recordFailure: () => undefined,
      },
    });
    const service = createConnectorBridgeService(database, {
      assistantChatService,
    });

    const result = service.createLinkToken({
      connectorKey: "telegram",
      userId: "user-luis",
      expiresInMinutes: 30,
    });

    expect(result.token).toHaveLength(6);
    expect(result.summary).toContain("Luis");

    const tokenRow = database
      .prepare(
        `
          SELECT connector_key, target_user_id, status
          FROM connector_link_tokens
          WHERE target_user_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `,
      )
      .get("user-luis") as { connector_key: string; target_user_id: string; status: string } | undefined;

    expect(tokenRow).toMatchObject({
      connector_key: "telegram",
      target_user_id: "user-luis",
      status: "pending",
    });

    cleanup();
    fs.rmSync(attachmentsRootPath, { recursive: true, force: true });
  });

  it("blocks telegram DMs until the identity is explicitly linked", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-connector-bridge-unlinked");
    const attachmentsRootPath = createAttachmentsRoot("bukowski-connector-bridge-unlinked");
    database.prepare("UPDATE agent_connector_configs SET status = 'configured' WHERE connector_key = 'telegram'").run();

    const assistantChatService = createAssistantChatService(database, {
      attachmentsRootPath,
      assistantGatewayService: {
        sendMessage: async () => {
          throw new Error("Should not reach gateway for unlinked users.");
        },
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
      memoryService: {
        extractAndPersist: () => [],
        getOverlay: () => ({ agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] }),
        pruneStaleEntries: () => undefined,
        recordFailure: () => undefined,
      },
    });
    const service = createConnectorBridgeService(database, {
      assistantChatService,
    });

    const result = await service.processTelegramDm({
      externalUserId: "telegram-user-unlinked",
      externalUsername: "unlinked_ops",
      displayName: "Unlinked Ops",
      externalChannelId: "telegram-dm-unlinked",
      externalMessageId: "telegram-msg-1",
      message: "Necesito el estado del monitor Cine 7",
    });

    expect(result.status).toBe("linked_required");
    expect(result.replyText).toContain("vinculada");

    cleanup();
    fs.rmSync(attachmentsRootPath, { recursive: true, force: true });
  });

  it("reuses the same DM thread for a linked user and persists source metadata", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-connector-bridge-threading");
    const attachmentsRootPath = createAttachmentsRoot("bukowski-connector-bridge-threading");
    database.prepare("UPDATE agent_connector_configs SET status = 'configured' WHERE connector_key = 'telegram'").run();
    database.prepare(
      `
        INSERT INTO connector_accounts (
          id,
          workspace_id,
          connector_key,
          external_user_id,
          external_username,
          display_name,
          linked_user_id,
          link_status,
          linked_at,
          created_at,
          updated_at
        ) VALUES (?, 'workspace-metadata', 'telegram', ?, ?, ?, ?, 'linked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
    ).run("connector-account-linked", "telegram-user-linked", "luis_ops", "Luis via Telegram", "user-luis");

    const assistantChatService = createAssistantChatService(database, {
      attachmentsRootPath,
      assistantGatewayService: {
        sendMessage: async (input) => ({
          status: "answered" as const,
          stateLabel: "Routed to Supervisor Agent",
          stateBody: "Supervisor answered from the Telegram DM bridge.",
          assistantMessage: `Resumen operativo para: ${input.message}`,
          routedAgentId: "agent-supervisor",
          routedAgentName: "Supervisor Agent",
          routedAgentRole: "Supervisor Agent",
          intentLabel: "Telegram DM intent",
          commandStateLabel: "No changes applied",
          draftRunId: null,
          providerKey: "openai",
          modelKey: "openai:gpt-5.4",
          toolTraces: [],
          orchestration: {
            intent: "telegram_dm_summary",
            targetAgentId: "agent-supervisor",
            targetAgentName: "Supervisor Agent",
            confidence: 0.92,
            requiresApproval: false,
            toolCallRequested: false,
            toolCalls: [],
            userFacingSummary: "Operational summary prepared.",
            answerKind: "informational",
            draftRunTitle: null,
            draftRunDescription: null,
          },
        }),
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
      memoryService: {
        extractAndPersist: () => [],
        getOverlay: () => ({ agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] }),
        pruneStaleEntries: () => undefined,
        recordFailure: () => undefined,
      },
    });
    const service = createConnectorBridgeService(database, {
      assistantChatService,
    });

    const first = await service.processTelegramDm({
      externalUserId: "telegram-user-linked",
      externalUsername: "luis_ops",
      displayName: "Luis via Telegram",
      externalChannelId: "telegram-dm-linked",
      externalMessageId: "telegram-msg-thread-1",
      message: "Dame el estado del monitor Cine 7",
    });
    const second = await service.processTelegramDm({
      externalUserId: "telegram-user-linked",
      externalUsername: "luis_ops",
      displayName: "Luis via Telegram",
      externalChannelId: "telegram-dm-linked",
      externalMessageId: "telegram-msg-thread-2",
      message: "Y ahora el estado del Teradek",
      replyToMessageId: "telegram-msg-thread-1",
    });

    expect(first.status).toBe("delivery_pending");
    expect(second.status).toBe("delivery_pending");
    expect(first.threadId).toBeTruthy();
    expect(second.threadId).toBe(first.threadId);

    const snapshot = assistantChatService.getSnapshot();
    const thread = snapshot.threads.find((row) => row.id === first.threadId);
    const telegramUserMessages = thread?.messages.filter((message) => message.role === "user") ?? [];

    expect(telegramUserMessages).toHaveLength(2);
    expect(telegramUserMessages[0]?.source?.connectorKey).toBe("telegram");
    expect(telegramUserMessages[0]?.source?.actorName).toBe("Luis Mena");
    expect(telegramUserMessages[0]?.source?.permissionSummary).toContain("assets.read");

    cleanup();
    fs.rmSync(attachmentsRootPath, { recursive: true, force: true });
  });

  it("recovers telegram DM bindings when an older archived binding already exists", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-connector-bridge-binding-recovery");
    const attachmentsRootPath = createAttachmentsRoot("bukowski-connector-bridge-binding-recovery");
    database.prepare("UPDATE agent_connector_configs SET status = 'configured' WHERE connector_key = 'telegram'").run();
    database.prepare(
      `
        INSERT INTO connector_accounts (
          id,
          workspace_id,
          connector_key,
          external_user_id,
          external_username,
          display_name,
          linked_user_id,
          link_status,
          linked_at,
          created_at,
          updated_at
        ) VALUES (?, 'workspace-metadata', 'telegram', ?, ?, ?, ?, 'linked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
    ).run("connector-account-recovery", "telegram-user-recovery", "ops_recovery", "Ops via Telegram", "user-ops");

    const assistantChatService = createAssistantChatService(database, {
      attachmentsRootPath,
      assistantGatewayService: {
        sendMessage: async (input) => ({
          status: "answered" as const,
          stateLabel: "Routed to Supervisor Agent",
          stateBody: "Recovered stale Telegram thread binding.",
          assistantMessage: `Binding recuperado para: ${input.message}`,
          routedAgentId: "agent-supervisor",
          routedAgentName: "Supervisor Agent",
          routedAgentRole: "Supervisor Agent",
          intentLabel: "Telegram DM intent",
          commandStateLabel: "No changes applied",
          draftRunId: null,
          providerKey: "openai",
          modelKey: "openai:gpt-5.4",
          toolTraces: [],
          orchestration: {
            intent: "telegram_binding_recovery",
            targetAgentId: "agent-supervisor",
            targetAgentName: "Supervisor Agent",
            confidence: 0.9,
            requiresApproval: false,
            toolCallRequested: false,
            toolCalls: [],
            userFacingSummary: "Recovered stale binding.",
            answerKind: "informational",
            draftRunTitle: null,
            draftRunDescription: null,
          },
        }),
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
      memoryService: {
        extractAndPersist: () => [],
        getOverlay: () => ({ agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] }),
        pruneStaleEntries: () => undefined,
        recordFailure: () => undefined,
      },
    });
    const service = createConnectorBridgeService(database, {
      assistantChatService,
    });
    const archivedThread = assistantChatService.createThread({
      commandId: "cmd-archived-binding-thread",
      workspaceId: "workspace-metadata",
      contextKey: "/agents/chat?connector=telegram",
      contextLabel: "Telegram DM",
    }).activeThreadId;
    const deletedThread = assistantChatService.createThread({
      commandId: "cmd-deleted-binding-thread",
      workspaceId: "workspace-metadata",
      contextKey: "/agents/chat?connector=telegram",
      contextLabel: "Telegram DM",
    }).activeThreadId;
    expect(archivedThread).toBeTruthy();
    expect(deletedThread).toBeTruthy();
    database.prepare("UPDATE assistant_chat_threads SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(deletedThread);
    database.prepare(
      `
        INSERT INTO connector_channels (
          id,
          workspace_id,
          connector_key,
          external_channel_id,
          display_name,
          channel_type,
          created_at,
          updated_at
        ) VALUES (?, 'workspace-metadata', 'telegram', ?, ?, 'dm', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
    ).run("connector-channel-recovery", "telegram-dm-recovery", "Ops via Telegram");
    database.prepare(
      `
        INSERT INTO connector_thread_bindings (
          id,
          workspace_id,
          connector_key,
          external_user_id,
          channel_id,
          thread_id,
          status,
          last_inbound_at,
          expires_at,
          created_at,
          updated_at
        ) VALUES
          (?, 'workspace-metadata', 'telegram', ?, ?, ?, 'expired', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          (?, 'workspace-metadata', 'telegram', ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
    ).run(
      "connector-binding-old-expired",
      "telegram-user-recovery",
      "connector-channel-recovery",
      archivedThread,
      "connector-binding-stale-active",
      "telegram-user-recovery",
      "connector-channel-recovery",
      deletedThread,
    );

    const result = await service.processTelegramDm({
      externalUserId: "telegram-user-recovery",
      externalUsername: "ops_recovery",
      displayName: "Ops via Telegram",
      externalChannelId: "telegram-dm-recovery",
      externalMessageId: "telegram-recovery-msg",
      message: "Prueba desde voz",
    });

    expect(result.status).toBe("delivery_pending");
    expect(result.threadId).toBeTruthy();
    expect(result.threadId).not.toBe(deletedThread);

    const staleBinding = database
      .prepare("SELECT status FROM connector_thread_bindings WHERE id = ?")
      .get("connector-binding-stale-active") as { status: string } | undefined;
    expect(staleBinding?.status).toBe("expired:connector-binding-stale-active");

    cleanup();
    fs.rmSync(attachmentsRootPath, { recursive: true, force: true });
  });

  it("routes Telegram work to the linked user's operational workspace instead of the seed workspace", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-connector-bridge-operational-workspace");
    const attachmentsRootPath = createAttachmentsRoot("bukowski-connector-bridge-operational-workspace");
    database.prepare("UPDATE agent_connector_configs SET status = 'configured' WHERE workspace_id = 'workspace-metadata' AND connector_key = 'telegram'").run();
    database.prepare(
      `
        INSERT INTO workspaces (id, slug, name, base_currency, is_active, created_at, updated_at)
        VALUES ('workspace-real', 'metadata-cine2', 'Metadata Cine2', 'USD', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
    ).run();
    database.prepare(
      `
        INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id, status, joined_at, created_at)
        VALUES ('membership-real-luis', 'workspace-real', 'user-luis', 'role-admin', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
    ).run();
    database.prepare(
      `
        INSERT INTO exchange_rates (
          id,
          workspace_id,
          base_currency,
          quote_currency,
          rate,
          rate_type,
          source,
          source_label,
          effective_date,
          fetched_at,
          notes,
          created_at
        ) VALUES ('rate-real-usd-buy', 'workspace-real', 'USD', 'DOP', 58.5, 'buy', 'banco_santa_cruz', 'Banco Santa Cruz', '2026-05-10', '2026-05-10T16:00:00.000Z', 'Imported from TasaReal. Source: https://tasareal.com.', CURRENT_TIMESTAMP)
      `,
    ).run();
    database.prepare(
      `
        INSERT INTO connector_accounts (
          id,
          workspace_id,
          connector_key,
          external_user_id,
          external_username,
          display_name,
          linked_user_id,
          link_status,
          linked_at,
          created_at,
          updated_at
        ) VALUES (?, 'workspace-metadata', 'telegram', ?, ?, ?, ?, 'linked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
    ).run("connector-account-operational-workspace", "telegram-user-operational", "luis_ops", "Luis via Telegram", "user-luis");

    let gatewayWorkspaceId: string | null = null;
    const assistantChatService = createAssistantChatService(database, {
      attachmentsRootPath,
      assistantGatewayService: {
        sendMessage: async (input) => {
          gatewayWorkspaceId = input.workspaceId;
          return {
            status: "answered" as const,
            stateLabel: "Routed to Finance Agent",
            stateBody: "Exchange rates loaded.",
            assistantMessage: "Banco Santa Cruz compra USD a 58.50 DOP.",
            routedAgentId: "agent-finance",
            routedAgentName: "Finance Agent",
            routedAgentRole: "Finance Agent",
            intentLabel: "Exchange rate request",
            commandStateLabel: "No changes applied",
            draftRunId: null,
            providerKey: "openai",
            modelKey: "openai:gpt-5.4",
            toolTraces: [],
            orchestration: {
              intent: "exchange_rate_lookup",
              targetAgentId: "agent-finance",
              targetAgentName: "Finance Agent",
              confidence: 0.9,
              requiresApproval: false,
              toolCallRequested: false,
              toolCalls: [],
              userFacingSummary: "Exchange rates loaded.",
              answerKind: "informational",
              draftRunTitle: null,
              draftRunDescription: null,
            },
          };
        },
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
      memoryService: {
        extractAndPersist: () => [],
        getOverlay: () => ({ agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] }),
        pruneStaleEntries: () => undefined,
        recordFailure: () => undefined,
      },
    });
    const service = createConnectorBridgeService(database, {
      assistantChatService,
    });

    const result = await service.processTelegramDm({
      externalUserId: "telegram-user-operational",
      externalUsername: "luis_ops",
      displayName: "Luis via Telegram",
      externalChannelId: "telegram-dm-operational",
      externalMessageId: "telegram-operational-msg",
      message: "Dime las tasas de USD",
    });

    expect(result.status).toBe("delivery_pending");
    expect(gatewayWorkspaceId).toBe("workspace-real");

    cleanup();
    fs.rmSync(attachmentsRootPath, { recursive: true, force: true });
  });

  it("treats duplicated inbound telegram messages as idempotent", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-connector-bridge-duplicate");
    const attachmentsRootPath = createAttachmentsRoot("bukowski-connector-bridge-duplicate");
    database.prepare("UPDATE agent_connector_configs SET status = 'configured' WHERE connector_key = 'telegram'").run();
    database.prepare(
      `
        INSERT INTO connector_accounts (
          id,
          workspace_id,
          connector_key,
          external_user_id,
          external_username,
          display_name,
          linked_user_id,
          link_status,
          linked_at,
          created_at,
          updated_at
        ) VALUES (?, 'workspace-metadata', 'telegram', ?, ?, ?, ?, 'linked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
    ).run("connector-account-duplicate", "telegram-user-duplicate", "miguel_ops", "Miguel via Telegram", "user-miguel");

    const assistantChatService = createAssistantChatService(database, {
      attachmentsRootPath,
      assistantGatewayService: {
        sendMessage: async () => ({
          status: "answered" as const,
          stateLabel: "Routed to Supervisor Agent",
          stateBody: "Supervisor answered directly.",
          assistantMessage: "Recibido. Estado actualizado.",
          routedAgentId: "agent-supervisor",
          routedAgentName: "Supervisor Agent",
          routedAgentRole: "Supervisor Agent",
          intentLabel: "Telegram duplicate test",
          commandStateLabel: "No changes applied",
          draftRunId: null,
          providerKey: "openai",
          modelKey: "openai:gpt-5.4",
          toolTraces: [],
          orchestration: {
            intent: "duplicate_check",
            targetAgentId: "agent-supervisor",
            targetAgentName: "Supervisor Agent",
            confidence: 0.9,
            requiresApproval: false,
            toolCallRequested: false,
            toolCalls: [],
            userFacingSummary: "Duplicate ignored cleanly.",
            answerKind: "informational",
            draftRunTitle: null,
            draftRunDescription: null,
          },
        }),
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
      memoryService: {
        extractAndPersist: () => [],
        getOverlay: () => ({ agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] }),
        pruneStaleEntries: () => undefined,
        recordFailure: () => undefined,
      },
    });
    const service = createConnectorBridgeService(database, {
      assistantChatService,
    });

    const first = await service.processTelegramDm({
      externalUserId: "telegram-user-duplicate",
      externalUsername: "miguel_ops",
      displayName: "Miguel via Telegram",
      externalChannelId: "telegram-dm-duplicate",
      externalMessageId: "telegram-duplicate-msg",
      message: "Estado del Teradek",
    });
    const duplicate = await service.processTelegramDm({
      externalUserId: "telegram-user-duplicate",
      externalUsername: "miguel_ops",
      displayName: "Miguel via Telegram",
      externalChannelId: "telegram-dm-duplicate",
      externalMessageId: "telegram-duplicate-msg",
      message: "Estado del Teradek",
    });

    const userMessages = assistantChatService
      .getSnapshot()
      .threads.flatMap((thread) => thread.messages)
      .filter((message) => message.role === "user");

    expect(first.status).toBe("delivery_pending");
    expect(duplicate.status).toBe("duplicate");
    expect(userMessages).toHaveLength(1);

    cleanup();
    fs.rmSync(attachmentsRootPath, { recursive: true, force: true });
  });

  it("warns Telegram users while reconnecting and confirms when service is back online", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-connector-bridge-recovery");
    const attachmentsRootPath = createAttachmentsRoot("bukowski-connector-bridge-recovery");
    database.prepare("UPDATE agent_connector_configs SET status = 'configured' WHERE connector_key = 'telegram'").run();
    database.prepare(
      `
        INSERT INTO connector_accounts (
          id,
          workspace_id,
          connector_key,
          external_user_id,
          external_username,
          display_name,
          linked_user_id,
          link_status,
          linked_at,
          created_at,
          updated_at
        ) VALUES (?, 'workspace-metadata', 'telegram', ?, ?, ?, ?, 'linked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
    ).run("connector-account-recovery", "telegram-user-recovery", "ana_ops", "Ana via Telegram", "user-luis");

    let responseMode: "degraded" | "healthy" = "degraded";
    const assistantChatService = createAssistantChatService(database, {
      attachmentsRootPath,
      assistantGatewayService: {
        sendMessage: async () =>
          responseMode === "degraded"
            ? {
                status: "provider_error" as const,
                stateLabel: "Provider unavailable",
                stateBody: "The model provider is reconnecting.",
                assistantMessage: "",
                routedAgentId: "agent-supervisor",
                routedAgentName: "Supervisor Agent",
                routedAgentRole: "Supervisor Agent",
                intentLabel: "Telegram DM intent",
                commandStateLabel: "No changes applied",
                draftRunId: null,
                providerKey: "openai",
                modelKey: "openai:gpt-5.4",
                toolTraces: [],
                orchestration: {
                  intent: "telegram_dm_summary",
                  targetAgentId: "agent-supervisor",
                  targetAgentName: "Supervisor Agent",
                  confidence: 0.1,
                  requiresApproval: false,
                  toolCallRequested: false,
                  toolCalls: [],
                  userFacingSummary: "Provider reconnecting.",
                  answerKind: "informational",
                  draftRunTitle: null,
                  draftRunDescription: null,
                },
              }
            : {
                status: "answered" as const,
                stateLabel: "Routed to Supervisor Agent",
                stateBody: "Supervisor answered from the Telegram DM bridge.",
                assistantMessage: "El sistema ya volvió y tu pedido está procesado.",
                routedAgentId: "agent-supervisor",
                routedAgentName: "Supervisor Agent",
                routedAgentRole: "Supervisor Agent",
                intentLabel: "Telegram DM intent",
                commandStateLabel: "No changes applied",
                draftRunId: null,
                providerKey: "openai",
                modelKey: "openai:gpt-5.4",
                toolTraces: [],
                orchestration: {
                  intent: "telegram_dm_summary",
                  targetAgentId: "agent-supervisor",
                  targetAgentName: "Supervisor Agent",
                  confidence: 0.92,
                  requiresApproval: false,
                  toolCallRequested: false,
                  toolCalls: [],
                  userFacingSummary: "Operational summary prepared.",
                  answerKind: "informational",
                  draftRunTitle: null,
                  draftRunDescription: null,
                },
              },
        continueApprovedRun: async () => {
          throw new Error("Not used in this test.");
        },
      },
      memoryService: {
        extractAndPersist: () => [],
        getOverlay: () => ({ agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] }),
        pruneStaleEntries: () => undefined,
        recordFailure: () => undefined,
      },
    });
    const service = createConnectorBridgeService(database, {
      assistantChatService,
    });

    const degraded = await service.processTelegramDm({
      externalUserId: "telegram-user-recovery",
      externalUsername: "ana_ops",
      displayName: "Ana via Telegram",
      externalChannelId: "telegram-dm-recovery",
      externalMessageId: "telegram-recovery-msg-1",
      message: "Necesito el estado del proyecto",
    });

    responseMode = "healthy";

    const restored = await service.processTelegramDm({
      externalUserId: "telegram-user-recovery",
      externalUsername: "ana_ops",
      displayName: "Ana via Telegram",
      externalChannelId: "telegram-dm-recovery",
      externalMessageId: "telegram-recovery-msg-2",
      message: "Estoy de vuelta, intenta otra vez",
    });

    const recoveryReceipt = database
      .prepare(
        `
          SELECT status, payload_json
          FROM connector_message_receipts
          WHERE connector_key = 'telegram'
            AND direction = 'inbound'
            AND external_message_id = ?
          LIMIT 1
        `,
      )
      .get("telegram-recovery-msg-2") as { status: string; payload_json: string } | undefined;

    expect(degraded.replyText).toContain("intentando reconectar");
    expect(restored.replyText).toContain("Conexión restablecida. Ya estoy online.");
    expect(recoveryReceipt?.status).toBe("processed");
    expect(recoveryReceipt?.payload_json).toContain("recovered_from_reconnect");

    cleanup();
    fs.rmSync(attachmentsRootPath, { recursive: true, force: true });
  });
});
