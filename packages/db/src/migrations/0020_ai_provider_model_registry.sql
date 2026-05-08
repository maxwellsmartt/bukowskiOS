ALTER TABLE ai_provider_configs ADD COLUMN fallback_model_key TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS ai_provider_model_cache (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  provider_key TEXT NOT NULL,
  model_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  raw_json TEXT,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, provider_key, model_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_model_cache_provider
  ON ai_provider_model_cache(workspace_id, provider_key, display_name);
