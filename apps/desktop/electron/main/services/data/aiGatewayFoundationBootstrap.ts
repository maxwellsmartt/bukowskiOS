import type { DatabaseSync } from "node:sqlite";
import agentConfig from "./agent_config.v1.json";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;
const now = "2026-04-09T16:00:00.000Z";

const providerDefaults = [
  {
    providerKey: "openai",
    displayName: "OpenAI",
    supportsLiveRequests: 1,
    enabled: 0,
    defaultModelKey: "openai:gpt-5.4-mini",
    baseUrl: "https://api.openai.com",
    timeoutMs: 20000,
    retryCount: 1,
    status: "not_configured",
    notes: "First real provider for supervised orchestration.",
  },
  {
    providerKey: "anthropic",
    displayName: "Anthropic",
    supportsLiveRequests: 0,
    enabled: 0,
    defaultModelKey: "anthropic:claude-sonnet-4.5",
    baseUrl: "",
    timeoutMs: 20000,
    retryCount: 1,
    status: "not_configured",
    notes: "Future provider shell. Not wired yet.",
  },
  {
    providerKey: "openclaw",
    displayName: "OpenClaw",
    supportsLiveRequests: 0,
    enabled: 0,
    defaultModelKey: "openclaw:metadata-routing-v1",
    baseUrl: "",
    timeoutMs: 20000,
    retryCount: 1,
    status: "not_configured",
    notes: "Future local or gateway provider shell.",
  },
  {
    providerKey: "custom",
    displayName: "Custom / Gateway",
    supportsLiveRequests: 0,
    enabled: 0,
    defaultModelKey: "custom:gateway-default",
    baseUrl: "",
    timeoutMs: 20000,
    retryCount: 1,
    status: "not_configured",
    notes: "Future custom provider or routing gateway shell.",
  },
] as const;

type AgentConfigRecord = (typeof agentConfig.agents)[number];

const hasColumn = (db: DatabaseSync, tableName: string, columnName: string) => {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
};

const hasTable = (db: DatabaseSync, tableName: string) => {
  const row = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = ?
        LIMIT 1
      `,
    )
    .get(tableName) as { name: string } | undefined;

  return Boolean(row);
};

const inferProviderKeyFromModel = (modelKey: string | null) => {
  const value = modelKey?.trim() ?? "";

  if (!value) {
    return "openai";
  }

  const separatorIndex = value.indexOf(":");
  return separatorIndex > 0 ? value.slice(0, separatorIndex) : "openai";
};

const ensureColumn = (db: DatabaseSync, tableName: string, columnName: string, sqlType: string) => {
  if (!hasTable(db, tableName)) {
    return;
  }

  if (!hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlType};`);
  }
};

const toJson = (value: unknown) => JSON.stringify(value);

const buildSystemAgentRecord = (agent: AgentConfigRecord) => ({
  id: agent.id,
  agentKey: agent.agent_key,
  displayName: agent.display_name,
  roleLabel: agent.display_name,
  emoji: agent.emoji,
  iconKey: agent.icon_key,
  agentType: agent.agent_type,
  roleSummary: agent.role_summary,
  mission: agent.mission,
  soul: agent.soul,
  domainKey: agent.domain_key,
  providerKey: agent.provider_key,
  modelKey: agent.model_key,
  modelLabel: agent.model_label,
  status: agent.status,
  approvalMode: agent.approval_mode,
  allowedToolsJson: toJson(agent.allowed_tools_json),
  allowedDomainsJson: toJson(agent.allowed_domains_json),
  skillsJson: toJson(agent.skills_json),
  specializationJson: toJson(agent.specialization_json),
  notes: agent.notes,
  basePrompt: agent.base_prompt,
  canCreateDraftRuns: agent.can_create_draft_runs ? 1 : 0,
  canExecuteWriteActions: agent.can_execute_write_actions ? 1 : 0,
  isSystemAgent: agent.is_system_agent ? 1 : 0,
  isSupervisor: agent.is_supervisor ? 1 : 0,
  visibility: agent.visibility ?? "public",
  seedVersion: agentConfig.version,
  sortOrder: agent.sort_order,
});

