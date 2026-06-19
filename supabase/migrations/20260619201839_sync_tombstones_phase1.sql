CREATE TABLE IF NOT EXISTS public.sync_tombstones (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  entity_id text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  cursor_key text GENERATED ALWAYS AS (table_name || ':' || entity_id) STORED,
  PRIMARY KEY (workspace_id, table_name, entity_id)
);

CREATE INDEX IF NOT EXISTS sync_tombstones_workspace_deleted_idx
  ON public.sync_tombstones (workspace_id, deleted_at, cursor_key);

ALTER TABLE public.sync_tombstones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can read workspace sync tombstones"
  ON public.sync_tombstones
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

GRANT SELECT ON public.sync_tombstones TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sync_tombstones FROM anon, authenticated;

-- Tombstones are written by trusted database triggers only. Clients cannot
-- forge a deletion marker for data they were not authorized to delete.
CREATE OR REPLACE FUNCTION public.record_sync_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD);
  workspace_value text := old_row ->> 'workspace_id';
  entity_value text := old_row ->> TG_ARGV[0];
BEGIN
  IF workspace_value IS NOT NULL AND entity_value IS NOT NULL THEN
    INSERT INTO public.sync_tombstones (workspace_id, table_name, entity_id, deleted_at)
    VALUES (workspace_value::uuid, TG_TABLE_NAME, entity_value, now())
    ON CONFLICT (workspace_id, table_name, entity_id)
    DO UPDATE SET deleted_at = EXCLUDED.deleted_at;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.record_sync_tombstone() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('asset_categories', 'id'),
      ('locations', 'id'),
      ('clients', 'id'),
      ('manufacturers', 'id'),
      ('production_companies', 'id'),
      ('crew_members', 'id'),
      ('departments', 'id'),
      ('bank_accounts', 'id'),
      ('bank_statement_imports', 'id'),
      ('bank_transactions', 'id'),
      ('transaction_annotations', 'transaction_id'),
      ('transaction_project_allocations', 'id'),
      ('transaction_links', 'id'),
      ('counterparty_rules', 'id'),
      ('collaborator_fees', 'id'),
      ('collaborator_payment_batches', 'id'),
      ('collaborator_fee_payments', 'id'),
      ('quotes', 'id'),
      ('quote_items', 'id'),
      ('quote_versions', 'id'),
      ('invoices', 'id'),
      ('invoice_items', 'id'),
      ('invoice_payments', 'id'),
      ('invoice_extractions', 'id'),
      ('invoice_extraction_projects', 'id'),
      ('financial_entries', 'id'),
      ('software_licenses', 'id')
    ) AS synced_table(table_name, id_column)
    WHERE to_regclass('public.' || synced_table.table_name) IS NOT NULL
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS record_sync_tombstone_after_delete ON public.%I', target.table_name);
    EXECUTE format(
      'CREATE TRIGGER record_sync_tombstone_after_delete AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.record_sync_tombstone(%L)',
      target.table_name,
      target.id_column
    );
  END LOOP;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sync_tombstones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_tombstones;
  END IF;
END
$$;

-- Tables introduced after the original publication sweep must be explicit.
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['crew_members', 'departments']
  LOOP
    IF to_regclass('public.' || target) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = target
      )
    THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target);
    END IF;
  END LOOP;
END
$$;
