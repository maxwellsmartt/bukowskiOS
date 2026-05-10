import type {
  AIGatewayToolCallTrace,
  AIGatewayToolContext,
  AssistantActionLink,
  AssistantGatewayAttachment,
  AssistantGatewayRequest,
  AssistantGatewayResponse,
  AssistantOperationalReceipt,
  AgentNotificationIntent,
  OrchestrationResult,
} from "@contracts";
import type { DatabaseSync } from "node:sqlite";

import type { AISecretStore } from "./aiSecretStore";
import type { AnthropicProviderService } from "./anthropicProviderService";
import type { AssistantMemoryService } from "./assistantMemoryService";
import type { AgentToolRegistry } from "./agentToolRegistry";
import type { OpenAIProviderService } from "./openaiProviderService";
import type { AssistantGatewaySessionStore } from "./assistantGatewaySessionStore";

import { DEFAULT_WORKSPACE_ID } from "@contracts";
import { getDesktopLogger } from "../logger";

const defaultWorkspaceId = DEFAULT_WORKSPACE_ID;
const maxToolCalls = 10;
const maxToolPayloadChars = 4000;
const logger = getDesktopLogger("assistant-gateway");
type AssistantProviderService = Pick<OpenAIProviderService, "createResponse" | "testConnection">;

const orchestrationSchema = {
  type: "json_schema",
  name: "bukowski_assistant_gateway_response",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: { type: "string" },
      target_agent: {
        type: "string",
        enum: [
          "supervisor-agent",
          "assets-agent",
          "incidents-maintenance-agent",
          "finance-agent",
          "communications-agent",
          "projects-scheduling-agent",
          "bugs-agent",
          "product-agent",
        ],
      },
      confidence: { type: "number" },
      requires_approval: { type: "boolean" },
      tool_call_requested: { type: "boolean" },
      user_facing_summary: { type: "string" },
      answer_kind: {
        type: "string",
        enum: ["informational", "draft_run", "needs_approval", "error"],
      },
      draft_run_title: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      draft_run_description: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
    },
    required: [
      "intent",
      "target_agent",
      "confidence",
      "requires_approval",
      "tool_call_requested",
      "user_facing_summary",
      "answer_kind",
      "draft_run_title",
      "draft_run_description",
    ],
  },
} satisfies Record<string, unknown>;

const safeJsonParse = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const parseAppContextSummary = (request: AssistantGatewayRequest) => ({
  activePath: request.context.activePath ?? "/assets",
  activeProjectId: request.context.activeProjectId ?? null,
  currentView: request.context.currentView ?? null,
  filters: request.context.activeFilters ?? {},
});

const summarizeAttachments = (attachments: AssistantGatewayAttachment[]) =>
  attachments.map((attachment) => ({
    kind: attachment.kind,
    name: attachment.name,
    mimeType: attachment.mimeType,
  }));

const truncateText = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

const createEventId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const serializeToolPayload = (payload: unknown) => {
  const serialized = JSON.stringify(payload);

  if (serialized.length <= maxToolPayloadChars) {
    return serialized;
  }

  logger.warn("Truncated oversized tool payload before second model pass.", {
    originalLength: serialized.length,
    maxToolPayloadChars,
  });

  return JSON.stringify({
    _truncated: true,
    originalType: Array.isArray(payload) ? "array" : typeof payload,
    preview: truncateText(serialized, maxToolPayloadChars - 160),
  });
};

const collectNotificationIntents = (
  payloads: Array<{
    toolName: string;
    payload: unknown;
  }>,
): AgentNotificationIntent[] => {
  const intents: AgentNotificationIntent[] = [];

  for (const entry of payloads) {
    if (!entry.payload || typeof entry.payload !== "object") {
      continue;
    }

    const maybeIntent = (entry.payload as { notificationIntent?: unknown }).notificationIntent;
    if (!maybeIntent || typeof maybeIntent !== "object") {
      continue;
    }

    const intent = maybeIntent as AgentNotificationIntent;
    if (
      intent.type === "create_notification" ||
      intent.type === "create_todo" ||
      intent.type === "create_reminder"
    ) {
      intents.push(intent);
    }
  }

  return intents;
};

const asPayloadRecord = (payload: unknown): Record<string, unknown> | null =>
  payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;

