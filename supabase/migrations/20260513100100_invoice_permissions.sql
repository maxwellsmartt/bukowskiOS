-- 20260513100100 — Invoice permissions. Seven keys mirroring the
-- `quotes.*` pattern, auto-granted to the admin role of every workspace.

INSERT INTO public.permissions (key, label, description) VALUES
  ('invoices.read',           'Read invoices',          'View workspace invoices.'),
  ('invoices.create',         'Create invoices',        'Create new invoice drafts.'),
  ('invoices.edit_draft',     'Edit invoice drafts',    'Edit invoices that are still in draft.'),
  ('invoices.issue',          'Issue invoices',         'Issue invoices (consumes an NCF and freezes the row).'),
  ('invoices.cancel',         'Cancel invoices',        'Cancel or void invoices.'),
  ('invoices.record_payment', 'Record payments',        'Register payments against an invoice.'),
  ('invoices.export',         'Export invoices',        'Generate invoice PDFs.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.key = 'admin'
  AND p.key IN (
    'invoices.read',
    'invoices.create',
    'invoices.edit_draft',
    'invoices.issue',
    'invoices.cancel',
    'invoices.record_payment',
    'invoices.export'
  )
ON CONFLICT DO NOTHING;
