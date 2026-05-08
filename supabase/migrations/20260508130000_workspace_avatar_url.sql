-- Workspace avatar used by the desktop shell, picker and workspace switcher.
-- Images are stored in the public `workspace-assets` bucket; this column stores the public URL.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.workspaces.avatar_url IS 'Public URL for the workspace avatar used in app navigation surfaces.';
