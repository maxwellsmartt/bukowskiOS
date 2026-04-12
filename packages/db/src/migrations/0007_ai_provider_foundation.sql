CREATE TABLE IF NOT EXISTS ai_provider_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  provider_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  supports_live_requests INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0,
  default_model_key TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  retry_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'not_configured',
  last_tested_at TEXT,
  last_success_at TEXT,
  last_error_summary TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, provider_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_configs_workspace
  ON ai_provider_configs(workspace_id, provider_key);
