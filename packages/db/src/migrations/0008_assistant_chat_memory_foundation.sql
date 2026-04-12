CREATE TABLE IF NOT EXISTS assistant_chat_threads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL,
  context_key TEXT NOT NULL,
  context_label TEXT NOT NULL,
  summary_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS assistant_chat_thread_state (
  thread_id TEXT PRIMARY KEY REFERENCES assistant_chat_threads(id) ON DELETE CASCADE,
  last_state TEXT NOT NULL DEFAULT 'idle',
  last_error_code TEXT,
  last_error_summary TEXT,
  last_routed_agent_id TEXT REFERENCES agents(id),
  last_intent TEXT,
  active_message_id TEXT,
  previous_response_id TEXT,
  recent_user_messages_json TEXT NOT NULL DEFAULT '[]',
  last_tool_result_summary TEXT,
  session_approval_agent_id TEXT,
  session_approval_granted_at TEXT,
  preferred_approval_mode TEXT NOT NULL DEFAULT 'supervised',
  is_active INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES assistant_chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  message_state TEXT NOT NULL DEFAULT 'completed',
  state_payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS assistant_chat_attachments (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES assistant_chat_threads(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES assistant_chat_messages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS assistant_memory_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id TEXT REFERENCES agents(id),
  project_id TEXT,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  source_thread_id TEXT REFERENCES assistant_chat_threads(id),
  source_message_id TEXT REFERENCES assistant_chat_messages(id),
  source_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_memory_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  entry_id TEXT REFERENCES assistant_memory_entries(id),
  thread_id TEXT REFERENCES assistant_chat_threads(id),
  message_id TEXT REFERENCES assistant_chat_messages(id),
  event_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  source_reason TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_error_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  source_kind TEXT NOT NULL,
  process_label TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  error_name TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  fingerprint TEXT NOT NULL,
  context_json TEXT,
  thread_id TEXT REFERENCES assistant_chat_threads(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_chat_threads_workspace_time
  ON assistant_chat_threads(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_chat_thread_state_active
  ON assistant_chat_thread_state(is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_chat_messages_thread_time
  ON assistant_chat_messages(thread_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_assistant_chat_attachments_thread
  ON assistant_chat_attachments(thread_id, message_id);

CREATE INDEX IF NOT EXISTS idx_assistant_memory_entries_lookup
  ON assistant_memory_entries(workspace_id, status, kind, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_memory_entries_normalized
  ON assistant_memory_entries(workspace_id, normalized_key);

CREATE INDEX IF NOT EXISTS idx_assistant_memory_events_thread
  ON assistant_memory_events(workspace_id, thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_error_events_time
  ON runtime_error_events(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_error_events_fingerprint
  ON runtime_error_events(workspace_id, fingerprint, created_at DESC);