export const applyAIGatewayFoundationMigration = (db: DatabaseSync) => {
  ensureColumn(db, "agents", "provider_key", "TEXT");
  ensureColumn(db, "agents", "role_label", "TEXT");
  ensureColumn(db, "agents", "agent_type", "TEXT DEFAULT 'specialist'");
  ensureColumn(db, "agents", "icon_key", "TEXT");
  ensureColumn(db, "agents", "mission", "TEXT");
  ensureColumn(db, "agents", "soul", "TEXT");
  ensureColumn(db, "agents", "skills_json", "TEXT DEFAULT '[]'");
  ensureColumn(db, "agents", "specialization_json", "TEXT DEFAULT '[]'");
  ensureColumn(db, "agents", "base_prompt", "TEXT");
  ensureColumn(db, "agents", "can_create_draft_runs", "INTEGER DEFAULT 1");
  ensureColumn(db, "agents", "can_execute_write_actions", "INTEGER DEFAULT 0");
  ensureColumn(db, "agents", "is_system_agent", "INTEGER DEFAULT 0");
  ensureColumn(db, "agents", "visibility", "TEXT DEFAULT 'public'");
  ensureColumn(db, "agents", "seed_version", "TEXT");
  ensureColumn(db, "agent_runs", "source", "TEXT DEFAULT 'manual'");
  ensureColumn(db, "agent_runs", "details_json", "TEXT");
  ensureColumn(db, "agent_runs", "thread_id", "TEXT");
  ensureColumn(db, "agent_runs", "approval_decision", "TEXT");
  ensureColumn(db, "agent_runs", "approval_scope", "TEXT");
  ensureColumn(db, "agent_runs", "approval_decided_at", "TEXT");
  ensureColumn(db, "agent_activity_events", "source", "TEXT DEFAULT 'manual'");
  ensureColumn(db, "agent_activity_events", "details_json", "TEXT");
  ensureColumn(db, "assistant_chat_threads", "deleted_at", "TEXT");
  ensureColumn(db, "assistant_chat_messages", "deleted_at", "TEXT");
  ensureColumn(db, "assistant_chat_attachments", "deleted_at", "TEXT");
  ensureColumn(db, "assistant_chat_thread_state", "session_approval_agent_id", "TEXT");
  ensureColumn(db, "assistant_chat_thread_state", "session_approval_granted_at", "TEXT");
  ensureColumn(db, "assistant_chat_thread_state", "preferred_approval_mode", "TEXT DEFAULT 'unsupervised'");

  // One-time bump: when we shipped Sprint A we relaxed Assets and Incidents
  // agents from `needs_approval` → `auto` so writes don't gate by default.
  // `approval_mode` is user-overridable so the seed UPSERT doesn't touch it
  // for already-installed workspaces; force the change here only when the
  // current value is still the original `needs_approval`. Anything the user
  // explicitly customised (supervised / auto / something else) stays put.
  try {
    db.prepare(
      `UPDATE agents
         SET approval_mode = 'auto', updated_at = ?
       WHERE agent_key IN ('assets-agent', 'incidents-maintenance-agent')
         AND approval_mode = 'needs_approval'`,
    ).run(new Date().toISOString());
  } catch {
    /* table may not exist yet on a brand-new install — ignore */
  }

  const agentsMissingProvider = db
    .prepare(
      `
        SELECT id, model_key
        FROM agents
        WHERE workspace_id = ?
          AND (provider_key IS NULL OR trim(provider_key) = '')
      `,
    )
    .all(workspaceId) as Array<{ id: string; model_key: string | null }>;

  agentsMissingProvider.forEach((agent) => {
    db.prepare("UPDATE agents SET provider_key = ? WHERE id = ?").run(inferProviderKeyFromModel(agent.model_key), agent.id);
  });

  db.exec(`
    UPDATE agents
    SET role_label = COALESCE(NULLIF(trim(role_label), ''), display_name)
    WHERE role_label IS NULL OR trim(role_label) = '';
  `);
};

