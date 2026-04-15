CREATE TABLE IF NOT EXISTS connector_accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connector_key TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  external_username TEXT,
  display_name TEXT,
  linked_user_id TEXT REFERENCES users(id),
  link_status TEXT NOT NULL DEFAULT 'pending',
  linked_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, connector_key, external_user_id)
);

CREATE TABLE IF NOT EXISTS connector_channels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connector_key TEXT NOT NULL,
  external_channel_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  operational_mode TEXT NOT NULL DEFAULT 'dm_first',
  status TEXT NOT NULL DEFAULT 'active',
  default_policy_json TEXT NOT NULL DEFAULT '{}',
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, connector_key, external_channel_id)
);

CREATE TABLE IF NOT EXISTS connector_channel_memberships (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connector_key TEXT NOT NULL,
  channel_id TEXT NOT NULL REFERENCES connector_channels(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  linked_user_id TEXT REFERENCES users(id),
  membership_status TEXT NOT NULL DEFAULT 'observed',
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (channel_id, external_user_id)
);

CREATE TABLE IF NOT EXISTS connector_message_receipts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connector_key TEXT NOT NULL,
  channel_id TEXT REFERENCES connector_channels(id) ON DELETE SET NULL,
  direction TEXT NOT NULL,
  external_message_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  thread_id TEXT REFERENCES assistant_chat_threads(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  payload_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (connector_key, direction, external_message_id)
);

CREATE TABLE IF NOT EXISTS connector_link_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connector_key TEXT NOT NULL,
  token TEXT NOT NULL,
  target_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (connector_key, token)
);

CREATE TABLE IF NOT EXISTS connector_thread_bindings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  connector_key TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL REFERENCES connector_channels(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES assistant_chat_threads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  last_correlation_id TEXT,
  last_inbound_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, connector_key, external_user_id, status)
);

CREATE INDEX IF NOT EXISTS idx_connector_accounts_lookup
  ON connector_accounts(workspace_id, connector_key, external_user_id, link_status);

CREATE INDEX IF NOT EXISTS idx_connector_channels_lookup
  ON connector_channels(workspace_id, connector_key, external_channel_id);

CREATE INDEX IF NOT EXISTS idx_connector_receipts_channel_time
  ON connector_message_receipts(connector_key, channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_thread_bindings_lookup
  ON connector_thread_bindings(workspace_id, connector_key, external_user_id, updated_at DESC);
