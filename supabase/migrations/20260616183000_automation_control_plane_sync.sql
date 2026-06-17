-- Remote control-plane tables for Automation > Team / AI Models / Channels.
-- Electron already writes these entities into the local outbox; without the
-- mirrored public tables, cross-machine sync stalls with schema-cache 404s.

CREATE TABLE IF NOT EXISTS public.agents (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  id text NOT NULL,
  agent_key text NOT NULL,
  display_name text NOT NULL,
  emoji text,
  role_summary text NOT NULL,
  domain_key text NOT NULL,
  model_key text NOT NULL,
  model_label text NOT NULL,
  status text NOT NULL,
  approval_mode text NOT NULL,
  allowed_tools_json text NOT NULL DEFAULT '[]',
  allowed_domains_json text NOT NULL DEFAULT '[]',
  notes text,
  is_supervisor integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, agent_key)
);

CREATE INDEX IF NOT EXISTS idx_agents_workspace_updated
  ON public.agents(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_provider_configs (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  id text NOT NULL,
  provider_key text NOT NULL,
  display_name text NOT NULL,
  supports_live_requests integer NOT NULL DEFAULT 0,
  enabled integer NOT NULL DEFAULT 0,
  default_model_key text NOT NULL,
  fallback_model_key text NOT NULL DEFAULT '',
  base_url text NOT NULL DEFAULT '',
  timeout_ms integer NOT NULL DEFAULT 30000,
  retry_count integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'not_configured',
  last_tested_at timestamptz,
  last_success_at timestamptz,
  last_error_summary text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, provider_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_configs_workspace_updated
  ON public.ai_provider_configs(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_connector_configs (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  id text NOT NULL,
  connector_key text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL,
  capability_summary text NOT NULL,
  notes text,
  bot_username text,
  last_tested_at timestamptz,
  last_error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, connector_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_connector_configs_workspace_updated
  ON public.agent_connector_configs(workspace_id, updated_at DESC);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_connector_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members can read agents control plane" ON public.agents;
DROP POLICY IF EXISTS "members can insert agents control plane" ON public.agents;
DROP POLICY IF EXISTS "members can update agents control plane" ON public.agents;
DROP POLICY IF EXISTS "members can delete agents control plane" ON public.agents;

CREATE POLICY "members can read agents control plane"
  ON public.agents FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "members can insert agents control plane"
  ON public.agents FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can update agents control plane"
  ON public.agents FOR UPDATE
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can delete agents control plane"
  ON public.agents FOR DELETE
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members can read ai provider configs" ON public.ai_provider_configs;
DROP POLICY IF EXISTS "members can insert ai provider configs" ON public.ai_provider_configs;
DROP POLICY IF EXISTS "members can update ai provider configs" ON public.ai_provider_configs;
DROP POLICY IF EXISTS "members can delete ai provider configs" ON public.ai_provider_configs;

CREATE POLICY "members can read ai provider configs"
  ON public.ai_provider_configs FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "members can insert ai provider configs"
  ON public.ai_provider_configs FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can update ai provider configs"
  ON public.ai_provider_configs FOR UPDATE
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can delete ai provider configs"
  ON public.ai_provider_configs FOR DELETE
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members can read agent connector configs" ON public.agent_connector_configs;
DROP POLICY IF EXISTS "members can insert agent connector configs" ON public.agent_connector_configs;
DROP POLICY IF EXISTS "members can update agent connector configs" ON public.agent_connector_configs;
DROP POLICY IF EXISTS "members can delete agent connector configs" ON public.agent_connector_configs;

CREATE POLICY "members can read agent connector configs"
  ON public.agent_connector_configs FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "members can insert agent connector configs"
  ON public.agent_connector_configs FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can update agent connector configs"
  ON public.agent_connector_configs FOR UPDATE
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can delete agent connector configs"
  ON public.agent_connector_configs FOR DELETE
  USING (public.is_workspace_member(workspace_id));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'agents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ai_provider_configs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_provider_configs;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'agent_connector_configs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_connector_configs;
  END IF;
END $$;
