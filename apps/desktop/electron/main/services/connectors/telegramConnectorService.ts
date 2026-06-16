import type { DatabaseSync } from "node:sqlite";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

import type { AssistantAudioTranscriptionService } from "../ai/assistantAudioTranscriptionService";
import type { ConnectorSecretStore } from "../ai/aiSecretStore";
import { getDesktopLogger } from "../logger";
import type { ConnectorBridgeService } from "./connectorBridgeService";

const workspaceId = DEFAULT_WORKSPACE_ID;
const logger = getDesktopLogger("telegram-connector");

type TelegramGetMeResponse = {
  ok: boolean;
  result?: {
    username?: string;
  };
  description?: string;
};

type TelegramGetFileResponse = {
  ok: boolean;
  result?: {
    file_path?: string;
    file_size?: number;
  };
  description?: string;
};

const telegramMessageSoftLimit = 3500;
const telegramProcessingNoticeDelayMs = 8_000;
const telegramProcessingTimeoutMs = 85_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const formatTelegramVoiceError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";

  if (/no speech was detected|no se detect[oó] voz|no speech detected/i.test(message)) {
    return null;
  }

  if (/openai api key/i.test(message)) {
    return "No pude transcribir esa nota de voz porque falta configurar el API key de OpenAI en Settings > AI Models.";
  }

  if (/credits|créditos|billing|quota/i.test(message)) {
    return "No pude transcribir esa nota de voz porque la cuenta de OpenAI parece estar sin créditos o con un límite de billing activo. Revisa Billing en OpenAI y vuelve a intentarlo.";
  }

  if (/rate-limit|rate limit|limitando/i.test(message)) {
    return "No pude transcribir esa nota de voz porque OpenAI está limitando temporalmente las solicitudes. Intenta de nuevo en unos segundos.";
  }

  if (/too large|25 MB/i.test(message)) {
    return "No pude transcribir esa nota de voz porque es demasiado larga. Intenta enviarla en partes más cortas.";
  }

  if (/could not be read|empty|loaded|download|unsupported|format|invalid file/i.test(message)) {
    return "No pude leer esa nota de voz. Intenta grabarla de nuevo y enviarla otra vez.";
  }

  return "No pude transcribir esa nota de voz. Inténtalo de nuevo en unos segundos.";
};

