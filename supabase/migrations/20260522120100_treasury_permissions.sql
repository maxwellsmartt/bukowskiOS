-- 20260522120100 — Treasury permissions + the "Contable" (accountant) role.
--
-- Six treasury.* keys auto-granted to every workspace admin. We also seed a
-- workspace-scoped "Contable" role with review-only access so Yané can
-- validate reimbursements / deductible amounts and export, without being able
-- to import statements or manage bank accounts.

INSERT INTO public.permissions (key, label, description) VALUES
  ('treasury.accounts.manage',       'Manage bank accounts',     'Create and edit workspace bank accounts.'),
  ('treasury.import',                'Import bank statements',   'Import CSV/XLSX/manual bank statement rows.'),
  ('treasury.transactions.read',     'Read treasury',            'View bank accounts, transactions and treasury overview.'),
  ('treasury.transactions.classify', 'Classify transactions',    'Annotate transactions: kind, concept, category and project allocation.'),
  ('treasury.reimbursements.review', 'Review reimbursements',    'Adjust DGII-deductible amounts and fiscal status.'),
  ('treasury.export',                'Export treasury reports',  'Export treasury data / reports.')
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description;

-- Grant every treasury.* key to the admin role of every workspace.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.key = 'admin'
  AND p.key IN (
    'treasury.accounts.manage',
    'treasury.import',
    'treasury.transactions.read',
    'treasury.transactions.classify',
    'treasury.reimbursements.review',
    'treasury.export'
  )
ON CONFLICT DO NOTHING;

-- Seed a workspace-scoped "Contable" role (review-only treasury access).
INSERT INTO public.roles (workspace_id, key, name, description, is_system_role, updated_at)
SELECT workspaces.id, 'contable', 'Contable',
       'Accountant: review reimbursements and deductible amounts, export reports.',
       false, now()
FROM public.workspaces
ON CONFLICT (workspace_id, key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = now();

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p
  ON p.key IN (
    'treasury.transactions.read',
    'treasury.reimbursements.review',
    'treasury.export',
    'finance.read'
  )
WHERE r.key = 'contable'
ON CONFLICT DO NOTHING;
