-- 20260528120000 — Invoice Inbox sync (PILAR T iteración 2).
--
-- Mirrors the locally-managed `invoice_extractions` table (created by
-- invoiceInboxService.ensureTable) so expense invoices + their extracted
-- fields sync across machines/users. Adds the multi-project tag join
-- (`invoice_extraction_projects`) and the linked-user column.
--
-- Loose typing on dates/text mirrors the local SQLite shape: OCR output is
-- best-effort, so `invoice_date` stays text (not date) to avoid rejecting
-- partially-extracted rows.

CREATE TABLE IF NOT EXISTS public.invoice_extractions (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  batch_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  original_name text NOT NULL,
  storage_path text,
  storage_object_key text,
  mime_type text NOT NULL,
  byte_size integer NOT NULL DEFAULT 0,
  uploaded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_name text,
  linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_user_name text,
  supplier_name text,
  supplier_rnc text,
  ncf text,
  invoice_date text,
  subtotal numeric(18,2),
  itbis numeric(18,2),
  total numeric(18,2),
  currency text,
  dgii_expense_type text,
  expense_category text,
  confidence numeric(6,4),
  raw_text text,
  suggested_transaction_id text,
  match_confidence numeric(6,4),
  applied_transaction_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_extractions_workspace
  ON public.invoice_extractions(workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.invoice_extraction_projects (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_extraction_id text NOT NULL REFERENCES public.invoice_extractions(id) ON DELETE CASCADE,
  project_id text,
  project_name_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_extraction_projects_extraction
  ON public.invoice_extraction_projects(invoice_extraction_id);

-- RLS ------------------------------------------------------------------------

ALTER TABLE public.invoice_extractions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_extraction_projects  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_extractions_read"   ON public.invoice_extractions;
DROP POLICY IF EXISTS "invoice_extractions_write"  ON public.invoice_extractions;
CREATE POLICY "invoice_extractions_read" ON public.invoice_extractions
  FOR SELECT USING (public.has_permission(workspace_id, 'treasury.transactions.read'));
CREATE POLICY "invoice_extractions_write" ON public.invoice_extractions
  FOR ALL USING (
    public.has_permission(workspace_id, 'treasury.import')
    OR public.has_permission(workspace_id, 'treasury.transactions.classify')
  )
  WITH CHECK (
    public.has_permission(workspace_id, 'treasury.import')
    OR public.has_permission(workspace_id, 'treasury.transactions.classify')
  );

DROP POLICY IF EXISTS "invoice_extraction_projects_read"  ON public.invoice_extraction_projects;
DROP POLICY IF EXISTS "invoice_extraction_projects_write" ON public.invoice_extraction_projects;
CREATE POLICY "invoice_extraction_projects_read" ON public.invoice_extraction_projects
  FOR SELECT USING (public.has_permission(workspace_id, 'treasury.transactions.read'));
CREATE POLICY "invoice_extraction_projects_write" ON public.invoice_extraction_projects
  FOR ALL USING (public.has_permission(workspace_id, 'treasury.transactions.classify'))
  WITH CHECK (public.has_permission(workspace_id, 'treasury.transactions.classify'));

-- Data API grants ------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_extractions         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_extraction_projects TO authenticated;
