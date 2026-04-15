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
});
