import type { DatabaseSync } from "node:sqlite";

import type {
  AIProviderMutationResult,
  AssistantGatewayRequest,
  AssistantGatewayResponse,
  AssistantChatSnapshot,
  AssistantChatMessageMeta,
  AgentApprovalMode,
  AgentRunReviewResult,
  AgentMutationResult,
  ConnectorMutationResult,
  AgentStatus,
  AssignAgentModelCommand,
  CreateConnectorLinkTokenCommand,
  CreateAssistantThreadCommand,
  CreateAgentCommand,
  CreateDraftRunFromChatCommand,
  DeleteAssistantThreadCommand,
  DraftRunFromChatResult,
  ReviewAgentRunCommand,
  SaveConnectorConfigCommand,
  SaveAIProviderConfigCommand,
  SendAssistantChatTurnCommand,
  SetActiveAssistantThreadCommand,
  RenameAssistantThreadCommand,
  RefreshAIProviderModelsCommand,
  UpdateAssistantThreadPreferencesCommand,
  SetAgentApprovalModeCommand,
  SetAgentStatusCommand,
  TestConnectorConnectionCommand,
  TestAIProviderConnectionCommand,
  UpdateAgentCommand,
} from "@contracts";

import type { AssistantChatService } from "./assistantChatService";
import type { AssistantGatewayService } from "../ai/assistantGatewayService";
import type { OpenAIProviderService } from "../ai/openaiProviderService";
import type { ConnectorBridgeService } from "../connectors/connectorBridgeService";
import type { TelegramConnectorService } from "../connectors/telegramConnectorService";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;
type AIModelListingService = {
  listModels?: OpenAIProviderService["listModels"];
  testConnection: OpenAIProviderService["testConnection"];
  createResponse: OpenAIProviderService["createResponse"];
};

const ensureValue = (value: string | undefined, label: string) => {
  const nextValue = value?.trim() ?? "";

  if (!nextValue) {
    throw new Error(`${label} is required.`);
  }

  return nextValue;
};

const optionalValue = (value: string | undefined) => {
  const nextValue = value?.trim() ?? "";
  return nextValue || null;
};

const normalizeProviderBaseUrl = (providerKey: string, value: string | undefined) => {
  const nextValue = optionalValue(value) ?? "";

  const trimmed = nextValue.replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  return providerKey === "openai" || providerKey === "anthropic"
    ? trimmed.endsWith("/v1")
      ? trimmed.slice(0, -3)
      : trimmed
    : trimmed;
};

const resolveProviderKey = (modelKey: string) => {
  const nextValue = modelKey.trim();
  if (!nextValue) {
    return "openai";
  }

  const separatorIndex = nextValue.indexOf(":");
  return separatorIndex > 0 ? nextValue.slice(0, separatorIndex) : "openai";
};

const formatModelLabel = (modelKey: string) => {
  const labels: Record<string, string> = {
    "openai:gpt-5.2": "GPT-5.2",
    "openai:gpt-5-mini": "GPT-5 Mini",
    "openai:gpt-5.4": "GPT-5.4",
    "openai:gpt-5.4-mini": "GPT-5.4 Mini",
    "anthropic:claude-sonnet-4-20250514": "Claude Sonnet 4",
    "anthropic:claude-opus-4-1-20250805": "Claude Opus 4.1",
    "anthropic:sonnet-4": "Claude Sonnet 4",
    "openclaw:command": "OpenClaw Command",
  };

  if (labels[modelKey]) {
    return labels[modelKey];
  }

  const nextValue = modelKey.includes(":") ? modelKey.split(":")[1] : modelKey;
  return nextValue.replace(/[-_]/g, " ").trim();
};

const normalizeTokenList = (values: string[]) =>
  Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

