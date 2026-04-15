import type { DatabaseSync } from "node:sqlite";

import type { ConnectorSecretStore } from "../ai/aiSecretStore";
import type { ConnectorBridgeService } from "./connectorBridgeService";

const workspaceId = "workspace-metadata";

type TelegramGetMeResponse = {
  ok: boolean;
  result?: {
    username?: string;
  };
  description?: string;
};

const telegramMessageSoftLimit = 3500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const createTelegramConnectorService = (
  db: DatabaseSync,
  options: {
    secretStore: ConnectorSecretStore;
    bridgeService: ConnectorBridgeService;
  },
) => {
  let running = false;
  let currentOffset = 0;

  const getConfig = () =>
    db
      .prepare(
        `
          SELECT status
          FROM agent_connector_configs
          WHERE workspace_id = ?
            AND connector_key = 'telegram'
          LIMIT 1
        `,
      )
      .get(workspaceId) as { status: string } | undefined;

  const updateConnectorHealth = (input: { status?: string; botUsername?: string | null; error?: string | null; testedAt?: string | null }) => {
    const now = input.testedAt ?? new Date().toISOString();
    db.prepare(
      `
        UPDATE agent_connector_configs
        SET status = COALESCE(?, status),
            bot_username = COALESCE(?, bot_username),
            last_error_summary = ?,
            last_tested_at = ?,
            updated_at = ?
        WHERE workspace_id = ?
          AND connector_key = 'telegram'
      `,
    ).run(input.status ?? null, input.botUsername ?? null, input.error ?? null, now, now, workspaceId);
  };

  const getBotToken = () => options.secretStore.getConnectorSecret(workspaceId, "telegram");

  const callTelegram = async <T>(method: string, body?: Record<string, unknown>): Promise<T> => {
    const token = getBotToken();
    if (!token) {
      throw new Error("Telegram bot token is not configured.");
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`Telegram API ${method} failed with ${response.status}.`);
    }
    return (await response.json()) as T;
  };

  const splitTelegramMessage = (text: string) => {
    const normalized = text.trim();

    if (!normalized) {
      return [] as string[];
    }

    if (normalized.length <= telegramMessageSoftLimit) {
      return [normalized];
    }

    const chunks: string[] = [];
    let remaining = normalized;

    while (remaining.length > telegramMessageSoftLimit) {
      const slice = remaining.slice(0, telegramMessageSoftLimit);
      const breakIndex = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(". "), slice.lastIndexOf(" "));
      const cutoff = breakIndex > telegramMessageSoftLimit * 0.5 ? breakIndex + (slice[breakIndex] === "." ? 1 : 0) : telegramMessageSoftLimit;
      chunks.push(remaining.slice(0, cutoff).trim());
      remaining = remaining.slice(cutoff).trim();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks.filter(Boolean);
  };

  const sendTypingIndicator = async (chatId: string | number) => {
    try {
      await callTelegram("sendChatAction", {
        chat_id: chatId,
        action: "typing",
      });
    } catch {
      // Best effort only. A missing typing indicator must not block delivery.
    }
  };

  const sendTelegramReply = async (chatId: string | number, text: string) => {
    const chunks = splitTelegramMessage(text);

    for (const chunk of chunks) {
      await callTelegram("sendMessage", {
        chat_id: chatId,
        text: chunk,
      });
    }
  };

  const processUpdate = async (update: any) => {
    const message = update?.message;
    if (!message || message.chat?.type !== "private" || typeof message.text !== "string") {
      return;
    }

    const text = message.text.trim();
    if (!text) {
      return;
    }

    let replyText = "";
    if (/^\/link\s+/i.test(text)) {
      const token = text.replace(/^\/link\s+/i, "").trim();
      const result = options.bridgeService.consumeTelegramLinkToken({
        token,
        externalUserId: String(message.from?.id ?? ""),
        externalUsername: message.from?.username ?? null,
        displayName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ").trim() || message.from?.username || "Telegram user",
        externalChannelId: String(message.chat?.id ?? ""),
      });
      replyText = result.replyText;
    } else {
      await sendTypingIndicator(message.chat.id);
      const result = await options.bridgeService.processTelegramDm({
        externalUserId: String(message.from?.id ?? ""),
        externalUsername: message.from?.username ?? null,
        displayName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ").trim() || message.from?.username || "Telegram user",
        externalChannelId: String(message.chat?.id ?? ""),
        externalMessageId: String(message.message_id),
        message: text,
        replyToMessageId: message.reply_to_message?.message_id ? String(message.reply_to_message.message_id) : null,
        sentAt: message.date ? new Date(message.date * 1000).toISOString() : null,
      });
      replyText = result.status === "duplicate" ? "" : result.replyText;
    }

    if (replyText) {
      await sendTelegramReply(message.chat.id, replyText);
    }
  };

  const loop = async () => {
    while (running) {
      try {
        const config = getConfig();
        if (!config || config.status !== "configured" || !options.secretStore.hasConnectorSecret(workspaceId, "telegram")) {
          await sleep(1500);
          continue;
        }

        const payload = await callTelegram<{
          ok: boolean;
          result?: Array<any>;
          description?: string;
        }>("getUpdates", {
          timeout: 20,
          offset: currentOffset,
          allowed_updates: ["message"],
        });

        if (!payload.ok) {
          throw new Error(payload.description || "Telegram polling failed.");
        }

        for (const update of payload.result ?? []) {
          currentOffset = Math.max(currentOffset, Number(update.update_id ?? 0) + 1);
          await processUpdate(update);
        }
      } catch (error) {
        updateConnectorHealth({
          error: error instanceof Error ? error.message : "Telegram polling failed.",
          testedAt: new Date().toISOString(),
        });
        await sleep(3000);
      }
    }
  };

  return {
    async testConnection() {
      const response = await callTelegram<TelegramGetMeResponse>("getMe");
      if (!response.ok) {
        throw new Error(response.description || "Telegram getMe failed.");
      }

      updateConnectorHealth({
        status: "configured",
        botUsername: response.result?.username ?? null,
        error: null,
        testedAt: new Date().toISOString(),
      });

      return {
        botUsername: response.result?.username ?? null,
      };
    },

    async saveConfig(input: { enabled: boolean; botToken?: string; clearStoredSecret?: boolean }) {
      if (input.clearStoredSecret) {
        options.secretStore.clearConnectorSecret(workspaceId, "telegram");
      }

      if (input.botToken?.trim()) {
        options.secretStore.setConnectorSecret(workspaceId, "telegram", input.botToken);
      }

      const hasSecret = options.secretStore.hasConnectorSecret(workspaceId, "telegram");
      const nextStatus = input.enabled ? (hasSecret ? "configured" : "not_configured") : "disabled";
      updateConnectorHealth({
        status: nextStatus,
        error: nextStatus === "not_configured" ? "Telegram needs a bot token before it can start." : null,
        testedAt: new Date().toISOString(),
      });

      if (nextStatus === "configured") {
        await this.restart();
      } else {
        this.stop();
      }

      return nextStatus as "configured" | "not_configured" | "disabled";
    },

    async start() {
      if (running) {
        return;
      }
      running = true;
      void loop();
    },

    stop() {
      running = false;
    },

    async restart() {
      this.stop();
      await sleep(50);
      await this.start();
    },
  };
};

export type TelegramConnectorService = ReturnType<typeof createTelegramConnectorService>;
