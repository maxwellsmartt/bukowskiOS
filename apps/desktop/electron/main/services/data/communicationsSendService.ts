import type { DatabaseSync } from "node:sqlite";

import type { NotificationCreateCommand } from "@contracts";

// Delivers agent-composed operational messages to internal teammates. Two
// channels: an in-app notification (always, the reliable record) and Telegram
// (best-effort push when the teammate linked their account). External
// recipients (clients/manufacturers) have no internal channel and are reported
// as skipped rather than silently dropped.

type NotificationsDependency = {
  createNotification: (input: NotificationCreateCommand) => unknown;
};

type TelegramDependency = {
  sendTelegramMessage: (input: {
    workspaceId: string;
    externalChannelId: string;
    body: string;
  }) => Promise<{ externalMessageId: string }>;
};

export type CommunicationsSendInput = {
  workspaceId: string;
  recipientKeys: string[];
  subject: string;
  body: string;
};

export type CommunicationsSendResult = {
  delivered: Array<{ recipientKey: string; label: string; channels: string[] }>;
  skipped: Array<{ recipientKey: string; reason: string }>;
};

const resolveTargetUser = (
  db: DatabaseSync,
  workspaceId: string,
  recipientKey: string,
): { userId: string; label: string } | { skip: string } => {
  const [type, id] = recipientKey.split(":");
  if (!type || !id) {
    return { skip: "Unrecognized recipient." };
  }

  if (type === "user") {
    const row = db
      .prepare(
        `
          SELECT users.id AS user_id, users.full_name AS label
          FROM workspace_memberships
          JOIN users ON users.id = workspace_memberships.user_id
          WHERE workspace_memberships.workspace_id = ?
            AND workspace_memberships.user_id = ?
            AND workspace_memberships.status = 'active'
            AND users.is_active = 1
          LIMIT 1
        `,
      )
      .get(workspaceId, id) as { user_id: string; label: string } | undefined;
    return row ? { userId: row.user_id, label: row.label } : { skip: "Teammate is not an active workspace member." };
  }

  if (type === "crew") {
    const row = db
      .prepare(
        `
          SELECT crew_members.linked_user_id AS user_id, crew_members.full_name AS label
          FROM crew_members
          WHERE crew_members.workspace_id = ?
            AND crew_members.id = ?
            AND crew_members.is_active = 1
          LIMIT 1
        `,
      )
      .get(workspaceId, id) as { user_id: string | null; label: string } | undefined;
    if (!row) {
      return { skip: "Crew member not found." };
    }
    if (!row.user_id) {
      return { skip: `${row.label} has no in-app account to receive messages.` };
    }
    return { userId: row.user_id, label: row.label };
  }

  return { skip: "External recipients cannot be reached from inside the app yet." };
};

const findLinkedTelegramChannel = (db: DatabaseSync, workspaceId: string, userId: string): string | null => {
  // The chat id lives on connector_channels; the link between an internal user
  // and a Telegram chat is recorded in connector_channel_memberships.
  const row = db
    .prepare(
      `
        SELECT connector_channels.external_channel_id AS external_channel_id
        FROM connector_channel_memberships
        JOIN connector_channels
          ON connector_channels.id = connector_channel_memberships.channel_id
        WHERE connector_channel_memberships.workspace_id = ?
          AND connector_channel_memberships.connector_key = 'telegram'
          AND connector_channel_memberships.linked_user_id = ?
          AND connector_channel_memberships.membership_status = 'linked'
          AND connector_channels.external_channel_id IS NOT NULL
        ORDER BY connector_channels.last_inbound_at DESC
        LIMIT 1
      `,
    )
    .get(workspaceId, userId) as { external_channel_id: string | null } | undefined;
  return row?.external_channel_id ?? null;
};

export const createCommunicationsSendService = (
  db: DatabaseSync,
  options: {
    notifications: NotificationsDependency;
    telegram?: TelegramDependency;
  },
) => ({
  sendToRecipients(input: CommunicationsSendInput): CommunicationsSendResult {
    const subject = input.subject.trim() || "Mensaje del equipo";
    const body = input.body.trim();
    const delivered: CommunicationsSendResult["delivered"] = [];
    const skipped: CommunicationsSendResult["skipped"] = [];
    const seen = new Set<string>();

    for (const recipientKey of input.recipientKeys) {
      if (seen.has(recipientKey)) {
        continue;
      }
      seen.add(recipientKey);

      const resolved = resolveTargetUser(db, input.workspaceId, recipientKey);
      if ("skip" in resolved) {
        skipped.push({ recipientKey, reason: resolved.skip });
        continue;
      }

      const channels: string[] = [];

      // In-app notification — the guaranteed, recorded delivery.
      options.notifications.createNotification({
        userId: resolved.userId,
        workspaceId: input.workspaceId,
        kind: "message",
        title: subject,
        body,
        sourceType: "agent",
        sourceRef: { type: "agent_message", recipientKey },
        linkTo: "/inbox",
      });
      channels.push("in-app");

      // Telegram — best-effort push when the teammate linked their account. Sent
      // fire-and-forget so a slow/failed Telegram API call never blocks or rolls
      // back the in-app delivery; failures are logged, not surfaced as errors.
      const telegramChannelId = findLinkedTelegramChannel(db, input.workspaceId, resolved.userId);
      if (telegramChannelId && options.telegram) {
        channels.push("telegram");
        void options.telegram
          .sendTelegramMessage({
            workspaceId: input.workspaceId,
            externalChannelId: telegramChannelId,
            body: `${subject}\n\n${body}`,
          })
          .catch((error) => {
            console.error("[communications] Telegram delivery failed", {
              recipientKey,
              message: error instanceof Error ? error.message : String(error),
            });
          });
      }

      delivered.push({ recipientKey, label: resolved.label, channels });
    }

    return { delivered, skipped };
  },
});

export type CommunicationsSendService = ReturnType<typeof createCommunicationsSendService>;
