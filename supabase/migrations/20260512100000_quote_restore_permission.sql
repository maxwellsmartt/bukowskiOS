-- 20260512100000 — Quote restore-from-version permission.
--
-- Phase 1 of the Quotes versioning UX completes the snapshot story:
-- versions are no longer just a read-only timeline — users can now
-- restore a draft back to any past version. We gate that capability
-- behind a dedicated permission so workspaces can decide whether
-- everyone with `quotes.edit` can also restore (default for admin),
-- or whether restoring requires a tighter role.
--
-- The IPC handler currently maps "restore" to `quotes.edit` for
-- simplicity, but this seed lets us migrate the check to
-- `quotes.restore_version` independently if needed.

INSERT INTO public.permissions (key, label, description) VALUES
  (
    'quotes.restore_version',
    'Restore quote version',
    'Restore a draft quote back to a previously saved version.'
  )
ON CONFLICT (key) DO NOTHING;

-- Grant to admin role of every workspace, same pattern as the other
-- quotes.* permissions in 20260504110000_quote_permissions.sql.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.key = 'admin'
  AND p.key = 'quotes.restore_version'
ON CONFLICT DO NOTHING;
