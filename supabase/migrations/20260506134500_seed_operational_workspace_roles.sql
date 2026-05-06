WITH permission_seed(key, label, description) AS (
  VALUES
    ('projects.read', 'Read projects', 'View project registry, details and schedule'),
    ('projects.manage', 'Manage projects', 'Create, edit and archive projects'),
    ('assets.read', 'Read assets', 'View asset registry and current state'),
    ('assets.manage', 'Manage assets', 'Create movements and update assets'),
    ('incidents.read', 'Read incidents', 'View incident queues and details'),
    ('incidents.create', 'Create incidents', 'Report, update and resolve incidents'),
    ('packing-slips.read', 'Read packing slips', 'View packing slip detail and status'),
    ('packing-slips.create', 'Create packing slips', 'Issue and return packing slips'),
    ('finance.read', 'Read finance', 'View finance exposure and entries'),
    ('rma.read', 'Read RMAs', 'Review RMA queues and manufacturer cases'),
    ('rma.create', 'Create RMAs', 'Open or prepare new RMA cases'),
    ('users.invite', 'Invite users', 'Invite a teammate to join a workspace by email.')
)
INSERT INTO public.permissions (key, label, description)
SELECT key, label, description
FROM permission_seed
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description;

WITH role_seed(key, name, description, is_system_role) AS (
  VALUES
    ('admin', 'Admin', 'Full access to settings, team, assets, projects and finance.', true),
    ('crew', 'Crew', 'Daily crew access for assigned gear, packing context and incident reports.', false),
    ('supervisor', 'Supervisor', 'Coordinate projects, assets, incidents, RMAs and packing slips.', false),
    ('finance_viewer', 'Finance Viewer', 'Review finance status without edit access.', false),
    ('maintenance', 'Maintenance', 'Handle incidents, repairs and RMA follow-up.', false)
)
INSERT INTO public.roles (workspace_id, key, name, description, is_system_role, updated_at)
SELECT workspaces.id, role_seed.key, role_seed.name, role_seed.description, role_seed.is_system_role, now()
FROM public.workspaces
CROSS JOIN role_seed
ON CONFLICT (workspace_id, key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system_role = EXCLUDED.is_system_role,
    updated_at = now();

WITH role_permission_seed(role_key, permission_key) AS (
  VALUES
    ('admin', 'projects.read'),
    ('admin', 'projects.manage'),
    ('admin', 'assets.read'),
    ('admin', 'assets.manage'),
    ('admin', 'incidents.read'),
    ('admin', 'incidents.create'),
    ('admin', 'packing-slips.read'),
    ('admin', 'packing-slips.create'),
    ('admin', 'finance.read'),
    ('admin', 'rma.read'),
    ('admin', 'rma.create'),
    ('admin', 'users.invite'),
    ('crew', 'projects.read'),
    ('crew', 'assets.read'),
    ('crew', 'incidents.read'),
    ('crew', 'incidents.create'),
    ('crew', 'packing-slips.read'),
    ('supervisor', 'projects.read'),
    ('supervisor', 'projects.manage'),
    ('supervisor', 'assets.read'),
    ('supervisor', 'assets.manage'),
    ('supervisor', 'incidents.read'),
    ('supervisor', 'incidents.create'),
    ('supervisor', 'packing-slips.read'),
    ('supervisor', 'packing-slips.create'),
    ('supervisor', 'rma.read'),
    ('supervisor', 'rma.create'),
    ('finance_viewer', 'finance.read'),
    ('maintenance', 'assets.read'),
    ('maintenance', 'incidents.read'),
    ('maintenance', 'incidents.create'),
    ('maintenance', 'rma.read'),
    ('maintenance', 'rma.create')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM public.roles
JOIN role_permission_seed
  ON role_permission_seed.role_key = roles.key
JOIN public.permissions
  ON permissions.key = role_permission_seed.permission_key
ON CONFLICT (role_id, permission_id) DO NOTHING;
