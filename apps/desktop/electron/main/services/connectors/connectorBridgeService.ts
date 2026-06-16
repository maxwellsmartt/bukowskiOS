import type { DatabaseSync } from "node:sqlite";

import type { AssistantChatService } from "../data/assistantChatService";

const defaultWorkspaceId = "workspace-metadata";
const defaultThreadTtlMs: number | null = null;

type TelegramDmInboundMessage = {
  workspaceId: string;
  externalUserId: string;
  externalUsername?: string | null;
  displayName: string;
  externalChannelId: string;
  externalMessageId: string;
  message: string;
  replyToMessageId?: string | null;
  sentAt?: string | null;
};

type DeliveryAdapter = {
  sendTelegramMessage?: (input: {
    workspaceId: string;
    externalChannelId: string;
    body: string;
    correlationId: string;
  }) => Promise<{ externalMessageId: string }>;
};

type ProcessTelegramDmResult = {
  status: "duplicate" | "linked_required" | "blocked" | "answered" | "draft_pending" | "delivery_pending";
  threadId: string | null;
  correlationId: string;
  replyText: string;
};

type ConsumeLinkTokenResult = {
  ok: boolean;
  replyText: string;
};

const nowIso = () => new Date().toISOString();

const buildId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const archivedBindingStatus = (bindingId: string) => `expired:${bindingId}`;

