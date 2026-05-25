import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type {
  AgentNotificationIntent,
  AssistantActionLink,
  AssistantApprovalPreference,
  AssistantChatAttachmentRow,
  AssistantChatAttachmentStatus,
  AssistantChatMessageMeta,
  AssistantChatMessageRow,
  AssistantChatMessageSource,
  AssistantChatSnapshot,
  AssistantChatThreadRow,
  AssistantChatThreadState,
  AssistantGatewayAttachment,
  AssistantOperationalReceipt,
  CreateAssistantThreadCommand,
  DeleteAssistantThreadCommand,
  SendAssistantChatTurnCommand,
  SetActiveAssistantThreadCommand,
  RenameAssistantThreadCommand,
  UpdateAssistantThreadPreferencesCommand,
} from "@contracts";

import type { AssistantMemoryService } from "../ai/assistantMemoryService";
import type { AssistantGatewayService } from "../ai/assistantGatewayService";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;
const defaultThreadTitle = "New thread";
const interruptedMessage = "This response was interrupted before completion.";

const ensureDir = (value: string) => {
  fs.mkdirSync(value, { recursive: true });
};

const resolveAttachmentExtension = (mimeType: string) => {
  if (mimeType.includes("png")) {
    return "png";
  }

  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return "jpg";
  }

  if (mimeType.includes("webp")) {
    return "webp";
  }

  if (mimeType.includes("gif")) {
    return "gif";
  }

  if (mimeType.includes("pdf")) {
    return "pdf";
  }

  if (mimeType.includes("csv")) {
    return "csv";
  }

  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) {
    return "xlsx";
  }

  if (mimeType.startsWith("text/")) {
    return "txt";
  }

  return "bin";
};

const decodeDataUrl = (value: string) => {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    throw new Error("Attachment payload is not a valid data URL.");
  }

  return {
    mimeType: match[1] ?? "application/octet-stream",
    buffer: Buffer.from(match[2] ?? "", "base64"),
  };
};

const deriveThreadTitle = (body: string) => {
  const normalized = body.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return defaultThreadTitle;
  }

  const shortWords = normalized.split(" ").slice(0, 6).join(" ");
  const preferred = shortWords.length >= 18 ? shortWords : normalized.slice(0, 42);
  return preferred.length > 42 ? `${preferred.slice(0, 39).trimEnd()}...` : preferred;
};

const normalizeMeta = (response: {
  status: string;
  stateLabel: string;
  stateBody: string;
  routedAgentId: string | null;
  routedAgentName: string;
  routedAgentRole: string | null;
  intentLabel: string;
  commandStateLabel: string;
  toolTraces: Array<{ summary: string }>;
  draftRunId: string | null;
  approvalDecision?: "pending" | "approved" | "approved_for_session" | "denied" | null;
  approvalScope?: "run" | "session" | null;
  approvalReason?: string | null;
  orchestration: { requiresApproval: boolean } | null;
  actionLinks?: AssistantActionLink[];
  notificationIntents?: AgentNotificationIntent[];
  operationalReceipt?: AssistantOperationalReceipt | null;
}): AssistantChatMessageMeta => ({
  tone:
    response.status === "provider_error" ||
    response.status === "tool_error" ||
    response.status === "structured_error" ||
    response.status === "needs_configuration"
      ? "error"
      : response.draftRunId || response.orchestration?.requiresApproval
        ? "approval"
        : "routed",
  label: response.stateLabel,
  body: response.stateBody,
  routedAgentId: response.routedAgentId,
  routedAgentName: response.routedAgentName,
  routedAgentRole: response.routedAgentRole,
  intentLabel: response.intentLabel,
  commandStateLabel: response.commandStateLabel,
  toolLabel: response.toolTraces.length ? response.toolTraces.map((trace) => trace.summary).join(" · ") : undefined,
  draftRunId: response.draftRunId,
  approvalDecision: response.approvalDecision ?? null,
  approvalScope: response.approvalScope ?? null,
  approvalReason: response.approvalReason ?? null,
  actionLinks: response.actionLinks ?? [],
  notificationIntents: response.notificationIntents ?? [],
  operationalReceipt: response.operationalReceipt ?? null,
});

