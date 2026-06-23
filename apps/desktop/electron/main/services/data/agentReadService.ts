import type { DatabaseSync } from "node:sqlite";

import type {
  AgentActivityRow,
  AssistantActionLink,
  AssistantOperationalReceipt,
  AgentConnectorRow,
  AgentDetailSnapshot,
  AgentGraphNode,
  AgentModelRow,
  AgentModelsSnapshot,
  AgentRosterRow,
  AgentRunRow,
  MissionControlSnapshot,
} from "@contracts";

import { LOCAL_FALLBACK_WORKSPACE_ID } from "@contracts";
import {
  compareOpenAIModelPriority,
  formatOpenAIModelLabel,
  isCuratedOpenAIModelId,
  toOpenAIUserFacingFailure,
} from "../ai/openaiProviderService";

type AgentWorkspaceQuery = {
  workspaceId?: string | null;
};

const resolveWorkspaceId = (query?: AgentWorkspaceQuery) => query?.workspaceId?.trim() || LOCAL_FALLBACK_WORKSPACE_ID;
const recentConnectorBusyWindowSeconds = 15;

const relativeFormatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
const absoluteFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const parseJsonArray = (value: string | null | undefined) => {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
};

const parseRunDetails = (value: string | null | undefined) => {
  if (!value) {
    return {
      approvalReason: null as string | null,
      actionLinks: [] as AssistantActionLink[],
      operationalReceipt: null as AssistantOperationalReceipt | null,
    };
  }

  try {
    const parsed = JSON.parse(value) as {
      approval_reason?: unknown;
      action_links?: unknown;
      actionLinks?: unknown;
      operational_receipt?: unknown;
      operationalReceipt?: unknown;
    };
    const rawActionLinks = parsed.action_links ?? parsed.actionLinks;
    const actionLinks = Array.isArray(rawActionLinks)
      ? rawActionLinks.filter((link): link is AssistantActionLink => {
          if (!link || typeof link !== "object") {
            return false;
          }
          const candidate = link as Partial<AssistantActionLink>;
          return (
            typeof candidate.label === "string" &&
            typeof candidate.path === "string" &&
            typeof candidate.entityType === "string" &&
            typeof candidate.entityId === "string"
          );
        })
      : [];
    const rawReceipt = parsed.operational_receipt ?? parsed.operationalReceipt;
    return {
      approvalReason: typeof parsed.approval_reason === "string" ? parsed.approval_reason : null,
      actionLinks,
      operationalReceipt: rawReceipt && typeof rawReceipt === "object" ? (rawReceipt as AssistantOperationalReceipt) : null,
    };
  } catch {
    return {
      approvalReason: null as string | null,
      actionLinks: [] as AssistantActionLink[],
      operationalReceipt: null as AssistantOperationalReceipt | null,
    };
  }
};

const formatOptionalTimestampLabel = (value: string | null) => (value ? formatTimestampLabel(value) : "Never tested");

const formatTimestampLabel = (value: string) => {
  const timestamp = new Date(value).getTime();
  const now = Date.now();
  const diffMinutes = Math.round((timestamp - now) / (60 * 1000));
  const absMinutes = Math.abs(diffMinutes);

  if (absMinutes < 1) {
    return "just now";
  }

  if (absMinutes < 60) {
    return relativeFormatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return relativeFormatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) {
    return relativeFormatter.format(diffDays, "day");
  }

  return absoluteFormatter.format(new Date(value));
};

const resolveConnectorStatus = (connectorKey: string, status: AgentConnectorRow["status"]): AgentConnectorRow["status"] => {
  if (connectorKey !== "telegram") {
    return status === "disabled" ? "disabled" : "not_configured";
  }

  return status;
};

type AgentRow = {
  id: string;
  agent_key: string;
  display_name: string;
  role_label: string | null;
  emoji: string | null;
  role_summary: string;
  mission: string | null;
  domain_key: string;
  provider_key: string | null;
  model_key: string;
  model_label: string;
  status: "active" | "paused";
  approval_mode: "auto" | "supervised" | "needs_approval";
  allowed_tools_json: string;
  allowed_domains_json: string;
  notes: string | null;
  is_supervisor: number;
  visibility: "public" | "internal";
};

