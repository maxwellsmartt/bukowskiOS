-- Shared sync ordering must not trust a workstation clock. Mutable rows receive
-- their ordering timestamp when Postgres accepts the write; append-only rows
-- receive their creation cursor on insert. Business timestamps such as
-- event_timestamp, paid_at and effective_date remain untouched.

CREATE OR REPLACE FUNCTION public.stamp_sync_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.stamp_sync_created_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
  ELSE
    NEW.created_at := statement_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_sync_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_sync_created_at() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  updated_tables CONSTANT text[] := ARRAY[
    'asset_categories', 'locations', 'clients', 'manufacturers',
    'production_companies', 'crew_members', 'departments', 'assets',
    'asset_current_state', 'operational_snapshots', 'bank_accounts',
    'transaction_annotations', 'transaction_project_allocations',
    'transaction_links', 'counterparty_rules', 'collaborator_fees',
    'currency_settings', 'quotes', 'quote_items', 'invoices', 'invoice_items',
    'invoice_extractions', 'financial_entries', 'software_licenses', 'agents',
    'ai_provider_configs', 'agent_connector_configs', 'notifications', 'todos',
    'sync_outbox'
  ];
  created_tables CONSTANT text[] := ARRAY[
    'bank_statement_imports', 'bank_transactions', 'collaborator_payment_batches',
    'collaborator_fee_payments', 'quote_versions', 'invoice_payments',
    'invoice_extraction_projects', 'exchange_rates', 'reminders', 'asset_events'
  ];
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY updated_tables
  LOOP
    IF to_regclass(format('%I.%I', 'public', target_table)) IS NULL OR NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target_table
        AND column_name = 'updated_at'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS stamp_sync_updated_at_before_write ON %I.%I', 'public', target_table);
    EXECUTE format(
      'CREATE TRIGGER stamp_sync_updated_at_before_write BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.stamp_sync_updated_at()',
      'public', target_table
    );
    EXECUTE format(
      'UPDATE %I.%I SET updated_at = statement_timestamp() WHERE updated_at > statement_timestamp() + interval ''5 minutes''',
      'public', target_table
    );
  END LOOP;

  FOREACH target_table IN ARRAY created_tables
  LOOP
    IF to_regclass(format('%I.%I', 'public', target_table)) IS NULL OR NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target_table
        AND column_name = 'created_at'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS stamp_sync_created_at_before_write ON %I.%I', 'public', target_table);
    EXECUTE format(
      'UPDATE %I.%I SET created_at = statement_timestamp() WHERE created_at > statement_timestamp() + interval ''5 minutes''',
      'public', target_table
    );
    EXECUTE format(
      'CREATE TRIGGER stamp_sync_created_at_before_write BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.stamp_sync_created_at()',
      'public', target_table
    );
  END LOOP;
END
$$;