const mapThreadStateFromResponse = (status: string): AssistantChatThreadState => {
  if (status === "needs_configuration") {
    return "needs_configuration";
  }

  if (status === "provider_error") {
    return "provider_error";
  }

  if (status === "tool_error") {
    return "tool_error";
  }

  if (status === "structured_error") {
    return "structured_error";
  }

  return "completed";
};

const buildSummaryText = (userMessage: string, assistantMessage: string, routedAgentName: string) => {
  const userSummary = userMessage.replace(/\s+/g, " ").trim().slice(0, 140);
  const assistantSummary = assistantMessage.replace(/\s+/g, " ").trim().slice(0, 180);
  return `User asked: ${userSummary || "—"} | Routed: ${routedAgentName} | Assistant: ${assistantSummary || "—"}`;
};

const parseMessageMeta = (value: string | null): AssistantChatMessageMeta | null => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as AssistantChatMessageMeta;
  } catch {
    return null;
  }
};

const parseMessageSource = (value: string | null): AssistantChatMessageSource | null => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as AssistantChatMessageSource;
  } catch {
    return null;
  }
};

type ThreadRow = {
  id: string;
  title: string;
  context_key: string;
  context_label: string;
  summary_text: string;
  created_at: string;
  updated_at: string;
  last_state: AssistantChatThreadState | null;
  last_error_code: string | null;
  last_error_summary: string | null;
  last_routed_agent_id: string | null;
  last_intent: string | null;
  preferred_approval_mode: AssistantApprovalPreference | null;
  is_active: number | null;
};

