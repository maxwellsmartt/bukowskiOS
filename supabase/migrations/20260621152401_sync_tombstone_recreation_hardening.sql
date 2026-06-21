-- A recreated row is newer than its prior delete marker. Clear that marker in
-- the same transaction so another device cannot consume a stale tombstone.
CREATE OR REPLACE FUNCTION public.clear_sync_tombstone_on_recreation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_row jsonb := to_jsonb(NEW);
  workspace_value text := new_row ->> 'workspace_id';
  entity_value text := new_row ->> TG_ARGV[0];
BEGIN
  IF workspace_value IS NOT NULL AND entity_value IS NOT NULL THEN
    DELETE FROM public.sync_tombstones
    WHERE workspace_id = workspace_value::uuid
      AND table_name = TG_TABLE_NAME
      AND entity_id = entity_value;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_sync_tombstone_on_recreation() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target_tables CONSTANT text[] := ARRAY[
    'asset_categories', 'locations', 'clients', 'manufacturers',
    'production_companies', 'crew_members', 'departments', 'bank_accounts',
    'bank_statement_imports', 'bank_transactions', 'transaction_annotations',
    'transaction_project_allocations', 'transaction_links', 'counterparty_rules',
    'collaborator_fees', 'collaborator_payment_batches', 'collaborator_fee_payments',
    'quotes', 'quote_items', 'quote_versions', 'invoices', 'invoice_items',
    'invoice_payments', 'invoice_extractions', 'invoice_extraction_projects',
    'financial_entries', 'software_licenses', 'exchange_rates', 'todos', 'reminders'
  ];
  id_columns CONSTANT text[] := ARRAY[
    'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id',
    'transaction_id', 'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id',
    'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id'
  ];
  target_index integer;
  target_table text;
  id_column text;
BEGIN
  FOR target_index IN array_lower(target_tables, 1)..array_upper(target_tables, 1)
  LOOP
    target_table := target_tables[target_index];
    id_column := id_columns[target_index];

    IF to_regclass(format('%I.%I', 'public', target_table)) IS NULL THEN
      CONTINUE;
    END IF;

    -- Reinstall both triggers idempotently. This also extends delete capture to
    -- exchange_rates, todos and reminders.
    EXECUTE format(
      'DROP TRIGGER IF EXISTS record_sync_tombstone_after_delete ON %I.%I',
      'public', target_table
    );
    EXECUTE format(
      'CREATE TRIGGER record_sync_tombstone_after_delete AFTER DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.record_sync_tombstone(%L)',
      'public', target_table, id_column
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS clear_sync_tombstone_after_insert ON %I.%I',
      'public', target_table
    );
    EXECUTE format(
      'CREATE TRIGGER clear_sync_tombstone_after_insert AFTER INSERT ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.clear_sync_tombstone_on_recreation(%L)',
      'public', target_table, id_column
    );

    -- One-shot repair for tombstones left behind before recreation cleanup
    -- existed. Identifiers come only from the constants above and are quoted.
    EXECUTE format(
      'DELETE FROM public.sync_tombstones AS tombstone
       WHERE tombstone.table_name = %L
         AND EXISTS (
           SELECT 1 FROM %I.%I AS live
           WHERE live.workspace_id::text = tombstone.workspace_id::text
             AND live.%I::text = tombstone.entity_id
         )',
      target_table, 'public', target_table, id_column
    );
  END LOOP;
END
$$;
