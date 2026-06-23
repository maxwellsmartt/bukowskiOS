-- Adds the dedicated `agents.manage` permission that gates agent
-- administration (creating/editing agents, approval modes, AI providers and
-- connector/Telegram settings) and grants it to admin roles in every
-- workspace. Previously these actions reused `users.invite`; the desktop app
-- now checks `agents.manage` first and only falls back to `users.invite`
-- during this rollout window.

INSERT INTO public.permissions (key, label, description)
VALUES ('agents.manage', 'Manage agents', 'Configure agents, AI providers, connectors and approval modes.')
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM public.roles
JOIN public.permissions ON permissions.key = 'agents.manage'
WHERE roles.key = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
