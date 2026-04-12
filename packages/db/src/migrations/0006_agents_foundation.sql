CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  emoji TEXT,
  role_summary TEXT NOT NULL,
  domain_key TEXT NOT NULL,
  model_key TEXT NOT NULL,
  model_label TEXT NOT NULL,
  status TEXT NOT NULL,
  approval_mode TEXT NOT NULL,
  allowed_tools_json TEXT NOT NULL DEFAULT '[]',
  allowed_domains_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  is_supervisor INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, agent_key)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id TEXT REFERENCES agents(id),
  routed_by_agent_id TEXT REFERENCES agents(id),
  source_channel TEXT NOT NULL,
  title TEXT NOT NULL,
  input_summary TEXT NOT NULL,
  output_summary TEXT NOT NULL,
  status TEXT NOT NULL,
  approval_mode TEXT NOT NULL,
  approval_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_activity_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id TEXT REFERENCES agents(id),
  run_id TEXT REFERENCES agent_runs(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'neutral',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_model_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  provider_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, provider_key)
);

CREATE TABLE IF NOT EXISTS agent_connector_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connector_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  capability_summary TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, connector_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_time
  ON agent_runs(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_activity_workspace_time
  ON agent_activity_events(workspace_id, created_at DESC);
