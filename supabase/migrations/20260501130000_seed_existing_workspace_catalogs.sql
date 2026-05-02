-- Make sure the catalog tables exist in Supabase (they were SQLite-only previously)
-- and backfill base catalogs into every workspace that doesn't have them yet.

CREATE TABLE IF NOT EXISTS public.asset_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  parent_category_id uuid REFERENCES public.asset_categories(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'warehouse',
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code)
);

ALTER TABLE public.asset_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'members can read asset_categories'
  ) THEN
    EXECUTE 'CREATE POLICY "members can read asset_categories" ON public.asset_categories FOR SELECT USING (public.is_workspace_member(workspace_id))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'members can read locations'
  ) THEN
    EXECUTE 'CREATE POLICY "members can read locations" ON public.locations FOR SELECT USING (public.is_workspace_member(workspace_id))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'admins can manage asset_categories'
  ) THEN
    EXECUTE 'CREATE POLICY "admins can manage asset_categories" ON public.asset_categories FOR ALL USING (public.has_permission(workspace_id, ''users.invite'')) WITH CHECK (public.has_permission(workspace_id, ''users.invite''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'admins can manage locations'
  ) THEN
    EXECUTE 'CREATE POLICY "admins can manage locations" ON public.locations FOR ALL USING (public.has_permission(workspace_id, ''users.invite'')) WITH CHECK (public.has_permission(workspace_id, ''users.invite''))';
  END IF;
END $$;

-- Backfill base catalog rows for existing workspaces.
INSERT INTO public.asset_categories (workspace_id, code, name, description)
SELECT w.id, c.code, c.name, c.description
FROM public.workspaces AS w
CROSS JOIN (
  VALUES
    ('CAM', 'Cameras', 'Bodies, accessories and rigs.'),
    ('LENS', 'Lenses', 'Primes, zooms and matte boxes.'),
    ('LITE', 'Lighting', 'Fixtures, modifiers and stands.'),
    ('GRIP', 'Grip', 'Stands, clamps, dollies and hardware.'),
    ('SOUND', 'Sound', 'Mics, recorders, mixers and cables.')
) AS c(code, name, description)
ON CONFLICT (workspace_id, code) DO NOTHING;

INSERT INTO public.locations (workspace_id, code, name, type, description)
SELECT w.id, 'WH-01', 'Main warehouse', 'warehouse', 'Default storage location. Rename or expand from the Catalog screen.'
FROM public.workspaces AS w
ON CONFLICT (workspace_id, code) DO NOTHING;
