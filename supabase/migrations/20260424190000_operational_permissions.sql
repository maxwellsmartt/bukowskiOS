INSERT INTO public.permissions (key, label, description)
VALUES
  ('assets.read', 'Read assets', 'View asset registry and current state'),
  ('assets.manage', 'Manage assets', 'Create movements and update assets'),
  ('incidents.read', 'Read incidents', 'View incident queues and details'),
  ('incidents.create', 'Create incidents', 'Report, update and resolve incidents'),
  ('packing-slips.read', 'Read packing slips', 'View packing slip detail and status'),
  ('packing-slips.create', 'Create packing slips', 'Issue and return packing slips'),
  ('finance.read', 'Read finance', 'View finance exposure and entries'),
  ('rma.read', 'Read RMAs', 'Review RMA queues and manufacturer cases'),
  ('rma.create', 'Create RMAs', 'Open or prepare new RMA cases')
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM public.roles
JOIN public.permissions
  ON permissions.key IN (
    'assets.read',
    'assets.manage',
    'incidents.read',
    'incidents.create',
    'packing-slips.read',
    'packing-slips.create',
    'finance.read',
    'rma.read',
    'rma.create'
  )
WHERE roles.key = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM public.roles
JOIN public.permissions
  ON permissions.key IN (
    'assets.read',
    'incidents.read',
    'incidents.create',
    'packing-slips.read',
    'packing-slips.create',
    'finance.read',
    'rma.read',
    'rma.create'
  )
WHERE roles.key = 'supervisor'
ON CONFLICT (role_id, permission_id) DO NOTHING;
