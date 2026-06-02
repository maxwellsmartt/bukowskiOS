-- 20260527210000 — Let Finance Viewer read & export quotes and invoices.
--
-- Today only Admin holds any quotes.*/invoices.* permission, so anyone who
-- needs to look up a quote or an issued invoice has to be made an Admin — too
-- broad. The existing `finance_viewer` role already grants read-only finance
-- access; extend it with read + export on quotes and invoices so sales/ops can
-- consult and download documents without edit/issue/cancel powers.
--
-- Idempotent: ON CONFLICT DO NOTHING. Permission keys already exist
-- (quote_permissions / invoice_permissions migrations).

WITH role_permission_seed(role_key, permission_key) AS (
  VALUES
    ('finance_viewer', 'quotes.read'),
    ('finance_viewer', 'quotes.export'),
    ('finance_viewer', 'invoices.read'),
    ('finance_viewer', 'invoices.export')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN role_permission_seed s ON s.role_key = r.key
JOIN public.permissions p ON p.key = s.permission_key
ON CONFLICT DO NOTHING;
