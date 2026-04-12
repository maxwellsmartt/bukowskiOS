import type { DatabaseSync } from "node:sqlite";

import type {
  AgentActivityRow,
  AgentConnectorRow,
  AgentDetailSnapshot,
  AgentGraphNode,
  AgentModelRow,
  AgentModelsSnapshot,
  AgentRosterRow,
  AgentRunRow,
  MissionControlSnapshot,
} from "@contracts";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

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
    return { approvalReason: null as string | null };
  }

  try {
    const parsed = JSON.parse(value) as { approval_reason?: unknown };
    return {
      approvalReason: typeof parsed.approval_reason === "string" ? parsed.approval_reason : null,
    };
  } catch {
    return { approvalReason: null as string | null };
  }
};

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

type AgentRow = {
  id: string;
  agent_key: string;
  display_name: string;
  emoji: string | null;
  role_summary: string;
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

const shouldShowInternalAgents = () => process.env.BUKOWSKI_SHOW_INTERNAL_AGENTS === "1" || process.env.NODE_ENV !== "production";

const isVisibleAgent = (row: AgentRow) => shouldShowInternalAgents() || row.visibility !== "internal";

const loadAgentRows = (db: DatabaseSync) =>
  db
    .prepare(
      `
        SELECT
          id,
          agent_key,
          display_name,
          emoji,
          role_summary,
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

const toRosterRow = (row: AgentRow): AgentRosterRow => {
  const tools = parseJsonArray(row.allowed_tools_json);
  const domains = parseJsonArray(row.allowed_domains_json);

  return {
    id: row.id,
    agentId: row.agent_key,
    displayName: row.display_name,
    emoji: row.emoji ?? "◌",
    role: row.role_summary,
    domain: row.domain_key,
    providerKey: row.provider_key ?? "openai",
    status: row.status,
    modelLabel: row.model_label,
    approvalMode: row.approval_mode,
    toolsSummary: tools.join(" · "),
    domainsSummary: domains.join(" · "),
    notes: row.notes ?? "",
    isSupervisor: row.is_supervisor === 1,
  };
};

const loadBusyAgentIds = (db: DatabaseSync) => {
  const runRows = db
    .prepare(
      `
        SELECT DISTINCT agent_id
        FROM agent_runs
        WHERE workspace_id = ?
          AND agent_id IS NOT NULL
          AND status IN ('routing', 'running', 'approved')
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

  return new Set([
    ...runRows.map((row) => row.agent_id),
    ...threadRows.map((row) => row.last_routed_agent_id),
  ]);
};

const loadAttentionAgentIds = (db: DatabaseSync) => {
  const providerRows = loadProviderRows(db);
  const unhealthyProviders = new Set(
    providerRows
      .filter((row) => row.enabled === 1 && !["healthy", "configured"].includes(row.status))
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
    attentionAgentIds: Set<string>;
    unhealthyProviderKeys: Set<string>;
  },
): AgentGraphNode => ({
  id: row.id,
  agentId: row.agent_key,
  displayName: row.display_name,
  emoji: row.emoji ?? "◌",
  role: row.role_summary,
  domain: row.domain_key,
  status: row.status,
  operationalState:
    row.status === "paused" || statusContext.unhealthyProviderKeys.has(row.provider_key ?? "openai") || statusContext.attentionAgentIds.has(row.id)
      ? "attention"
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
  base_url: string;
  timeout_ms: number;
  retry_count: number;
  status: AgentModelRow["status"];
  last_tested_at: string | null;
  last_success_at: string | null;
  last_error_summary: string | null;
  notes: string;
};

const formatOptionalTimestampLabel = (value: string | null) => (value ? formatTimestampLabel(value) : "Never");

const loadProviderRows = (db: DatabaseSync) =>
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

const loadRuns = (db: DatabaseSync, limit?: number, agentId?: string) => {
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
    createdAtLabel: formatTimestampLabel(row.created_at),
    updatedAtLabel: formatTimestampLabel(row.updated_at),
  };
};

const loadActivity = (db: DatabaseSync, limit = 6) =>
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

const buildProviderRows = (
  db: DatabaseSync,
  secretStore?: { hasProviderSecret: (workspaceId: string, providerKey: string) => boolean },
) => {
  const agentRows = loadAgentRows(db);
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

  return loadProviderRows(db).map((row) => {
    const assignedRows = assignedByProvider.get(row.provider_key) ?? [];
    const assignedModels = Array.from(new Set(assignedRows.map((agent) => agent.modelLabel).filter(Boolean)));
    const hasStoredSecret = secretStore?.hasProviderSecret(workspaceId, row.provider_key) ?? false;
    const isActiveProvider = row.enabled === 1 && assignedRows.length > 0;

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
      baseUrl: row.base_url,
      timeoutMs: row.timeout_ms,
      retryCount: row.retry_count,
      lastTestedAtLabel: formatOptionalTimestampLabel(row.last_tested_at),
      lastSuccessAtLabel: formatOptionalTimestampLabel(row.last_success_at),
      lastErrorSummary: row.last_error_summary ?? "",
      assignedAgents: assignedRows.map((agent) => agent.displayName),
      assignedModels,
      notes: row.notes,
    } satisfies AgentModelRow;
  });
};