export const bootstrapAIGatewayFoundation = (db: DatabaseSync) => {
  applyAIGatewayFoundationMigration(db);

  const workspaceRows = db.prepare("SELECT id FROM workspaces").all() as Array<{ id: string }>;

  if (!workspaceRows.length) {
    return;
  }

  const insertProvider = db.prepare(`
    INSERT OR IGNORE INTO ai_provider_configs (
      id,
      workspace_id,
      provider_key,
      display_name,
      supports_live_requests,
      enabled,
      default_model_key,
      base_url,
      timeout_ms,
      retry_count,
      status,
      notes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  workspaceRows.forEach((workspace) => {
    providerDefaults.forEach((provider) => {
      insertProvider.run(
        `provider-${provider.providerKey}-${workspace.id}`,
        workspace.id,
        provider.providerKey,
        provider.displayName,
        provider.supportsLiveRequests,
        provider.enabled,
        provider.defaultModelKey,
        provider.baseUrl,
        provider.timeoutMs,
        provider.retryCount,
        provider.status,
        provider.notes,
        now,
        now,
      );
    });
  });

  const insertAgent = db.prepare(`
    INSERT OR IGNORE INTO agents (
      id,
      workspace_id,
      agent_key,
      display_name,
      role_label,
      emoji,
      role_summary,
      domain_key,
      provider_key,
      model_key,
      model_label,
      agent_type,
      icon_key,
      mission,
      soul,
      status,
      approval_mode,
      allowed_tools_json,
      allowed_domains_json,
      skills_json,
      specialization_json,
      notes,
      base_prompt,
      can_create_draft_runs,
      can_execute_write_actions,
      is_system_agent,
      visibility,
      is_supervisor,
      seed_version,
      sort_order,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateSystemAgent = db.prepare(`
    UPDATE agents
    SET
      agent_key = ?,
      role_label = ?,
      emoji = ?,
      domain_key = ?,
      agent_type = ?,
      icon_key = ?,
      soul = ?,
      skills_json = ?,
      specialization_json = ?,
      base_prompt = ?,
      can_create_draft_runs = ?,
      can_execute_write_actions = ?,
      is_system_agent = ?,
      visibility = ?,
      is_supervisor = ?,
      seed_version = ?,
      sort_order = ?,
      updated_at = ?
    WHERE workspace_id = ?
      AND id = ?
  `);

  workspaceRows.forEach((workspace) => {
    agentConfig.agents.forEach((agentConfigRow) => {
      const agent = buildSystemAgentRecord(agentConfigRow);
      insertAgent.run(
        agent.id,
        workspace.id,
        agent.agentKey,
        agent.displayName,
        agent.roleLabel,
        agent.emoji,
        agent.roleSummary,
        agent.domainKey,
        agent.providerKey,
        agent.modelKey,
        agent.modelLabel,
        agent.agentType,
        agent.iconKey,
        agent.mission,
        agent.soul,
        agent.status,
        agent.approvalMode,
        agent.allowedToolsJson,
        agent.allowedDomainsJson,
        agent.skillsJson,
        agent.specializationJson,
        agent.notes,
        agent.basePrompt,
        agent.canCreateDraftRuns,
        agent.canExecuteWriteActions,
        agent.isSystemAgent,
        agent.visibility,
        agent.isSupervisor,
        agent.seedVersion,
        agent.sortOrder,
        now,
        now,
      );

      updateSystemAgent.run(
        agent.agentKey,
        agent.roleLabel,
        agent.emoji,
        agent.domainKey,
        agent.agentType,
        agent.iconKey,
        agent.soul,
        agent.skillsJson,
        agent.specializationJson,
        agent.basePrompt,
        agent.canCreateDraftRuns,
        agent.canExecuteWriteActions,
        agent.isSystemAgent,
        agent.visibility,
        agent.isSupervisor,
        agent.seedVersion,
        agent.sortOrder,
        now,
        workspace.id,
        agent.id,
      );
    });
  });
};

export const reconcileLiveProviderEnablement = (
  db: DatabaseSync,
  secretStore: { hasProviderSecret: (workspaceId: string, providerKey: string) => boolean },
) => {
  const providerRows = db
    .prepare(
      `
        SELECT workspace_id, provider_key, display_name, supports_live_requests, enabled, status
        FROM ai_provider_configs
        WHERE supports_live_requests = 1
      `,
    )
    .all() as Array<{
      workspace_id: string;
      provider_key: string;
      display_name: string;
      supports_live_requests: number;
      enabled: number;
      status: string;
    }>;

  providerRows.forEach((row) => {
    const hasStoredSecret = secretStore.hasProviderSecret(row.workspace_id, row.provider_key);
    const shouldEnable =
      row.enabled !== 1 &&
      hasStoredSecret &&
      (row.status === "healthy" || row.status === "configured");

    if (!shouldEnable) {
      return;
    }

    db.prepare(
      `
        UPDATE ai_provider_configs
        SET enabled = 1,
            updated_at = ?
        WHERE workspace_id = ?
          AND provider_key = ?
      `,
    ).run(new Date().toISOString(), row.workspace_id, row.provider_key);
  });
};
