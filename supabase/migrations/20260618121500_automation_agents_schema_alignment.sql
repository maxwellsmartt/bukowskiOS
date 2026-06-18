-- Align the remote automation control-plane agents table with the richer local
-- desktop schema so cross-machine sync can carry the same operational shape.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS provider_key text,
  ADD COLUMN IF NOT EXISTS role_label text,
  ADD COLUMN IF NOT EXISTS agent_type text NOT NULL DEFAULT 'specialist',
  ADD COLUMN IF NOT EXISTS icon_key text,
  ADD COLUMN IF NOT EXISTS mission text,
  ADD COLUMN IF NOT EXISTS soul text,
  ADD COLUMN IF NOT EXISTS skills_json text NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS specialization_json text NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS base_prompt text,
  ADD COLUMN IF NOT EXISTS can_create_draft_runs integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS can_execute_write_actions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_system_agent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS seed_version text;

UPDATE public.agents
SET
  provider_key = COALESCE(NULLIF(provider_key, ''), CASE
    WHEN model_key ILIKE 'claude%' THEN 'anthropic'
    WHEN model_key ILIKE 'gpt%' OR model_key ILIKE 'openai:%' OR model_key ILIKE 'o1%' OR model_key ILIKE 'o3%' THEN 'openai'
    WHEN model_key ILIKE 'openclaw%' THEN 'openclaw'
    ELSE 'custom'
  END),
  role_label = COALESCE(NULLIF(role_label, ''), display_name),
  icon_key = COALESCE(NULLIF(icon_key, ''), agent_key),
  mission = COALESCE(mission, notes),
  skills_json = COALESCE(NULLIF(skills_json, ''), '[]'),
  specialization_json = COALESCE(NULLIF(specialization_json, ''), '[]'),
  visibility = COALESCE(NULLIF(visibility, ''), 'public')
WHERE
  provider_key IS NULL
  OR role_label IS NULL
  OR icon_key IS NULL
  OR mission IS NULL
  OR visibility IS NULL
  OR skills_json IS NULL
  OR specialization_json IS NULL;
