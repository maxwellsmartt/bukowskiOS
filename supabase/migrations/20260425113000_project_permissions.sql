INSERT INTO public.permissions (key, label, description)
VALUES
  ('projects.read', 'Read projects', 'View project registry, details and schedule'),
  ('projects.manage', 'Manage projects', 'Create, edit and archive projects')
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM public.roles
JOIN public.permissions
  ON permissions.key IN ('projects.read', 'projects.manage')
WHERE roles.key = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM public.roles
JOIN public.permissions
  ON permissions.key = 'projects.read'
WHERE roles.key = 'supervisor'
ON CONFLICT (role_id, permission_id) DO NOTHING;
