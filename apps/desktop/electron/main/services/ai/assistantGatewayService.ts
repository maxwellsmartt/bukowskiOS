import type {
  AIGatewayToolCallTrace,
  AssistantGatewayAttachment,
  AssistantGatewayRequest,
  AssistantGatewayResponse,
  OrchestrationResult,
} from "@contracts";
import type { DatabaseSync } from "node:sqlite";

import type { AISecretStore } from "./aiSecretStore";
import type { AssistantMemoryService } from "./assistantMemoryService";
import type { AgentToolRegistry } from "./agentToolRegistry";
import type { OpenAIProviderService } from "./openaiProviderService";
import type { AssistantGatewaySessionStore } from "./assistantGatewaySessionStore";

import { DEFAULT_WORKSPACE_ID } from "@contracts";
import { getDesktopLogger } from "../logger";

const workspaceId = DEFAULT_WORKSPACE_ID;
const maxToolCalls = 5;
const maxToolPayloadChars = 4000;
const logger = getDesktopLogger("assistant-gateway");

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
): string | Array<Record<string, unknown>> => {
  const attachments = request.attachments ?? [];
  const trimmedMessage = request.message.trim();
  const payload = JSON.stringify({
    userMessage:
      trimmedMessage || (attachments.length ? "Please review the attached image context for BukowskiOS." : ""),
    appContext: parseAppContextSummary(request),
    recentUserMessages,
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

const loadSupervisorConfig = (db: DatabaseSync) =>
  db
    .prepare(
      `
        SELECT id, agent_key, provider_key, model_key, COALESCE(base_prompt, '') AS base_prompt
        FROM agents
        WHERE workspace_id = ?
          AND is_supervisor = 1
        LIMIT 1
      `,
    )
    .get(workspaceId) as
    | {
        id: string;
        agent_key: string;
        provider_key: string;
        model_key: string;
        base_prompt: string;
      }
    | undefined;

const loadProviderConfig = (db: DatabaseSync, providerKey: string) =>
  db
    .prepare(
      `
        SELECT display_name, enabled, default_model_key, base_url, timeout_ms, retry_count, status
        FROM ai_provider_configs
        WHERE workspace_id = ?
          AND provider_key = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, providerKey) as
    | {
        display_name: string;
        enabled: number;
        default_model_key: string;
        base_url: string;
        timeout_ms: number;
        retry_count: number;
        status: string;
      }
    | undefined;

const loadAgentsPrompt = (db: DatabaseSync) => {
  const rows = db
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

  return rows
    .map(
      (row) =>
        `- ${row.agent_key}: ${row.display_name} | domain=${row.domain_key} | approval=${row.approval_mode} | mission=${row.mission}`,
    )
    .join("\n");
};

const loadAgentTarget = (db: DatabaseSync, agentKey: string) =>
  db
    .prepare(
      `
        SELECT id, display_name, approval_mode
        FROM agents
        WHERE workspace_id = ?
          AND agent_key = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, agentKey) as
    | {
        id: string;
        display_name: string;
        approval_mode: string;
      }
    | undefined;

const loadAgentRuntimeConfigByKey = (db: DatabaseSync, agentKey: string) =>
  db
    .prepare(
      `
        SELECT id, agent_key, display_name, approval_mode, provider_key, model_key, COALESCE(base_prompt, '') AS base_prompt
        FROM agents
        WHERE workspace_id = ?
          AND agent_key = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, agentKey) as
    | {
        id: string;
        agent_key: string;
        display_name: string;
        approval_mode: string;
        provider_key: string | null;
        model_key: string;
        base_prompt: string;
      }
    | undefined;

const loadAgentRuntimeConfigById = (db: DatabaseSync, agentId: string) =>
  db
    .prepare(
      `
        SELECT id, agent_key, display_name, approval_mode, provider_key, model_key, COALESCE(base_prompt, '') AS base_prompt
        FROM agents
        WHERE workspace_id = ?
          AND id = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, agentId) as
    | {
        id: string;
        agent_key: string;
        display_name: string;
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
    workspaceId,
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
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, NULL, 'chat', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_gateway', ?, ?, ?)
    `,
  ).run(
    runId,
    workspaceId,
    args.routedAgentId,
    args.title,
    args.inputSummary,
    args.outputSummary,
    args.requiresApproval ? "needs_approval" : args.approvalDecision ? "approved" : "queued",
    args.approvalMode,
    args.requiresApproval ? 1 : 0,
    args.threadId,
    args.approvalDecision,
    args.approvalScope,
    args.approvalDecision ? now : null,
    args.detailsJson,
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

export const createAssistantGatewayService = (
  db: DatabaseSync,
  options: {
    secretStore: AISecretStore;
    openaiProviderService: OpenAIProviderService;
    sessionStore: AssistantGatewaySessionStore;
    toolRegistry: AgentToolRegistry;
    memoryService?: AssistantMemoryService;
  },
) => {
  const runGatewayTurn = async (
    request: AssistantGatewayRequest,
    executionOptions?: {
      approvalBypassAgentId?: string | null;
      approvalScope?: "run" | "session" | null;
      existingRunId?: string | null;
      existingRunTitle?: string | null;
    },
  ): Promise<AssistantGatewayResponse> => {
    const supervisor = loadSupervisorConfig(db);
    const supervisorProviderKey = supervisor?.provider_key ?? "openai";
    const supervisorModelKey = supervisor?.model_key ?? "openai:gpt-5.4";

    if (!supervisor) {
      return buildHumanErrorResponse(
        "needs_configuration",
        "Supervisor Agent is not configured yet. Assign a provider and model in Models first.",
        supervisorProviderKey,
        supervisorModelKey,
      );
    }

    const supervisorProvider = loadProviderConfig(db, supervisorProviderKey);

    if (!supervisorProvider || supervisorProvider.enabled !== 1) {
      return buildHumanErrorResponse(
        "needs_configuration",
        "Connect an AI provider in Models before using chat.",
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

    const supervisorInstructions = [
      supervisor.base_prompt || "You are the BukowskiOS Supervisor Agent.",
      "Never imply that the command layer executed. Only read-only tools and supervised draft runs are allowed.",
      "Choose one target_agent from the allowed list below.",
      "Only set requires_approval=true when the requested action truly needs an explicit approval boundary or when the target agent is configured as needs_approval.",
      "Keep user_facing_summary practical and concise.",
      "Allowed agents:",
      loadAgentsPrompt(db),
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
    ].join("\n");

    const initialPrompt = buildGatewayInput(request, sessionSnapshot.recentUserMessages);
    const toolTraces: AIGatewayToolCallTrace[] = [];
    const executedToolPayloads: Array<{
      toolName: string;
      payload: unknown;
    }> = [];

    let previousResponseId = sessionSnapshot.isExpired ? null : sessionSnapshot.previousResponseId;
    let result = await options.openaiProviderService.createResponse(
      {
        apiKey: supervisorApiKey,
        baseUrl: supervisorProvider.base_url,
        defaultModelKey: supervisorModelKey,
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
        "The provider could not answer right now. Check the connection in Models and try again.",
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
          const execution = options.toolRegistry.execute(call.name, call.arguments, request.context);
          toolTraces.push(execution.trace);
          executedToolPayloads.push({
            toolName: call.name,
            payload: execution.result.payload,
          });
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

          options.sessionStore.writeResult(request.workspaceId, request.threadId, {
            previousResponseId,
            intent: null,
            targetAgent: null,
            toolResultSummary: summary,
            status: "tool_error",
            error: summary,
          });

          return {
            status: "tool_error",
            stateLabel: "Read-only query failed",
            stateBody: "A supervised lookup failed before any action could be prepared.",
            assistantMessage: "I could not finish that read-only lookup cleanly. No changes were made.",
            routedAgentId: null,
            routedAgentName: "Supervisor Agent",
            intentLabel: "Intent classified",
            commandStateLabel: "No changes applied",
            draftRunId: null,
            providerKey: supervisorProviderKey,
            modelKey: supervisorModelKey,
            toolTraces,
            orchestration: null,
          };
        }
      }

      result = await options.openaiProviderService.createResponse(
        {
          apiKey: supervisorApiKey,
          baseUrl: supervisorProvider.base_url,
          defaultModelKey: supervisorModelKey,
          timeoutMs: supervisorProvider.timeout_ms,
        },
        {
          model: supervisorModelKey,
          previousResponseId,
          input: outputs,
          tools: options.toolRegistry.definitions,
          toolChoice: "auto",
          maxOutputTokens: 900,
          textFormat: orchestrationSchema,
        },
      );

      if (!result.ok) {
        return buildHumanErrorResponse(
          "provider_error",
          "The provider stopped responding while finishing the supervised answer.",
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
        intentLabel: "Intent classified",
        commandStateLabel: "No changes applied",
        draftRunId: null,
        providerKey: supervisorProviderKey,
        modelKey: supervisorModelKey,
        toolTraces,
        orchestration: null,
      };
    }

    const target = loadAgentTarget(db, orchestration.target_agent);
    const targetRuntime = loadAgentRuntimeConfigByKey(db, orchestration.target_agent);
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
    const requiresApproval =
      !sessionApprovalApplies &&
      !approvalBypassApplies &&
      !allowUnsupervised &&
      (forceNeedsApproval ||
        orchestration.requires_approval ||
        orchestration.answer_kind === "needs_approval" ||
        targetApprovalMode === "needs_approval");
    const approvalReason = requiresApproval
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
      const targetProvider = loadProviderConfig(db, targetProviderKey);
      const targetApiKey = options.secretStore.getProviderSecret(workspaceId, targetProviderKey);

      if (targetProvider?.enabled === 1 && targetApiKey) {
        responseProviderKey = targetProviderKey;
        responseModelKey = targetRuntime.model_key || supervisorModelKey;

        const specialistInstructions = [
          targetRuntime.base_prompt || `You are the ${targetRuntime.display_name} inside BukowskiOS.`,
          "You are responding after Supervisor routing has already classified the request.",
          "Ground the answer in the provided read-only results and operational context.",
          "Do not invent facts and do not claim that the command layer executed.",
          "If this is still supervised work, explain the current supervised state clearly and naturally.",
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

        const specialistResult = await options.openaiProviderService.createResponse(
          {
            apiKey: targetApiKey,
            baseUrl: targetProvider.base_url,
            defaultModelKey: responseModelKey,
            timeoutMs: targetProvider.timeout_ms,
          },
          {
            model: responseModelKey,
            instructions: specialistInstructions,
            input: specialistInput,
            toolChoice: "none",
            maxOutputTokens: 700,
          },
        );

        if (specialistResult.ok && specialistResult.outputText.trim()) {
          specialistMessage = specialistResult.outputText.trim();
        }
      }
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

    const detailsJson = JSON.stringify({
      provider_key: responseProviderKey,
      model_key: responseModelKey,
      intent: typedOrchestration.intent,
      target_agent: orchestration.target_agent,
      tool_calls: toolTraces.map((trace) => trace.toolName),
      status: orchestration.answer_kind,
      approval_decision: approvalDecision,
      approval_reason: approvalReason,
      existing_run_id: executionOptions?.existingRunId ?? null,
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
      typedOrchestration.answerKind === "draft_run" &&
      typedOrchestration.draftRunTitle &&
      typedOrchestration.draftRunDescription
    ) {
      const createdRun = createDraftRun(db, {
        threadId: request.threadId,
        routedAgentId: target?.id ?? null,
        title: typedOrchestration.draftRunTitle,
        inputSummary: request.message,
        outputSummary: typedOrchestration.draftRunDescription,
        approvalMode: targetApprovalMode,
        requiresApproval,
        approvalDecision,
        approvalScope,
        detailsJson,
      });
      draftRunId = createdRun.runId;

      createActivityEvent(db, {
        id: createEventId("agent-activity"),
        agentId: target?.id ?? null,
        runId: draftRunId,
        kind: "ai_draft_run_created",
        title: "AI draft run prepared",
        body: typedOrchestration.draftRunTitle,
        tone: requiresApproval ? "warning" : "info",
        source: "ai_gateway",
        detailsJson,
        createdAt: createdRun.now,
      });
    } else {
      createActivityEvent(db, {
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
      toolResultSummary,
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
            ? "Prepared or completed this supervised follow-up under your session approval. No changes were made."
            : approvalDecision === "approved"
              ? "Completed the approved supervised follow-up. No changes were made."
              : "Action ready for review. No changes were made."
        : typedOrchestration.toolCalls.length
          ? `${typedOrchestration.targetAgentName} answered after a read-only lookup.`
          : `${typedOrchestration.targetAgentName} answered directly from supervised routing.`,
      assistantMessage: specialistMessage,
      routedAgentId: typedOrchestration.targetAgentId,
      routedAgentName: typedOrchestration.targetAgentName,
      intentLabel: `Intent classified · ${typedOrchestration.intent}`,
      commandStateLabel: draftRunId
        ? requiresApproval
          ? "Action ready for review · no changes made"
          : approvalDecision === "approved_for_session"
            ? "Session-approved follow-up · no changes made"
            : "Approved follow-up · no changes made"
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
        .get(workspaceId, args.runId) as
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
        ).run(summary, now, workspaceId, run.id);

        createActivityEvent(db, {
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