type MessageDbRow = {
  id: string;
  thread_id: string;
  role: "assistant" | "user";
  body: string;
  message_state: AssistantChatMessageRow["state"];
  source_connector_key: string | null;
  state_payload_json: string | null;
  source_metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type AttachmentDbRow = {
  id: string;
  message_id: string;
  name: string;
  mime_type: string;
  byte_size: number;
  status: AssistantChatAttachmentStatus;
  storage_path: string;
};

const loadSupervisorAgentId = (db: DatabaseSync) =>
  (
    db
      .prepare(
        `
          SELECT id
          FROM agents
          WHERE workspace_id = ?
            AND is_supervisor = 1
          LIMIT 1
        `,
      )
      .get(workspaceId) as { id: string } | undefined
  )?.id ?? null;

export const createAssistantChatService = (
  db: DatabaseSync,
  options: {
    assistantGatewayService: AssistantGatewayService;
    memoryService: AssistantMemoryService;
    attachmentsRootPath: string;
    onWorkspaceDataChanged?: (detail: { source: "assistant-tool"; workspaceId: string; entities: string[] }) => void;
  },
) => {
  const writeWelcomeMessage = (threadId: string) => {
    const now = new Date().toISOString();
    db.prepare(
      `
        INSERT INTO assistant_chat_messages (
          id,
          thread_id,
          role,
          body,
          message_state,
          state_payload_json,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (?, ?, 'assistant', ?, 'completed', NULL, ?, ?, NULL)
      `,
    ).run(
      `assistant-welcome-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      threadId,
      "Supervisor ready. Ask for context, routing, or a draft run. Nothing touches the command layer from chat without review.",
      now,
      now,
    );
  };

  const setActiveThreadRow = (threadId: string | null) => {
    db.prepare("UPDATE assistant_chat_thread_state SET is_active = 0").run();

    if (threadId) {
      db.prepare("UPDATE assistant_chat_thread_state SET is_active = 1, updated_at = ? WHERE thread_id = ?").run(
        new Date().toISOString(),
        threadId,
      );
    }
  };

  const loadSnapshot = (): AssistantChatSnapshot => {
    const attachmentRows = db.prepare(
      `
        SELECT id, message_id, name, mime_type, byte_size, status, storage_path
        FROM assistant_chat_attachments
        WHERE deleted_at IS NULL
      `,
    ).all() as AttachmentDbRow[];

    attachmentRows.forEach((attachment) => {
      if (attachment.status === "available" && !fs.existsSync(attachment.storage_path)) {
        db.prepare(
          `
            UPDATE assistant_chat_attachments
            SET status = 'missing',
                updated_at = ?
            WHERE id = ?
          `,
        ).run(new Date().toISOString(), attachment.id);
        attachment.status = "missing";
      }
    });

    const attachmentMap = attachmentRows.reduce<Record<string, AssistantChatAttachmentRow[]>>((accumulator, attachment) => {
      const list = accumulator[attachment.message_id] ?? [];
      list.push({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mime_type,
        byteSize: attachment.byte_size,
        status: attachment.status,
      });
      accumulator[attachment.message_id] = list;
      return accumulator;
    }, {});

    const messageRows = db.prepare(
      `
        SELECT id, thread_id, role, body, message_state, source_connector_key, state_payload_json, source_metadata_json, created_at, updated_at
        FROM assistant_chat_messages
        WHERE deleted_at IS NULL
        ORDER BY created_at ASC
      `,
    ).all() as MessageDbRow[];

    const messagesByThread = messageRows.reduce<Record<string, AssistantChatMessageRow[]>>((accumulator, message) => {
      const list = accumulator[message.thread_id] ?? [];
      const messageSource = parseMessageSource(message.source_metadata_json);
      list.push({
        id: message.id,
        role: message.source_connector_key ? "user" : message.role,
        body: message.body,
        state: message.message_state,
        meta: parseMessageMeta(message.state_payload_json),
        source: messageSource,
        attachments: attachmentMap[message.id] ?? [],
        createdAt: message.created_at,
        updatedAt: message.updated_at,
      });
      accumulator[message.thread_id] = list;
      return accumulator;
    }, {});

    const threads = db.prepare(
      `
        SELECT
          assistant_chat_threads.id,
          assistant_chat_threads.title,
          assistant_chat_threads.context_key,
          assistant_chat_threads.context_label,
          assistant_chat_threads.summary_text,
          assistant_chat_threads.created_at,
          assistant_chat_threads.updated_at,
          assistant_chat_thread_state.last_state,
          assistant_chat_thread_state.last_error_code,
          assistant_chat_thread_state.last_error_summary,
          assistant_chat_thread_state.last_routed_agent_id,
          assistant_chat_thread_state.last_intent,
          assistant_chat_thread_state.preferred_approval_mode,
          assistant_chat_thread_state.is_active
        FROM assistant_chat_threads
        LEFT JOIN assistant_chat_thread_state
          ON assistant_chat_thread_state.thread_id = assistant_chat_threads.id
        WHERE assistant_chat_threads.deleted_at IS NULL
        ORDER BY COALESCE(assistant_chat_thread_state.is_active, 0) DESC, assistant_chat_threads.updated_at DESC
      `,
    ).all() as ThreadRow[];

    const snapshotThreads: AssistantChatThreadRow[] = threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      contextKey: thread.context_key,
      contextLabel: thread.context_label,
      summaryText: thread.summary_text,
      preferredApprovalMode: thread.preferred_approval_mode ?? "unsupervised",
      state: thread.last_state ?? "idle",
      lastErrorCode: thread.last_error_code,
      lastErrorSummary: thread.last_error_summary,
      lastRoutedAgentId: thread.last_routed_agent_id,
      lastIntent: thread.last_intent,
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
      messages: messagesByThread[thread.id] ?? [],
    }));

    const activeThread = threads.find((thread) => thread.is_active === 1)?.id ?? snapshotThreads[0]?.id ?? null;
    return {
      activeThreadId: activeThread,
      threads: snapshotThreads,
    };
  };

  const reconcileInterruptedThreads = () => {
    const now = new Date().toISOString();
    db.prepare(
      `
        UPDATE assistant_chat_thread_state
        SET last_state = 'interrupted',
            last_error_code = COALESCE(last_error_code, 'interrupted'),
            last_error_summary = COALESCE(last_error_summary, 'This conversation was interrupted before the assistant finished responding.'),
            updated_at = ?
        WHERE last_state IN ('pending', 'streaming')
      `,
    ).run(now);

    db.prepare(
      `
        UPDATE assistant_chat_messages
        SET message_state = 'error',
            body = CASE
              WHEN trim(body) = '' THEN ?
              ELSE body
            END,
            updated_at = ?
        WHERE message_state = 'pending'
          AND deleted_at IS NULL
      `,
    ).run(interruptedMessage, now);
  };

  const createThread = (input: CreateAssistantThreadCommand) => {
    const threadId = `assistant-thread-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    db.prepare(
      `
        INSERT INTO assistant_chat_threads (
          id,
          workspace_id,
          title,
          context_key,
          context_label,
          summary_text,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (?, ?, ?, ?, ?, '', ?, ?, NULL)
      `,
    ).run(threadId, input.workspaceId, defaultThreadTitle, input.contextKey, input.contextLabel, now, now);

    db.prepare(
      `
        INSERT INTO assistant_chat_thread_state (
          thread_id,
          last_state,
          recent_user_messages_json,
          preferred_approval_mode,
          is_active,
          updated_at
        ) VALUES (?, 'idle', '[]', 'unsupervised', 1, ?)
      `,
    ).run(threadId, now);

    setActiveThreadRow(threadId);
    writeWelcomeMessage(threadId);

    return loadSnapshot();
  };

  const persistAttachment = (threadId: string, messageId: string, attachment: AssistantGatewayAttachment) => {
    const { buffer, mimeType } = decodeDataUrl(attachment.dataUrl);
    const nextMimeType = attachment.mimeType || mimeType;
    const extension = resolveAttachmentExtension(nextMimeType);
    const threadDir = path.join(options.attachmentsRootPath, workspaceId, threadId);
    ensureDir(threadDir);
    const storagePath = path.join(threadDir, `${attachment.id}.${extension}`);
    fs.writeFileSync(storagePath, buffer);

    db.prepare(
      `
        INSERT INTO assistant_chat_attachments (
          id,
          thread_id,
          message_id,
          name,
          mime_type,
          storage_path,
          byte_size,
          status,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, NULL)
      `,
    ).run(
      attachment.id,
      threadId,
      messageId,
      attachment.name,
      nextMimeType,
      storagePath,
      buffer.byteLength,
      new Date().toISOString(),
      new Date().toISOString(),
    );
  };

  const getPrimaryAttachmentMessage = (message: string, attachments: AssistantGatewayAttachment[]) => {
    const trimmed = message.trim();
    if (!attachments.length) {
      return trimmed;
    }

    const attachmentSummary = attachments.length === 1 ? "Attached 1 image." : `Attached ${attachments.length} images.`;

    if (!trimmed) {
      return attachmentSummary;
    }

    return `${trimmed}\n\n${attachmentSummary}`;
  };

  const createAssistantMessageRow = (
    threadId: string,
    body: string,
    state: AssistantChatMessageRow["state"],
    meta: AssistantChatMessageMeta | null,
  ) => {
    const messageId = `assistant-reply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    db.prepare(
      `
        INSERT INTO assistant_chat_messages (
          id,
          thread_id,
          role,
          body,
          message_state,
          state_payload_json,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, NULL)
      `,
    ).run(messageId, threadId, body, state, meta ? JSON.stringify(meta) : null, now, now);

    return {
      messageId,
      timestamp: now,
    };
  };

  const markThreadPending = (threadId: string, messageId: string, routedAgentId?: string | null, activate = true) => {
    const now = new Date().toISOString();
    db.prepare(
      `
        UPDATE assistant_chat_thread_state
        SET last_state = 'pending',
            last_error_code = NULL,
            last_error_summary = NULL,
            last_routed_agent_id = COALESCE(?, last_routed_agent_id),
            active_message_id = ?,
            is_active = CASE WHEN ? = 1 THEN 1 ELSE is_active END,
            updated_at = ?
        WHERE thread_id = ?
      `,
    ).run(routedAgentId ?? null, messageId, activate ? 1 : 0, now, threadId);
    if (activate) {
      setActiveThreadRow(threadId);
    }
  };

  const completeAssistantMessage = (
    threadId: string,
    assistantMessageId: string,
    summarySeed: string,
    response: {
      status: string;
      assistantMessage: string;
      routedAgentId: string | null;
      routedAgentName: string;
      routedAgentRole: string | null;
      orchestration: { intent: string | null; requiresApproval: boolean } | null;
      stateLabel: string;
      stateBody: string;
      intentLabel: string;
      commandStateLabel: string;
      toolTraces: Array<{ summary: string }>;
      draftRunId: string | null;
      approvalDecision?: "pending" | "approved" | "approved_for_session" | "denied" | null;
      approvalScope?: "run" | "session" | null;
      approvalReason?: string | null;
      actionLinks?: AssistantActionLink[];
      notificationIntents?: AgentNotificationIntent[];
      operationalReceipt?: AssistantOperationalReceipt | null;
    },
  ) => {
    const completedAt = new Date().toISOString();
    const meta = normalizeMeta(response);
    db.prepare(
      `
        UPDATE assistant_chat_messages
        SET body = ?,
            message_state = 'completed',
            state_payload_json = ?,
            updated_at = ?
        WHERE id = ?
      `,
    ).run(response.assistantMessage, JSON.stringify(meta), completedAt, assistantMessageId);

    db.prepare(
      `
        UPDATE assistant_chat_threads
        SET summary_text = ?,
            updated_at = ?
        WHERE id = ?
      `,
    ).run(buildSummaryText(summarySeed, response.assistantMessage, response.routedAgentName), completedAt, threadId);

    db.prepare(
      `
        UPDATE assistant_chat_thread_state
        SET last_state = ?,
            last_error_code = NULL,
            last_error_summary = NULL,
            last_routed_agent_id = ?,
            last_intent = ?,
            active_message_id = ?,
            updated_at = ?
        WHERE thread_id = ?
      `,
    ).run(
      mapThreadStateFromResponse(response.status),
      response.routedAgentId,
      response.orchestration?.intent ?? null,
      assistantMessageId,
      completedAt,
      threadId,
    );
  };

  const failAssistantMessage = (threadId: string, assistantMessageId: string, summarySeed: string, errorMessage: string) => {
    const failedAt = new Date().toISOString();
    const errorMeta: AssistantChatMessageMeta = {
      tone: "error",
      label: "Assistant unavailable",
      body: errorMessage,
      routedAgentId: null,
      routedAgentName: "Supervisor Agent",
      routedAgentRole: "Supervisor Agent",
      intentLabel: "Routing unavailable",
      commandStateLabel: "No changes applied",
    };

    db.prepare(
      `
        UPDATE assistant_chat_messages
        SET body = ?,
            message_state = 'error',
            state_payload_json = ?,
            updated_at = ?
        WHERE id = ?
      `,
    ).run(errorMessage, JSON.stringify(errorMeta), failedAt, assistantMessageId);

    db.prepare(
      `
        UPDATE assistant_chat_threads
        SET summary_text = ?,
            updated_at = ?
        WHERE id = ?
      `,
    ).run(buildSummaryText(summarySeed, errorMessage, "Supervisor Agent"), failedAt, threadId);

    db.prepare(
      `
        UPDATE assistant_chat_thread_state
        SET last_state = 'provider_error',
            last_error_code = 'provider_error',
            last_error_summary = ?,
            active_message_id = ?,
            updated_at = ?
        WHERE thread_id = ?
      `,
    ).run(errorMessage, assistantMessageId, failedAt, threadId);
  };

  return {
    reconcileInterruptedThreads,
    getSnapshot() {
      return loadSnapshot();
    },
    createThread,
    setActiveThread(input: SetActiveAssistantThreadCommand) {
      setActiveThreadRow(input.threadId);
      return loadSnapshot();
    },
    deleteThread(input: DeleteAssistantThreadCommand) {
      const now = new Date().toISOString();
      db.prepare(
        `
          UPDATE assistant_chat_threads
          SET deleted_at = ?, updated_at = ?
          WHERE id = ?
        `,
      ).run(now, now, input.threadId);
      db.prepare(
        `
          UPDATE assistant_chat_messages
          SET deleted_at = ?, updated_at = ?
          WHERE thread_id = ?
            AND deleted_at IS NULL
        `,
      ).run(now, now, input.threadId);
      db.prepare(
        `
          UPDATE assistant_chat_attachments
          SET status = 'cleanup_pending',
              updated_at = ?
          WHERE thread_id = ?
            AND deleted_at IS NULL
        `,
      ).run(now, input.threadId);

      const attachments = db.prepare(
        `
          SELECT id, storage_path
          FROM assistant_chat_attachments
          WHERE thread_id = ?
            AND deleted_at IS NULL
        `,
      ).all(input.threadId) as Array<{ id: string; storage_path: string }>;

      attachments.forEach((attachment) => {
        try {
          if (fs.existsSync(attachment.storage_path)) {
            fs.unlinkSync(attachment.storage_path);
          }
        } finally {
          db.prepare(
            `
              UPDATE assistant_chat_attachments
              SET status = 'deleted',
                  deleted_at = ?,
                  updated_at = ?
              WHERE id = ?
            `,
          ).run(now, now, attachment.id);
        }
      });

      const nextActive = db
        .prepare(
          `
            SELECT id
            FROM assistant_chat_threads
            WHERE workspace_id = ?
              AND deleted_at IS NULL
              AND id != ?
            ORDER BY updated_at DESC
            LIMIT 1
          `,
        )
        .get(workspaceId, input.threadId) as { id: string } | undefined;
      setActiveThreadRow(nextActive?.id ?? null);

      return loadSnapshot();
    },
    async sendTurn(input: SendAssistantChatTurnCommand) {
      const thread = db
        .prepare(
          `
            SELECT id, title
            FROM assistant_chat_threads
            WHERE id = ?
              AND workspace_id = ?
              AND deleted_at IS NULL
            LIMIT 1
          `,
        )
        .get(input.threadId, input.workspaceId) as { id: string; title: string } | undefined;

      if (!thread) {
        throw new Error("Assistant thread was not found.");
      }

      const userMessageId = `assistant-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const userBody = getPrimaryAttachmentMessage(input.message, input.attachments ?? []);
      const nextTitle = thread.title === defaultThreadTitle ? deriveThreadTitle(userBody) : thread.title;

      db.prepare(
        `
          INSERT INTO assistant_chat_messages (
            id,
            thread_id,
            role,
            body,
            message_state,
            state_payload_json,
            source_connector_key,
            source_channel_id,
            source_external_message_id,
            source_actor_user_id,
            correlation_id,
            source_metadata_json,
            created_at,
            updated_at,
            deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        userMessageId,
        input.threadId,
        "user",
        userBody,
        "sent",
        null,
        input.source?.connectorKey ?? null,
        input.context.sourceChannelId ?? null,
        input.context.sourceExternalMessageId ?? input.source?.externalMessageId ?? null,
        input.context.sourceActorUserId ?? input.source?.actorUserId ?? null,
        input.context.correlationId ?? input.source?.correlationId ?? null,
        input.source ? JSON.stringify(input.source) : null,
        now,
        now,
        null,
      );

      (input.attachments ?? []).forEach((attachment) => {
        persistAttachment(input.threadId, userMessageId, attachment);
      });

      const { messageId: assistantMessageId } = createAssistantMessageRow(input.threadId, "", "pending", null);

      db.prepare(
        `
          UPDATE assistant_chat_threads
          SET title = ?,
              context_key = ?,
              context_label = ?,
              updated_at = ?
          WHERE id = ?
        `,
      ).run(nextTitle, input.context.activePath ?? "/agents", input.context.currentView ?? "Agents", now, input.threadId);

      markThreadPending(input.threadId, assistantMessageId, loadSupervisorAgentId(db), !input.source?.connectorKey);

      try {
        const response = await options.assistantGatewayService.sendMessage(input);
        completeAssistantMessage(input.threadId, assistantMessageId, userBody, response);
        options.onWorkspaceDataChanged?.({
          source: "assistant-tool",
          workspaceId: input.workspaceId,
          entities: ["projects", "assets", "packing", "quotes", "incidents", "rma"],
        });

        try {
          options.memoryService.extractAndPersist({
            message: input.message,
            context: { activeProjectId: input.context.activeProjectId ?? null },
            threadId: input.threadId,
            messageId: userMessageId,
            routedAgentId: response.routedAgentId,
          });
        } catch (error) {
          options.memoryService.recordFailure({
            threadId: input.threadId,
            messageId: userMessageId,
            sourceReason: "manual_promotion",
            body: error instanceof Error ? error.message : "Memory extraction failed after chat turn.",
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Assistant unavailable";
        failAssistantMessage(input.threadId, assistantMessageId, userBody, errorMessage);
      }

      return loadSnapshot();
    },
    updateThreadPreferences(input: UpdateAssistantThreadPreferencesCommand) {
      const now = new Date().toISOString();
      db.prepare(
        `
          UPDATE assistant_chat_thread_state
          SET preferred_approval_mode = ?,
              updated_at = ?
          WHERE thread_id = ?
        `,
      ).run(input.preferredApprovalMode, now, input.threadId);

      return loadSnapshot();
    },
    renameThread(input: RenameAssistantThreadCommand) {
      const trimmedTitle = input.title.trim().slice(0, 120);
      if (!trimmedTitle) {
        throw new Error("Thread title cannot be empty.");
      }
      const now = new Date().toISOString();
      const result = db
        .prepare(
          `
            UPDATE assistant_chat_threads
            SET title = ?,
                updated_at = ?
            WHERE id = ?
              AND workspace_id = ?
              AND deleted_at IS NULL
          `,
        )
        .run(trimmedTitle, now, input.threadId, input.workspaceId);

      if (result.changes === 0) {
        throw new Error("Thread not found.");
      }

      return loadSnapshot();
    },
    async continueReviewedRun(input: {
      runId: string;
      decision: "approve" | "deny" | "approve_for_session";
    }) {
      const run = db
        .prepare(
          `
            SELECT
              agent_runs.id,
              agent_runs.thread_id,
              agent_runs.agent_id,
              agent_runs.title,
              COALESCE(agents.display_name, 'Supervisor Agent') AS agent_display_name,
              COALESCE(NULLIF(trim(agents.role_label), ''), agents.display_name, 'Supervisor Agent') AS agent_role_label
            FROM agent_runs
            LEFT JOIN agents ON agents.id = agent_runs.agent_id
            WHERE agent_runs.workspace_id = ?
              AND agent_runs.id = ?
            LIMIT 1
          `,
        )
        .get(workspaceId, input.runId) as
        | {
            id: string;
            thread_id: string | null;
            agent_id: string | null;
            title: string;
            agent_display_name: string;
            agent_role_label: string;
          }
        | undefined;

      if (!run?.thread_id) {
        return loadSnapshot();
      }

      const summarySeed = `Approval review · ${run.title}`;

      if (input.decision === "deny") {
        const deniedMeta: AssistantChatMessageMeta = {
          tone: "approval",
          label: "Denied",
          body: "You denied this supervised draft. No changes were made.",
          routedAgentId: run.agent_id,
          routedAgentName: run.agent_display_name,
          routedAgentRole: run.agent_role_label,
          intentLabel: "Approval decision recorded",
          commandStateLabel: "No changes applied",
          draftRunId: run.id,
          approvalDecision: "denied",
          approvalScope: "run",
        };
        const { messageId } = createAssistantMessageRow(
          run.thread_id,
          "Understood. I stopped this supervised follow-up. No changes were made.",
          "completed",
          deniedMeta,
        );
        const completedAt = new Date().toISOString();
        db.prepare(
          `
            UPDATE assistant_chat_threads
            SET summary_text = ?,
                updated_at = ?
            WHERE id = ?
          `,
        ).run(
          buildSummaryText(summarySeed, "Understood. I stopped this supervised follow-up. No changes were made.", run.agent_display_name),
          completedAt,
          run.thread_id,
        );
        db.prepare(
          `
            UPDATE assistant_chat_thread_state
            SET last_state = 'completed',
                last_error_code = NULL,
                last_error_summary = NULL,
                last_routed_agent_id = ?,
                active_message_id = ?,
                updated_at = ?
            WHERE thread_id = ?
          `,
        ).run(run.agent_id, messageId, completedAt, run.thread_id);
        return loadSnapshot();
      }

      const pendingMeta: AssistantChatMessageMeta = {
        tone: "sending",
        label: input.decision === "approve_for_session" ? "Continuing under session approval" : "Continuing approved draft",
        body:
          input.decision === "approve_for_session"
            ? "Using your session approval to continue this supervised follow-up."
            : "Applying your approval and continuing this supervised follow-up.",
        routedAgentId: run.agent_id,
        routedAgentName: run.agent_display_name,
        routedAgentRole: run.agent_role_label,
        intentLabel: "Approval decision recorded",
        commandStateLabel: "No changes applied",
        draftRunId: run.id,
        approvalDecision: input.decision === "approve_for_session" ? "approved_for_session" : "approved",
        approvalScope: input.decision === "approve_for_session" ? "session" : "run",
      };

      const { messageId: assistantMessageId } = createAssistantMessageRow(run.thread_id, "", "pending", pendingMeta);
      markThreadPending(run.thread_id, assistantMessageId, run.agent_id);

      try {
        const response = await options.assistantGatewayService.continueApprovedRun({
          workspaceId,
          threadId: run.thread_id,
          runId: run.id,
          approvalScope: input.decision === "approve_for_session" ? "session" : "run",
        });
        completeAssistantMessage(run.thread_id, assistantMessageId, summarySeed, response);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Approved follow-up could not continue.";
        failAssistantMessage(run.thread_id, assistantMessageId, summarySeed, errorMessage);
      }

      return loadSnapshot();
    },
  };
};

export type AssistantChatService = ReturnType<typeof createAssistantChatService>;