// Internal agents (Bugs, Product) stay hidden from end-users. Dev override only via env flag.
const shouldShowInternalAgents = () => process.env.BUKOWSKI_SHOW_INTERNAL_AGENTS === "1";

const isVisibleAgent = (row: AgentRow) => shouldShowInternalAgents() || row.visibility !== "internal";

const loadAgentRows = (db: DatabaseSync, workspaceId = LOCAL_FALLBACK_WORKSPACE_ID) =>
  db
    .prepare(
      `
        SELECT
          id,
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
          COALESCE(visibility, 'public') AS visibility
        FROM agents
        WHERE workspace_id = ?
        ORDER BY is_supervisor DESC, sort_order ASC, display_name COLLATE NOCASE ASC
      `,
    )
    .all(workspaceId)
    .filter((row) => isVisibleAgent(row as AgentRow)) as AgentRow[];

const toRosterRow = (
  row: AgentRow,
  statusContext?: {
    busyAgentIds: Set<string>;
    notWorkingAgentIds: Set<string>;
    unhealthyProviderKeys: Set<string>;
  },
): AgentRosterRow => {
  const tools = parseJsonArray(row.allowed_tools_json);
  const domains = parseJsonArray(row.allowed_domains_json);
  const role = row.role_label?.trim() || row.display_name;
  const mission = row.mission?.trim() || row.role_summary;

  return {
    id: row.id,
    agentId: row.agent_key,
    displayName: row.display_name,
    emoji: row.emoji ?? "◌",
    role,
    mission,
    domain: row.domain_key,
    providerKey: row.provider_key ?? "openai",
    status: row.status,
    operationalState:
      row.status === "paused" ||
      !row.model_key.trim() ||
      statusContext?.unhealthyProviderKeys.has(row.provider_key ?? "openai") ||
      statusContext?.notWorkingAgentIds.has(row.id)
        ? "not_working"
        : statusContext?.busyAgentIds.has(row.id)
          ? "working"
          : "idle",
    modelKey: row.model_key,
    modelLabel: row.model_label,
    approvalMode: row.approval_mode,
    toolsSummary: tools.join(" · "),
    domainsSummary: domains.join(" · "),
    notes: row.notes ?? "",
    isSupervisor: row.is_supervisor === 1,
  };
};

const loadBusyAgentIds = (db: DatabaseSync, workspaceId = LOCAL_FALLBACK_WORKSPACE_ID) => {
  const runRows = db
    .prepare(
      `
        SELECT DISTINCT agent_id
        FROM agent_runs
        WHERE workspace_id = ?
          AND agent_id IS NOT NULL
          AND status IN ('routing', 'running')
      `,
    )
    .all(workspaceId) as Array<{ agent_id: string }>;

  const threadRows = db
    .prepare(
      `
        SELECT DISTINCT last_routed_agent_id
        FROM assistant_chat_thread_state
        WHERE last_routed_agent_id IS NOT NULL
          AND last_state IN ('pending', 'streaming')
      `,
    )
    .all() as Array<{ last_routed_agent_id: string }>;

  const recentConnectorRows = db
    .prepare(
      `
        SELECT DISTINCT assistant_chat_thread_state.last_routed_agent_id
        FROM assistant_chat_messages
        JOIN assistant_chat_thread_state ON assistant_chat_thread_state.thread_id = assistant_chat_messages.thread_id
        WHERE assistant_chat_messages.role = 'user'
          AND assistant_chat_messages.source_connector_key = 'telegram'
          AND assistant_chat_messages.deleted_at IS NULL
          AND assistant_chat_thread_state.last_routed_agent_id IS NOT NULL
          AND julianday(assistant_chat_messages.created_at) >= julianday('now', ?)
      `,
    )
    .all(`-${recentConnectorBusyWindowSeconds} seconds`) as Array<{ last_routed_agent_id: string }>;

  return new Set([
    ...runRows.map((row) => row.agent_id),
    ...threadRows.map((row) => row.last_routed_agent_id),
    ...recentConnectorRows.map((row) => row.last_routed_agent_id),
  ]);
};

