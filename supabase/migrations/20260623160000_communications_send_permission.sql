-- Adds the `communications.send` permission that lets agents send operational
-- messages to teammates (in-app notifications, and Telegram where linked) and
-- grants it to admin and supervisor roles in every workspace. Sending always
-- requires human approval; this permission controls who may approve/trigger it.

INSERT INTO public.permissions (key, label, description)
VALUES ('communications.send', 'Send messages', 'Let agents send operational messages to teammates (in-app and Telegram).')
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM public.roles
JOIN public.permissions ON permissions.key = 'communications.send'
WHERE roles.key IN ('admin', 'supervisor')
ON CONFLICT (role_id, permission_id) DO NOTHING;