export const createTelegramConnectorService = (
  db: DatabaseSync,
  options: {
    secretStore: ConnectorSecretStore;
    bridgeService: ConnectorBridgeService;
    audioTranscriptionService?: AssistantAudioTranscriptionService;
    pollingMode?: "host" | "disabled";
  },
) => {
  let running = false;
  let currentOffset = 0;
  let pollingDegraded = false;
  const pollingMode = options.pollingMode ?? "host";

  const getConfig = (currentWorkspaceId = workspaceId) =>
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
      .get(currentWorkspaceId) as { status: string } | undefined;

  const updateConnectorHealth = (input: {
    workspaceId?: string;
    status?: string;
    botUsername?: string | null;
    error?: string | null;
    testedAt?: string | null;
  }) => {
    const currentWorkspaceId = input.workspaceId ?? workspaceId;
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
    ).run(input.status ?? null, input.botUsername ?? null, input.error ?? null, now, now, currentWorkspaceId);
  };

  const getBotToken = (currentWorkspaceId = workspaceId) => options.secretStore.getConnectorSecret(currentWorkspaceId, "telegram");

  const callTelegram = async <T>(method: string, body?: Record<string, unknown>, currentWorkspaceId = workspaceId): Promise<T> => {
    const token = getBotToken(currentWorkspaceId);
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

  const downloadTelegramFile = async (fileId: string) => {
    const token = getBotToken();
    if (!token) {
      throw new Error("Telegram bot token is not configured.");
    }

    const fileResponse = await callTelegram<TelegramGetFileResponse>("getFile", {
      file_id: fileId,
    });
    const filePath = fileResponse.result?.file_path;
    if (!fileResponse.ok || !filePath) {
      throw new Error(fileResponse.description || "Telegram voice note could not be loaded.");
    }

    const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!response.ok) {
      throw new Error(`Telegram voice note download failed with ${response.status}.`);
    }

    const data = Buffer.from(await response.arrayBuffer());
    const isOggVoice = /\.(oga|ogg)$/iu.test(filePath);
    const rawFileName = filePath.split("/").pop() || "telegram-voice.ogg";
    const fileName = rawFileName.replace(/\.oga$/iu, ".ogg");
    const mimeType = isOggVoice ? "audio/ogg; codecs=opus" : "audio/mpeg";

    return {
      data,
      mimeType,
      fileName,
    };
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

  const sendChatAction = async (chatId: string | number, action: "typing" | "upload_voice" = "typing") => {
    try {
      await callTelegram("sendChatAction", {
        chat_id: chatId,
        action,
      });
    } catch {
      // Best effort only. A missing chat action must not block delivery.
    }
  };

  const sendTelegramReply = async (chatId: string | number, text: string) => {
    const chunks = splitTelegramMessage(text);

    for (const chunk of chunks) {
      try {
        await callTelegram("sendMessage", {
          chat_id: chatId,
          text: chunk,
        });
      } catch (error) {
        logger.warn("Telegram reply delivery failed.", {
          chatId: String(chatId),
          chunkLength: chunk.length,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  };

  const resolveTelegramMessageText = async (message: any) => {
    if (typeof message.text === "string") {
      return message.text.trim();
    }

    const voiceFileId = typeof message.voice?.file_id === "string" ? message.voice.file_id : null;
    const audioFileId = typeof message.audio?.file_id === "string" ? message.audio.file_id : null;
    const fileId = voiceFileId ?? audioFileId;

    if (!fileId) {
      return "";
    }

    if (!options.audioTranscriptionService) {
      throw new Error("Voice notes are not available in this build.");
    }

    await sendChatAction(message.chat.id, "upload_voice");
    const file = await downloadTelegramFile(fileId);
    let transcription;
    try {
      transcription = await options.audioTranscriptionService.transcribeBuffer({
        workspaceId,
        data: file.data,
        fileName: file.fileName,
        mimeType: file.mimeType,
      });
    } catch (error) {
      logger.warn("Telegram voice transcription failed.", {
        fileName: file.fileName,
        mimeType: file.mimeType,
        byteSize: file.data.byteLength,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    logger.info("Telegram voice transcribed.", {
      fileName: file.fileName,
      mimeType: file.mimeType,
      byteSize: file.data.byteLength,
      textLength: transcription.text.length,
    });

    return transcription.text;
  };

  const processUpdate = async (update: any) => {
    const message = update?.message;
    if (!message || message.chat?.type !== "private") {
      return;
    }

    let text = "";
    try {
      text = await resolveTelegramMessageText(message);
      if (!text) {
        return;
      }
    } catch (error) {
      const replyText = formatTelegramVoiceError(error);
      if (replyText) {
        await sendTelegramReply(message.chat.id, replyText);
      }
      return;
    }

    const isVoiceMessage = Boolean(message.voice?.file_id || message.audio?.file_id);
    logger.info("Telegram inbound resolved.", {
      externalMessageId: String(message.message_id),
      source: isVoiceMessage ? "voice" : "text",
      textLength: text.length,
    });

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
      await sendChatAction(message.chat.id);
      let processingNoticeSent = false;
      const processingNoticeTimer = setTimeout(() => {
        processingNoticeSent = true;
        const notice = isVoiceMessage
          ? "Ya transcribí tu audio. Estoy procesando la solicitud y te respondo en breve."
          : "Estoy procesando la solicitud y te respondo en breve.";
        void sendTelegramReply(message.chat.id, notice).catch((error) => {
          logger.warn("Telegram processing notice failed.", {
            externalMessageId: String(message.message_id),
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }, telegramProcessingNoticeDelayMs);
      let result;
      try {
        logger.info("Telegram DM entering assistant bridge.", {
          externalMessageId: String(message.message_id),
          source: isVoiceMessage ? "voice" : "text",
          textLength: text.length,
        });
        result = await withTimeout(
          options.bridgeService.processTelegramDm({
            externalUserId: String(message.from?.id ?? ""),
            externalUsername: message.from?.username ?? null,
            displayName:
              [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ").trim() ||
              message.from?.username ||
              "Telegram user",
            externalChannelId: String(message.chat?.id ?? ""),
            externalMessageId: String(message.message_id),
            message: text,
            replyToMessageId: message.reply_to_message?.message_id ? String(message.reply_to_message.message_id) : null,
            sentAt: message.date ? new Date(message.date * 1000).toISOString() : null,
          }),
          telegramProcessingTimeoutMs,
          "Telegram agent response timed out.",
        );
      } catch (error) {
        logger.warn("Telegram assistant bridge failed or timed out.", {
          externalMessageId: String(message.message_id),
          source: isVoiceMessage ? "voice" : "text",
          error: error instanceof Error ? error.message : String(error),
        });
        const errorMessage = error instanceof Error ? error.message : String(error);
        const timedOut = /timed out|timeout/i.test(errorMessage);
        replyText = timedOut
          ? processingNoticeSent
            ? "Sigo procesando, pero el agente tardó más de lo esperado. Inténtalo de nuevo en unos segundos o envíame una versión más corta."
            : "Recibí tu mensaje, pero el agente tardó demasiado en responder. Inténtalo de nuevo en unos segundos."
          : "Recibí tu mensaje, pero hubo un problema conectando el chat con el agente. Inténtalo de nuevo en unos segundos.";
      } finally {
        clearTimeout(processingNoticeTimer);
      }
      if (!result) {
        await sendTelegramReply(message.chat.id, replyText);
        return;
      }
      replyText = result.replyText;
      logger.info("Telegram DM processed.", {
        status: result.status,
        correlationId: result.correlationId,
        threadId: result.threadId,
        replyLength: replyText.length,
      });
    }

    if (replyText) {
      try {
        await sendTelegramReply(message.chat.id, replyText);
      } catch {
        // The polling loop will mark Telegram degraded and retry connectivity.
      }
    } else {
      logger.warn("Telegram DM produced no reply text.", {
        externalMessageId: String(message.message_id),
        textLength: text.length,
      });
      await sendTelegramReply(message.chat.id, "Recibí tu mensaje, pero no pude generar una respuesta clara. Inténtalo otra vez en unos segundos.");
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

        if (pollingDegraded) {
          updateConnectorHealth({
            status: "configured",
            error: null,
            testedAt: new Date().toISOString(),
          });
          pollingDegraded = false;
        }
      } catch (error) {
        pollingDegraded = true;
        updateConnectorHealth({
          error:
            error instanceof Error
              ? `Telegram temporalmente fuera de línea. Reintentando automáticamente. ${error.message}`
              : "Telegram temporalmente fuera de línea. Reintentando automáticamente.",
          testedAt: new Date().toISOString(),
        });
        await sleep(3000);
      }
    }
  };

  return {
    async testConnection(input?: { workspaceId?: string }) {
      const currentWorkspaceId = input?.workspaceId ?? workspaceId;
      const response = await callTelegram<TelegramGetMeResponse>("getMe", undefined, currentWorkspaceId);
      if (!response.ok) {
        throw new Error(response.description || "Telegram getMe failed.");
      }

      updateConnectorHealth({
        workspaceId: currentWorkspaceId,
        status: "configured",
        botUsername: response.result?.username ?? null,
        error: null,
        testedAt: new Date().toISOString(),
      });

      return {
        botUsername: response.result?.username ?? null,
      };
    },

    async saveConfig(input: { workspaceId?: string; enabled: boolean; botToken?: string; clearStoredSecret?: boolean }) {
      const currentWorkspaceId = input.workspaceId ?? workspaceId;
      if (input.clearStoredSecret) {
        options.secretStore.clearConnectorSecret(currentWorkspaceId, "telegram");
      }

      if (input.botToken?.trim()) {
        options.secretStore.setConnectorSecret(currentWorkspaceId, "telegram", input.botToken);
      }

      const hasSecret = options.secretStore.hasConnectorSecret(currentWorkspaceId, "telegram");
      const nextStatus = input.enabled ? (hasSecret ? "configured" : "not_configured") : "disabled";
      updateConnectorHealth({
        workspaceId: currentWorkspaceId,
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
      if (pollingMode === "disabled") {
        logger.info("Telegram polling is disabled on this device. Another host/webhook should process updates.");
        return;
      }
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
