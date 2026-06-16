import type { DatabaseSync } from "node:sqlite";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

import type { AssistantAudioTranscriptionService } from "../ai/assistantAudioTranscriptionService";
import type { ConnectorSecretStore } from "../ai/aiSecretStore";
import { getDesktopLogger } from "../logger";
import type { ConnectorBridgeService } from "./connectorBridgeService";

const defaultWorkspaceId = DEFAULT_WORKSPACE_ID;
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

type TelegramSendMessageResponse = {
  ok: boolean;
  result?: {
    message_id?: number;
  };
  description?: string;
};

type WorkspacePollerState = {
  workspaceId: string;
  currentOffset: number;
  degraded: boolean;
  running: boolean;
  stopRequested: boolean;
};

const telegramMessageSoftLimit = 3500;
const telegramProcessingNoticeDelayMs = 8_000;
const telegramProcessingTimeoutMs = 85_000;
const pollerReconcileIntervalMs = 2_500;

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

const buildScopedTelegramMessageId = (workspaceId: string, chatId: string | number, messageId: string | number) =>
  `${workspaceId}:${String(chatId)}:${String(messageId)}`;

export const createTelegramConnectorService = (
  db: DatabaseSync,
  options: {
    secretStore: ConnectorSecretStore;
    bridgeService: ConnectorBridgeService;
    audioTranscriptionService?: AssistantAudioTranscriptionService;
    pollingMode?: "host" | "disabled";
  },
) => {
  let serviceRunning = false;
  let reconcileTimer: NodeJS.Timeout | null = null;
  const workspacePollers = new Map<string, WorkspacePollerState>();
  const pollingMode = options.pollingMode ?? "host";

  const getConfig = (workspaceId = defaultWorkspaceId) =>
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

  const listPollableWorkspaceIds = () =>
    (db
      .prepare(
        `
          SELECT workspace_id
          FROM agent_connector_configs
          WHERE connector_key = 'telegram'
            AND status = 'configured'
          ORDER BY workspace_id ASC
        `,
      )
      .all() as Array<{ workspace_id: string }>)
      .map((row) => row.workspace_id)
      .filter((workspaceId) => options.secretStore.hasConnectorSecret(workspaceId, "telegram"));

  const updateConnectorHealth = (input: {
    workspaceId?: string;
    status?: string;
    botUsername?: string | null;
    error?: string | null;
    testedAt?: string | null;
  }) => {
    const workspaceId = input.workspaceId ?? defaultWorkspaceId;
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

  const getBotToken = (workspaceId = defaultWorkspaceId) => options.secretStore.getConnectorSecret(workspaceId, "telegram");

  const callTelegram = async <T>(method: string, body?: Record<string, unknown>, workspaceId = defaultWorkspaceId): Promise<T> => {
    const token = getBotToken(workspaceId);
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

  const downloadTelegramFile = async (fileId: string, workspaceId: string) => {
    const token = getBotToken(workspaceId);
    if (!token) {
      throw new Error("Telegram bot token is not configured.");
    }

    const fileResponse = await callTelegram<TelegramGetFileResponse>(
      "getFile",
      {
        file_id: fileId,
      },
      workspaceId,
    );
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

  const sendChatAction = async (
    chatId: string | number,
    workspaceId: string,
    action: "typing" | "upload_voice" = "typing",
  ) => {
    try {
      await callTelegram(
        "sendChatAction",
        {
          chat_id: chatId,
          action,
        },
        workspaceId,
      );
    } catch {
      // Best effort only. A missing chat action must not block delivery.
    }
  };

  const sendTelegramReply = async (chatId: string | number, text: string, workspaceId: string) => {
    const chunks = splitTelegramMessage(text);
    let lastExternalMessageId: string | null = null;

    for (const chunk of chunks) {
      try {
        const response = await callTelegram<TelegramSendMessageResponse>(
          "sendMessage",
          {
            chat_id: chatId,
            text: chunk,
          },
          workspaceId,
        );
        if (!response.ok) {
          throw new Error(response.description || "Telegram sendMessage failed.");
        }
        if (response.result?.message_id != null) {
          lastExternalMessageId = buildScopedTelegramMessageId(workspaceId, chatId, response.result.message_id);
        }
      } catch (error) {
        logger.warn("Telegram reply delivery failed.", {
          workspaceId,
          chatId: String(chatId),
          chunkLength: chunk.length,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    return lastExternalMessageId;
  };

  const resolveTelegramMessageText = async (message: any, workspaceId: string) => {
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

    await sendChatAction(message.chat.id, workspaceId, "upload_voice");
    const file = await downloadTelegramFile(fileId, workspaceId);
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
        workspaceId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        byteSize: file.data.byteLength,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    logger.info("Telegram voice transcribed.", {
      workspaceId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      byteSize: file.data.byteLength,
      textLength: transcription.text.length,
    });

    return transcription.text;
  };

  const processUpdate = async (update: any, workspaceId: string) => {
    const message = update?.message;
    if (!message || message.chat?.type !== "private") {
      return;
    }

    const scopedMessageId = buildScopedTelegramMessageId(workspaceId, message.chat?.id ?? "dm", message.message_id ?? "unknown");
    const scopedReplyToMessageId = message.reply_to_message?.message_id
      ? buildScopedTelegramMessageId(workspaceId, message.chat?.id ?? "dm", message.reply_to_message.message_id)
      : null;

    let text = "";
    try {
      text = await resolveTelegramMessageText(message, workspaceId);
      if (!text) {
        return;
      }
    } catch (error) {
      const replyText = formatTelegramVoiceError(error);
      if (replyText) {
        await sendTelegramReply(message.chat.id, replyText, workspaceId);
      }
      return;
    }

    const isVoiceMessage = Boolean(message.voice?.file_id || message.audio?.file_id);
    logger.info("Telegram inbound resolved.", {
      workspaceId,
      externalMessageId: scopedMessageId,
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
      await sendChatAction(message.chat.id, workspaceId);
      let processingNoticeSent = false;
      const processingNoticeTimer = setTimeout(() => {
        processingNoticeSent = true;
        const notice = isVoiceMessage
          ? "Ya transcribí tu audio. Estoy procesando la solicitud y te respondo en breve."
          : "Estoy procesando la solicitud y te respondo en breve.";
        void sendTelegramReply(message.chat.id, notice, workspaceId).catch((error) => {
          logger.warn("Telegram processing notice failed.", {
            workspaceId,
            externalMessageId: scopedMessageId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }, telegramProcessingNoticeDelayMs);
      let result;
      try {
        logger.info("Telegram DM entering assistant bridge.", {
          workspaceId,
          externalMessageId: scopedMessageId,
          source: isVoiceMessage ? "voice" : "text",
          textLength: text.length,
        });
        result = await withTimeout(
          options.bridgeService.processTelegramDm({
            workspaceId,
            externalUserId: String(message.from?.id ?? ""),
            externalUsername: message.from?.username ?? null,
            displayName:
              [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ").trim() ||
              message.from?.username ||
              "Telegram user",
            externalChannelId: String(message.chat?.id ?? ""),
            externalMessageId: scopedMessageId,
            message: text,
            replyToMessageId: scopedReplyToMessageId,
            sentAt: message.date ? new Date(message.date * 1000).toISOString() : null,
          }),
          telegramProcessingTimeoutMs,
          "Telegram agent response timed out.",
        );
      } catch (error) {
        logger.warn("Telegram assistant bridge failed or timed out.", {
          workspaceId,
          externalMessageId: scopedMessageId,
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
        await sendTelegramReply(message.chat.id, replyText, workspaceId);
        return;
      }
      replyText = result.replyText;
      logger.info("Telegram DM processed.", {
        workspaceId,
        status: result.status,
        correlationId: result.correlationId,
        threadId: result.threadId,
        replyLength: replyText.length,
      });
      return;
    }

    if (replyText) {
      try {
        await sendTelegramReply(message.chat.id, replyText, workspaceId);
      } catch {
        // The polling loop will mark Telegram degraded and retry connectivity.
      }
    } else {
      logger.warn("Telegram DM produced no reply text.", {
        workspaceId,
        externalMessageId: scopedMessageId,
        textLength: text.length,
      });
      await sendTelegramReply(
        message.chat.id,
        "Recibí tu mensaje, pero no pude generar una respuesta clara. Inténtalo otra vez en unos segundos.",
        workspaceId,
      );
    }
  };

  const runWorkspacePoller = async (state: WorkspacePollerState) => {
    state.running = true;
    state.stopRequested = false;

    while (serviceRunning && !state.stopRequested) {
      try {
        const config = getConfig(state.workspaceId);
        if (!config || config.status !== "configured" || !options.secretStore.hasConnectorSecret(state.workspaceId, "telegram")) {
          break;
        }

        const payload = await callTelegram<{
          ok: boolean;
          result?: Array<any>;
          description?: string;
        }>(
          "getUpdates",
          {
            timeout: 20,
            offset: state.currentOffset,
            allowed_updates: ["message"],
          },
          state.workspaceId,
        );

        if (!payload.ok) {
          throw new Error(payload.description || "Telegram polling failed.");
        }

        for (const update of payload.result ?? []) {
          state.currentOffset = Math.max(state.currentOffset, Number(update.update_id ?? 0) + 1);
          await processUpdate(update, state.workspaceId);
        }

        if (state.degraded) {
          updateConnectorHealth({
            workspaceId: state.workspaceId,
            status: "configured",
            error: null,
            testedAt: new Date().toISOString(),
          });
          state.degraded = false;
        }
      } catch (error) {
        state.degraded = true;
        updateConnectorHealth({
          workspaceId: state.workspaceId,
          error:
            error instanceof Error
              ? `Telegram temporalmente fuera de línea. Reintentando automáticamente. ${error.message}`
              : "Telegram temporalmente fuera de línea. Reintentando automáticamente.",
          testedAt: new Date().toISOString(),
        });
        await sleep(3000);
      }
    }

    state.running = false;
    if (state.stopRequested || !serviceRunning) {
      workspacePollers.delete(state.workspaceId);
    }
  };

  const reconcileWorkspacePollers = async () => {
    if (!serviceRunning || pollingMode === "disabled") {
      return;
    }

    const desired = new Set(listPollableWorkspaceIds());

    for (const [workspaceId, state] of workspacePollers.entries()) {
      if (!desired.has(workspaceId)) {
        state.stopRequested = true;
        workspacePollers.delete(workspaceId);
      }
    }

    for (const workspaceId of desired) {
      const existing = workspacePollers.get(workspaceId);
      if (existing?.running) {
        continue;
      }

      const nextState: WorkspacePollerState = existing ?? {
        workspaceId,
        currentOffset: 0,
        degraded: false,
        running: false,
        stopRequested: false,
      };
      nextState.stopRequested = false;
      workspacePollers.set(workspaceId, nextState);
      void runWorkspacePoller(nextState);
    }
  };

  const scheduleReconcile = () => {
    if (reconcileTimer) {
      clearTimeout(reconcileTimer);
      reconcileTimer = null;
    }

    if (!serviceRunning || pollingMode === "disabled") {
      return;
    }

    reconcileTimer = setTimeout(() => {
      void reconcileWorkspacePollers().finally(() => {
        scheduleReconcile();
      });
    }, pollerReconcileIntervalMs);
  };

  options.bridgeService.setDeliveryAdapter({
    sendTelegramMessage: async ({ workspaceId, externalChannelId, body }) => {
      const externalMessageId = await sendTelegramReply(externalChannelId, body, workspaceId);
      return {
        externalMessageId:
          externalMessageId ?? buildScopedTelegramMessageId(workspaceId, externalChannelId, `fallback-${Date.now().toString(36)}`),
      };
    },
  });

  return {
    async testConnection(input?: { workspaceId?: string }) {
      const workspaceId = input?.workspaceId ?? defaultWorkspaceId;
      const response = await callTelegram<TelegramGetMeResponse>("getMe", undefined, workspaceId);
      if (!response.ok) {
        throw new Error(response.description || "Telegram getMe failed.");
      }

      updateConnectorHealth({
        workspaceId,
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
      const workspaceId = input.workspaceId ?? defaultWorkspaceId;
      if (input.clearStoredSecret) {
        options.secretStore.clearConnectorSecret(workspaceId, "telegram");
      }

      if (input.botToken?.trim()) {
        options.secretStore.setConnectorSecret(workspaceId, "telegram", input.botToken);
      }

      const hasSecret = options.secretStore.hasConnectorSecret(workspaceId, "telegram");
      const nextStatus = input.enabled ? (hasSecret ? "configured" : "not_configured") : "disabled";
      updateConnectorHealth({
        workspaceId,
        status: nextStatus,
        error: nextStatus === "not_configured" ? "Telegram needs a bot token before it can start." : null,
        testedAt: new Date().toISOString(),
      });

      if (serviceRunning) {
        if (nextStatus !== "configured") {
          const poller = workspacePollers.get(workspaceId);
          if (poller) {
            poller.stopRequested = true;
            workspacePollers.delete(workspaceId);
          }
        }
        await reconcileWorkspacePollers();
        scheduleReconcile();
      }

      return nextStatus as "configured" | "not_configured" | "disabled";
    },

    async start() {
      if (pollingMode === "disabled") {
        logger.info("Telegram polling is disabled on this device. Another host/webhook should process updates.");
        return;
      }
      if (serviceRunning) {
        return;
      }
      serviceRunning = true;
      await reconcileWorkspacePollers();
      scheduleReconcile();
    },

    stop() {
      serviceRunning = false;
      if (reconcileTimer) {
        clearTimeout(reconcileTimer);
        reconcileTimer = null;
      }
      for (const state of workspacePollers.values()) {
        state.stopRequested = true;
      }
      workspacePollers.clear();
    },

    async restart(input?: { workspaceId?: string }) {
      if (!serviceRunning) {
        await this.start();
        return;
      }

      if (input?.workspaceId) {
        const poller = workspacePollers.get(input.workspaceId);
        if (poller) {
          poller.stopRequested = true;
          workspacePollers.delete(input.workspaceId);
        }
        await reconcileWorkspacePollers();
        scheduleReconcile();
        return;
      }

      this.stop();
      await sleep(50);
      await this.start();
    },
  };
};

export type TelegramConnectorService = ReturnType<typeof createTelegramConnectorService>;
