-- 20260605130000 — Harden Finance access roles.
--
-- Finance UI/data must be visible only to admins or roles with explicit
-- finance-domain permissions. Existing workspaces may predate Treasury and
-- collaborator-fee permissions, so this migration aligns the built-in
-- finance_viewer role with the read-only Finance surface.

INSERT INTO public.permissions (key, label, description) VALUES
  ('finance.read', 'Read finance', 'View finance exposure and entries.'),
  ('quotes.read', 'Read quotes', 'View workspace quotes.'),
  ('quotes.export', 'Export quotes', 'Generate PDFs of quotes.'),
  ('invoices.read', 'Read invoices', 'View workspace invoices.'),
  ('invoices.export', 'Export invoices', 'Generate invoice PDFs.'),
  ('treasury.transactions.read', 'Read treasury', 'View bank accounts, transactions and treasury overview.'),
  ('treasury.reimbursements.review', 'Review reimbursements', 'Adjust DGII-deductible amounts and fiscal status.'),
  ('treasury.export', 'Export treasury reports', 'Export treasury data and reports.'),
  ('crew_fees.read', 'Read crew fees', 'View collaborator fees and payment history.')
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

WITH finance_viewer_permissions(permission_key) AS (
  VALUES
    ('finance.read'),
    ('quotes.read'),
    ('quotes.export'),
    ('invoices.read'),
    ('invoices.export'),
    ('treasury.transactions.read'),
    ('treasury.reimbursements.review'),
    ('treasury.export'),
    ('crew_fees.read')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM public.roles
JOIN finance_viewer_permissions ON TRUE
JOIN public.permissions ON permissions.key = finance_viewer_permissions.permission_key
WHERE roles.key = 'finance_viewer'
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH admin_finance_permissions(permission_key) AS (
  VALUES
    ('finance.read'),
    ('finance.manage'),
    ('currency.manage_rates'),
    ('quotes.read'),
    ('quotes.create'),
    ('quotes.edit'),
    ('quotes.approve'),
    ('quotes.cancel'),
    ('quotes.export'),
    ('quotes.manage_templates'),
    ('invoices.read'),
    ('invoices.create'),
    ('invoices.edit_draft'),
    ('invoices.issue'),
    ('invoices.cancel'),
    ('invoices.record_payment'),
    ('invoices.export'),
    ('treasury.accounts.manage'),
    ('treasury.import'),
    ('treasury.transactions.read'),
    ('treasury.transactions.classify'),
    ('treasury.reimbursements.review'),
    ('treasury.export'),
    ('crew_fees.read'),
    ('crew_fees.manage'),
    ('crew_payments.record')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM public.roles
JOIN admin_finance_permissions ON TRUE
JOIN public.permissions ON permissions.key = admin_finance_permissions.permission_key
WHERE roles.key = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

DROP POLICY IF EXISTS "members can read project budget targets" ON public.project_budget_targets;
DROP POLICY IF EXISTS "admins can manage project budget targets" ON public.project_budget_targets;
DROP POLICY IF EXISTS "finance can read project budget targets" ON public.project_budget_targets;
DROP POLICY IF EXISTS "finance can manage project budget targets" ON public.project_budget_targets;

CREATE POLICY "finance can read project budget targets"
  ON public.project_budget_targets FOR SELECT
  USING (public.has_permission(workspace_id, 'finance.read'));

CREATE POLICY "finance can manage project budget targets"
  ON public.project_budget_targets FOR ALL
  USING (public.has_permission(workspace_id, 'finance.manage'))
  WITH CHECK (public.has_permission(workspace_id, 'finance.manage'));
