-- 20260527200000 — Row-Level Security assertion / defense in depth.
--
-- Every table that grants INSERT/UPDATE/DELETE to `authenticated` MUST have
-- RLS enabled — otherwise any signed-in user can read/write every workspace's
-- data through PostgREST. Earlier migrations enabled RLS individually, but
-- there was no single place to verify the post-condition; this one does it
-- idempotently.
--
-- `ENABLE ROW LEVEL SECURITY` is a no-op when already on.
-- The final SELECT prints the RLS state of every targeted table so a human
-- can verify in the SQL editor that nothing slipped.

DO $$
DECLARE
  target_table text;
  target_tables CONSTANT text[] := ARRAY[
    -- Operational
    'notifications','todos','reminders','software_licenses',
    'workspace_system_actors','workspace_system_actor_permissions',
    -- Treasury
    'bank_accounts','bank_statement_imports','bank_transactions',
    'transaction_annotations','transaction_project_allocations',
    'transaction_links','counterparty_rules',
    -- Finance: currency / quotes / invoices / entries / collaborators
    'currency_settings','exchange_rates',
    'quotes','quote_items','quote_versions',
    'invoices','invoice_items','invoice_payments',
    'financial_entries',
    'collaborator_fees','collaborator_payment_batches','collaborator_fee_payments'
  ];
BEGIN
  FOREACH target_table IN ARRAY target_tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = target_table AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
    ELSE
      RAISE NOTICE 'Skipped % (table not present in this project)', target_table;
    END IF;
  END LOOP;
END $$;

-- Post-condition report. Any row with rls_enabled = false on a granted table
-- means a leak: it must be enabled + given a workspace-scoped policy before
-- the grant is allowed to stand.
SELECT
  c.relname                AS table_name,
  c.relrowsecurity         AS rls_enabled,
  c.relforcerowsecurity    AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'notifications','todos','reminders','software_licenses',
    'workspace_system_actors','workspace_system_actor_permissions',
    'bank_accounts','bank_statement_imports','bank_transactions',
    'transaction_annotations','transaction_project_allocations',
    'transaction_links','counterparty_rules',
    'currency_settings','exchange_rates',
    'quotes','quote_items','quote_versions',
    'invoices','invoice_items','invoice_payments',
    'financial_entries',
    'collaborator_fees','collaborator_payment_batches','collaborator_fee_payments'
  )
ORDER BY rls_enabled, c.relname;