const loadNotWorkingAgentIds = (db: DatabaseSync, workspaceId = LOCAL_FALLBACK_WORKSPACE_ID) => {
  const providerRows = loadProviderRows(db, workspaceId);
  const unhealthyProviders = new Set(
    providerRows
      .filter((row) => row.enabled !== 1 || !["healthy", "configured"].includes(row.status))
      .map((row) => row.provider_key),
  );

  const stalledRuns = db
    .prepare(
      `
        SELECT DISTINCT agent_id
        FROM agent_runs
        WHERE workspace_id = ?
          AND agent_id IS NOT NULL
          AND status IN ('failed', 'denied', 'paused')
      `,
    )
    .all(workspaceId) as Array<{ agent_id: string }>;

  return {
    providerKeys: unhealthyProviders,
    runAgentIds: new Set(stalledRuns.map((row) => row.agent_id)),
  };
};

const toGraphNode = (
  row: AgentRow,
  statusContext: {
    busyAgentIds: Set<string>;
    notWorkingAgentIds: Set<string>;
    unhealthyProviderKeys: Set<string>;
  },
): AgentGraphNode => ({
  id: row.id,
  agentId: row.agent_key,
  displayName: row.display_name,
  emoji: row.emoji ?? "◌",
  role: row.role_label?.trim() || row.display_name,
  mission: row.mission?.trim() || row.role_summary,
  domain: row.domain_key,
  modelLabel: row.model_label,
  status: row.status,
  operationalState:
    row.status === "paused" ||
    !row.model_key.trim() ||
    statusContext.unhealthyProviderKeys.has(row.provider_key ?? "openai") ||
    statusContext.notWorkingAgentIds.has(row.id)
      ? "not_working"
      : statusContext.busyAgentIds.has(row.id)
        ? "working"
        : "idle",
  secondaryLabel: row.model_label,
  isSupervisor: row.is_supervisor === 1,
});

type ProviderConfigRow = {
  id: string;
  provider_key: string;
  display_name: string;
  supports_live_requests: number;
  enabled: number;
  default_model_key: string;
  fallback_model_key: string;
  base_url: string;
  timeout_ms: number;
  retry_count: number;
  status: AgentModelRow["status"];
  last_tested_at: string | null;
  last_success_at: string | null;
  last_error_summary: string | null;
  notes: string;
};

const loadProviderRows = (db: DatabaseSync, workspaceId = LOCAL_FALLBACK_WORKSPACE_ID) =>
  db
    .prepare(
      `
        SELECT
          id,
          provider_key,
          display_name,
          supports_live_requests,
          enabled,
          default_model_key,
          COALESCE(fallback_model_key, '') AS fallback_model_key,
          base_url,
          timeout_ms,
          retry_count,
          status,
          last_tested_at,
          last_success_at,
          last_error_summary,
          COALESCE(notes, '') AS notes
        FROM ai_provider_configs
        WHERE workspace_id = ?
        ORDER BY supports_live_requests DESC, display_name COLLATE NOCASE ASC
      `,
    )
    .all(workspaceId) as ProviderConfigRow[];

const loadRuns = (db: DatabaseSync, workspaceId = LOCAL_FALLBACK_WORKSPACE_ID, limit?: number, agentId?: string) => {
  const clauses = ["agent_runs.workspace_id = ?"];
  const params: Array<string | number> = [workspaceId];

  if (agentId) {
    clauses.push("agent_runs.agent_id = ?");
    params.push(agentId);
  }

  let sql = `
    SELECT
      agent_runs.id,
      agent_runs.agent_id,
      agent_runs.thread_id,
      agent_runs.title,
      agent_runs.status,
      agent_runs.output_summary,
      agent_runs.approval_mode,
      agent_runs.approval_required,
      agent_runs.approval_decision,
      agent_runs.approval_scope,
      agent_runs.details_json,
      agent_runs.created_at,
      agent_runs.updated_at,
      COALESCE(agents.display_name, 'Supervisor Agent') AS agent_display_name,
      COALESCE(agents.visibility, 'public') AS agent_visibility
    FROM agent_runs
    LEFT JOIN agents ON agents.id = agent_runs.agent_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY agent_runs.updated_at DESC
  `;

  if (limit) {
    sql += ` LIMIT ${limit}`;
  }

  return db.prepare(sql).all(...params) as Array<{
    id: string;
    agent_id: string | null;
    thread_id: string | null;
    title: string;
    status: AgentRunRow["status"];
    output_summary: string;
    approval_mode: AgentRunRow["approvalMode"];
    approval_required: number;
    approval_decision: AgentRunRow["approvalDecision"];
    approval_scope: AgentRunRow["approvalScope"];
    details_json: string | null;
    created_at: string;
    updated_at: string;
    agent_display_name: string;
    agent_visibility: "public" | "internal";
  }>;
};

