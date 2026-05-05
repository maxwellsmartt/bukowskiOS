-- 20260504110000 — Quote permissions (Plan L FQ3). Adds the seven `quotes.*`
-- permission keys and assigns them to the admin role for every workspace.

INSERT INTO public.permissions (key, label, description) VALUES
  ('quotes.read',             'Read quotes',             'View workspace quotes.'),
  ('quotes.create',           'Create quotes',           'Create new quotes.'),
  ('quotes.edit',             'Edit quotes',             'Edit drafts and send quotes.'),
  ('quotes.approve',          'Approve quotes',          'Approve / reject quotes.'),
  ('quotes.cancel',           'Cancel quotes',           'Cancel or delete quotes.'),
  ('quotes.export',           'Export quotes',           'Generate PDFs of quotes.'),
  ('quotes.manage_templates', 'Manage quote templates',  'Create and edit quote templates.')
ON CONFLICT (key) DO NOTHING;

-- Grant every quotes.* permission to existing admin roles in every workspace.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.key = 'admin'
  AND p.key IN (
    'quotes.read',
    'quotes.create',
    'quotes.edit',
    'quotes.approve',
    'quotes.cancel',
    'quotes.export',
    'quotes.manage_templates'
  )
ON CONFLICT DO NOTHING;
