-- Adds the `users.invite` permission used by the send-invite Edge Function
-- and grants it to admin roles in every workspace.

INSERT INTO public.permissions (key, label, description)
VALUES ('users.invite', 'Invite users', 'Invite a teammate to join a workspace by email.')
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM public.roles
JOIN public.permissions ON permissions.key = 'users.invite'
WHERE roles.key = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