const persistProviderModelOptions = (
  db: DatabaseSync,
  providerKey: string,
  models: Array<{ key: string; label: string; raw?: Record<string, unknown> }>,
) => {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `
      INSERT INTO ai_provider_model_cache (
        id,
        workspace_id,
        provider_key,
        model_key,
        display_name,
        source,
        raw_json,
        fetched_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'api', ?, ?, ?, ?)
      ON CONFLICT(workspace_id, provider_key, model_key) DO UPDATE SET
        display_name = excluded.display_name,
        source = excluded.source,
        raw_json = excluded.raw_json,
        fetched_at = excluded.fetched_at,
        updated_at = excluded.updated_at
    `,
  );

  db.exec("BEGIN");
  try {
    db.prepare(
      `
        DELETE FROM ai_provider_model_cache
        WHERE workspace_id = ?
          AND provider_key = ?
          AND source = 'api'
      `,
    ).run(workspaceId, providerKey);

    models.forEach((model) => {
      insert.run(
        `provider-model-${workspaceId}-${providerKey}-${model.key.replace(/[^a-zA-Z0-9_-]/gu, "-")}`,
        workspaceId,
        providerKey,
        model.key,
        model.label || model.key,
        JSON.stringify(model.raw ?? {}),
        now,
        now,
        now,
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

const loadAgent = (db: DatabaseSync, id: string) =>
  db
    .prepare(
      `
        SELECT id, display_name, approval_mode, status
        FROM agents
        WHERE workspace_id = ?
          AND id = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, id) as
    | {
        id: string;
        display_name: string;
        approval_mode: AgentApprovalMode;
        status: AgentStatus;
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
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    event.createdAt,
  );
};

const createActivityEventId = () => `agent-activity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const buildApprovalMeta = (
  decision: ReviewAgentRunCommand["decision"],
  routedAgentId: string | null,
  routedAgentName: string,
  routedAgentRole: string | null,
): AssistantChatMessageMeta => {
  if (decision === "deny") {
    return {
      tone: "error",
      label: "Denied",
      body: "This draft was denied. No command-layer action will proceed from it.",
      routedAgentId,
      routedAgentName,
      routedAgentRole,
      intentLabel: "Approval decision recorded",
      commandStateLabel: "Denied · no changes applied",
      approvalDecision: "denied",
      approvalScope: "run",
    };
  }

  if (decision === "approve_for_session") {
    return {
      tone: "routed",
      label: "Approved for this session",
      body: "This thread is approved for this specialist during the current session. No command-layer action was executed.",
      routedAgentId,
      routedAgentName,
      routedAgentRole,
      intentLabel: "Approval decision recorded",
      commandStateLabel: "Session-approved · no changes made",
      approvalDecision: "approved_for_session",
      approvalScope: "session",
    };
  }

  return {
    tone: "routed",
    label: "Approved",
    body: "This draft is approved for supervised follow-up. No command-layer action was executed.",
    routedAgentId,
    routedAgentName,
    routedAgentRole,
    intentLabel: "Approval decision recorded",
    commandStateLabel: "Approved · no changes made",
    approvalDecision: "approved",
    approvalScope: "run",
  };
};

const applyApprovalMetaToThread = (
  db: DatabaseSync,
  threadId: string,
  runId: string,
  meta: AssistantChatMessageMeta,
) => {
  const rows = db
    .prepare(
      `
        SELECT id, state_payload_json
        FROM assistant_chat_messages
        WHERE thread_id = ?
          AND deleted_at IS NULL
          AND role = 'assistant'
          AND state_payload_json IS NOT NULL
        ORDER BY created_at DESC
      `,
    )
    .all(threadId) as Array<{ id: string; state_payload_json: string | null }>;

  for (const row of rows) {
    if (!row.state_payload_json) {
      continue;
    }

    try {
      const parsed = JSON.parse(row.state_payload_json) as AssistantChatMessageMeta & { draftRunId?: string | null };

      if (parsed.draftRunId !== runId) {
        continue;
      }

      db.prepare(
        `
          UPDATE assistant_chat_messages
          SET state_payload_json = ?,
              updated_at = ?
          WHERE id = ?
        `,
      ).run(
        JSON.stringify({
          ...parsed,
          tone: meta.tone,
          label: meta.label,
          body: meta.body,
          commandStateLabel: meta.commandStateLabel,
          approvalDecision: meta.approvalDecision ?? null,
          approvalScope: meta.approvalScope ?? null,
        }),
        new Date().toISOString(),
        row.id,
      );
      break;
    } catch {
      continue;
    }
  }
};

const inferRoute = (message: string) => {
  const normalized = message.toLowerCase();

  if (/(incident|maintenance|repair|rma|damage|loss|broken)/.test(normalized)) {
    return "incidents-maintenance-agent";
  }

  if (/(asset|inventory|packing|warehouse|catalog)/.test(normalized)) {
    return "assets-agent";
  }

  if (/(finance|budget|cost|expense|entry|reserve|exposure)/.test(normalized)) {
    return "finance-agent";
  }

  if (/(project|timeline|schedule|unit|conflict)/.test(normalized)) {
    return "projects-scheduling-agent";
  }

  if (/(email|whatsapp|telegram|notify|message|support)/.test(normalized)) {
    return "communications-agent";
  }

  return "supervisor-agent";
};

const actionVerbRequiresApproval = (message: string) =>
  /(create|update|change|apply|archive|delete|send|assign|move|close|approve|sync)/i.test(message);

export const createAgentMutationService = (
  db: DatabaseSync,
  options: {
    secretStore: {
      hasProviderSecret: (workspaceId: string, providerKey: string) => boolean;
      getProviderSecret: (workspaceId: string, providerKey: string) => string | null;
      setProviderSecret: (workspaceId: string, providerKey: string, secret: string) => void;
      clearProviderSecret: (workspaceId: string, providerKey: string) => void;
    };
    openaiProviderService: AIModelListingService;
    anthropicProviderService?: AIModelListingService;
    assistantGatewayService: AssistantGatewayService;
    assistantChatService?: AssistantChatService;
    connectorBridgeService?: ConnectorBridgeService;
    telegramConnectorService?: TelegramConnectorService;
  },
) => ({
  createAgent(input: CreateAgentCommand): AgentMutationResult {
    const now = new Date().toISOString();
    const agentId = ensureValue(input.agentId, "Agent ID").toLowerCase();
    const displayName = ensureValue(input.displayName, "Display name");
    const role = ensureValue(input.role, "Role");
    const mission = ensureValue(input.mission, "Mission");
    const domain = ensureValue(input.domain, "Domain");
    const modelKey = ensureValue(input.modelKey, "Model");
    const providerKey = resolveProviderKey(modelKey);
    const modelLabel = formatModelLabel(modelKey);
    const tools = JSON.stringify(normalizeTokenList(input.allowedTools));
    const domains = JSON.stringify(normalizeTokenList(input.allowedDomains));
    const id = `agent-${agentId}`;

    const existing = db
      .prepare("SELECT id FROM agents WHERE workspace_id = ? AND agent_key = ? LIMIT 1")
      .get(workspaceId, agentId) as { id: string } | undefined;

    if (existing) {
      throw new Error("Agent ID already exists.");
    }

    db.prepare(
      `
        INSERT INTO agents (
          id,
          workspace_id,
          agent_key,
          display_name,
          role_label,
          emoji,
          role_summary,
          mission,
          domain_key,
          provider_key,
          model_key,
          model_label,
          status,
          approval_mode,
          allowed_tools_json,
          allowed_domains_json,
          notes,
          is_supervisor,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0,
          COALESCE((SELECT MAX(sort_order) + 1 FROM agents WHERE workspace_id = ?), 1),
          ?, ?
        )
      `,
    ).run(
      id,
      workspaceId,
      agentId,
      displayName,
      role,
      optionalValue(input.emoji),
      mission,
      mission,
      domain,
      providerKey,
      modelKey,
      modelLabel,
      input.status,
      input.approvalMode,
      tools,
      domains,
      optionalValue(input.notes),
      workspaceId,
      now,
      now,
    );

    createActivityEvent(db, {
      id: createActivityEventId(),
      agentId: id,
      runId: null,
      kind: "agent_created",
      title: "Agent created",
      body: `${displayName} was added to Mission Control.`,
      tone: "success",
      createdAt: now,
    });

    return {
      agentId: id,
      summary: `${displayName} is now available in Mission Control.`,
    };
  },

  updateAgent(input: UpdateAgentCommand): AgentMutationResult {
    const now = new Date().toISOString();
    const displayName = ensureValue(input.displayName, "Display name");
    const role = ensureValue(input.role, "Role");
    const mission = ensureValue(input.mission, "Mission");
    const domain = ensureValue(input.domain, "Domain");
    const modelKey = ensureValue(input.modelKey, "Model");
    const providerKey = resolveProviderKey(modelKey);
    const modelLabel = formatModelLabel(modelKey);
    const nextAgentKey = ensureValue(input.agentId, "Agent ID").toLowerCase();
    const duplicate = db
      .prepare(
        `
          SELECT id
          FROM agents
          WHERE workspace_id = ?
            AND agent_key = ?
            AND id != ?
          LIMIT 1
        `,
      )
      .get(workspaceId, nextAgentKey, input.id) as { id: string } | undefined;

    if (duplicate) {
      throw new Error("Agent ID already exists.");
    }

    const result = db.prepare(
      `
        UPDATE agents
        SET agent_key = ?,
            display_name = ?,
            role_label = ?,
            emoji = ?,
            role_summary = ?,
            mission = ?,
            domain_key = ?,
            provider_key = ?,
            model_key = ?,
            model_label = ?,
            status = ?,
            approval_mode = ?,
            allowed_tools_json = ?,
            allowed_domains_json = ?,
            notes = ?,
            updated_at = ?
        WHERE workspace_id = ?
          AND id = ?
      `,
    ).run(
      nextAgentKey,
      displayName,
      role,
      optionalValue(input.emoji),
      mission,
      mission,
      domain,
      providerKey,
      modelKey,
      modelLabel,
      input.status,
      input.approvalMode,
      JSON.stringify(normalizeTokenList(input.allowedTools)),
      JSON.stringify(normalizeTokenList(input.allowedDomains)),
      optionalValue(input.notes),
      now,
      workspaceId,
      input.id,
    );

    if (!result.changes) {
      throw new Error("Agent not found.");
    }

    createActivityEvent(db, {
      id: createActivityEventId(),
      agentId: input.id,
      runId: null,
      kind: "agent_updated",
      title: "Agent updated",
      body: `${displayName} was updated from the directory.`,
      tone: "info",
      createdAt: now,
    });

    return {
      agentId: input.id,
      summary: `${displayName} updated successfully.`,
    };
  },

  setAgentStatus(input: SetAgentStatusCommand): AgentMutationResult {
    const now = new Date().toISOString();
    const current = loadAgent(db, input.id);

    if (!current) {
      throw new Error("Agent not found.");
    }

    db.prepare("UPDATE agents SET status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?").run(
      input.status,
      now,
      workspaceId,
      input.id,
    );

    createActivityEvent(db, {
      id: createActivityEventId(),
      agentId: input.id,
      runId: null,
      kind: "status_changed",
      title: input.status === "paused" ? "Agent paused" : "Agent reactivated",
      body: `${current.display_name} is now ${input.status}.`,
      tone: input.status === "paused" ? "warning" : "success",
      createdAt: now,
    });

    return {
      agentId: input.id,
      summary: `${current.display_name} is now ${input.status}.`,
    };
  },

  setAgentApprovalMode(input: SetAgentApprovalModeCommand): AgentMutationResult {
    const now = new Date().toISOString();
    const current = loadAgent(db, input.id);

    if (!current) {
      throw new Error("Agent not found.");
    }

    db.prepare("UPDATE agents SET approval_mode = ?, updated_at = ? WHERE workspace_id = ? AND id = ?").run(
      input.approvalMode,
      now,
      workspaceId,
      input.id,
    );

    createActivityEvent(db, {
      id: createActivityEventId(),
      agentId: input.id,
      runId: null,
      kind: "approval_mode_changed",
      title: "Approval mode updated",
      body: `${current.display_name} now uses ${input.approvalMode.replace(/_/g, " ")} mode.`,
      tone: "info",
      createdAt: now,
    });

    return {
      agentId: input.id,
      summary: `${current.display_name} approval mode updated.`,
    };
  },

  saveAIProviderConfig(input: SaveAIProviderConfigCommand): AIProviderMutationResult {
    const now = new Date().toISOString();
  const providerKey = ensureValue(input.providerKey, "Provider key").toLowerCase();
    const supportsLiveRequests = providerKey === "openai" || providerKey === "anthropic";
    const defaultModelKey = ensureValue(input.defaultModelKey, "Default model");
    const fallbackModelKey = optionalValue(input.fallbackModelKey) ?? "";
    const timeoutMs = Math.max(3_000, Math.min(120_000, Math.round(input.timeoutMs)));
    const retryCount = Math.max(0, Math.min(5, Math.round(input.retryCount)));
    const hasIncomingSecret = Boolean(input.apiKey?.trim());

    if (input.clearStoredKey) {
      options.secretStore.clearProviderSecret(workspaceId, providerKey);
    }

    if (hasIncomingSecret) {
      options.secretStore.setProviderSecret(workspaceId, providerKey, input.apiKey ?? "");
    }

    const hasStoredSecret = supportsLiveRequests ? options.secretStore.hasProviderSecret(workspaceId, providerKey) : false;
    const enabled = supportsLiveRequests ? (input.enabled && hasStoredSecret ? 1 : 0) : 0;
    const status = supportsLiveRequests ? (hasStoredSecret ? "configured" : "not_configured") : "not_configured";
    const displayName =
      providerKey === "openai"
        ? "OpenAI"
        : providerKey === "anthropic"
          ? "Anthropic"
          : providerKey === "openclaw"
            ? "OpenClaw"
            : "Custom / Gateway";
    const baseUrl = normalizeProviderBaseUrl(providerKey, input.baseUrl);
    const notes =
      providerKey === "openai"
        ? "First live AI provider for supervised routing."
        : providerKey === "anthropic"
          ? "Live Claude provider for users who prefer Anthropic."
          : "Provider shell staged for future expansion.";

    db.prepare(
      `
        INSERT INTO ai_provider_configs (
          id,
          workspace_id,
          provider_key,
          display_name,
          supports_live_requests,
          enabled,
          default_model_key,
          fallback_model_key,
          base_url,
          timeout_ms,
          retry_count,
          status,
          last_tested_at,
          last_success_at,
          last_error_summary,
          notes,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
        ON CONFLICT(workspace_id, provider_key) DO UPDATE SET
          display_name = excluded.display_name,
          supports_live_requests = excluded.supports_live_requests,
          enabled = excluded.enabled,
          default_model_key = excluded.default_model_key,
          fallback_model_key = excluded.fallback_model_key,
          base_url = excluded.base_url,
          timeout_ms = excluded.timeout_ms,
          retry_count = excluded.retry_count,
          status = excluded.status,
          notes = excluded.notes,
          updated_at = excluded.updated_at
      `,
    ).run(
      `provider-${providerKey}`,
      workspaceId,
      providerKey,
      displayName,
      supportsLiveRequests ? 1 : 0,
      enabled,
      defaultModelKey,
      fallbackModelKey,
      baseUrl,
      timeoutMs,
      retryCount,
      status,
      notes,
      now,
      now,
    );

    createActivityEvent(db, {
      id: createActivityEventId(),
      agentId: null,
      runId: null,
      kind: "provider_config_saved",
      title: "Provider config updated",
      body: `${displayName} configuration was saved for Agents.`,
      tone: "info",
      createdAt: now,
    });

    return {
      providerKey,
      status,
      summary: hasStoredSecret
        ? `${displayName} configuration saved. Test the connection to confirm health.`
        : `${displayName} configuration saved without a stored API key.`,
    };
  },

  async testAIProviderConnection(input: TestAIProviderConnectionCommand): Promise<AIProviderMutationResult> {
    const now = new Date().toISOString();
    const providerKey = ensureValue(input.providerKey, "Provider key").toLowerCase();
    const config = db
      .prepare(
        `
          SELECT display_name, supports_live_requests, enabled, default_model_key, base_url, timeout_ms
          FROM ai_provider_configs
          WHERE workspace_id = ?
            AND provider_key = ?
          LIMIT 1
        `,
      )
      .get(workspaceId, providerKey) as
      | {
          display_name: string;
          supports_live_requests: number;
          enabled: number;
          default_model_key: string;
          base_url: string;
          timeout_ms: number;
        }
      | undefined;

    if (!config || config.supports_live_requests !== 1) {
      return {
        providerKey,
        status: "not_configured",
        summary: "This provider is still a shell and cannot be tested yet.",
      };
    }

    const apiKey = options.secretStore.getProviderSecret(workspaceId, providerKey);

    if (!apiKey) {
      db.prepare(
        `
          UPDATE ai_provider_configs
          SET status = 'not_configured',
              enabled = 0,
              last_tested_at = ?,
              last_error_summary = ?,
              updated_at = ?
          WHERE workspace_id = ?
            AND provider_key = ?
        `,
      ).run(now, "No API key stored locally on this Mac.", now, workspaceId, providerKey);

      return {
        providerKey,
        status: "not_configured",
        summary: "Store an API key before testing this provider.",
      };
    }

    const providerService =
      providerKey === "anthropic" && options.anthropicProviderService
        ? options.anthropicProviderService
        : options.openaiProviderService;
    const result = await providerService.testConnection({
      apiKey,
      baseUrl: config.base_url,
      defaultModelKey: config.default_model_key,
      timeoutMs: config.timeout_ms,
    });

    db.prepare(
      `
        UPDATE ai_provider_configs
        SET status = ?,
            enabled = CASE
              WHEN ? = 'healthy' AND supports_live_requests = 1 THEN 1
              ELSE enabled
            END,
            last_tested_at = ?,
            last_success_at = CASE WHEN ? = 'healthy' THEN ? ELSE last_success_at END,
            last_error_summary = CASE WHEN ? = 'healthy' THEN NULL ELSE ? END,
            updated_at = ?
        WHERE workspace_id = ?
          AND provider_key = ?
      `,
    ).run(
      result.status,
      result.status,
      now,
      result.status,
      now,
      result.status,
      result.ok ? null : result.summary,
      now,
      workspaceId,
      providerKey,
    );

    createActivityEvent(db, {
      id: createActivityEventId(),
      agentId: null,
      runId: null,
      kind: "provider_connection_tested",
      title: result.ok ? "Provider healthy" : "Provider test failed",
      body: result.summary,
      tone: result.ok ? "success" : "warning",
      createdAt: now,
    });

    return {
      providerKey,
      status: result.status,
      summary:
        result.ok && config.enabled !== 1
          ? `${result.summary} ${config.display_name} is now enabled for chat.`
          : result.summary,
    };
  },

  async refreshAIProviderModels(input: RefreshAIProviderModelsCommand): Promise<AIProviderMutationResult> {
    const now = new Date().toISOString();
    const providerKey = ensureValue(input.providerKey, "Provider key").toLowerCase();
    const config = db
      .prepare(
        `
          SELECT display_name, supports_live_requests, default_model_key, base_url, timeout_ms
          FROM ai_provider_configs
          WHERE workspace_id = ?
            AND provider_key = ?
          LIMIT 1
        `,
      )
      .get(workspaceId, providerKey) as
      | {
          display_name: string;
          supports_live_requests: number;
          default_model_key: string;
          base_url: string;
          timeout_ms: number;
        }
      | undefined;

    if (!config || config.supports_live_requests !== 1) {
      return {
        providerKey,
        status: "not_configured",
        summary: "This provider cannot list live models yet.",
      };
    }

    const apiKey = options.secretStore.getProviderSecret(workspaceId, providerKey);
    if (!apiKey) {
      return {
        providerKey,
        status: "not_configured",
        summary: "Store an API key before refreshing model options.",
      };
    }

    const providerService: AIModelListingService =
      providerKey === "anthropic" && options.anthropicProviderService
        ? options.anthropicProviderService
        : options.openaiProviderService;

    try {
      if (!providerService.listModels) {
        throw new Error("This provider cannot refresh model options in this build.");
      }

      const models = await providerService.listModels({
        apiKey,
        baseUrl: config.base_url,
        defaultModelKey: config.default_model_key,
        timeoutMs: config.timeout_ms,
      });
      persistProviderModelOptions(db, providerKey, models);

      db.prepare(
        `
          UPDATE ai_provider_configs
          SET last_error_summary = NULL,
              updated_at = ?
          WHERE workspace_id = ?
            AND provider_key = ?
        `,
      ).run(now, workspaceId, providerKey);

      return {
        providerKey,
        status: "configured",
        summary: `${config.display_name} model list refreshed (${models.length} models).`,
      };
    } catch (error) {
      const summary = error instanceof Error ? error.message : "Could not refresh model options.";
      db.prepare(
        `
          UPDATE ai_provider_configs
          SET last_error_summary = ?,
              updated_at = ?
          WHERE workspace_id = ?
            AND provider_key = ?
        `,
      ).run(summary, now, workspaceId, providerKey);

      return {
        providerKey,
        status: "unavailable",
        summary,
      };
    }
  },

  async saveConnectorConfig(input: SaveConnectorConfigCommand): Promise<ConnectorMutationResult> {
    const connectorKey = ensureValue(input.connectorKey, "Connector key").toLowerCase();

    if (connectorKey !== "telegram") {
      throw new Error("Only Telegram is supported right now.");
    }

    if (!options.telegramConnectorService) {
      throw new Error("Telegram connector service unavailable.");
    }

    const status = await options.telegramConnectorService.saveConfig({
      enabled: input.enabled,
      botToken: input.botToken,
      clearStoredSecret: input.clearStoredSecret,
    });

    return {
      connectorKey,
      status,
      summary:
        status === "configured"
          ? "Telegram connector enabled and polling direct messages."
          : status === "disabled"
            ? "Telegram connector disabled."
            : "Telegram connector saved, but a valid bot token is still required.",
    };
  },

  async testConnectorConnection(input: TestConnectorConnectionCommand): Promise<ConnectorMutationResult> {
    const connectorKey = ensureValue(input.connectorKey, "Connector key").toLowerCase();

    if (connectorKey !== "telegram") {
      throw new Error("Only Telegram is supported right now.");
    }

    if (!options.telegramConnectorService) {
      throw new Error("Telegram connector service unavailable.");
    }

    const result = await options.telegramConnectorService.testConnection();
    return {
      connectorKey,
      status: "configured",
      botUsername: result.botUsername,
      summary: result.botUsername ? `Telegram is connected as @${result.botUsername}.` : "Telegram responded successfully.",
    };
  },

  createConnectorLinkToken(input: CreateConnectorLinkTokenCommand): ConnectorMutationResult {
    const connectorKey = ensureValue(input.connectorKey, "Connector key").toLowerCase();
    if (!options.connectorBridgeService) {
      throw new Error("Connector bridge service unavailable.");
    }
    const result = options.connectorBridgeService.createLinkToken({
      connectorKey,
      workspaceId: input.workspaceId,
      userId: input.userId,
      expiresInMinutes: input.expiresInMinutes,
    });

    return {
      connectorKey,
      status: "configured",
      linkToken: result.token,
      summary: result.summary,
    };
  },

  assignAgentModel(input: AssignAgentModelCommand): AgentMutationResult {
    const now = new Date().toISOString();
    const providerKey = ensureValue(input.providerKey, "Provider");
    const modelKey = ensureValue(input.modelKey, "Model");
    const modelLabel = ensureValue(input.modelLabel, "Model label");
    const current = loadAgent(db, input.agentId);

    if (!current) {
      throw new Error("Agent not found.");
    }

    const provider = db
      .prepare(
        `
          SELECT display_name
          FROM ai_provider_configs
          WHERE workspace_id = ?
            AND provider_key = ?
          LIMIT 1
        `,
      )
      .get(workspaceId, providerKey) as { display_name: string } | undefined;

    if (!provider) {
      throw new Error("Provider not found.");
    }

    db.prepare(
      `
        UPDATE agents
        SET provider_key = ?,
            model_key = ?,
            model_label = ?,
            updated_at = ?
        WHERE workspace_id = ?
          AND id = ?
      `,
    ).run(providerKey, modelKey, modelLabel, now, workspaceId, input.agentId);

    createActivityEvent(db, {
      id: createActivityEventId(),
      agentId: input.agentId,
      runId: null,
      kind: "agent_model_assigned",
      title: "Agent model updated",
      body: `${current.display_name} now uses ${provider.display_name} · ${modelLabel}.`,
      tone: "info",
      createdAt: now,
    });

    return {
      agentId: input.agentId,
      summary: `${current.display_name} now uses ${provider.display_name} · ${modelLabel}.`,
    };
  },

  sendAssistantMessage(input: AssistantGatewayRequest): Promise<AssistantGatewayResponse> {
    return options.assistantGatewayService.sendMessage(input);
  },

  getAssistantChatSnapshot(): AssistantChatSnapshot {
    if (!options.assistantChatService) {
      throw new Error("Assistant chat service unavailable.");
    }

    return options.assistantChatService.getSnapshot();
  },

  createAssistantThread(input: CreateAssistantThreadCommand): AssistantChatSnapshot {
    if (!options.assistantChatService) {
      throw new Error("Assistant chat service unavailable.");
    }

    return options.assistantChatService.createThread(input);
  },

  deleteAssistantThread(input: DeleteAssistantThreadCommand): AssistantChatSnapshot {
    if (!options.assistantChatService) {
      throw new Error("Assistant chat service unavailable.");
    }

    return options.assistantChatService.deleteThread(input);
  },

  setActiveAssistantThread(input: SetActiveAssistantThreadCommand): AssistantChatSnapshot {
    if (!options.assistantChatService) {
      throw new Error("Assistant chat service unavailable.");
    }

    return options.assistantChatService.setActiveThread(input);
  },

  updateAssistantThreadPreferences(input: UpdateAssistantThreadPreferencesCommand): AssistantChatSnapshot {
    if (!options.assistantChatService) {
      throw new Error("Assistant chat service unavailable.");
    }

    return options.assistantChatService.updateThreadPreferences(input);
  },

  renameAssistantThread(input: RenameAssistantThreadCommand): AssistantChatSnapshot {
    if (!options.assistantChatService) {
      throw new Error("Assistant chat service unavailable.");
    }

    return options.assistantChatService.renameThread(input);
  },

  sendAssistantChatTurn(input: SendAssistantChatTurnCommand): Promise<AssistantChatSnapshot> {
    if (!options.assistantChatService) {
      throw new Error("Assistant chat service unavailable.");
    }

    return options.assistantChatService.sendTurn(input);
  },

  async reviewRun(input: ReviewAgentRunCommand): Promise<AgentRunReviewResult> {
    const now = new Date().toISOString();
    const run = db
      .prepare(
        `
          SELECT
            agent_runs.id,
            agent_runs.thread_id,
            agent_runs.agent_id,
            agent_runs.title,
            agent_runs.status,
            agent_runs.approval_required,
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
          status: string;
          approval_required: number;
          agent_display_name: string;
          agent_role_label: string;
        }
      | undefined;

    if (!run) {
      throw new Error("Run not found.");
    }

    if (run.approval_required !== 1) {
      throw new Error("This run does not require approval.");
    }

    if (input.decision === "approve_for_session" && (!run.thread_id || !run.agent_id)) {
      throw new Error("Session approval is only available for chat-linked draft runs.");
    }

    const nextStatus = input.decision === "deny" ? "denied" : "approved";
    const approvalDecision: AgentRunReviewResult["approvalDecision"] =
      input.decision === "deny"
        ? "denied"
        : input.decision === "approve_for_session"
          ? "approved_for_session"
          : "approved";
    const approvalScope: AgentRunReviewResult["approvalScope"] = input.decision === "approve_for_session" ? "session" : "run";

    db.exec("BEGIN");

    try {
      db.prepare(
        `
          UPDATE agent_runs
          SET status = ?,
              approval_decision = ?,
              approval_scope = ?,
              approval_decided_at = ?,
              updated_at = ?
          WHERE workspace_id = ?
            AND id = ?
        `,
      ).run(nextStatus, approvalDecision, approvalScope, now, now, workspaceId, input.runId);

      if (run.thread_id) {
        if (input.decision === "approve_for_session") {
          db.prepare(
            `
              UPDATE assistant_chat_thread_state
              SET session_approval_agent_id = ?,
                  session_approval_granted_at = ?,
                  updated_at = ?
              WHERE thread_id = ?
            `,
          ).run(run.agent_id, now, now, run.thread_id);
        } else if (input.decision === "deny") {
          db.prepare(
            `
              UPDATE assistant_chat_thread_state
              SET session_approval_agent_id = CASE
                    WHEN session_approval_agent_id = ? THEN NULL
                    ELSE session_approval_agent_id
                  END,
                  session_approval_granted_at = CASE
                    WHEN session_approval_agent_id = ? THEN NULL
                    ELSE session_approval_granted_at
                  END,
                  updated_at = ?
              WHERE thread_id = ?
            `,
          ).run(run.agent_id, run.agent_id, now, run.thread_id);
        }

        applyApprovalMetaToThread(
          db,
          run.thread_id,
          run.id,
          buildApprovalMeta(input.decision, run.agent_id, run.agent_display_name, run.agent_role_label),
        );
      }

      const summary =
        input.decision === "deny"
          ? `${run.title} was denied. No command-layer action will proceed.`
          : input.decision === "approve_for_session"
            ? `${run.title} was approved for this session. Similar follow-ups in this thread can continue without another approval step.`
            : `${run.title} was approved for supervised follow-up.`;

      createActivityEvent(db, {
        id: createActivityEventId(),
        agentId: run.agent_id,
        runId: run.id,
        kind: "run_approval_reviewed",
        title: input.decision === "deny" ? "Draft denied" : "Draft approved",
        body: summary,
        tone: input.decision === "deny" ? "warning" : "success",
        createdAt: now,
      });

      db.exec("COMMIT");

      const result = {
        runId: run.id,
        status: nextStatus as AgentRunReviewResult["status"],
        approvalDecision,
        approvalScope,
        summary,
      };

      if (options.assistantChatService && run.thread_id) {
        try {
          await options.assistantChatService.continueReviewedRun({
            runId: run.id,
            decision: input.decision,
          });
        } catch (continuationError) {
          createActivityEvent(db, {
            id: createActivityEventId(),
            agentId: run.agent_id,
            runId: run.id,
            kind: "run_review_followup_failed",
            title: "Approval follow-up failed",
            body:
              continuationError instanceof Error
                ? continuationError.message
                : "The approval decision was saved, but the chat follow-up could not continue cleanly.",
            tone: "warning",
            createdAt: new Date().toISOString(),
          });
        }
      }

      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },

  createDraftRunFromChat(input: CreateDraftRunFromChatCommand): DraftRunFromChatResult {
    const now = new Date().toISOString();
    const message = ensureValue(input.message, "Message");
    const routedAgentKey = input.routeHint?.trim() || inferRoute(message);
    const routedAgent = db
      .prepare(
        `
          SELECT id, display_name, approval_mode
          FROM agents
          WHERE workspace_id = ?
            AND agent_key = ?
          LIMIT 1
        `,
      )
      .get(workspaceId, routedAgentKey) as
      | {
          id: string;
          display_name: string;
          approval_mode: AgentApprovalMode;
        }
      | undefined;

    const supervisor = db
      .prepare("SELECT id FROM agents WHERE workspace_id = ? AND is_supervisor = 1 LIMIT 1")
      .get(workspaceId) as { id: string } | undefined;

    const requiresApproval = (routedAgent?.approval_mode ?? "supervised") !== "auto" || actionVerbRequiresApproval(message);
    const status = requiresApproval ? "needs_approval" : "queued";
    const routedAgentName = routedAgent?.display_name ?? "Supervisor Agent";
    const runId = `run-chat-${Date.now().toString(36)}`;
    const summary = requiresApproval
      ? `Prepared an action draft for ${routedAgentName}. Approval is required before anything can continue.`
      : `Routed to ${routedAgentName}. Draft run prepared and waiting in queue.`;

    db.exec("BEGIN");

    try {
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
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, 'chat', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        runId,
        workspaceId,
        routedAgent?.id ?? null,
        supervisor?.id ?? null,
        message.slice(0, 96),
        message,
        summary,
        status,
        routedAgent?.approval_mode ?? "supervised",
        requiresApproval ? 1 : 0,
        null,
        requiresApproval ? "pending" : "approved",
        "run",
        requiresApproval ? null : now,
        now,
        now,
      );

      createActivityEvent(db, {
        id: createActivityEventId(),
        agentId: routedAgent?.id ?? null,
        runId,
        kind: "chat_routed",
        title: "Chat request routed",
        body: summary,
        tone: requiresApproval ? "warning" : "info",
        createdAt: now,
      });

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      runId,
      status,
      routedAgentId: routedAgent?.id ?? null,
      routedAgentName,
      supervisorReply: summary,
      requiresApproval,
    };
  },
});

export type AgentMutationService = ReturnType<typeof createAgentMutationService>;
