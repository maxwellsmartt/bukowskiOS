import { describe, expect, it } from "vitest";

import { createCommunicationsSendService } from "../../electron/main/services/data/communicationsSendService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const WORKSPACE = "workspace-metadata";

describe("communications send service", () => {
  it("delivers in-app to teammates, pushes Telegram when linked, and skips external recipients", () => {
    const { cleanup, database } = createTestDatabase("bukowski-communications-send");
    const now = new Date().toISOString();

    // A teammate with a linked Telegram account.
    database
      .prepare(
        `INSERT INTO users (id, full_name, email, phone, is_active, created_at, updated_at)
         VALUES (?, ?, ?, '', 1, ?, ?)`,
      )
      .run("user-linked", "Linked Teammate", "linked@bukowskios.local", now, now);
    database
      .prepare(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id, status, joined_at, created_at)
         VALUES (?, ?, ?, 'role-crew', 'active', ?, ?)`,
      )
      .run("membership-linked", WORKSPACE, "user-linked", now, now);
    database
      .prepare(
        `INSERT INTO connector_channels (
           id, workspace_id, connector_key, external_channel_id, channel_type,
           display_name, operational_mode, status, default_policy_json, last_inbound_at, created_at, updated_at
         ) VALUES (?, ?, 'telegram', ?, 'dm', ?, 'dm_first', 'active', '{}', ?, ?, ?)`,
      )
      .run("chan-linked", WORKSPACE, "tg-chat-1", "Linked via TG", now, now, now);
    database
      .prepare(
        `INSERT INTO connector_channel_memberships (
           id, workspace_id, connector_key, channel_id, external_user_id, linked_user_id,
           membership_status, last_seen_at, created_at, updated_at
         ) VALUES (?, ?, 'telegram', ?, ?, ?, 'linked', ?, ?, ?)`,
      )
      .run("mem-linked", WORKSPACE, "chan-linked", "tg-user-1", "user-linked", now, now, now);

    // A client (external) — should be skipped, no internal channel.
    database
      .prepare(
        `INSERT INTO clients (id, workspace_id, name, contact_name, email, phone, is_active, created_at, updated_at)
         VALUES (?, ?, ?, '', '', '', 1, ?, ?)`,
      )
      .run("client-ext", WORKSPACE, "External Client", now, now);

    const createdNotifications: Array<{ userId: string; title: string }> = [];
    const telegramSends: Array<{ externalChannelId: string; body: string }> = [];

    const service = createCommunicationsSendService(database, {
      notifications: {
        createNotification: (input) => {
          createdNotifications.push({ userId: input.userId, title: input.title });
          return undefined;
        },
      },
      telegram: {
        sendTelegramMessage: async (input) => {
          telegramSends.push({ externalChannelId: input.externalChannelId, body: input.body });
          return { externalMessageId: "tg-msg-1" };
        },
      },
    });

    const result = service.sendToRecipients({
      workspaceId: WORKSPACE,
      recipientKeys: ["user:user-linked", "client:client-ext"],
      subject: "Equipo listo",
      body: "La cámara A está montada en set.",
    });

    expect(result.delivered).toHaveLength(1);
    expect(result.delivered[0]).toMatchObject({
      recipientKey: "user:user-linked",
      label: "Linked Teammate",
      channels: ["in-app", "telegram"],
    });
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].recipientKey).toBe("client:client-ext");

    // In-app notification always created for the reachable teammate.
    expect(createdNotifications).toEqual([{ userId: "user-linked", title: "Equipo listo" }]);
    // Telegram push fired (fire-and-forget) with subject + body.
    expect(telegramSends).toHaveLength(1);
    expect(telegramSends[0].externalChannelId).toBe("tg-chat-1");
    expect(telegramSends[0].body).toContain("Equipo listo");
    expect(telegramSends[0].body).toContain("La cámara A está montada en set.");

    cleanup();
  });

  it("delivers in-app only when the teammate has no linked Telegram", () => {
    const { cleanup, database } = createTestDatabase("bukowski-communications-send-no-tg");
    const now = new Date().toISOString();

    database
      .prepare(
        `INSERT INTO users (id, full_name, email, phone, is_active, created_at, updated_at)
         VALUES (?, ?, ?, '', 1, ?, ?)`,
      )
      .run("user-plain", "Plain Teammate", "plain@bukowskios.local", now, now);
    database
      .prepare(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id, status, joined_at, created_at)
         VALUES (?, ?, ?, 'role-crew', 'active', ?, ?)`,
      )
      .run("membership-plain", WORKSPACE, "user-plain", now, now);

    const createdNotifications: string[] = [];
    let telegramCalls = 0;

    const service = createCommunicationsSendService(database, {
      notifications: {
        createNotification: (input) => {
          createdNotifications.push(input.userId);
          return undefined;
        },
      },
      telegram: {
        sendTelegramMessage: async () => {
          telegramCalls += 1;
          return { externalMessageId: "x" };
        },
      },
    });

    const result = service.sendToRecipients({
      workspaceId: WORKSPACE,
      recipientKeys: ["user:user-plain"],
      subject: "Aviso",
      body: "Recuerda el check-in de mañana.",
    });

    expect(result.delivered[0].channels).toEqual(["in-app"]);
    expect(createdNotifications).toEqual(["user-plain"]);
    expect(telegramCalls).toBe(0);

    cleanup();
  });
});
