ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS recurrence_rule text;

INSERT INTO public.permissions (key, label, description)
VALUES ('licenses.manage', 'Manage licenses', 'Create and update software licenses, renewal links and license codes.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM public.roles
JOIN public.permissions ON permissions.key = 'licenses.manage'
WHERE roles.key IN ('admin', 'supervisor', 'maintenance')
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.software_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  software_name text NOT NULL,
  vendor text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expiring', 'expired', 'permanent', 'archived')),
  license_type text NOT NULL DEFAULT 'subscription' CHECK (license_type IN ('subscription', 'perpetual', 'trial', 'usage_based', 'web_service', 'other')),
  seat_count integer NOT NULL DEFAULT 1 CHECK (seat_count >= 0),
  seat_assignments jsonb NOT NULL DEFAULT '[]'::jsonb,
  license_key text,
  account_email text,
  starts_at date,
  expires_at date,
  renewal_url text,
  payment_url text,
  invoice_url text,
  reminder_days_before integer NOT NULL DEFAULT 0 CHECK (reminder_days_before >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_software_licenses_workspace
  ON public.software_licenses (workspace_id, status, expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.software_licenses TO authenticated;

ALTER TABLE public.software_licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can read software licenses" ON public.software_licenses;
CREATE POLICY "workspace members can read software licenses"
  ON public.software_licenses FOR SELECT
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "workspace members can manage software licenses" ON public.software_licenses;
CREATE POLICY "workspace members can manage software licenses"
  ON public.software_licenses FOR ALL
  USING (public.has_permission(workspace_id, 'licenses.manage'))
  WITH CHECK (public.has_permission(workspace_id, 'licenses.manage'));
