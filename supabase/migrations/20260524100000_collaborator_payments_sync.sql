-- 20260524100000 — Collaborator fees / outbound crew payments sync schema.
--
-- Local-first source of truth lives in SQLite. These tables mirror the local
-- collaborator fee/payment tables so outbox domain upserts can materialize the
-- data in Supabase for other installed clients.

CREATE TABLE IF NOT EXISTS public.collaborator_fees (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  crew_member_id text NOT NULL,
  project_id text,
  project_unit_id text,
  department_id text,
  source_assignment_id text,
  fee_type text NOT NULL,
  description text,
  agreed_amount numeric(18,2) NOT NULL,
  currency text NOT NULL,
  exchange_rate numeric(18,8),
  base_currency_amount numeric(18,2),
  paid_amount numeric(18,2) NOT NULL DEFAULT 0,
  outstanding_amount numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL,
  expected_payment_date date,
  approved_at timestamptz,
  cancelled_at timestamptz,
  paid_at date,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_actor_type text NOT NULL DEFAULT 'user',
  source_channel text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collaborator_fees_workspace_status
  ON public.collaborator_fees(workspace_id, status, expected_payment_date);
CREATE INDEX IF NOT EXISTS idx_collaborator_fees_crew
  ON public.collaborator_fees(workspace_id, crew_member_id, status);
CREATE INDEX IF NOT EXISTS idx_collaborator_fees_project
  ON public.collaborator_fees(workspace_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_collaborator_fees_assignment
  ON public.collaborator_fees(source_assignment_id);

CREATE TABLE IF NOT EXISTS public.collaborator_payment_batches (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  crew_member_id text NOT NULL,
  paid_at date NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL,
  exchange_rate numeric(18,8),
  base_currency_amount numeric(18,2),
  payment_method text,
  reference text,
  notes text,
  recorded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_actor_type text NOT NULL DEFAULT 'user',
  source_channel text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collaborator_payment_batches_workspace_date
  ON public.collaborator_payment_batches(workspace_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_collaborator_payment_batches_crew
  ON public.collaborator_payment_batches(workspace_id, crew_member_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS public.collaborator_fee_payments (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  fee_id text NOT NULL REFERENCES public.collaborator_fees(id) ON DELETE CASCADE,
  payment_batch_id text NOT NULL REFERENCES public.collaborator_payment_batches(id) ON DELETE CASCADE,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fee_id, payment_batch_id)
);

CREATE INDEX IF NOT EXISTS idx_collaborator_fee_payments_fee
  ON public.collaborator_fee_payments(fee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collaborator_fee_payments_batch
  ON public.collaborator_fee_payments(payment_batch_id);

ALTER TABLE public.collaborator_fees            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaborator_payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaborator_fee_payments    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "collaborator_fees_read"   ON public.collaborator_fees;
DROP POLICY IF EXISTS "collaborator_fees_manage" ON public.collaborator_fees;
CREATE POLICY "collaborator_fees_read" ON public.collaborator_fees
  FOR SELECT USING (public.has_permission(workspace_id, 'crew_fees.read'));
CREATE POLICY "collaborator_fees_manage" ON public.collaborator_fees
  FOR ALL USING (public.has_permission(workspace_id, 'crew_fees.manage'))
  WITH CHECK (public.has_permission(workspace_id, 'crew_fees.manage'));

DROP POLICY IF EXISTS "collaborator_payment_batches_read"   ON public.collaborator_payment_batches;
DROP POLICY IF EXISTS "collaborator_payment_batches_record" ON public.collaborator_payment_batches;
CREATE POLICY "collaborator_payment_batches_read" ON public.collaborator_payment_batches
  FOR SELECT USING (public.has_permission(workspace_id, 'crew_fees.read'));
CREATE POLICY "collaborator_payment_batches_record" ON public.collaborator_payment_batches
  FOR ALL USING (public.has_permission(workspace_id, 'crew_payments.record'))
  WITH CHECK (public.has_permission(workspace_id, 'crew_payments.record'));

DROP POLICY IF EXISTS "collaborator_fee_payments_read"   ON public.collaborator_fee_payments;
DROP POLICY IF EXISTS "collaborator_fee_payments_record" ON public.collaborator_fee_payments;
CREATE POLICY "collaborator_fee_payments_read" ON public.collaborator_fee_payments
  FOR SELECT USING (public.has_permission(workspace_id, 'crew_fees.read'));
CREATE POLICY "collaborator_fee_payments_record" ON public.collaborator_fee_payments
  FOR ALL USING (public.has_permission(workspace_id, 'crew_payments.record'))
  WITH CHECK (public.has_permission(workspace_id, 'crew_payments.record'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collaborator_fees            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collaborator_payment_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collaborator_fee_payments    TO authenticated;

INSERT INTO public.permissions (key, label, description) VALUES
  ('crew_fees.read', 'Read crew fees', 'View collaborator fees and payment history.'),
  ('crew_fees.manage', 'Manage crew fees', 'Create, edit, approve and cancel collaborator fees.'),
  ('crew_payments.record', 'Record crew payments', 'Record outbound payments to collaborators.')
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.key = 'admin'
  AND p.key IN ('crew_fees.read', 'crew_fees.manage', 'crew_payments.record')
ON CONFLICT DO NOTHING;
