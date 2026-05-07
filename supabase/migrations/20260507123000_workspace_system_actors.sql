CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.workspace_system_actors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  email text,
  kind text NOT NULL DEFAULT 'agent' CHECK (kind IN ('agent', 'integration', 'system')),
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'inactive')),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS public.workspace_system_actor_permissions (
  actor_id uuid NOT NULL REFERENCES public.workspace_system_actors(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, permission_id)
);

ALTER TABLE public.workspace_system_actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_system_actor_permissions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_system_actors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_system_actor_permissions TO authenticated;

DROP POLICY IF EXISTS "members can read workspace system actors" ON public.workspace_system_actors;
DROP POLICY IF EXISTS "admins can manage workspace system actors" ON public.workspace_system_actors;
DROP POLICY IF EXISTS "members can read workspace system actor permissions" ON public.workspace_system_actor_permissions;
DROP POLICY IF EXISTS "admins can manage workspace system actor permissions" ON public.workspace_system_actor_permissions;

CREATE POLICY "members can read workspace system actors"
  ON public.workspace_system_actors FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "admins can manage workspace system actors"
  ON public.workspace_system_actors FOR ALL
  USING (public.has_permission(workspace_id, 'users.invite'))
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

CREATE POLICY "members can read workspace system actor permissions"
  ON public.workspace_system_actor_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_system_actors actor
      WHERE actor.id = workspace_system_actor_permissions.actor_id
        AND public.is_workspace_member(actor.workspace_id)
    )
  );

CREATE POLICY "admins can manage workspace system actor permissions"
  ON public.workspace_system_actor_permissions FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_system_actors actor
      WHERE actor.id = workspace_system_actor_permissions.actor_id
        AND public.has_permission(actor.workspace_id, 'users.invite')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspace_system_actors actor
      WHERE actor.id = workspace_system_actor_permissions.actor_id
        AND public.has_permission(actor.workspace_id, 'users.invite')
    )
  );

WITH actor_seed AS (
  INSERT INTO public.workspace_system_actors (
    workspace_id,
    key,
    name,
    email,
    kind,
    description,
    status,
    metadata_json,
    updated_at
  )
  SELECT
    workspaces.id,
    'ai_agent',
    'AI Agent',
    'ai-agent@bukowskios.local',
    'agent',
    'System actor used to audit assistant-driven operational actions in this workspace.',
    'active',
    '{"local_actor_id":"user-ops","managed_by":"bukowskiOS"}'::jsonb,
    now()
  FROM public.workspaces
  ON CONFLICT (workspace_id, key) DO UPDATE
  SET name = EXCLUDED.name,
      email = EXCLUDED.email,
      kind = EXCLUDED.kind,
      description = EXCLUDED.description,
      status = EXCLUDED.status,
      metadata_json = public.workspace_system_actors.metadata_json || EXCLUDED.metadata_json,
      updated_at = now()
  RETURNING id
),
target_actors AS (
  SELECT id
  FROM actor_seed
  UNION
  SELECT id
  FROM public.workspace_system_actors
  WHERE key = 'ai_agent'
),
system_actor_permission_seed(permission_key) AS (
  VALUES
    ('projects.read'),
    ('projects.manage'),
    ('assets.read'),
    ('assets.manage'),
    ('incidents.read'),
    ('incidents.create'),
    ('packing-slips.read'),
    ('packing-slips.create'),
    ('finance.read'),
    ('rma.read'),
    ('rma.create'),
    ('quotes.read'),
    ('quotes.create'),
    ('quotes.edit'),
    ('quotes.export')
)
INSERT INTO public.workspace_system_actor_permissions (actor_id, permission_id)
SELECT target_actors.id, permissions.id
FROM target_actors
JOIN system_actor_permission_seed
  ON true
JOIN public.permissions
  ON permissions.key = system_actor_permission_seed.permission_key
ON CONFLICT (actor_id, permission_id) DO NOTHING;