export const createAgentReadService = (
  db: DatabaseSync,
  secretStore?: { hasProviderSecret: (workspaceId: string, providerKey: string) => boolean },
) => ({
  getMissionControlSnapshot(): MissionControlSnapshot {
    const agentRows = loadAgentRows(db);
    const supervisor = agentRows.find((row) => row.is_supervisor === 1) ?? null;
    const subagents = agentRows.filter((row) => row.is_supervisor !== 1);
    const busyAgentIds = loadBusyAgentIds(db);
    const attentionContext = loadAttentionAgentIds(db);
    const modelSummary = buildProviderRows(db, secretStore);
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
    const configuredConnectors = db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM agent_connector_configs
          WHERE workspace_id = ?
            AND status = 'configured'
        `,
      )
      .get(workspaceId) as { count: number };
    const assignedModels = agentRows.filter((row) => row.model_label.trim().length > 0).length;

    return {
      supervisor: supervisor
        ? toGraphNode(supervisor, {
            busyAgentIds,
            attentionAgentIds: attentionContext.runAgentIds,
            unhealthyProviderKeys: attentionContext.providerKeys,
          })
        : null,
      subagents: subagents.map((agent) =>
        toGraphNode(agent, {
          busyAgentIds,
          attentionAgentIds: attentionContext.runAgentIds,
          unhealthyProviderKeys: attentionContext.providerKeys,
        }),
      ),
      queue: loadRuns(db, 5).filter(isVisibleRunRow).map(toRunRow),
      activity: loadActivity(db, 6).filter(isVisibleActivityRow).map(toActivityRow),
      health: {
        activeAgents: String(activeCount),
        pausedAgents: String(pausedCount),
        recentRuns: String(loadRuns(db, 12).length),
        connectorsConfigured: String(configuredConnectors.count),
        modelsAssigned: String(assignedModels),
      },
      modelSummary,
      connectorSummary: connectorSummary.map((row) => ({
        id: row.id,
        connectorKey: row.connector_key,
        label: row.display_name,
        status: row.status,
        capability: row.capability_summary,
        notes: row.notes,
      })),
    };
  },

  getAgentsList(): AgentRosterRow[] {
    return loadAgentRows(db).map(toRosterRow);
  },

  getAgentDetail(agentId: string): AgentDetailSnapshot {
    const row = loadAgentRows(db).find((candidate) => candidate.id === agentId) ?? null;

    if (!row) {
      return {
        agent: null,
        tools: [],
        domains: [],
        recentRuns: [],
      };
    }

    return {
      agent: toRosterRow(row),
      tools: parseJsonArray(row.allowed_tools_json),
      domains: parseJsonArray(row.allowed_domains_json),
      recentRuns: loadRuns(db, 4, row.id).map(toRunRow),
    };
  },

  getRunsList(): AgentRunRow[] {
    return loadRuns(db).filter(isVisibleRunRow).map(toRunRow);
  },

  getModelsSnapshot(): AgentModelsSnapshot {
    const providers = buildProviderRows(db, secretStore);
    const agents = loadAgentRows(db);
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

  getAIProviderConfigs(): AgentModelRow[] {
    return buildProviderRows(db, secretStore);
  },

  getConnectorsSnapshot(): AgentConnectorRow[] {
    const rows = db
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

    return rows.map((row) => ({
      id: row.id,
      connectorKey: row.connector_key,
      label: row.display_name,
      status: row.status,
      capability: row.capability_summary,
      notes: row.notes,
    }));
  },
});

export type AgentReadService = ReturnType<typeof createAgentReadService>;