const toRunRow = (row: ReturnType<typeof loadRuns>[number]): AgentRunRow => {
  const details = parseRunDetails(row.details_json);
  const fallbackApprovalReason =
    row.approval_required === 1
      ? row.approval_mode === "needs_approval"
        ? `${row.agent_display_name} is configured to always require approval before continuing.`
        : "This supervised draft pauses here until you review it."
      : null;

  return {
    id: row.id,
    agentId: row.agent_id,
    threadId: row.thread_id,
    title: row.title,
    status: row.status,
    summary: row.output_summary,
    agentDisplayName: row.agent_display_name,
    approvalMode: row.approval_mode,
    approvalRequired: row.approval_required === 1,
    approvalDecision: row.approval_decision,
    approvalScope: row.approval_scope,
    approvalReason: details.approvalReason ?? fallbackApprovalReason,
    actionLinks: details.actionLinks,
    operationalReceipt: details.operationalReceipt,
    createdAtLabel: formatTimestampLabel(row.created_at),
    updatedAtLabel: formatTimestampLabel(row.updated_at),
  };
};

const loadActivity = (db: DatabaseSync, workspaceId = LOCAL_FALLBACK_WORKSPACE_ID, limit = 6) =>
  db
    .prepare(
      `
        SELECT
          agent_activity_events.id,
          agent_activity_events.agent_id,
          agent_activity_events.title,
          agent_activity_events.body,
          agent_activity_events.tone,
          agent_activity_events.created_at,
          COALESCE(agents.display_name, 'Mission Control') AS agent_display_name,
          COALESCE(agents.visibility, 'public') AS agent_visibility
        FROM agent_activity_events
        LEFT JOIN agents ON agents.id = agent_activity_events.agent_id
        WHERE agent_activity_events.workspace_id = ?
        ORDER BY agent_activity_events.created_at DESC
        LIMIT ${limit}
      `,
    )
    .all(workspaceId) as Array<{
    id: string;
    agent_id: string | null;
    title: string;
    body: string;
    tone: AgentActivityRow["tone"];
    created_at: string;
    agent_display_name: string;
    agent_visibility: "public" | "internal";
  }>;

const toActivityRow = (row: ReturnType<typeof loadActivity>[number]): AgentActivityRow => ({
  id: row.id,
  agentId: row.agent_id,
  title: row.title,
  body: row.body,
  tone: row.tone,
  agentDisplayName: row.agent_display_name,
  timestampLabel: formatTimestampLabel(row.created_at),
});

const isVisibleRunRow = (row: ReturnType<typeof loadRuns>[number]) => shouldShowInternalAgents() || row.agent_visibility !== "internal";

const isVisibleActivityRow = (row: ReturnType<typeof loadActivity>[number]) =>
  shouldShowInternalAgents() || row.agent_visibility !== "internal";

const getDefaultProviderModelOptions = (providerKey: string) => {
  const defaults: Record<string, Array<{ key: string; label: string; source: "default" }>> = {
    openai: [
      { key: "openai:gpt-5.2", label: "GPT 5.2", source: "default" },
      { key: "openai:gpt-5-mini", label: "GPT 5 Mini", source: "default" },
    ],
    anthropic: [
      { key: "anthropic:claude-sonnet-4-20250514", label: "Claude Sonnet 4", source: "default" },
      { key: "anthropic:claude-opus-4-1-20250805", label: "Claude Opus 4.1", source: "default" },
    ],
    openclaw: [{ key: "openclaw:command", label: "OpenClaw Command", source: "default" }],
    custom: [{ key: "custom:gateway-default", label: "Gateway Default", source: "default" }],
  };

  return defaults[providerKey] ?? defaults.custom ?? [];
};