const asPayloadString = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const appendActionLink = (links: AssistantActionLink[], seen: Set<string>, link: AssistantActionLink | null) => {
  if (!link) {
    return;
  }

  const key = `${link.entityType}:${link.entityId}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  links.push(link);
};

const buildActionLinks = (
  executedToolPayloads: Array<{
    toolName: string;
    payload: unknown;
  }>,
): AssistantActionLink[] => {
  const links: AssistantActionLink[] = [];
  const seen = new Set<string>();

  for (const { payload } of executedToolPayloads) {
    const record = asPayloadRecord(payload);
    if (!record) {
      continue;
    }

    const projectId = asPayloadString(record, "projectId");
    appendActionLink(
      links,
      seen,
      projectId
        ? {
            label: "Open project",
            path: `/projects/${encodeURIComponent(projectId)}/info`,
            entityType: "project",
            entityId: projectId,
          }
        : null,
    );

    const assetId = asPayloadString(record, "assetId");
    appendActionLink(
      links,
      seen,
      assetId
        ? {
            label: "Open asset",
            path: `/assets/${encodeURIComponent(assetId)}`,
            entityType: "asset",
            entityId: assetId,
          }
        : null,
    );

    const quoteId = asPayloadString(record, "quoteId");
    appendActionLink(
      links,
      seen,
      quoteId
        ? {
            label: "Open quote",
            path: `/finance/quotes/${encodeURIComponent(quoteId)}`,
            entityType: "quote",
            entityId: quoteId,
          }
        : null,
    );

    const packingSlipId = asPayloadString(record, "packingSlipId");
    appendActionLink(
      links,
      seen,
      packingSlipId
        ? {
            label: "Open packing slip",
            path: `/packing-slips?focus=${encodeURIComponent(packingSlipId)}`,
            entityType: "packing_slip",
            entityId: packingSlipId,
          }
        : null,
    );

    const incidentId = asPayloadString(record, "incidentId");
    appendActionLink(
      links,
      seen,
      incidentId
        ? {
            label: "Open incident",
            path: `/incidents?focus=${encodeURIComponent(incidentId)}`,
            entityType: "incident",
            entityId: incidentId,
          }
        : null,
    );

    const rmaCaseId = asPayloadString(record, "rmaCaseId");
    appendActionLink(
      links,
      seen,
      rmaCaseId
        ? {
            label: "Open RMA",
            path: `/incidents/rma?focus=${encodeURIComponent(rmaCaseId)}`,
            entityType: "rma",
            entityId: rmaCaseId,
          }
        : null,
    );
  }

  return links;
};

const summarizeToolName = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());

const buildOperationalReceipt = (args: {
  toolTraces: AIGatewayToolCallTrace[];
  actionLinks: AssistantActionLink[];
  deferredWriteToolCalls: Array<{ toolName: string; arguments: Record<string, unknown> }>;
  executedWriteToolNames: string[];
}): AssistantOperationalReceipt | null => {
  if (!args.toolTraces.length && !args.actionLinks.length && !args.deferredWriteToolCalls.length) {
    return null;
  }

  const completed = args.toolTraces
    .filter((trace) => trace.status === "completed")
    .map((trace) => ({
      label: summarizeToolName(trace.toolName),
      status: "done" as const,
      detail: trace.summary,
    }));
  const blocked = args.toolTraces
    .filter((trace) => trace.status === "failed")
    .map((trace) => ({
      label: summarizeToolName(trace.toolName),
      status: "blocked" as const,
      detail: trace.summary,
    }));
  const pending = args.deferredWriteToolCalls.map((tool) => ({
    label: summarizeToolName(tool.toolName),
    status: "pending" as const,
    detail: "Needs approval before changing the workspace.",
  }));
  const nextSteps: string[] = [];

  if (blocked.length) {
    nextSteps.push("Reply with the missing detail or corrected target so the agent can continue from the blocked step.");
  }

  if (pending.length) {
    nextSteps.push("Approve the pending action or adjust it before it changes the workspace.");
  }

  if (args.actionLinks.length) {
    nextSteps.push("Open the created records from the action links if you want to inspect them.");
  }

  if (!nextSteps.length && args.executedWriteToolNames.length) {
    nextSteps.push("No follow-up is required unless you want to adjust the created records.");
  }

  const summary = blocked.length
    ? `${completed.length} step(s) completed, ${blocked.length} blocked.`
    : pending.length
      ? `${pending.length} action(s) waiting for approval.`
      : args.executedWriteToolNames.length
        ? `${args.executedWriteToolNames.length} action(s) completed.`
        : completed.length
          ? `${completed.length} lookup step(s) completed.`
          : "Assistant action recorded.";

  return {
    summary,
    completed,
    blocked,
    pending,
    nextSteps,
  };
};

const summarizeOperationalReceiptForSession = (receipt: AssistantOperationalReceipt | null) => {
  if (!receipt) {
    return null;
  }

  const details = [
    ...receipt.blocked.map((item) => `blocked:${item.label}${item.detail ? ` (${item.detail})` : ""}`),
    ...receipt.pending.map((item) => `pending:${item.label}`),
    ...receipt.completed.slice(0, 3).map((item) => `done:${item.label}`),
  ];
  return truncateText([receipt.summary, ...details].join(" | "), 1000);
};

const parseToolArgumentsPreview = (value: string) => {
  const parsed = safeJsonParse<Record<string, unknown>>(value);
  if (!parsed) {
    return {};
  }

  return parsed;
};

const summarizeMessageForSession = (request: AssistantGatewayRequest) => {
  const trimmedMessage = request.message.trim();
  const attachmentCount = request.attachments?.length ?? 0;

  if (!attachmentCount) {
    return trimmedMessage;
  }

  const attachmentSummary = attachmentCount === 1 ? "attached 1 image" : `attached ${attachmentCount} images`;
  return trimmedMessage ? `${trimmedMessage} (${attachmentSummary})` : `Image review request (${attachmentSummary})`;
};

const buildGatewayInput = (
  request: AssistantGatewayRequest,
  recentUserMessages: string[],
  recentAssistantMessages: string[],
): string | Array<Record<string, unknown>> => {
  const attachments = request.attachments ?? [];
  const trimmedMessage = request.message.trim();
  const payload = JSON.stringify({
    userMessage:
      trimmedMessage || (attachments.length ? "Please review the attached image context for BukowskiOS." : ""),
    appContext: parseAppContextSummary(request),
    recentUserMessages,
    recentAssistantMessages,
    attachments: attachments.length ? summarizeAttachments(attachments) : [],
  });

  if (!attachments.length) {
    return payload;
  }

  return [
    {
      role: "user",
      content: [
        { type: "input_text", text: payload },
        ...attachments.map((attachment) => ({
          type: "input_image",
          image_url: attachment.dataUrl,
        })),
      ],
    },
  ];
};

const loadSupervisorConfig = (db: DatabaseSync, workspaceId: string) =>
  db
    .prepare(
      `
        SELECT id, agent_key, provider_key, model_key, COALESCE(base_prompt, '') AS base_prompt
        FROM agents
        WHERE workspace_id IN (?, ?)
          AND is_supervisor = 1
        ORDER BY CASE WHEN workspace_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `,
    )
    .get(workspaceId, defaultWorkspaceId, workspaceId) as
    | {
        id: string;
        agent_key: string;
        provider_key: string;
        model_key: string;
        base_prompt: string;
      }
    | undefined;

const loadProviderConfig = (db: DatabaseSync, providerKey: string, workspaceId: string) =>
  db
    .prepare(
      `
        SELECT display_name, enabled, default_model_key, COALESCE(fallback_model_key, '') AS fallback_model_key, base_url, timeout_ms, retry_count, status
        FROM ai_provider_configs
        WHERE workspace_id IN (?, ?)
          AND provider_key = ?
        ORDER BY CASE WHEN workspace_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `,
    )
    .get(workspaceId, defaultWorkspaceId, providerKey, workspaceId) as
    | {
        display_name: string;
        enabled: number;
        default_model_key: string;
        fallback_model_key: string;
        base_url: string;
        timeout_ms: number;
        retry_count: number;
        status: string;
      }
    | undefined;

const loadAgentsPrompt = (db: DatabaseSync, workspaceId: string) => {
  let rows = db
    .prepare(
      `
        SELECT agent_key, display_name, domain_key, role_summary, approval_mode
        , COALESCE(mission, role_summary) AS mission
        FROM agents
        WHERE workspace_id = ?
        ORDER BY is_supervisor DESC, sort_order ASC
      `,
    )
    .all(workspaceId) as Array<{
      agent_key: string;
      display_name: string;
      domain_key: string;
      role_summary: string;
      approval_mode: string;
      mission: string;
    }>;

  if (!rows.length && workspaceId !== defaultWorkspaceId) {
    rows = db
      .prepare(
        `
          SELECT agent_key, display_name, domain_key, role_summary, approval_mode
          , COALESCE(mission, role_summary) AS mission
          FROM agents
          WHERE workspace_id = ?
          ORDER BY is_supervisor DESC, sort_order ASC
        `,
      )
      .all(defaultWorkspaceId) as typeof rows;
  }

  return rows
    .map(
      (row) =>
        `- ${row.agent_key}: ${row.display_name} | domain=${row.domain_key} | approval=${row.approval_mode} | mission=${row.mission}`,
    )
    .join("\n");
};

const loadAgentTarget = (db: DatabaseSync, agentKey: string, workspaceId: string) =>
  db
    .prepare(
      `
        SELECT id, display_name, COALESCE(NULLIF(trim(role_label), ''), display_name) AS role_label, approval_mode
        FROM agents
        WHERE workspace_id IN (?, ?)
          AND agent_key = ?
        ORDER BY CASE WHEN workspace_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `,
    )
    .get(workspaceId, defaultWorkspaceId, agentKey, workspaceId) as
    | {
        id: string;
        display_name: string;
        role_label: string;
        approval_mode: string;
      }
    | undefined;

const loadAgentRuntimeConfigByKey = (db: DatabaseSync, agentKey: string, workspaceId: string) =>
  db
    .prepare(
      `
        SELECT id, agent_key, display_name, COALESCE(NULLIF(trim(role_label), ''), display_name) AS role_label, approval_mode, provider_key, model_key, COALESCE(base_prompt, '') AS base_prompt
        FROM agents
        WHERE workspace_id IN (?, ?)
          AND agent_key = ?
        ORDER BY CASE WHEN workspace_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `,
    )
    .get(workspaceId, defaultWorkspaceId, agentKey, workspaceId) as
    | {
        id: string;
        agent_key: string;
        display_name: string;
        role_label: string;
        approval_mode: string;
        provider_key: string | null;
        model_key: string;
        base_prompt: string;
      }
    | undefined;

const loadAgentRuntimeConfigById = (db: DatabaseSync, agentId: string, workspaceId: string) =>
  db
    .prepare(
      `
        SELECT id, agent_key, display_name, COALESCE(NULLIF(trim(role_label), ''), display_name) AS role_label, approval_mode, provider_key, model_key, COALESCE(base_prompt, '') AS base_prompt
        FROM agents
        WHERE workspace_id IN (?, ?)
          AND id = ?
        ORDER BY CASE WHEN workspace_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `,
    )
    .get(workspaceId, defaultWorkspaceId, agentId, workspaceId) as
    | {
        id: string;
        agent_key: string;
        display_name: string;
        role_label: string;
        approval_mode: string;
        provider_key: string | null;
        model_key: string;
        base_prompt: string;
      }
    | undefined;

const inferProjectIdFromPath = (activePath?: string | null) => {
  if (!activePath) {
    return null;
  }

  const match = activePath.match(/^\/projects\/([^/]+)/);
  return match?.[1] ?? null;
};

const loadThreadRouteContext = (db: DatabaseSync, threadId: string) =>
  db
    .prepare(
      `
        SELECT context_key, context_label
        FROM assistant_chat_threads
        WHERE id = ?
          AND deleted_at IS NULL
        LIMIT 1
      `,
    )
    .get(threadId) as
    | {
        context_key: string;
        context_label: string;
      }
    | undefined;

const loadRecentAssistantMessages = (db: DatabaseSync, threadId: string, limit = 2) =>
  (
    db
      .prepare(
        `
          SELECT body
          FROM assistant_chat_messages
          WHERE thread_id = ?
            AND role = 'assistant'
            AND message_state = 'completed'
            AND deleted_at IS NULL
            AND trim(body) <> ''
          ORDER BY created_at DESC
          LIMIT ?
        `,
      )
      .all(threadId, limit) as Array<{ body: string }>
  )
    .map((row) => row.body.trim().replace(/\s+/g, " ").slice(0, 1200))
    .reverse();

const loadThreadSessionApproval = (db: DatabaseSync, threadId: string) =>
  db
    .prepare(
      `
        SELECT session_approval_agent_id, session_approval_granted_at
        FROM assistant_chat_thread_state
        WHERE thread_id = ?
        LIMIT 1
      `,
    )
    .get(threadId) as
    | {
        session_approval_agent_id: string | null;
        session_approval_granted_at: string | null;
      }
    | undefined;

const createActivityEvent = (
  db: DatabaseSync,
  event: {
    workspaceId: string;
    id: string;
    agentId: string | null;
    runId: string | null;
    kind: string;
    title: string;
    body: string;
    tone: "neutral" | "info" | "warning" | "critical" | "success";
    source: "manual" | "ai_gateway";
    detailsJson?: string | null;
    createdAt: string;
  },
) => {
  db.prepare(
    `
      INSERT INTO agent_activity_events (
        id,
        workspace_id,
        agent_id,
        run_id,
        kind,
        title,
        body,
        tone,
        source,
        details_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    event.id,
    event.workspaceId,
    event.agentId,
    event.runId,
    event.kind,
    event.title,
    event.body,
    event.tone,
    event.source,
    event.detailsJson ?? null,
    event.createdAt,
  );
};