const parseJsonObject = (value: string | null) => {
  if (!value) {
    return {} as Record<string, unknown>;
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const classifyRequiredPermissions = (message: string) => {
  const normalized = message.toLowerCase();
  const permissions = new Set<string>();

  if (/(finance|budget|cost|spend|reserve|burn)/.test(normalized)) {
    permissions.add("finance.read");
  }

  if (/(incident|damage|report issue|reporta|reportar|aver[ií]a|broken|damaged|se me da[nñ]o)/.test(normalized)) {
    permissions.add("incidents.create");
  }

  if (/(incident|damage|rma|repair|maintenance)/.test(normalized)) {
    permissions.add("incidents.read");
  }

  if (/(\brma\b|warranty|repair case|manufacturer)/.test(normalized)) {
    permissions.add(/(create|open|genera|generar|crear|report)/.test(normalized) ? "rma.create" : "rma.read");
  }

  if (/(packing slip|packing|picklist|dispatch|checkout)/.test(normalized)) {
    permissions.add(/(create|issue|genera|generar|crear|emit)/.test(normalized) ? "packing-slips.create" : "packing-slips.read");
  }

  if (!permissions.size) {
    permissions.add("assets.read");
  }

  return Array.from(permissions);
};

const summarizePermissions = (permissions: string[]) => {
  if (!permissions.length) {
    return "No internal permissions";
  }

  return permissions.join(", ");
};

const toPlainTelegramText = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1: $2")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const degradedServiceStates = new Set(["provider_error", "tool_error", "structured_error"]);
const reconnectingReceiptStatuses = new Set(["service_reconnecting", "delivery_failed", "pending_delivery"]);

const isDegradedServiceState = (value: string | null | undefined) => degradedServiceStates.has(value ?? "");

const isReconnectReceiptStatus = (value: string | null | undefined) => reconnectingReceiptStatuses.has(value ?? "");

const buildOperationalReply = (args: {
  status: string;
  assistantMessage?: string;
  approvalReason?: string | null;
  approvalDecision?: string | null;
  routedAgentName?: string | null;
}) => {
  if (args.status === "needs_configuration") {
    return "Bloqueado. El connector todavía no está listo para operar.";
  }

  if (args.status === "provider_error" || args.status === "tool_error" || args.status === "structured_error") {
    const summary = toPlainTelegramText(args.assistantMessage ?? "");
    if (/créditos|credits|billing|quota|rate limit|limitando/i.test(summary)) {
      return summary;
    }

    return "Estoy teniendo problemas para conectarme al servicio. Ya estoy intentando reconectar. Vuelve a escribirme en un momento.";
  }

  if (args.approvalDecision === "pending") {
    return `Recibido. Preparé un draft para ${args.routedAgentName ?? "revisión"} y queda pendiente en bukowskiOS desktop.`;
  }

  const summary = toPlainTelegramText(args.assistantMessage ?? "");
  if (!summary) {
    return "Recibido. El supervisor actualizó el estado.";
  }

  return summary;
};

export const createConnectorBridgeService = (
  db: DatabaseSync,
  options: {
    assistantChatService: AssistantChatService;
    deliveryAdapter?: DeliveryAdapter;
    threadTtlMs?: number | null;
  },
) => {
  const threadTtlMs = options.threadTtlMs ?? defaultThreadTtlMs;
  let deliveryAdapter = options.deliveryAdapter;
  const resolveThreadExpiresAt = () => (threadTtlMs ? new Date(Date.now() + threadTtlMs).toISOString() : null);

  const resolveConnectorConfig = (workspaceId: string, connectorKey: string) =>
    db
      .prepare(
        `
          SELECT id, status, display_name
          FROM agent_connector_configs
          WHERE workspace_id = ?
            AND connector_key = ?
          LIMIT 1
        `,
      )
      .get(workspaceId, connectorKey) as { id: string; status: string; display_name: string } | undefined;

  const resolveUsableConnectorConfig = (workspaceId: string, connectorKey: string) => {
    const workspaceConfig = resolveConnectorConfig(workspaceId, connectorKey);
    if (workspaceConfig?.status === "configured") {
      return workspaceConfig;
    }

    return db
      .prepare(
        `
          SELECT id, status, display_name
          FROM agent_connector_configs
          WHERE connector_key = ?
            AND status = 'configured'
          ORDER BY updated_at DESC
          LIMIT 1
        `,
      )
      .get(connectorKey) as { id: string; status: string; display_name: string } | undefined;
  };

  const loadLinkedTelegramAccount = (workspaceId: string, externalUserId: string) =>
    db
      .prepare(
        `
          SELECT id, workspace_id, linked_user_id, link_status
          FROM connector_accounts
          WHERE workspace_id = ?
            AND connector_key = 'telegram'
            AND external_user_id = ?
            AND linked_user_id IS NOT NULL
            AND link_status = 'linked'
          ORDER BY updated_at DESC
          LIMIT 1
        `,
      )
      .get(workspaceId, externalUserId) as
      | {
          id: string;
          workspace_id: string;
          linked_user_id: string;
          link_status: string;
        }
      | undefined;

  const upsertChannel = (workspaceId: string, externalChannelId: string, displayName: string) => {
    const existing = db
      .prepare(
        `
          SELECT id
          FROM connector_channels
          WHERE workspace_id = ?
            AND connector_key = 'telegram'
            AND external_channel_id = ?
          LIMIT 1
        `,
      )
      .get(workspaceId, externalChannelId) as { id: string } | undefined;

    const id = existing?.id ?? buildId("connector-channel");
    const now = nowIso();
    db.prepare(
      `
        INSERT INTO connector_channels (
          id,
          workspace_id,
          connector_key,
          external_channel_id,
          channel_type,
          display_name,
          operational_mode,
          status,
          default_policy_json,
          last_inbound_at,
          created_at,
          updated_at
        ) VALUES (?, ?, 'telegram', ?, 'dm', ?, 'dm_first', 'active', '{}', ?, ?, ?)
        ON CONFLICT (workspace_id, connector_key, external_channel_id) DO UPDATE SET
          display_name = excluded.display_name,
          operational_mode = excluded.operational_mode,
          last_inbound_at = excluded.last_inbound_at,
          updated_at = excluded.updated_at
      `,
    ).run(id, workspaceId, externalChannelId, displayName, now, now, now);

    return id;
  };

  const upsertAccount = (
    workspaceId: string,
    input: TelegramDmInboundMessage,
    seed?: { linkedUserId: string | null; linkStatus: string } | null,
  ) => {
    const existing = db
      .prepare(
        `
          SELECT id, linked_user_id, link_status
          FROM connector_accounts
          WHERE workspace_id = ?
            AND connector_key = 'telegram'
            AND external_user_id = ?
          LIMIT 1
        `,
      )
      .get(workspaceId, input.externalUserId) as
      | {
          id: string;
          linked_user_id: string | null;
          link_status: string;
        }
      | undefined;

    const id = existing?.id ?? buildId("connector-account");
    const now = nowIso();
    db.prepare(
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
          revoked_at,
          created_at,
          updated_at
        ) VALUES (?, ?, 'telegram', ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        ON CONFLICT (workspace_id, connector_key, external_user_id) DO UPDATE SET
          external_username = excluded.external_username,
          display_name = excluded.display_name,
          updated_at = excluded.updated_at
      `,
    ).run(
      id,
      workspaceId,
      input.externalUserId,
      input.externalUsername ?? null,
      input.displayName,
      existing?.linked_user_id ?? seed?.linkedUserId ?? null,
      existing?.link_status ?? seed?.linkStatus ?? "pending",
      now,
      now,
    );

    return {
      id,
      linkedUserId: existing?.linked_user_id ?? seed?.linkedUserId ?? null,
      linkStatus: existing?.link_status ?? seed?.linkStatus ?? "pending",
    };
  };

  const upsertMembership = (workspaceId: string, channelId: string, externalUserId: string, linkedUserId: string | null) => {
    const now = nowIso();
    db.prepare(
      `
        INSERT INTO connector_channel_memberships (
          id,
          workspace_id,
          connector_key,
          channel_id,
          external_user_id,
          linked_user_id,
          membership_status,
          last_seen_at,
          created_at,
          updated_at
        ) VALUES (?, ?, 'telegram', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (channel_id, external_user_id) DO UPDATE SET
          linked_user_id = excluded.linked_user_id,
          membership_status = excluded.membership_status,
          last_seen_at = excluded.last_seen_at,
          updated_at = excluded.updated_at
      `,
    ).run(
      buildId("connector-membership"),
      workspaceId,
      channelId,
      externalUserId,
      linkedUserId,
      linkedUserId ? "linked" : "observed",
      now,
      now,
      now,
    );
  };

  const loadLinkedIdentity = (workspaceId: string, linkedUserId: string) =>
    db
      .prepare(
        `
          SELECT
            users.id AS user_id,
            users.full_name,
            roles.name AS role_name,
            workspace_memberships.status AS membership_status,
            GROUP_CONCAT(permissions.key, ',') AS permission_keys
          FROM users
          JOIN workspace_memberships
            ON workspace_memberships.user_id = users.id
            AND workspace_memberships.workspace_id = ?
          LEFT JOIN roles ON roles.id = workspace_memberships.role_id
          LEFT JOIN role_permissions ON role_permissions.role_id = roles.id
          LEFT JOIN permissions ON permissions.id = role_permissions.permission_id
          WHERE users.id = ?
            AND users.is_active = 1
          GROUP BY users.id, users.full_name, roles.name, workspace_memberships.status
          LIMIT 1
        `,
      )
      .get(workspaceId, linkedUserId) as
      | {
          user_id: string;
          full_name: string;
          role_name: string | null;
          membership_status: string;
          permission_keys: string | null;
        }
      | undefined;

  const upsertReceipt = (args: {
    workspaceId: string;
    direction: "inbound" | "outbound";
    externalMessageId: string;
    channelId: string | null;
    correlationId: string;
    status: string;
    threadId: string | null;
    payload: Record<string, unknown>;
    errorMessage?: string | null;
  }) => {
    const now = nowIso();
    const existing = db
      .prepare(
        `
          SELECT id
          FROM connector_message_receipts
          WHERE connector_key = 'telegram'
            AND direction = ?
            AND external_message_id = ?
          LIMIT 1
        `,
      )
      .get(args.direction, args.externalMessageId) as { id: string } | undefined;

    const id = existing?.id ?? buildId("connector-receipt");
    db.prepare(
      `
        INSERT INTO connector_message_receipts (
          id,
          workspace_id,
          connector_key,
          channel_id,
          direction,
          external_message_id,
          correlation_id,
          thread_id,
          status,
          payload_json,
          error_message,
          created_at,
          updated_at
        ) VALUES (?, ?, 'telegram', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (connector_key, direction, external_message_id) DO UPDATE SET
          correlation_id = excluded.correlation_id,
          thread_id = excluded.thread_id,
          status = excluded.status,
          payload_json = excluded.payload_json,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at
      `,
    ).run(
      id,
      args.workspaceId,
      args.channelId,
      args.direction,
      args.externalMessageId,
      args.correlationId,
      args.threadId,
      args.status,
      JSON.stringify(args.payload),
      args.errorMessage ?? null,
      now,
      now,
    );

    return id;
  };

  const resolveBoundThreadId = (workspaceId: string, externalUserId: string, channelId: string, forceNewThread: boolean) => {
    if (forceNewThread) {
      db.prepare(
        `
          UPDATE connector_thread_bindings
          SET status = 'expired:' || id,
              updated_at = ?
          WHERE workspace_id = ?
            AND connector_key = 'telegram'
            AND external_user_id = ?
            AND status = 'active'
        `,
      ).run(nowIso(), workspaceId, externalUserId);
    }

    if (!forceNewThread) {
      const binding = db
        .prepare(
          `
            SELECT
              connector_thread_bindings.id,
              connector_thread_bindings.thread_id,
              connector_thread_bindings.expires_at,
              assistant_chat_threads.deleted_at
            FROM connector_thread_bindings
            LEFT JOIN assistant_chat_threads ON assistant_chat_threads.id = connector_thread_bindings.thread_id
            WHERE connector_thread_bindings.workspace_id = ?
              AND connector_thread_bindings.connector_key = 'telegram'
              AND connector_thread_bindings.external_user_id = ?
              AND connector_thread_bindings.status = 'active'
            ORDER BY connector_thread_bindings.updated_at DESC
            LIMIT 1
          `,
        )
        .get(workspaceId, externalUserId) as
        | {
            id: string;
            thread_id: string;
            expires_at: string | null;
            deleted_at: string | null;
          }
        | undefined;

      const expiresAt = binding?.expires_at ? new Date(binding.expires_at).getTime() : null;
      const isExpired = threadTtlMs !== null && expiresAt !== null && expiresAt <= Date.now();
      const threadExists = binding?.deleted_at !== undefined;
      if (binding && threadExists && !binding.deleted_at && !isExpired) {
        db.prepare(
          `
            UPDATE connector_thread_bindings
            SET status = 'expired:' || id,
                updated_at = ?
            WHERE workspace_id = ?
              AND connector_key = 'telegram'
              AND external_user_id = ?
              AND status = 'active'
              AND id != ?
          `,
        ).run(nowIso(), workspaceId, externalUserId, binding.id);
        return binding.thread_id;
      }

      if (binding) {
        db.prepare("UPDATE connector_thread_bindings SET status = ?, updated_at = ? WHERE id = ?").run(
          archivedBindingStatus(binding.id),
          nowIso(),
          binding.id,
        );
      }
    }

    const previousActiveThreadId = options.assistantChatService.getSnapshot().activeThreadId;
    const created = options.assistantChatService.createThread({
      commandId: buildId("cmd-connector-thread"),
      workspaceId,
      contextKey: "/agents/chat?connector=telegram",
      contextLabel: "Telegram DM",
    });
    const threadId = created.activeThreadId ?? created.threads[0]?.id ?? null;
    if (!threadId) {
      throw new Error("Could not create a connector-backed thread.");
    }
    if (previousActiveThreadId && previousActiveThreadId !== threadId) {
      options.assistantChatService.setActiveThread({
        commandId: buildId("cmd-connector-restore-active-thread"),
        workspaceId,
        threadId: previousActiveThreadId,
      });
    }

    const now = nowIso();
    db.prepare(
      `
        UPDATE connector_thread_bindings
        SET status = 'expired:' || id,
            updated_at = ?
        WHERE workspace_id = ?
          AND connector_key = 'telegram'
          AND external_user_id = ?
          AND status = 'active'
      `,
    ).run(now, workspaceId, externalUserId);
    const expiresAt = resolveThreadExpiresAt();
    db.prepare(
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
        ) VALUES (?, ?, 'telegram', ?, ?, ?, 'active', ?, ?, ?, ?)
      `,
    ).run(buildId("connector-thread"), workspaceId, externalUserId, channelId, threadId, now, expiresAt, now, now);

    return threadId;
  };

  const loadLatestInboundReceipt = (channelId: string) =>
    db
      .prepare(
        `
          SELECT status, payload_json, updated_at
          FROM connector_message_receipts
          WHERE connector_key = 'telegram'
            AND direction = 'inbound'
            AND channel_id = ?
          ORDER BY updated_at DESC
          LIMIT 1
        `,
      )
      .get(channelId) as
      | {
          status: string;
          payload_json: string | null;
          updated_at: string;
        }
      | undefined;

  const deliverOutboundReply = async (
    workspaceId: string,
    externalChannelId: string,
    body: string,
    correlationId: string,
    channelId: string,
    threadId: string | null,
  ) => {
    if (!deliveryAdapter?.sendTelegramMessage) {
      upsertReceipt({
        workspaceId,
        direction: "outbound",
        externalMessageId: `pending:${correlationId}`,
        channelId,
        correlationId,
        status: "pending_delivery",
        threadId,
        payload: { body },
      });
      return "pending_delivery" as const;
    }

    try {
      const result = await deliveryAdapter.sendTelegramMessage({
        workspaceId,
        externalChannelId,
        body,
        correlationId,
      });
      upsertReceipt({
        workspaceId,
        direction: "outbound",
        externalMessageId: result.externalMessageId,
        channelId,
        correlationId,
        status: "delivered",
        threadId,
        payload: { body },
      });
      db.prepare("UPDATE connector_channels SET last_outbound_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), channelId);
      return "delivered" as const;
    } catch (error) {
      upsertReceipt({
        workspaceId,
        direction: "outbound",
        externalMessageId: `failed:${correlationId}`,
        channelId,
        correlationId,
        status: "delivery_failed",
        threadId,
        payload: { body },
        errorMessage: error instanceof Error ? error.message : "Connector delivery failed.",
      });
      return "delivery_failed" as const;
    }
  };

  return {
    setDeliveryAdapter(nextAdapter: DeliveryAdapter) {
      deliveryAdapter = nextAdapter;
    },

    createLinkToken(input: { workspaceId?: string; connectorKey: string; userId: string; expiresInMinutes?: number }) {
      if (input.connectorKey !== "telegram") {
        throw new Error("Only Telegram link tokens are supported right now.");
      }
      const workspaceId = input.workspaceId ?? defaultWorkspaceId;

      const user = db
        .prepare(
          `
            SELECT users.id, users.full_name
            FROM users
            JOIN workspace_memberships
              ON workspace_memberships.user_id = users.id
              AND workspace_memberships.workspace_id = ?
            WHERE users.id = ?
              AND users.is_active = 1
              AND workspace_memberships.status = 'active'
            LIMIT 1
          `,
        )
        .get(workspaceId, input.userId) as { id: string; full_name: string } | undefined;

      if (!user) {
        throw new Error("User not found.");
      }

      const token = Math.random().toString(36).slice(2, 8).toUpperCase();
      const now = nowIso();
      const expiresAt = new Date(Date.now() + (input.expiresInMinutes ?? 30) * 60 * 1000).toISOString();
      db.prepare(
        `
          INSERT INTO connector_link_tokens (
            id,
            workspace_id,
            connector_key,
            token,
            target_user_id,
            status,
            expires_at,
            consumed_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, ?)
        `,
      ).run(buildId("connector-link"), workspaceId, input.connectorKey, token, user.id, expiresAt, now);

      return {
        token,
        summary: `Generated Telegram link token for ${user.full_name}.`,
      };
    },

    consumeTelegramLinkToken(input: {
      token: string;
      externalUserId: string;
      externalUsername?: string | null;
      displayName: string;
      externalChannelId: string;
    }): ConsumeLinkTokenResult {
      const tokenRow = db
        .prepare(
          `
            SELECT id, workspace_id, target_user_id, status, expires_at
            FROM connector_link_tokens
            WHERE connector_key = 'telegram'
              AND token = ?
            LIMIT 1
          `,
        )
        .get(input.token.trim().toUpperCase()) as
        | {
            id: string;
            workspace_id: string;
            target_user_id: string;
            status: string;
            expires_at: string;
          }
        | undefined;

      if (!tokenRow) {
        return { ok: false, replyText: "Token inválido. Genera uno nuevo desde bukowskiOS." };
      }

      if (tokenRow.status !== "pending") {
        return { ok: false, replyText: "Ese token ya fue usado o revocado." };
      }

      if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        db.prepare("UPDATE connector_link_tokens SET status = 'expired' WHERE id = ?").run(tokenRow.id);
        return { ok: false, replyText: "Ese token expiró. Genera uno nuevo desde bukowskiOS." };
      }

      const workspaceId = tokenRow.workspace_id;
      const channelId = upsertChannel(workspaceId, input.externalChannelId, input.displayName);
      const account = upsertAccount(
        workspaceId,
        {
          workspaceId,
          externalUserId: input.externalUserId,
          externalUsername: input.externalUsername ?? null,
          displayName: input.displayName,
          externalChannelId: input.externalChannelId,
          externalMessageId: `link-${Date.now()}`,
          message: `/link ${input.token}`,
        },
        { linkedUserId: tokenRow.target_user_id, linkStatus: "linked" },
      );
      const now = nowIso();

      db.prepare(
        `
          UPDATE connector_accounts
          SET linked_user_id = ?,
              link_status = 'linked',
              linked_at = ?,
              revoked_at = NULL,
              updated_at = ?
          WHERE id = ?
        `,
      ).run(tokenRow.target_user_id, now, now, account.id);

      upsertMembership(workspaceId, channelId, input.externalUserId, tokenRow.target_user_id);
      db.prepare(
        `
          UPDATE connector_link_tokens
          SET status = 'consumed',
              consumed_at = ?
          WHERE id = ?
        `,
      ).run(now, tokenRow.id);

      const user = db.prepare("SELECT full_name FROM users WHERE id = ? LIMIT 1").get(tokenRow.target_user_id) as { full_name: string } | undefined;
      return {
        ok: true,
        replyText: `Cuenta vinculada. Ahora escribes como ${user?.full_name ?? "usuario interno"} en bukowskiOS.`,
      };
    },

    async processTelegramDm(input: TelegramDmInboundMessage): Promise<ProcessTelegramDmResult> {
      const correlationId = `telegram:${input.externalChannelId}:${input.externalMessageId}`;
      const workspaceId = input.workspaceId;
      const duplicateReceipt = db
        .prepare(
          `
            SELECT status, thread_id, payload_json
            FROM connector_message_receipts
            WHERE workspace_id = ?
              AND connector_key = 'telegram'
              AND direction = 'inbound'
              AND external_message_id = ?
            LIMIT 1
          `,
        )
        .get(workspaceId, input.externalMessageId) as
        | {
            status: string;
            thread_id: string | null;
            payload_json: string | null;
          }
        | undefined;

      if (duplicateReceipt) {
        const payload = parseJsonObject(duplicateReceipt.payload_json);
        return {
          status: "duplicate",
          threadId: duplicateReceipt.thread_id,
          correlationId,
          replyText: typeof payload.reply_text === "string" ? payload.reply_text : "Recibido. Ese mensaje ya fue procesado.",
        };
      }

      const linkedAccount = loadLinkedTelegramAccount(workspaceId, input.externalUserId);
      const connectorConfig = resolveUsableConnectorConfig(workspaceId, "telegram");
      const channelId = upsertChannel(workspaceId, input.externalChannelId, input.displayName);
      const account = upsertAccount(
        workspaceId,
        input,
        linkedAccount
          ? {
              linkedUserId: linkedAccount.linked_user_id,
              linkStatus: linkedAccount.link_status,
            }
          : null,
      );
      upsertMembership(workspaceId, channelId, input.externalUserId, account.linkedUserId);
      const previousInboundReceipt = loadLatestInboundReceipt(channelId);

      if (!connectorConfig || connectorConfig.status === "disabled" || connectorConfig.status === "not_configured") {
        const replyText = "Bloqueado. Telegram todavía no está habilitado para operación en este workspace.";
        upsertReceipt({
          workspaceId,
          direction: "inbound",
          externalMessageId: input.externalMessageId,
          channelId,
          correlationId,
          status: "connector_blocked",
          threadId: null,
          payload: { reply_text: replyText, reply_to_message_id: input.replyToMessageId ?? null },
        });
        return { status: "blocked", threadId: null, correlationId, replyText };
      }

      if (!account.linkedUserId || account.linkStatus !== "linked") {
        const replyText = "Bloqueado. Tu cuenta de Telegram todavía no está vinculada a un usuario interno.";
        upsertReceipt({
          workspaceId,
          direction: "inbound",
          externalMessageId: input.externalMessageId,
          channelId,
          correlationId,
          status: "linked_required",
          threadId: null,
          payload: { reply_text: replyText, reply_to_message_id: input.replyToMessageId ?? null },
        });
        return { status: "linked_required", threadId: null, correlationId, replyText };
      }

      const identity = loadLinkedIdentity(workspaceId, account.linkedUserId);
      if (!identity || identity.membership_status !== "active") {
        const replyText = "Bloqueado. Tu usuario interno no tiene una membresía activa en este workspace.";
        upsertReceipt({
          workspaceId,
          direction: "inbound",
          externalMessageId: input.externalMessageId,
          channelId,
          correlationId,
          status: "membership_blocked",
          threadId: null,
          payload: { reply_text: replyText },
        });
        return { status: "blocked", threadId: null, correlationId, replyText };
      }

      const permissions = (identity.permission_keys ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const requiredPermissions = classifyRequiredPermissions(input.message);
      const missingPermissions = requiredPermissions.filter((permission) => !permissions.includes(permission));
      if (missingPermissions.length) {
        const primaryMissingPermission = missingPermissions[0] ?? "assets.read";
        const replyText =
          primaryMissingPermission === "finance.read"
            ? "Bloqueado. Tu rol no permite consultar finanzas."
            : primaryMissingPermission.startsWith("packing-slips")
              ? "Bloqueado. Tu rol no permite trabajar con packing slips."
              : primaryMissingPermission.startsWith("rma")
                ? "Bloqueado. Tu rol no permite crear o consultar RMAs."
            : "Bloqueado. Tu rol no permite esta consulta u orden.";
        upsertReceipt({
          workspaceId,
          direction: "inbound",
          externalMessageId: input.externalMessageId,
          channelId,
          correlationId,
          status: "permission_blocked",
          threadId: null,
          payload: { reply_text: replyText, required_permissions: requiredPermissions, missing_permissions: missingPermissions },
        });
        return { status: "blocked", threadId: null, correlationId, replyText };
      }

      const forceNewThread = /\b(new thread|nuevo hilo|nuevo chat)\b/i.test(input.message);
      const threadId = resolveBoundThreadId(workspaceId, input.externalUserId, channelId, forceNewThread);
      const snapshot = await options.assistantChatService.sendTurn({
        commandId: buildId("cmd-telegram-dm"),
        workspaceId,
        threadId,
        message: input.message,
        context: {
          workspaceId,
          activePath: "/agents/chat?connector=telegram",
          currentView: "Telegram DM",
          sourceConnectorKey: "telegram",
          sourceChannelId: channelId,
          sourceExternalMessageId: input.externalMessageId,
          sourceActorUserId: identity.user_id,
          correlationId,
        },
        source: {
          connectorKey: "telegram",
          connectorLabel: "Telegram",
          channelLabel: "Telegram DM",
          actorUserId: identity.user_id,
          actorName: identity.full_name,
          actorRole: identity.role_name,
          permissionSummary: summarizePermissions(permissions),
          externalMessageId: input.externalMessageId,
          correlationId,
          isLinkedIdentity: true,
        },
      });

      db.prepare(
        `
          UPDATE connector_thread_bindings
          SET last_correlation_id = ?,
              last_inbound_at = ?,
              expires_at = ?,
              updated_at = ?
          WHERE workspace_id = ?
            AND connector_key = 'telegram'
            AND external_user_id = ?
            AND status = 'active'
        `,
      ).run(correlationId, nowIso(), resolveThreadExpiresAt(), nowIso(), workspaceId, input.externalUserId);

      const thread = snapshot.threads.find((row) => row.id === threadId);
      const lastAssistantMessage = [...(thread?.messages ?? [])].reverse().find((message) => message.role === "assistant");
      const replyText = buildOperationalReply({
        status: thread?.state ?? "completed",
        assistantMessage: lastAssistantMessage?.body,
        approvalReason: lastAssistantMessage?.meta?.approvalReason ?? null,
        approvalDecision: lastAssistantMessage?.meta?.approvalDecision ?? null,
        routedAgentName: lastAssistantMessage?.meta?.routedAgentName ?? null,
      });
      const recoveredFromReconnect =
        !isDegradedServiceState(thread?.state) && isReconnectReceiptStatus(previousInboundReceipt?.status);
      const replyTextWithRecovery = recoveredFromReconnect
        ? `Conexión restablecida. Ya estoy online.\n\n${replyText}`
        : replyText;
      const inboundStatus =
        lastAssistantMessage?.meta?.approvalDecision === "pending"
          ? "draft_pending"
          : isDegradedServiceState(thread?.state)
            ? "service_reconnecting"
            : "processed";

      upsertReceipt({
        workspaceId,
        direction: "inbound",
        externalMessageId: input.externalMessageId,
        channelId,
        correlationId,
        status: inboundStatus,
        threadId,
        payload: {
          reply_text: replyTextWithRecovery,
          reply_to_message_id: input.replyToMessageId ?? null,
          required_permissions: requiredPermissions,
          recovered_from_reconnect: recoveredFromReconnect,
        },
      });

      const deliveryStatus = await deliverOutboundReply(
        workspaceId,
        input.externalChannelId,
        replyTextWithRecovery,
        correlationId,
        channelId,
        threadId,
      );
      return {
        status: lastAssistantMessage?.meta?.approvalDecision === "pending" ? "draft_pending" : deliveryStatus === "pending_delivery" ? "delivery_pending" : "answered",
        threadId,
        correlationId,
        replyText: replyTextWithRecovery,
      };
    },
  };
};

export type ConnectorBridgeService = ReturnType<typeof createConnectorBridgeService>;