const loadProviderModelOptions = (db: DatabaseSync, workspaceId: string, providerKey: string) => {
  try {
    return db
      .prepare(
        `
          SELECT model_key, display_name, source
          FROM ai_provider_model_cache
          WHERE workspace_id = ?
            AND provider_key = ?
          ORDER BY
            CASE WHEN source = 'api' THEN 0 ELSE 1 END,
            display_name COLLATE NOCASE ASC
        `,
      )
      .all(workspaceId, providerKey) as Array<{ model_key: string; display_name: string; source: string }>;
  } catch {
    return [];
  }
};

const loadProviderModelOptionsLastSyncedAt = (db: DatabaseSync, workspaceId: string, providerKey: string) => {
  try {
    const row = db
      .prepare(
        `
          SELECT MAX(fetched_at) AS fetched_at
          FROM ai_provider_model_cache
          WHERE workspace_id = ?
            AND provider_key = ?
            AND source = 'api'
        `,
      )
      .get(workspaceId, providerKey) as { fetched_at: string | null } | undefined;
    return row?.fetched_at ?? null;
  } catch {
    return null;
  }
};

const buildProviderRows = (
  db: DatabaseSync,
  workspaceId: string,
  secretStore?: { hasProviderSecret: (workspaceId: string, providerKey: string) => boolean },
) => {
  const agentRows = loadAgentRows(db, workspaceId);
  const assignedByProvider = new Map<
    string,
    Array<{
      displayName: string;
      modelLabel: string;
    }>
  >();

  agentRows.forEach((row) => {
    const providerKey = row.provider_key ?? "openai";
    const current = assignedByProvider.get(providerKey) ?? [];
    current.push({
      displayName: row.display_name,
      modelLabel: row.model_label,
    });
    assignedByProvider.set(providerKey, current);
  });

  return loadProviderRows(db, workspaceId).map((row) => {
    const assignedRows = assignedByProvider.get(row.provider_key) ?? [];
    const assignedModels = Array.from(new Set(assignedRows.map((agent) => agent.modelLabel).filter(Boolean)));
    const hasStoredSecret = secretStore?.hasProviderSecret(workspaceId, row.provider_key) ?? false;
    const isActiveProvider = row.enabled === 1 && assignedRows.length > 0;
    const modelOptions = loadProviderModelOptions(db, workspaceId, row.provider_key)
      .filter((model) => (row.provider_key === "openai" ? isCuratedOpenAIModelId(model.model_key) : true))
      .sort((left, right) =>
        row.provider_key === "openai"
          ? compareOpenAIModelPriority(left.model_key, right.model_key)
          : left.display_name.localeCompare(right.display_name, "en-US", { sensitivity: "base" }),
      )
      .map((model) => ({
        key: model.model_key,
        label: row.provider_key === "openai" ? formatOpenAIModelLabel(model.model_key) : model.display_name,
        source: model.source === "api" ? ("api" as const) : ("default" as const),
      }));
    const mergedModelOptions = [
      ...(modelOptions.length ? modelOptions : getDefaultProviderModelOptions(row.provider_key)),
    ];
    [row.default_model_key, row.fallback_model_key]
      .filter(Boolean)
      .forEach((modelKey) => {
        if (!mergedModelOptions.some((option) => option.key === modelKey)) {
          const fallbackLabel =
            row.provider_key === "openai"
              ? formatOpenAIModelLabel(modelKey)
              : modelKey.includes(":")
                ? modelKey.split(":").slice(1).join(":")
                : modelKey;
          mergedModelOptions.push({
            key: modelKey,
            label: fallbackLabel,
            source: "default",
          });
        }
      });
    const modelsLastSyncedAtLabel = formatOptionalTimestampLabel(
      loadProviderModelOptionsLastSyncedAt(db, workspaceId, row.provider_key),
    );

    return {
      id: row.id,
      providerKey: row.provider_key,
      label: row.display_name,
      status: row.status,
      enabled: row.enabled === 1,
      isActiveProvider,
      supportsLiveRequests: row.supports_live_requests === 1,
      hasStoredSecret,
      defaultModelKey: row.default_model_key,
      fallbackModelKey: row.fallback_model_key,
      modelOptions: mergedModelOptions,
      modelsLastSyncedAtLabel,
      baseUrl: row.base_url,
      timeoutMs: row.timeout_ms,
      retryCount: row.retry_count,
      lastTestedAtLabel: formatOptionalTimestampLabel(row.last_tested_at),
      lastSuccessAtLabel: formatOptionalTimestampLabel(row.last_success_at),
      lastErrorSummary:
        row.provider_key === "openai" && row.last_error_summary
          ? toOpenAIUserFacingFailure(row.last_error_summary, undefined, row.base_url)
          : row.last_error_summary ?? "",
      assignedAgents: assignedRows.map((agent) => agent.displayName),
      assignedModels,
      notes: row.notes,
    } satisfies AgentModelRow;
  });
};