const createDraftRun = (
  db: DatabaseSync,
  args: {
    workspaceId: string;
    threadId: string;
    routedAgentId: string | null;
    title: string;
    inputSummary: string;
    outputSummary: string;
    approvalMode: string;
    requiresApproval: boolean;
    approvalDecision: "pending" | "approved" | "approved_for_session" | null;
    approvalScope: "run" | "session" | null;
    detailsJson: string;
    sourceConnectorKey?: string | null;
    sourceChannelId?: string | null;
    sourceExternalMessageId?: string | null;
    sourceActorUserId?: string | null;
    correlationId?: string | null;
  },
) => {
  const now = new Date().toISOString();
  const runId = `run-ai-${Date.now().toString(36)}`;

  db.prepare(
    `
      INSERT INTO agent_runs (
        id,
        workspace_id,
        agent_id,
        routed_by_agent_id,
        source_channel,
        title,
        input_summary,
        output_summary,
        status,
        approval_mode,
        approval_required,
        thread_id,
        approval_decision,
        approval_scope,
        approval_decided_at,
        source,
        details_json,
        source_connector_key,
        source_channel_id,
        source_external_message_id,
        source_actor_user_id,
        correlation_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, NULL, 'chat', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_gateway', ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    runId,
    args.workspaceId,
    args.routedAgentId,
    args.title,
    args.inputSummary,
    args.outputSummary,
    args.requiresApproval ? "needs_approval" : args.approvalDecision ? "approved" : "done",
    args.approvalMode,
    args.requiresApproval ? 1 : 0,
    args.threadId,
    args.approvalDecision,
    args.approvalScope,
    args.approvalDecision ? now : null,
    args.detailsJson,
    args.sourceConnectorKey ?? null,
    args.sourceChannelId ?? null,
    args.sourceExternalMessageId ?? null,
    args.sourceActorUserId ?? null,
    args.correlationId ?? null,
    now,
    now,
  );

  return { runId, now };
};

const buildHumanErrorResponse = (
  status: AssistantGatewayResponse["status"],
  body: string,
  providerKey: string | null,
  modelKey: string | null,
): AssistantGatewayResponse => ({
  status,
  stateLabel: status === "needs_configuration" ? "Provider setup required" : "Assistant unavailable",
  stateBody: body,
  assistantMessage: body,
  routedAgentId: null,
  routedAgentName: "Supervisor Agent",
  routedAgentRole: "Supervisor Agent",
  intentLabel: "Routing unavailable",
  commandStateLabel: "No changes applied",
  draftRunId: null,
  approvalDecision: null,
  approvalScope: null,
  providerKey,
  modelKey,
  toolTraces: [],
  orchestration: null,
});

const normalizeFastPathMessage = (message: string) =>
  message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const hasActionIntent = (normalizedMessage: string) =>
  /\b(crea|crear|creame|genera|generar|prepara|preparar|haz|hacer|asigna|asignar|mueve|mover|borra|borrar|elimina|eliminar|actualiza|actualizar|edita|editar|packing|quote|cotizacion|rma|incidente|reminder|todo)\b/i.test(
    normalizedMessage,
  );

const formatRateValue = (value: unknown) =>
  typeof value === "number"
    ? new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(value)
    : "—";

const formatFastPathTimestamp = (value: unknown) => {
  if (typeof value !== "string" || !value) {
    return "sin hora guardada";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("es-DO", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const buildFastPathResponse = (input: {
  assistantMessage: string;
  intentLabel: string;
  commandStateLabel?: string;
  toolTraces: AIGatewayToolCallTrace[];
}): AssistantGatewayResponse => ({
  status: "answered",
  stateLabel: "Answered",
  stateBody: "Answered from workspace data.",
  assistantMessage: input.assistantMessage,
  routedAgentId: null,
  routedAgentName: "Fast path",
  routedAgentRole: "Workspace tools",
  intentLabel: input.intentLabel,
  commandStateLabel: input.commandStateLabel ?? "No changes applied",
  draftRunId: null,
  approvalDecision: null,
  approvalScope: null,
  approvalReason: null,
  providerKey: "workspace-tools",
  modelKey: "fast-path",
  toolTraces: input.toolTraces,
  orchestration: {
    intent: input.intentLabel,
    targetAgentId: null,
    targetAgentName: "Fast path",
    confidence: 1,
    requiresApproval: false,
    toolCallRequested: true,
    toolCalls: input.toolTraces,
    userFacingSummary: input.assistantMessage,
    answerKind: "informational",
    draftRunTitle: null,
    draftRunDescription: null,
  },
});

const getCurrencyRequests = (normalizedMessage: string) => {
  const mentionsUsd = /\b(usd|dolar|dolares|dollar|dollars)\b/.test(normalizedMessage);
  const mentionsEur = /\b(eur|euro|euros)\b/.test(normalizedMessage);
  if (mentionsUsd && mentionsEur) {
    return ["USD", "EUR"];
  }
  if (mentionsEur) {
    return ["EUR"];
  }
  return ["USD"];
};

const buildExchangeFastPathMessage = (payloads: Array<Record<string, unknown>>) => {
  const sections = payloads.map((payload) => {
    const pair = typeof payload.pair === "string" ? payload.pair : "USD/DOP";
    const items = Array.isArray(payload.items) ? (payload.items as Array<Record<string, unknown>>) : [];
    const bestBuySource = typeof payload.bestBuySource === "string" ? payload.bestBuySource : null;
    const bestSellSource = typeof payload.bestSellSource === "string" ? payload.bestSellSource : null;

    if (!items.length) {
      return `No tengo tasas activas guardadas para ${pair}. Prueba Refresh rates en Finance para traer el último snapshot.`;
    }

    const lines = items.slice(0, 6).map((item) => {
      const buy = item.buy && typeof item.buy === "object" ? (item.buy as Record<string, unknown>) : null;
      const sell = item.sell && typeof item.sell === "object" ? (item.sell as Record<string, unknown>) : null;
      const sourceLabel = typeof item.sourceLabel === "string" ? item.sourceLabel : "Banco";
      const fetchedAt = formatFastPathTimestamp(buy?.fetchedAt ?? sell?.fetchedAt);
      const sourceProof = typeof buy?.sourceProof === "string" ? buy.sourceProof : typeof sell?.sourceProof === "string" ? sell.sourceProof : null;
      const bestMarkers = [
        bestBuySource === sourceLabel ? "mejor compra" : null,
        bestSellSource === sourceLabel ? "mejor venta" : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `- ${sourceLabel}: compra ${formatRateValue(buy?.rate)} | venta ${formatRateValue(sell?.rate)}${
        bestMarkers ? ` (${bestMarkers})` : ""
      }. Actualizado: ${fetchedAt}${sourceProof ? ` · fuente: ${sourceProof}` : ""}`;
    });

    return [`${pair}`, ...lines].join("\n");
  });

  return sections.join("\n\n");
};

const extractLookupQuery = (normalizedMessage: string, originalMessage: string) => {
  if (/\bmonitor(es)?\b/.test(normalizedMessage)) {
    return "monitor";
  }
  if (/\bteradek\b/.test(normalizedMessage)) {
    return "teradek";
  }
  if (/\bflanders\b/.test(normalizedMessage)) {
    return "flanders";
  }
  if (/\blicen(c|s)ia(s)?\b/.test(normalizedMessage)) {
    return "license";
  }
  return originalMessage
    .replace(/[¿?]/g, " ")
    .replace(/\b(busca|buscar|buscame|hay|tienes|disponible|disponibles|availability|search|asset|assets|equipo|equipos|en|el|la|los|las|un|una|de|del|para|por|favor)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
};

const buildAssetFastPathMessage = (payload: Record<string, unknown>, query: string) => {
  const items = Array.isArray(payload.items) ? (payload.items as Array<Record<string, unknown>>) : [];
  if (!items.length) {
    return `No encontré assets disponibles para “${query}”. Puedo hacer una búsqueda más amplia o revisar por categoría si quieres.`;
  }
  const exactMatch = payload.exactMatch !== false;
  const intro = exactMatch
    ? `Encontré ${items.length} asset${items.length === 1 ? "" : "s"} para “${query}”:`
    : `No encontré match exacto para “${query}”, pero estas alternativas están disponibles:`;
  const lines = items.map((item) => {
    const name = typeof item.name === "string" ? item.name : "Asset";
    const code = typeof item.code === "string" ? item.code : "sin código";
    const quantity = typeof item.availableQuantity === "number" ? item.availableQuantity : null;
    const location = typeof item.location === "string" ? item.location : "sin ubicación";
    return `- ${name} (${code})${quantity !== null ? ` · disponible: ${quantity}` : ""} · ${location}`;
  });
  return [intro, ...lines].join("\n");
};

const maybeRunFastPath = (
  request: AssistantGatewayRequest,
  toolRegistry: AgentToolRegistry,
): AssistantGatewayResponse | null => {
  if (request.attachments?.length) {
    return null;
  }
  const normalizedMessage = normalizeFastPathMessage(request.message);
  if (hasActionIntent(normalizedMessage)) {
    return null;
  }

  const context: AIGatewayToolContext = {
    ...request.context,
    workspaceId: request.workspaceId || request.context.workspaceId || defaultWorkspaceId,
  };

  if (/\b(tasa|tasas|exchange|cambio|dolar|dolares|usd|euro|eur|banco|popular|central|santa cruz)\b/.test(normalizedMessage)) {
    const toolTraces: AIGatewayToolCallTrace[] = [];
    const payloads: Array<Record<string, unknown>> = [];
    for (const currency of getCurrencyRequests(normalizedMessage)) {
      const execution = toolRegistry.execute(
        "compare_exchange_rates",
        JSON.stringify({ base_currency: currency, quote_currency: "DOP" }),
        context,
      );
      toolTraces.push(execution.trace);
      payloads.push(execution.result.payload as Record<string, unknown>);
    }
    return buildFastPathResponse({
      assistantMessage: buildExchangeFastPathMessage(payloads),
      intentLabel: "Exchange-rate lookup",
      toolTraces,
    });
  }

  if (/\b(busca|buscar|buscame|search|disponible|disponibles|availability|hay|tienes|asset|assets|equipo|equipos|monitor|teradek|flanders)\b/.test(normalizedMessage)) {
    const query = extractLookupQuery(normalizedMessage, request.message);
    if (!query) {
      return null;
    }
    const execution = toolRegistry.execute(
      "search_assets",
      JSON.stringify({ query, status: "Available", scope: "workspace", limit: 5 }),
      context,
    );
    return buildFastPathResponse({
      assistantMessage: buildAssetFastPathMessage(execution.result.payload as Record<string, unknown>, query),
      intentLabel: "Asset availability lookup",
      toolTraces: [execution.trace],
    });
  }

  return null;
};

const formatProviderFailureForUser = (summary: string, fallback: string) => {
  const normalized = summary.toLowerCase();

  if (
    normalized.includes("sin créditos") ||
    normalized.includes("insufficient_quota") ||
    normalized.includes("exceeded your current quota") ||
    normalized.includes("billing") ||
    normalized.includes("credit")
  ) {
    return "El proveedor de AI no pudo responder porque la cuenta parece estar sin créditos o con un límite de billing activo. Revisa Billing, recarga créditos y vuelve a intentarlo.";
  }

  if (normalized.includes("rate limit") || normalized.includes("limitando temporalmente")) {
    return "El proveedor de AI está limitando temporalmente las solicitudes. Espera unos segundos y vuelve a intentarlo.";
  }

  return fallback;
};

const deriveApprovalReason = (args: {
  requestedApprovalMode: "supervised" | "needs_approval" | "unsupervised";
  targetAgentName: string;
  targetApprovalMode: string;
  orchestrationRequiresApproval: boolean;
  answerKind: "informational" | "draft_run" | "needs_approval" | "error";
}) => {
  if (args.requestedApprovalMode === "needs_approval") {
    return "This thread is set to Needs approval, so delegated follow-up must stop here for review.";
  }

  if (args.targetApprovalMode === "needs_approval") {
    return `${args.targetAgentName} is configured to always ask for approval before continuing delegated work.`;
  }

  if (args.orchestrationRequiresApproval || args.answerKind === "needs_approval") {
    return "Supervisor marked this as action-like work that should stay behind an approval boundary.";
  }

  return null;
};

const markThreadRoutedAgentPending = (db: DatabaseSync, threadId: string, routedAgentId: string | null) => {
  if (!routedAgentId) {
    return;
  }

  db.prepare(
    `
      UPDATE assistant_chat_thread_state
      SET last_routed_agent_id = ?,
          updated_at = ?
      WHERE thread_id = ?
        AND last_state IN ('pending', 'streaming')
    `,
  ).run(routedAgentId, new Date().toISOString(), threadId);
};

export const createAssistantGatewayService = (
  db: DatabaseSync,
  options: {
    secretStore: AISecretStore;
    openaiProviderService: AssistantProviderService;
    anthropicProviderService?: AnthropicProviderService;
    sessionStore: AssistantGatewaySessionStore;
    toolRegistry: AgentToolRegistry;
    memoryService?: AssistantMemoryService;
  },
) => {
  const getProviderService = (providerKey: string | null | undefined) =>
    providerKey === "anthropic" && options.anthropicProviderService
      ? options.anthropicProviderService
      : options.openaiProviderService;
  const createProviderResponse = async (
    providerKey: string,
    config: {
      apiKey: string;
      baseUrl: string;
      defaultModelKey: string;
      fallbackModelKey?: string | null;
      timeoutMs: number;
    },
    input: Parameters<OpenAIProviderService["createResponse"]>[1],
  ) => {
    const providerService = getProviderService(providerKey);
    const primaryResult = await providerService.createResponse(
      {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        defaultModelKey: config.defaultModelKey,
        timeoutMs: config.timeoutMs,
      },
      input,
    );

    const fallbackModelKey = config.fallbackModelKey?.trim();
    if (primaryResult.ok || !fallbackModelKey || fallbackModelKey === input.model) {
      return {
        result: primaryResult,
        modelKey: input.model,
        usedFallback: false,
      };
    }

    const fallbackResult = await providerService.createResponse(
      {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        defaultModelKey: fallbackModelKey,
        timeoutMs: config.timeoutMs,
      },
      {
        ...input,
        previousResponseId: null,
        model: fallbackModelKey,
      },
    );

    return {
      result: fallbackResult,
      modelKey: fallbackResult.ok ? fallbackModelKey : input.model,
      usedFallback: fallbackResult.ok,
    };
  };

  const runGatewayTurn = async (
    request: AssistantGatewayRequest,
    executionOptions?: {
      approvalBypassAgentId?: string | null;
      approvalScope?: "run" | "session" | null;
      existingRunId?: string | null;
      existingRunTitle?: string | null;
    },
  ): Promise<AssistantGatewayResponse> => {
    const workspaceId = request.workspaceId || request.context.workspaceId || defaultWorkspaceId;
    const fastPathResponse = maybeRunFastPath(request, options.toolRegistry);
    if (fastPathResponse) {
      options.sessionStore.writeResult(request.workspaceId, request.threadId, {
        previousResponseId: null,
        intent: fastPathResponse.intentLabel,
        targetAgent: fastPathResponse.routedAgentName,
        toolResultSummary: fastPathResponse.toolTraces[fastPathResponse.toolTraces.length - 1]?.summary ?? null,
        status: fastPathResponse.status,
        error: null,
      });
      return fastPathResponse;
    }

    const supervisor = loadSupervisorConfig(db, workspaceId);
    const supervisorProviderKey = supervisor?.provider_key ?? "openai";
    const supervisorModelKey = supervisor?.model_key ?? "openai:gpt-5.2";

    if (!supervisor) {
      return buildHumanErrorResponse(
        "needs_configuration",
        "Supervisor Agent is not configured yet. Assign a provider and model in Models first.",
        supervisorProviderKey,
        supervisorModelKey,
      );
    }

    const supervisorProvider = loadProviderConfig(db, supervisorProviderKey, workspaceId);

    if (!supervisorProvider) {
      return buildHumanErrorResponse(
        "needs_configuration",
        "Connect an AI provider in Models before using chat.",
        supervisorProviderKey,
        supervisorModelKey,
      );
    }

    if (supervisorProvider.enabled !== 1) {
      const disabledMessage =
        supervisorProvider.status === "healthy" || supervisorProvider.status === "configured"
          ? `${supervisorProvider.display_name} is configured but still disabled in Models. Enable it before using chat.`
          : "Connect an AI provider in Models before using chat.";

      return buildHumanErrorResponse(
        "needs_configuration",
        disabledMessage,
        supervisorProviderKey,
        supervisorModelKey,
      );
    }

    const supervisorApiKey = options.secretStore.getProviderSecret(workspaceId, supervisorProviderKey);

    if (!supervisorApiKey) {
      return buildHumanErrorResponse(
        "needs_configuration",
        "Add an API key for this provider in Models before using chat.",
        supervisorProviderKey,
        supervisorModelKey,
      );
    }

    const sessionSnapshot = options.sessionStore.read(request.workspaceId, request.threadId);
    options.sessionStore.touchMessage(request.workspaceId, request.threadId, summarizeMessageForSession(request));

    const supervisorMemoryOverlay =
      options.memoryService?.getOverlay({
        agentId: supervisor.id,
        projectId: request.context.activeProjectId ?? null,
        query: request.message,
        limit: 5,
      }) ?? { agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] };
    const financeContextHint =
      request.context.activePath?.startsWith("/finance")
        ? (() => {
            try {
              const result = options.toolRegistry.execute("get_financial_health", "{}", request.context);
              const payload = result.result.payload as {
                trackedSpend?: string;
                reserve?: string;
                exposure?: string;
                burnRateAverage?: string;
                scope?: string;
              };

              return `Active finance context: scope=${payload.scope ?? "workspace"} | trackedSpend=${payload.trackedSpend ?? "—"} | reserve=${payload.reserve ?? "—"} | exposure=${payload.exposure ?? "—"} | burnRate=${payload.burnRateAverage ?? "—"}`;
            } catch {
              return "Active finance context: unavailable";
            }
          })()
        : null;

    const supervisorTodayIso = new Date().toISOString().slice(0, 10);
    const supervisorTodayHuman = new Date().toLocaleDateString("es-DO", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const supervisorRequestingUser = request.context.sourceActorUserId
      ? `user_id=${request.context.sourceActorUserId}`
      : "anonymous workspace member";

    const supervisorInstructions = [
      supervisor.base_prompt || "You are the BukowskiOS Supervisor Agent.",
      "=== SYSTEM CONTEXT ===",
      `Today: ${supervisorTodayIso} (${supervisorTodayHuman})`,
      `Workspace: ${workspaceId}`,
      `Requesting user: ${supervisorRequestingUser}`,
      "=== END SYSTEM CONTEXT ===",
      "Specialists EXECUTE write tools directly when the user asks for an action — packing slips, incidents, RMAs, projects, finance entries, quotes. Don't block them.",
      "Specialists must use search_assets / search_projects / etc. to resolve names → IDs BEFORE asking the user anything. They can use ask_user_choice to surface a small set of options when search returns ambiguous results.",
      "When the user asks to create, prepare, save, or draft a quote, treat it as a saved draft in Quotes and route toward create_quote. prepare_quote_draft is only for an explicitly non-saved outline.",
      "If the user is continuing a partially completed task, use the previous session summary and last tool results to continue the pending steps. Do not make them repeat the full original prompt.",
      "If the user replies with a short continuation like 'usa el primero', 'dale', 'hazlo', or 'continúa', use recentAssistantMessages plus the previous tool summary as the pending action context.",
      "If recentAssistantMessages contain candidate assets/projects/options and the user chooses one, reuse the exact IDs already shown there. Do not restart the task or ask for the same project again.",
      "Never ask the user for internal IDs for projects, quotes, assets, units, users or departments before trying the available search/detail tools. Users know names, codes and context; tools resolve IDs.",
      "For exchange-rate questions, route to the Finance Agent and use exchange-rate tools before answering. Include buy/sell meaning, source and fetchedAt when available.",
      "For packing slips, asset availability searches must use the full workspace inventory unless the user explicitly asks for assets already assigned to a specific project. Do not let activeProjectId limit inventory discovery by accident.",
      "If an asset search finds no available match, the specialist should run one broader workspace-level search_assets query and propose the closest available alternatives before asking the user what to use.",
      "Choose one target_agent from the allowed list below.",
      "Only set requires_approval=true when the action is truly irreversible (delete), externally visible (send message to a client), or above the workspace's risk threshold. Routine creation is NOT a reason for approval.",
      "When the user asks for an action and the specialist has enough data, route it and let the specialist execute. Do not stall by asking the user to confirm what they already asked for.",
      "Keep user_facing_summary practical and concise — describe what got done, not what could be done.",
      "Allowed agents:",
      loadAgentsPrompt(db, workspaceId),
      "When tool data is needed, call only the smallest relevant tool.",
      `Previous session summary: intent=${sessionSnapshot.lastIntent ?? "none"} | target=${sessionSnapshot.lastTargetAgent ?? "none"} | tool=${sessionSnapshot.lastToolResultSummary ?? "none"}`,
      supervisorMemoryOverlay.agentEntries.length
        ? `Agent memory:\n${supervisorMemoryOverlay.agentEntries.map((entry) => `- [${entry.kind}] ${entry.body}`).join("\n")}`
        : "Agent memory: none",
      supervisorMemoryOverlay.workspaceEntries.length
        ? `Workspace memory:\n${supervisorMemoryOverlay.workspaceEntries.map((entry) => `- [${entry.kind}] ${entry.body}`).join("\n")}`
        : "Workspace memory: none",
      supervisorMemoryOverlay.projectEntries.length
        ? `Project memory:\n${supervisorMemoryOverlay.projectEntries.map((entry) => `- [${entry.kind}] ${entry.body}`).join("\n")}`
        : "Project memory: none",
      financeContextHint ?? null,
    ].join("\n");

    const recentAssistantMessages = loadRecentAssistantMessages(db, request.threadId);
    const initialPrompt = buildGatewayInput(request, sessionSnapshot.recentUserMessages, recentAssistantMessages);
    const toolTraces: AIGatewayToolCallTrace[] = [];
    const executedToolPayloads: Array<{
      toolName: string;
      payload: unknown;
    }> = [];
    const deferredWriteToolCalls: Array<{
      toolName: string;
      arguments: Record<string, unknown>;
    }> = [];
    const executedWriteToolNames: string[] = [];

    let previousResponseId = sessionSnapshot.isExpired ? null : sessionSnapshot.previousResponseId;
    let supervisorRuntimeModelKey = supervisorModelKey;
    const initialProviderResponse = await createProviderResponse(
      supervisorProviderKey,
      {
        apiKey: supervisorApiKey,
        baseUrl: supervisorProvider.base_url,
        defaultModelKey: supervisorModelKey,
        fallbackModelKey: supervisorProvider.fallback_model_key,
        timeoutMs: supervisorProvider.timeout_ms,
      },
      {
        model: supervisorModelKey,
        instructions: supervisorInstructions,
        input: initialPrompt,
        previousResponseId,
        tools: options.toolRegistry.definitions,
        toolChoice: "auto",
        maxOutputTokens: 900,
        textFormat: orchestrationSchema,
      },
    );
    let result = initialProviderResponse.result;
    supervisorRuntimeModelKey = initialProviderResponse.modelKey;

    if (!result.ok) {
      const now = new Date().toISOString();
      db.prepare(
        `
          UPDATE ai_provider_configs
          SET status = ?,
              last_tested_at = ?,
              last_error_summary = ?,
              updated_at = ?
          WHERE workspace_id = ?
            AND provider_key = ?
        `,
      ).run(result.status, now, result.summary, now, workspaceId, supervisorProviderKey);

      options.sessionStore.writeResult(request.workspaceId, request.threadId, {
        previousResponseId: null,
        intent: null,
        targetAgent: null,
        toolResultSummary: null,
        status: result.status,
        error: result.summary,
      });

      return buildHumanErrorResponse(
        "provider_error",
        formatProviderFailureForUser(result.summary, "The provider could not answer right now. Check the connection in Models and try again."),
        supervisorProviderKey,
        supervisorModelKey,
      );
    }

    previousResponseId = result.responseId;
    let toolCallsUsed = 0;

    while (result.ok && result.functionCalls.length && toolCallsUsed < maxToolCalls) {
      const outputs = [];

      for (const call of result.functionCalls) {
        if (toolCallsUsed >= maxToolCalls) {
          break;
        }

        try {
          const toolRequiresApproval = options.toolRegistry.requiresApproval(call.name);
          const writeToolCanRunNow =
            !toolRequiresApproval ||
            request.context.requestedApprovalMode === "unsupervised" ||
            Boolean(executionOptions?.approvalBypassAgentId);

          if (!writeToolCanRunNow) {
            const parsedArguments = parseToolArgumentsPreview(call.arguments);
            const summary = `${summarizeToolName(call.name)} needs approval before it runs.`;
            deferredWriteToolCalls.push({
              toolName: call.name,
              arguments: parsedArguments,
            });
            toolTraces.push({
              toolName: call.name,
              status: "completed",
              summary,
            });
            outputs.push({
              type: "function_call_output",
              call_id: call.call_id,
              output: serializeToolPayload({
                requires_approval: true,
                executed: false,
                tool_name: call.name,
                requested_arguments: parsedArguments,
                user_message:
                  "This write action was not executed yet. Prepare a clear approval summary for the user.",
              }),
            });
            toolCallsUsed += 1;
            continue;
          }

          const execution = options.toolRegistry.execute(call.name, call.arguments, request.context);
          toolTraces.push(execution.trace);
          executedToolPayloads.push({
            toolName: call.name,
            payload: execution.result.payload,
          });
          if (toolRequiresApproval) {
            executedWriteToolNames.push(call.name);
          }
          outputs.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: serializeToolPayload(execution.result.payload),
          });
          toolCallsUsed += 1;
        } catch (error) {
          const summary = error instanceof Error ? error.message : `Tool ${call.name} failed.`;
          toolTraces.push({
            toolName: call.name,
            status: "failed",
            summary,
          });
          outputs.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: serializeToolPayload({
              ok: false,
              error: summary,
              tool_name: call.name,
              recovery_hint:
                "The tool failed. If the failure is caused by an existing record or ambiguous input, use read tools to recover and continue when safe. Otherwise explain the exact blocker.",
            }),
          });
          toolCallsUsed += 1;
        }
      }

      const nextProviderResponse = await createProviderResponse(
        supervisorProviderKey,
        {
          apiKey: supervisorApiKey,
          baseUrl: supervisorProvider.base_url,
          defaultModelKey: supervisorRuntimeModelKey,
          fallbackModelKey: supervisorProvider.fallback_model_key,
          timeoutMs: supervisorProvider.timeout_ms,
        },
        {
          model: supervisorRuntimeModelKey,
          previousResponseId,
          input: outputs,
          tools: options.toolRegistry.definitions,
          toolChoice: "auto",
          maxOutputTokens: 900,
          textFormat: orchestrationSchema,
        },
      );
      result = nextProviderResponse.result;
      supervisorRuntimeModelKey = nextProviderResponse.modelKey;

      if (!result.ok) {
        return buildHumanErrorResponse(
          "provider_error",
          formatProviderFailureForUser(result.summary, "The provider stopped responding while finishing the supervised answer."),
          supervisorProviderKey,
          supervisorModelKey,
        );
      }

      previousResponseId = result.responseId;
    }

    const orchestration = safeJsonParse<{
      intent: string;
      target_agent: string;
      confidence: number;
      requires_approval: boolean;
      tool_call_requested: boolean;
      user_facing_summary: string;
      answer_kind: "informational" | "draft_run" | "needs_approval" | "error";
      draft_run_title: string | null;
      draft_run_description: string | null;
    }>(result.outputText);

    if (!orchestration) {
      options.sessionStore.writeResult(request.workspaceId, request.threadId, {
        previousResponseId,
        intent: null,
        targetAgent: null,
        toolResultSummary: toolTraces[toolTraces.length - 1]?.summary ?? null,
        status: "structured_error",
        error: "The assistant could not complete a valid structured response.",
      });

      return {
        status: "structured_error",
        stateLabel: "Supervisor answer unavailable",
        stateBody: "The provider answered, but the orchestration result was not shaped correctly.",
        assistantMessage: "I could not finish that answer cleanly. No changes were made.",
        routedAgentId: null,
        routedAgentName: "Supervisor Agent",
        routedAgentRole: "Supervisor Agent",
        intentLabel: "Intent classified",
        commandStateLabel: "No changes applied",
        draftRunId: null,
        providerKey: supervisorProviderKey,
        modelKey: supervisorModelKey,
        toolTraces,
        orchestration: null,
      };
    }

    const target = loadAgentTarget(db, orchestration.target_agent, workspaceId);
    const targetRuntime = loadAgentRuntimeConfigByKey(db, orchestration.target_agent, workspaceId);

    markThreadRoutedAgentPending(db, request.threadId, target?.id ?? null);

    const sessionApproval = loadThreadSessionApproval(db, request.threadId);
    const requestedApprovalMode = request.context.requestedApprovalMode ?? "supervised";
    const sessionApprovalApplies =
      Boolean(sessionApproval?.session_approval_granted_at) &&
      Boolean(target?.id) &&
      sessionApproval?.session_approval_agent_id === target?.id;
    const approvalBypassApplies =
      Boolean(executionOptions?.approvalBypassAgentId) &&
      Boolean(target?.id) &&
      executionOptions?.approvalBypassAgentId === target?.id;
    const targetApprovalMode = targetRuntime?.approval_mode ?? target?.approval_mode ?? "supervised";
    const forceNeedsApproval = requestedApprovalMode === "needs_approval";
    const allowUnsupervised = requestedApprovalMode === "unsupervised" && targetApprovalMode !== "needs_approval";
    let requiresApproval =
      !sessionApprovalApplies &&
      !approvalBypassApplies &&
      !allowUnsupervised &&
      (deferredWriteToolCalls.length > 0 ||
      (forceNeedsApproval ||
        orchestration.requires_approval ||
        orchestration.answer_kind === "needs_approval" ||
        targetApprovalMode === "needs_approval"));
    let approvalReason = requiresApproval
      ? deriveApprovalReason({
          requestedApprovalMode,
          targetAgentName: target?.display_name ?? "Supervisor Agent",
          targetApprovalMode,
          orchestrationRequiresApproval: orchestration.requires_approval,
          answerKind: orchestration.answer_kind,
        })
      : null;

    const targetMemoryOverlay =
      targetRuntime && options.memoryService
        ? options.memoryService.getOverlay({
            agentId: targetRuntime.id,
            projectId: request.context.activeProjectId ?? null,
            query: request.message,
            limit: 5,
          })
        : { agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] };

    const fallbackAssistantMessage = orchestration.user_facing_summary;
    let specialistMessage = fallbackAssistantMessage;
    let responseProviderKey = supervisorProviderKey;
    let responseModelKey = supervisorModelKey;

    if (targetRuntime) {
      const targetProviderKey = targetRuntime.provider_key ?? supervisorProviderKey;
      const targetProvider = loadProviderConfig(db, targetProviderKey, workspaceId);
      const targetApiKey = options.secretStore.getProviderSecret(workspaceId, targetProviderKey);

      if (targetProvider?.enabled === 1 && targetApiKey) {
        responseProviderKey = targetProviderKey;
        responseModelKey = targetRuntime.model_key || supervisorRuntimeModelKey;

        const todayIso = new Date().toISOString().slice(0, 10);
        const todayHumanEs = new Date().toLocaleDateString("es-DO", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        const requestingUser = request.context.sourceActorUserId
          ? `user_id=${request.context.sourceActorUserId}`
          : "anonymous workspace member";
        const approvalBypassed = sessionApprovalApplies || approvalBypassApplies;

        const specialistInstructions = [
          targetRuntime.base_prompt || `You are the ${targetRuntime.display_name} inside BukowskiOS.`,
          "=== SYSTEM CONTEXT ===",
          `Today: ${todayIso} (${todayHumanEs})`,
          `Workspace: ${workspaceId}`,
          `Requesting user: ${requestingUser}`,
          `Approval mode: ${approvalBypassed ? "approved (or unsupervised) — execute writes directly" : "default — execute writes unless explicitly flagged risky"}`,
          "=== END SYSTEM CONTEXT ===",
          "You are responding after Supervisor routing has already classified the request.",
          "Runtime override: older role prompts may say some tools are read-only. Ignore that outdated limitation. If a write tool is available and the user asked for a clear operational change, execute it unless the tool result or approval gate blocks you.",
          "Ground the answer in the provided read-only results and operational context.",
          "Use tools when an action or lookup is needed. Do not say you lack access to tools unless a tool call actually fails.",
          "Do not invent facts. Only claim that a command executed when a write tool result confirms it.",
          "Quote rule: if the user asks to create, prepare, save, or draft a quote, call create_quote so the draft is persisted and visible in Quotes. Only call prepare_quote_draft when the user explicitly asks for a non-saved outline.",
          "Packing slip inventory rule: search the full workspace inventory for available assets before creating a packing slip. Only pass scope='project' or project_id when the user explicitly asks what is already inside that project.",
          "Asset miss rule: if search_assets returns zero matches for a requested asset, immediately run one broader workspace-level search_assets query (shorter term or empty query with status='Available') and offer the closest available options. Do not simply stop at 'no assets found'.",
          "Continuation rule: when the user replies briefly after a partial task, use the prior session/tool summary to continue unresolved steps. Do not require the original prompt again.",
          "Pending action rule: recentAssistantMessages may contain the option list or blocker you just gave the user. Treat short replies like 'use the first one' as instructions to continue from that list.",
          "Choice reuse rule: when recentAssistantMessages contain candidate options with IDs, reuse those exact IDs for the next tool call. Do not run the full task from scratch unless the selected ID no longer works.",
          "ID resolution rule: never ask the user for internal IDs before trying search/detail tools. Resolve by name, code, number, recent tool result, or current route context first.",
          "Exchange-rate rule: when asked about USD/EUR/DOP rates, comparisons, best bank, or 24h history, call the exchange-rate tools and include source/fetchedAt if available.",
          "Do NOT mention 'supervised' or 'pending approval' to the user unless the action is genuinely gated. The default is to execute and report results.",
          targetMemoryOverlay.agentEntries.length
            ? `Agent memory:\n${targetMemoryOverlay.agentEntries.map((entry) => `- [${entry.kind}] ${entry.body}`).join("\n")}`
            : "Agent memory: none",
          targetMemoryOverlay.workspaceEntries.length
            ? `Workspace memory:\n${targetMemoryOverlay.workspaceEntries.map((entry) => `- [${entry.kind}] ${entry.body}`).join("\n")}`
            : "Workspace memory: none",
          targetMemoryOverlay.projectEntries.length
            ? `Project memory:\n${targetMemoryOverlay.projectEntries.map((entry) => `- [${entry.kind}] ${entry.body}`).join("\n")}`
            : "Project memory: none",
        ].join("\n");

        const specialistInput = JSON.stringify({
          userRequest: request.message,
          intent: orchestration.intent,
          answerKind: orchestration.answer_kind,
          activeContext: parseAppContextSummary(request),
          approvalBypassed: sessionApprovalApplies || approvalBypassApplies,
          draftContext:
            orchestration.answer_kind === "draft_run"
              ? {
                  title: orchestration.draft_run_title,
                  description: orchestration.draft_run_description,
                }
              : null,
          supervisorSummary: orchestration.user_facing_summary,
          toolResults: executedToolPayloads,
        });
        const specialistMustUseTool =
          orchestration.tool_call_requested && executedToolPayloads.length === 0 && deferredWriteToolCalls.length === 0;

        const initialSpecialistProviderResponse = await createProviderResponse(
          targetProviderKey,
          {
            apiKey: targetApiKey,
            baseUrl: targetProvider.base_url,
            defaultModelKey: responseModelKey,
            fallbackModelKey: targetProvider.fallback_model_key,
            timeoutMs: targetProvider.timeout_ms,
          },
          {
            model: responseModelKey,
            instructions: specialistInstructions,
            input: specialistInput,
            tools: options.toolRegistry.definitions,
            toolChoice: specialistMustUseTool ? "required" : "auto",
            maxOutputTokens: 700,
          },
        );
        let specialistResult = initialSpecialistProviderResponse.result;
        responseModelKey = initialSpecialistProviderResponse.modelKey;

        let specialistPreviousResponseId = specialistResult.ok ? specialistResult.responseId : null;
        let specialistToolCallsUsed = 0;

        while (specialistResult.ok && specialistResult.functionCalls.length && specialistToolCallsUsed < maxToolCalls) {
          const outputs = [];

          for (const call of specialistResult.functionCalls) {
            if (specialistToolCallsUsed >= maxToolCalls) {
              break;
            }

            try {
              const toolRequiresApproval = options.toolRegistry.requiresApproval(call.name);
              const writeToolCanRunNow =
                !toolRequiresApproval ||
                request.context.requestedApprovalMode === "unsupervised" ||
                sessionApprovalApplies ||
                Boolean(executionOptions?.approvalBypassAgentId);

              if (!writeToolCanRunNow) {
                const parsedArguments = parseToolArgumentsPreview(call.arguments);
                const summary = `${summarizeToolName(call.name)} needs approval before it runs.`;
                deferredWriteToolCalls.push({
                  toolName: call.name,
                  arguments: parsedArguments,
                });
                toolTraces.push({
                  toolName: call.name,
                  status: "completed",
                  summary,
                });
                outputs.push({
                  type: "function_call_output",
                  call_id: call.call_id,
                  output: serializeToolPayload({
                    requires_approval: true,
                    executed: false,
                    tool_name: call.name,
                    requested_arguments: parsedArguments,
                    user_message:
                      "This write action was not executed yet. Prepare a clear approval summary for the user.",
                  }),
                });
                specialistToolCallsUsed += 1;
                continue;
              }

              const execution = options.toolRegistry.execute(call.name, call.arguments, request.context);
              toolTraces.push(execution.trace);
              executedToolPayloads.push({
                toolName: call.name,
                payload: execution.result.payload,
              });
              if (toolRequiresApproval) {
                executedWriteToolNames.push(call.name);
              }
              outputs.push({
                type: "function_call_output",
                call_id: call.call_id,
                output: serializeToolPayload(execution.result.payload),
              });
              specialistToolCallsUsed += 1;
            } catch (error) {
              const summary = error instanceof Error ? error.message : `Tool ${call.name} failed.`;
              toolTraces.push({
                toolName: call.name,
                status: "failed",
                summary,
              });
              outputs.push({
                type: "function_call_output",
                call_id: call.call_id,
                output: serializeToolPayload({
                  ok: false,
                  error: summary,
                  tool_name: call.name,
                  recovery_hint:
                    "The tool failed. If the failure is caused by an existing record or ambiguous input, use read tools to recover and continue when safe. Otherwise explain the exact blocker.",
                }),
              });
              specialistToolCallsUsed += 1;
            }
          }

          const nextSpecialistProviderResponse = await createProviderResponse(
            targetProviderKey,
            {
              apiKey: targetApiKey,
              baseUrl: targetProvider.base_url,
              defaultModelKey: responseModelKey,
              fallbackModelKey: targetProvider.fallback_model_key,
              timeoutMs: targetProvider.timeout_ms,
            },
            {
              model: responseModelKey,
              previousResponseId: specialistPreviousResponseId,
              input: outputs,
              tools: options.toolRegistry.definitions,
              toolChoice: "auto",
              maxOutputTokens: 700,
            },
          );
          specialistResult = nextSpecialistProviderResponse.result;
          responseModelKey = nextSpecialistProviderResponse.modelKey;

          if (!specialistResult.ok) {
            return buildHumanErrorResponse(
              "provider_error",
              formatProviderFailureForUser(specialistResult.summary, "The provider stopped responding while the specialist was finishing the action."),
              responseProviderKey,
              responseModelKey,
            );
          }

          specialistPreviousResponseId = specialistResult.responseId;
        }

        if (specialistResult.ok && specialistResult.outputText.trim()) {
          specialistMessage = specialistResult.outputText.trim();
        }
      }
    }

    if (!requiresApproval && !sessionApprovalApplies && !approvalBypassApplies && !allowUnsupervised && deferredWriteToolCalls.length > 0) {
      requiresApproval = true;
      approvalReason = deriveApprovalReason({
        requestedApprovalMode,
        targetAgentName: target?.display_name ?? "Supervisor Agent",
        targetApprovalMode,
        orchestrationRequiresApproval: true,
        answerKind: "needs_approval",
      });
    }

    const now = new Date().toISOString();
    const toolResultSummary = toolTraces.map((trace) => trace.summary).join(" · ") || null;
    const typedOrchestration: OrchestrationResult = {
      intent: orchestration.intent,
      targetAgentId: target?.id ?? null,
      targetAgentName: target?.display_name ?? "Supervisor Agent",
      confidence: orchestration.confidence,
      requiresApproval,
      toolCallRequested: orchestration.tool_call_requested,
      toolCalls: toolTraces,
      userFacingSummary: specialistMessage,
      answerKind: orchestration.answer_kind,
      draftRunTitle: orchestration.draft_run_title,
      draftRunDescription: orchestration.draft_run_description,
    };

    const approvalDecision = requiresApproval
      ? "pending"
      : sessionApprovalApplies || executionOptions?.approvalScope === "session"
        ? "approved_for_session"
        : executionOptions?.approvalBypassAgentId
          ? "approved"
          : null;
    const approvalScope = requiresApproval
      ? "run"
      : approvalDecision === "approved_for_session"
        ? "session"
        : approvalDecision === "approved"
          ? "run"
          : null;
    const actionLinks = buildActionLinks(executedToolPayloads);
    const notificationIntents = collectNotificationIntents(executedToolPayloads);
    const operationalReceipt = buildOperationalReceipt({
      toolTraces,
      actionLinks,
      deferredWriteToolCalls,
      executedWriteToolNames,
    });

    const detailsJson = JSON.stringify({
      provider_key: responseProviderKey,
      model_key: responseModelKey,
      intent: typedOrchestration.intent,
      target_agent: orchestration.target_agent,
      tool_calls: toolTraces.map((trace) => trace.toolName),
      deferred_write_tools: deferredWriteToolCalls,
      executed_write_tools: executedWriteToolNames,
      action_links: actionLinks,
      status: orchestration.answer_kind,
      approval_decision: approvalDecision,
      approval_reason: approvalReason,
      operational_receipt: operationalReceipt,
      existing_run_id: executionOptions?.existingRunId ?? null,
      source_connector_key: request.context.sourceConnectorKey ?? null,
      source_channel_id: request.context.sourceChannelId ?? null,
      source_external_message_id: request.context.sourceExternalMessageId ?? null,
      source_actor_user_id: request.context.sourceActorUserId ?? null,
      correlation_id: request.context.correlationId ?? null,
    });

    let draftRunId: string | null = null;
    if (executionOptions?.existingRunId) {
      draftRunId = executionOptions.existingRunId;
      db.prepare(
        `
          UPDATE agent_runs
          SET status = ?,
              output_summary = ?,
              approval_decision = ?,
              approval_scope = ?,
              approval_decided_at = ?,
              details_json = ?,
              updated_at = ?
          WHERE workspace_id = ?
            AND id = ?
        `,
      ).run(
        requiresApproval ? "needs_approval" : "done",
        typedOrchestration.draftRunDescription ?? specialistMessage,
        approvalDecision,
        approvalScope,
        approvalDecision ? now : null,
        detailsJson,
        now,
        workspaceId,
        executionOptions.existingRunId,
      );

      createActivityEvent(db, {
        workspaceId,
        id: createEventId("agent-activity"),
        agentId: target?.id ?? null,
        runId: draftRunId,
        kind: requiresApproval ? "ai_run_still_waiting_for_approval" : "ai_run_completed_after_approval",
        title: requiresApproval ? "Approval still required" : "Approved run completed",
        body: requiresApproval
          ? "The delegated follow-up still requires an explicit approval boundary."
          : executionOptions.existingRunTitle ?? "Approved supervised follow-up completed.",
        tone: requiresApproval ? "warning" : "success",
        source: "ai_gateway",
        detailsJson,
        createdAt: now,
      });
    } else if (
      deferredWriteToolCalls.length > 0 ||
      (typedOrchestration.answerKind === "draft_run" &&
        typedOrchestration.draftRunTitle &&
        typedOrchestration.draftRunDescription)
    ) {
      const fallbackRunTitle = deferredWriteToolCalls.length
        ? `Review ${summarizeToolName(deferredWriteToolCalls[0]!.toolName)}`
        : "Review assistant action";
      const fallbackRunDescription = deferredWriteToolCalls.length
        ? `The assistant prepared ${deferredWriteToolCalls.map((tool) => summarizeToolName(tool.toolName)).join(", ")}. Review and approve before it changes the workspace.`
        : typedOrchestration.userFacingSummary;
      const createdRun = createDraftRun(db, {
        workspaceId,
        threadId: request.threadId,
        routedAgentId: target?.id ?? null,
        title: typedOrchestration.draftRunTitle ?? fallbackRunTitle,
        inputSummary: request.message,
        outputSummary: typedOrchestration.draftRunDescription ?? fallbackRunDescription,
        approvalMode: targetApprovalMode,
        requiresApproval,
        approvalDecision,
        approvalScope,
        detailsJson,
        sourceConnectorKey: request.context.sourceConnectorKey ?? null,
        sourceChannelId: request.context.sourceChannelId ?? null,
        sourceExternalMessageId: request.context.sourceExternalMessageId ?? null,
        sourceActorUserId: request.context.sourceActorUserId ?? null,
        correlationId: request.context.correlationId ?? null,
      });
      draftRunId = createdRun.runId;

      createActivityEvent(db, {
        workspaceId,
        id: createEventId("agent-activity"),
        agentId: target?.id ?? null,
        runId: draftRunId,
        kind: "ai_draft_run_created",
        title: "AI draft run prepared",
        body: typedOrchestration.draftRunTitle ?? fallbackRunTitle,
        tone: requiresApproval ? "warning" : "info",
        source: "ai_gateway",
        detailsJson,
        createdAt: createdRun.now,
      });
    } else {
      createActivityEvent(db, {
        workspaceId,
        id: createEventId("agent-activity"),
        agentId: target?.id ?? null,
        runId: null,
        kind: "ai_request_routed",
        title: "AI request routed",
        body: specialistMessage,
        tone: requiresApproval ? "warning" : "success",
        source: "ai_gateway",
        detailsJson,
        createdAt: now,
      });
    }

    db.prepare(
      `
        UPDATE ai_provider_configs
        SET status = 'healthy',
            last_success_at = ?,
            last_error_summary = NULL,
            updated_at = ?
        WHERE workspace_id = ?
          AND provider_key = ?
      `,
    ).run(now, now, workspaceId, supervisorProviderKey);

    options.sessionStore.writeResult(request.workspaceId, request.threadId, {
      previousResponseId,
      intent: typedOrchestration.intent,
      targetAgent: orchestration.target_agent,
      toolResultSummary: summarizeOperationalReceiptForSession(operationalReceipt) ?? toolResultSummary,
      status: typedOrchestration.answerKind,
      error: null,
    });

    return {
      status: draftRunId ? "draft_created" : "answered",
      stateLabel: requiresApproval ? "Needs approval" : `Routed to ${typedOrchestration.targetAgentName}`,
      stateBody: draftRunId
        ? requiresApproval
          ? "Action ready for review. Approval is still required before any change is applied."
          : approvalDecision === "approved_for_session"
            ? executedWriteToolNames.length
              ? "Completed this session-approved action."
              : "Prepared this session-approved follow-up. No changes were made."
            : approvalDecision === "approved"
              ? executedWriteToolNames.length
                ? "Completed the approved action."
                : "Completed the approved follow-up. No changes were made."
              : "Action ready for review. No changes were made."
        : typedOrchestration.toolCalls.length
          ? executedWriteToolNames.length
            ? `${typedOrchestration.targetAgentName} completed the requested action.`
            : `${typedOrchestration.targetAgentName} answered after a lookup.`
          : `${typedOrchestration.targetAgentName} answered directly from supervised routing.`,
      assistantMessage: specialistMessage,
      routedAgentId: typedOrchestration.targetAgentId,
      routedAgentName: typedOrchestration.targetAgentName,
      routedAgentRole: target?.role_label ?? "Supervisor Agent",
      intentLabel: `Intent classified · ${typedOrchestration.intent}`,
      commandStateLabel: draftRunId
        ? requiresApproval
          ? "Action ready for review · no changes made"
          : approvalDecision === "approved_for_session"
            ? executedWriteToolNames.length
              ? "Session-approved action completed"
              : "Session-approved follow-up · no changes made"
            : executedWriteToolNames.length
              ? "Approved action completed"
              : "Approved follow-up · no changes made"
        : executedWriteToolNames.length
          ? "Action completed"
          : "Information only · no changes made",
      draftRunId,
      approvalDecision,
      approvalScope,
      approvalReason,
      providerKey: responseProviderKey,
      modelKey: responseModelKey,
      toolTraces,
      orchestration: {
        ...typedOrchestration,
        requiresApproval,
      },
      actionLinks,
      notificationIntents,
      operationalReceipt,
    };
  };

  return {
    async sendMessage(request: AssistantGatewayRequest): Promise<AssistantGatewayResponse> {
      return runGatewayTurn(request);
    },

    async continueApprovedRun(args: {
      workspaceId: string;
      threadId: string;
      runId: string;
      approvalScope: "run" | "session";
    }): Promise<AssistantGatewayResponse> {
      const run = db
        .prepare(
          `
            SELECT id, thread_id, agent_id, title, input_summary
            FROM agent_runs
            WHERE workspace_id = ?
              AND id = ?
            LIMIT 1
          `,
        )
        .get(args.workspaceId, args.runId) as
        | {
            id: string;
            thread_id: string | null;
            agent_id: string | null;
            title: string;
            input_summary: string;
          }
        | undefined;

      if (!run || !run.thread_id || !run.agent_id) {
        throw new Error("Approved run is not linked to a recoverable chat thread.");
      }

      const threadContext = loadThreadRouteContext(db, run.thread_id);
      const request: AssistantGatewayRequest = {
        commandId: `cmd-approved-${Date.now().toString(36)}`,
        workspaceId: args.workspaceId,
        threadId: run.thread_id,
        message: run.input_summary,
        attachments: [],
        context: {
          workspaceId: args.workspaceId,
          activePath: threadContext?.context_key ?? "/agents",
          currentView: threadContext?.context_label ?? "Agents",
          activeProjectId: inferProjectIdFromPath(threadContext?.context_key ?? null),
          activeFilters: {},
        },
      };

      try {
        return await runGatewayTurn(request, {
          approvalBypassAgentId: run.agent_id,
          approvalScope: args.approvalScope,
          existingRunId: run.id,
          existingRunTitle: run.title,
        });
      } catch (error) {
        const summary = error instanceof Error ? error.message : "Approved run could not continue.";
        const now = new Date().toISOString();
        db.prepare(
          `
            UPDATE agent_runs
            SET status = 'failed',
                output_summary = ?,
                updated_at = ?
            WHERE workspace_id = ?
              AND id = ?
          `,
        ).run(summary, now, args.workspaceId, run.id);

        createActivityEvent(db, {
          workspaceId: args.workspaceId,
          id: `agent-activity-${Date.now().toString(36)}`,
          agentId: run.agent_id,
          runId: run.id,
          kind: "ai_run_failed_after_approval",
          title: "Approved run failed",
          body: summary,
          tone: "critical",
          source: "ai_gateway",
          createdAt: now,
        });
        throw error;
      }
    },
  };
};

export type AssistantGatewayService = ReturnType<typeof createAssistantGatewayService>;
