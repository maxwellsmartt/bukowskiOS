-- Treasury payment instruments / pending invoice allocations.
--
-- Security notes:
-- - Do not persist full account/card numbers. `account_number_full` remains for
--   compatibility but is nulled here and should not be used by app code.
-- - No new tables are exposed. Existing treasury RLS and authenticated grants
--   continue to gate rows by workspace permissions.

ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_user_name_snapshot text,
  ADD COLUMN IF NOT EXISTS instrument_kind text NOT NULL DEFAULT 'bank_account',
  ADD COLUMN IF NOT EXISTS last4 text,
  ADD COLUMN IF NOT EXISTS issuer text,
  ADD COLUMN IF NOT EXISTS statement_cycle_day integer,
  ADD COLUMN IF NOT EXISTS payment_due_day integer,
  ADD COLUMN IF NOT EXISTS reminder_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.bank_accounts
SET account_number_full = NULL
WHERE account_number_full IS NOT NULL;

ALTER TABLE public.transaction_links
  DROP CONSTRAINT IF EXISTS transaction_links_transaction_id_linked_entity_type_linked_entity_id_key,
  DROP CONSTRAINT IF EXISTS transaction_links_transaction_id_fkey;

ALTER TABLE public.transaction_links
  ALTER COLUMN transaction_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS payment_instrument_id text REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amount_applied numeric(18,2),
  ADD COLUMN IF NOT EXISTS amount_currency text,
  ADD COLUMN IF NOT EXISTS fx_rate numeric(18,8),
  ADD COLUMN IF NOT EXISTS allocation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS cycle_start date,
  ADD COLUMN IF NOT EXISTS cycle_end date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.transaction_links
  ADD CONSTRAINT transaction_links_transaction_id_fkey
  FOREIGN KEY (transaction_id)
  REFERENCES public.bank_transactions(id)
  ON DELETE SET NULL;

UPDATE public.transaction_links
SET allocation_status = 'matched'
WHERE transaction_id IS NOT NULL
  AND allocation_status = 'pending';

UPDATE public.transaction_links
SET updated_at = created_at
WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bank_accounts_owner
  ON public.bank_accounts(workspace_id, owner, owner_user_id);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_instrument
  ON public.bank_accounts(workspace_id, instrument_kind, is_active);

CREATE INDEX IF NOT EXISTS idx_txn_links_transaction
  ON public.transaction_links(workspace_id, transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_txn_links_payment_instrument
  ON public.transaction_links(workspace_id, payment_instrument_id)
  WHERE payment_instrument_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_links_dedupe_v4
  ON public.transaction_links(
    workspace_id,
    linked_entity_type,
    linked_entity_id,
    COALESCE(transaction_id, ''),
    COALESCE(payment_instrument_id, '')
  );
