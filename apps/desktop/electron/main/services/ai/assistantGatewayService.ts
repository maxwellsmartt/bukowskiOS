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

const workspaceId = "workspace-metadata";
const maxToolCalls = 2;

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
  stateLabel: status === "needs_configuration" ? "Provider not ready" : "Assistant unavailable",
  stateBody: body,
  assistantMessage: body,
  routedAgentId: null,
  routedAgentName: "Supervisor Agent",
  intentLabel: "Routing unavailable",
  commandStateLabel: "Command layer still idle",
  draftRunId: null,
  approvalDecision: null,
  approvalScope: null,
  providerKey,
  modelKey,
  toolTraces: [],
  orchestration: null,
});

export const createAssistantGatewayService = (
  db: DatabaseSync,
  options: {
    secretStore: AISecretStore;
    openaiProviderService: OpenAIProviderService;
    sessionStore: AssistantGatewaySessionStore;
    toolRegistry: AgentToolRegistry;
    memoryService?: AssistantMemoryService;
  },
) => ({
  async sendMessage(request: AssistantGatewayRequest): Promise<AssistantGatewayResponse> {
    const supervisor = loadSupervisorConfig(db);
    const providerKey = supervisor?.provider_key ?? "openai";
    const modelKey = supervisor?.model_key ?? "openai:gpt-5.4";

    if (!supervisor) {
      return buildHumanErrorResponse(
        "needs_configuration",
        "Supervisor Agent is not configured yet. Assign a provider and model in Models first.",
        providerKey,
        modelKey,
      );
    }

    const provider = loadProviderConfig(db, providerKey);

    if (!provider || provider.enabled !== 1) {
      return buildHumanErrorResponse(
        "needs_configuration",
        "OpenAI is not enabled yet. Configure the provider in Models before using chat.",
        providerKey,
        modelKey,
      );
    }

    const apiKey = options.secretStore.getProviderSecret(workspaceId, providerKey);

    if (!apiKey) {
      return buildHumanErrorResponse(
        "needs_configuration",
        "This provider does not have a stored API key on this Mac yet.",
        providerKey,
        modelKey,
      );
    }

    const sessionSnapshot = options.sessionStore.read(request.workspaceId, request.threadId);
    options.sessionStore.touchMessage(request.workspaceId, request.threadId, summarizeMessageForSession(request));
    const memoryOverlay = options.memoryService?.getOverlay({
      agentId: supervisor.id,
      projectId: request.context.activeProjectId ?? null,
      query: request.message,
      limit: 5,
    }) ?? { agentEntries: [], workspaceEntries: [], projectEntries: [], all: [] };

    const instructions = [
      supervisor.base_prompt || "You are the BukowskiOS Supervisor Agent.",
      "Never imply that the command layer executed. Only read-only tools and supervised draft runs are allowed.",
      "Choose one target_agent from the allowed list below.",
      "If a write-like action is implied, set requires_approval=true and answer_kind='draft_run' or 'needs_approval'.",
      "Keep user_facing_summary practical and concise.",
      "Allowed agents:",
      loadAgentsPrompt(db),
      "When tool data is needed, call only the smallest relevant tool.",
      `Previous session summary: intent=${sessionSnapshot.lastIntent ?? "none"} | target=${sessionSnapshot.lastTargetAgent ?? "none"} | tool=${sessionSnapshot.lastToolResultSummary ?? "none"}`,
      memoryOverlay.agentEntries.length
        ? `Agent memory:\n${memoryOverlay.agentEntries.map((entry) => `- [${entry.kind}] ${entry.body}`).join("\n")}`
        : "Agent memory: none",
      memoryOverlay.workspaceEntries.length
        ? `Workspace memory:\n${memoryOverlay.workspaceEntries.map((entry) => `- [${entry.kind}] ${entry.body}`).join("\n")}`
        : "Workspace memory: none",
      memoryOverlay.projectEntries.length
        ? `Project memory:\n${memoryOverlay.projectEntries.map((entry) => `- [${entry.kind}] ${entry.body}`).join("\n")}`
        : "Project memory: none",
    ].join("\n");

    const initialPrompt = buildGatewayInput(request, sessionSnapshot.recentUserMessages);

    const toolTraces: AIGatewayToolCallTrace[] = [];
    let previousResponseId = sessionSnapshot.isExpired ? null : sessionSnapshot.previousResponseId;
    let result = await options.openaiProviderService.createResponse(
      {
        apiKey,
        baseUrl: provider.base_url,
        defaultModelKey: modelKey,
        timeoutMs: provider.timeout_ms,
      },
      {
        model: modelKey,
        instructions,
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
      ).run(result.status, now, result.summary, now, workspaceId, providerKey);

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
        providerKey,
        modelKey,
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
          outputs.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(execution.result.payload),
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
            assistantMessage: "I could not finish that read-only lookup cleanly. No change was applied, and the command layer is still idle.",
            routedAgentId: null,
            routedAgentName: "Supervisor Agent",
            intentLabel: "Intent classified",
            commandStateLabel: "Command layer still idle",
            draftRunId: null,
            providerKey,
            modelKey,
            toolTraces,
            orchestration: null,
          };
        }
      }

      result = await options.openaiProviderService.createResponse(
        {
          apiKey,
          baseUrl: provider.base_url,
          defaultModelKey: modelKey,
          timeoutMs: provider.timeout_ms,
        },
        {
          model: modelKey,
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
          providerKey,
          modelKey,
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
        error: "Structured response could not be parsed.",
      });

      return {
        status: "structured_error",
        stateLabel: "Supervisor answer unavailable",
        stateBody: "The provider answered, but the orchestration result was not shaped correctly.",
        assistantMessage: "I could not finish that answer cleanly. No action was applied, and the command layer is still idle.",
        routedAgentId: null,
        routedAgentName: "Supervisor Agent",
        intentLabel: "Intent classified",
        commandStateLabel: "Command layer still idle",
        draftRunId: null,
        providerKey,
        modelKey,
        toolTraces,
        orchestration: null,
      };
    }

    const target = loadAgentTarget(db, orchestration.target_agent);
    const sessionApproval = loadThreadSessionApproval(db, request.threadId);
    const sessionApprovalApplies =
      Boolean(sessionApproval?.session_approval_granted_at) &&
      Boolean(target?.id) &&
      sessionApproval?.session_approval_agent_id === target?.id;
    const requiresApproval =
      !sessionApprovalApplies &&
      (orchestration.requires_approval || orchestration.answer_kind === "draft_run" || orchestration.answer_kind === "needs_approval");
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
      userFacingSummary: orchestration.user_facing_summary,
      answerKind: orchestration.answer_kind,
      draftRunTitle: orchestration.draft_run_title,
      draftRunDescription: orchestration.draft_run_description,
    };

    const detailsJson = JSON.stringify({
      provider_key: providerKey,
      model_key: modelKey,
      intent: typedOrchestration.intent,
      target_agent: orchestration.target_agent,
      tool_calls: toolTraces.map((trace) => trace.toolName),
      status: orchestration.answer_kind,
      approval_decision: requiresApproval ? "pending" : sessionApprovalApplies ? "approved_for_session" : null,
      });

    let draftRunId: string | null = null;
    if (typedOrchestration.answerKind === "draft_run" && typedOrchestration.draftRunTitle && typedOrchestration.draftRunDescription) {
      const createdRun = createDraftRun(db, {
        threadId: request.threadId,
        routedAgentId: target?.id ?? null,
        title: typedOrchestration.draftRunTitle,
        inputSummary: request.message,
        outputSummary: typedOrchestration.draftRunDescription,
        approvalMode: target?.approval_mode ?? "supervised",
        requiresApproval,
        approvalDecision: requiresApproval ? "pending" : sessionApprovalApplies ? "approved_for_session" : null,
        approvalScope: requiresApproval ? "run" : sessionApprovalApplies ? "session" : null,
        detailsJson,
      });
      draftRunId = createdRun.runId;

      createActivityEvent(db, {
        id: `agent-activity-${Date.now().toString(36)}`,
        agentId: target?.id ?? null,
        runId: draftRunId,
        kind: "ai_draft_run_created",
        title: "AI draft run prepared",
        body: typedOrchestration.draftRunTitle,
        tone: "info",
        source: "ai_gateway",
        detailsJson,
        createdAt: createdRun.now,
      });
    } else {
      createActivityEvent(db, {
        id: `agent-activity-${Date.now().toString(36)}`,
        agentId: target?.id ?? null,
        runId: null,
        kind: "ai_request_routed",
        title: "AI request routed",
        body: typedOrchestration.userFacingSummary,
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
    ).run(now, now, workspaceId, providerKey);

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
          ? "Prepared a supervised draft. This still needs approval before any change is applied."
          : sessionApprovalApplies
            ? "Prepared a supervised draft under your session approval. No command-layer action was executed."
            : "Prepared a supervised draft. No command-layer action was executed."
        : typedOrchestration.toolCalls.length
          ? `${typedOrchestration.targetAgentName} answered after a read-only lookup.`
          : `${typedOrchestration.targetAgentName} answered directly from supervised routing.`,
      assistantMessage: typedOrchestration.userFacingSummary,
      routedAgentId: typedOrchestration.targetAgentId,
      routedAgentName: typedOrchestration.targetAgentName,
      intentLabel: `Intent classified · ${typedOrchestration.intent}`,
      commandStateLabel: draftRunId
        ? requiresApproval
          ? "Prepared supervised draft · command layer still not executed"
          : sessionApprovalApplies
            ? "Session-approved draft · command layer still not executed"
            : "Approved draft · command layer still not executed"
        : "Read-only answer · command layer still not executed",
      draftRunId,
      approvalDecision: requiresApproval ? "pending" : sessionApprovalApplies ? "approved_for_session" : null,
      approvalScope: requiresApproval ? "run" : sessionApprovalApplies ? "session" : null,
      providerKey,
      modelKey,
      toolTraces,
      orchestration: {
        ...typedOrchestration,
        requiresApproval,
      },
    };
  },
});

export type AssistantGatewayService = ReturnType<typeof createAssistantGatewayService>;