export const createAgentReadService = (
  db: DatabaseSync,
  secretStore?: {
    hasProviderSecret: (workspaceId: string, providerKey: string) => boolean;
    hasConnectorSecret?: (workspaceId: string, connectorKey: string) => boolean;
  },
) => ({
  getMissionControlSnapshot(query?: AgentWorkspaceQuery): MissionControlSnapshot {
    const workspaceId = resolveWorkspaceId(query);
    const agentRows = loadAgentRows(db, workspaceId);
    const supervisor = agentRows.find((row) => row.is_supervisor === 1) ?? null;
    const subagents = agentRows.filter((row) => row.is_supervisor !== 1);
    const busyAgentIds = loadBusyAgentIds(db, workspaceId);
    const attentionContext = loadNotWorkingAgentIds(db, workspaceId);
    const modelSummary = buildProviderRows(db, workspaceId, secretStore);
    const connectorSummary = db
      .prepare(
        `
          SELECT id, connector_key, display_name, status, capability_summary, COALESCE(notes, '') AS notes
          FROM agent_connector_configs
          WHERE workspace_id = ?
          ORDER BY display_name COLLATE NOCASE ASC
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      connector_key: string;
      display_name: string;
      status: AgentConnectorRow["status"];
      capability_summary: string;
      notes: string;
    }>;

    const activeCount = agentRows.filter((row) => row.status === "active").length;
    const pausedCount = agentRows.filter((row) => row.status === "paused").length;
    const assignedModels = agentRows.filter((row) => row.model_label.trim().length > 0).length;
    const effectiveConfiguredConnectors = connectorSummary.filter(
      (row) => resolveConnectorStatus(row.connector_key, row.status) === "configured",
    ).length;

    return {
      supervisor: supervisor
        ? toGraphNode(supervisor, {
            busyAgentIds,
            notWorkingAgentIds: attentionContext.runAgentIds,
            unhealthyProviderKeys: attentionContext.providerKeys,
          })
        : null,
      subagents: subagents.map((agent) =>
        toGraphNode(agent, {
            busyAgentIds,
            notWorkingAgentIds: attentionContext.runAgentIds,
            unhealthyProviderKeys: attentionContext.providerKeys,
          }),
      ),
      queue: loadRuns(db, workspaceId, 5).filter(isVisibleRunRow).map(toRunRow),
      activity: loadActivity(db, workspaceId, 6).filter(isVisibleActivityRow).map(toActivityRow),
      health: {
        activeAgents: String(activeCount),
        pausedAgents: String(pausedCount),
        recentRuns: String(loadRuns(db, workspaceId, 12).length),
        connectorsConfigured: String(effectiveConfiguredConnectors),
        modelsAssigned: String(assignedModels),
      },
      modelSummary,
      connectorSummary: connectorSummary.map((row) => ({
        id: row.id,
        connectorKey: row.connector_key,
        label: row.display_name,
        status: resolveConnectorStatus(row.connector_key, row.status),
        capability: row.capability_summary,
        notes: row.notes,
        operationalMode: row.connector_key === "telegram" ? "dm_first" : "future",
        hasStoredSecret: secretStore?.hasConnectorSecret?.(workspaceId, row.connector_key) ?? false,
        botUsername: null,
        linkedAccounts: 0,
        activeLinks: 0,
        activeChannels: 0,
        inboundMessages: 0,
        pendingDeliveries: 0,
        deliverySummary: row.connector_key === "telegram" ? "DM-first bridge staged." : "Connector shell staged for future activation.",
        lastErrorSummary: "",
        lastTestedAtLabel: "Never tested",
        lastInboundAtLabel: "No inbound yet",
        lastOutboundAtLabel: "No outbound yet",
      })),
    };
  },

  getAgentsList(query?: AgentWorkspaceQuery): AgentRosterRow[] {
    const workspaceId = resolveWorkspaceId(query);
    const busyAgentIds = loadBusyAgentIds(db, workspaceId);
    const attentionContext = loadNotWorkingAgentIds(db, workspaceId);

    return loadAgentRows(db, workspaceId).map((row) =>
      toRosterRow(row, {
        busyAgentIds,
        notWorkingAgentIds: attentionContext.runAgentIds,
        unhealthyProviderKeys: attentionContext.providerKeys,
      }),
    );
  },

  getAgentDetail(agentId: string, query?: AgentWorkspaceQuery): AgentDetailSnapshot {
    const workspaceId = resolveWorkspaceId(query);
    const row = loadAgentRows(db, workspaceId).find((candidate) => candidate.id === agentId) ?? null;

    if (!row) {
      return {
        agent: null,
        tools: [],
        domains: [],
        recentRuns: [],
      };
    }

    const busyAgentIds = loadBusyAgentIds(db, workspaceId);
    const attentionContext = loadNotWorkingAgentIds(db, workspaceId);

    return {
      agent: toRosterRow(row, {
        busyAgentIds,
        notWorkingAgentIds: attentionContext.runAgentIds,
        unhealthyProviderKeys: attentionContext.providerKeys,
      }),
      tools: parseJsonArray(row.allowed_tools_json),
      domains: parseJsonArray(row.allowed_domains_json),
      recentRuns: loadRuns(db, workspaceId, 4, row.id).map(toRunRow),
    };
  },

  getRunsList(query?: AgentWorkspaceQuery): AgentRunRow[] {
    const workspaceId = resolveWorkspaceId(query);
    return loadRuns(db, workspaceId).filter(isVisibleRunRow).map(toRunRow);
  },

  getModelsSnapshot(query?: AgentWorkspaceQuery): AgentModelsSnapshot {
    const workspaceId = resolveWorkspaceId(query);
    const providers = buildProviderRows(db, workspaceId, secretStore);
    const agents = loadAgentRows(db, workspaceId);
    const providerLabelByKey = new Map(providers.map((provider) => [provider.providerKey, provider.label]));

    return {
      providers,
      assignments: agents.map((agent) => ({
        agentId: agent.id,
        displayName: agent.display_name,
        providerKey: agent.provider_key ?? "openai",
        providerLabel: providerLabelByKey.get(agent.provider_key ?? "openai") ?? "Unknown provider",
        modelKey: agent.model_key,
        modelLabel: agent.model_label,
        status: agent.status,
        isSupervisor: agent.is_supervisor === 1,
      })),
      summary: {
        activeProviders: String(providers.filter((provider) => provider.isActiveProvider).length),
        configuredProviders: String(
          providers.filter((provider) => provider.status === "configured" || provider.status === "healthy").length,
        ),
        healthyProviders: String(providers.filter((provider) => provider.status === "healthy").length),
        assignedAgents: String(agents.length),
      },
    };
  },

  getAIProviderConfigs(query?: AgentWorkspaceQuery): AgentModelRow[] {
    const workspaceId = resolveWorkspaceId(query);
    return buildProviderRows(db, workspaceId, secretStore);
  },

  getConnectorsSnapshot(query?: AgentWorkspaceQuery): AgentConnectorRow[] {
    const workspaceId = resolveWorkspaceId(query);
    const rows = db
      .prepare(
        `
          SELECT
            agent_connector_configs.id,
            agent_connector_configs.connector_key,
            agent_connector_configs.display_name,
            agent_connector_configs.status,
            agent_connector_configs.capability_summary,
            COALESCE(agent_connector_configs.notes, '') AS notes,
            COALESCE(agent_connector_configs.bot_username, '') AS bot_username,
            COALESCE(agent_connector_configs.last_tested_at, '') AS last_tested_at,
            COALESCE(agent_connector_configs.last_error_summary, '') AS last_error_summary,
            COALESCE(
              (
                SELECT COUNT(*)
                FROM connector_accounts
                WHERE connector_accounts.workspace_id = agent_connector_configs.workspace_id
                  AND connector_accounts.connector_key = agent_connector_configs.connector_key
              ),
              0
            ) AS linked_accounts,
            COALESCE(
              (
                SELECT COUNT(*)
                FROM connector_accounts
                WHERE connector_accounts.workspace_id = agent_connector_configs.workspace_id
                  AND connector_accounts.connector_key = agent_connector_configs.connector_key
                  AND connector_accounts.link_status = 'linked'
              ),
              0
            ) AS active_links,
            COALESCE(
              (
                SELECT COUNT(*)
                FROM connector_channels
                WHERE connector_channels.workspace_id = agent_connector_configs.workspace_id
                  AND connector_channels.connector_key = agent_connector_configs.connector_key
                  AND connector_channels.status = 'active'
              ),
              0
            ) AS active_channels,
            COALESCE(
              (
                SELECT COUNT(*)
                FROM connector_message_receipts
                WHERE connector_message_receipts.workspace_id = agent_connector_configs.workspace_id
                  AND connector_message_receipts.connector_key = agent_connector_configs.connector_key
                  AND connector_message_receipts.direction = 'inbound'
              ),
              0
            ) AS inbound_messages,
            COALESCE(
              (
                SELECT COUNT(*)
                FROM connector_message_receipts
                WHERE connector_message_receipts.workspace_id = agent_connector_configs.workspace_id
                  AND connector_message_receipts.connector_key = agent_connector_configs.connector_key
                  AND connector_message_receipts.direction = 'outbound'
                  AND connector_message_receipts.status IN ('pending_delivery', 'delivery_failed')
              ),
              0
            ) AS pending_deliveries,
            (
              SELECT MAX(last_inbound_at)
              FROM connector_channels
              WHERE connector_channels.workspace_id = agent_connector_configs.workspace_id
                AND connector_channels.connector_key = agent_connector_configs.connector_key
            ) AS last_inbound_at,
            (
              SELECT MAX(last_outbound_at)
              FROM connector_channels
              WHERE connector_channels.workspace_id = agent_connector_configs.workspace_id
                AND connector_channels.connector_key = agent_connector_configs.connector_key
            ) AS last_outbound_at
          FROM agent_connector_configs
          WHERE workspace_id = ?
          ORDER BY display_name COLLATE NOCASE ASC
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      connector_key: string;
      display_name: string;
      status: AgentConnectorRow["status"];
      capability_summary: string;
      notes: string;
      bot_username: string;
      last_tested_at: string;
      last_error_summary: string;
      linked_accounts: number;
      active_links: number;
      active_channels: number;
      inbound_messages: number;
      pending_deliveries: number;
      last_inbound_at: string | null;
      last_outbound_at: string | null;
    }>;

    return rows.map((row) => ({
      status: resolveConnectorStatus(row.connector_key, row.status),
      id: row.id,
      connectorKey: row.connector_key,
      label: row.display_name,
      capability: row.capability_summary,
      notes: row.notes,
      operationalMode: row.connector_key === "telegram" ? "dm_first" : "future",
      hasStoredSecret: secretStore?.hasConnectorSecret?.(workspaceId, row.connector_key) ?? false,
      botUsername: row.bot_username || null,
      linkedAccounts: row.linked_accounts,
      activeLinks: row.active_links,
      activeChannels: row.active_channels,
      inboundMessages: row.inbound_messages,
      pendingDeliveries: row.pending_deliveries,
      deliverySummary:
        row.connector_key === "telegram"
          ? `${row.active_links} linked identities, ${row.pending_deliveries} deliveries pending.`
          : "Connector shell staged for future activation.",
      lastErrorSummary: row.last_error_summary,
      lastTestedAtLabel: formatOptionalTimestampLabel(row.last_tested_at || null),
      lastInboundAtLabel: row.last_inbound_at ? formatTimestampLabel(row.last_inbound_at) : "No inbound yet",
      lastOutboundAtLabel: row.last_outbound_at ? formatTimestampLabel(row.last_outbound_at) : "No outbound yet",
    }));
  },
});

export type AgentReadService = ReturnType<typeof createAgentReadService>;
