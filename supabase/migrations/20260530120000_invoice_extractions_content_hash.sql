-- 20260530120000 — Invoice content hash for cross-machine dedupe (I3a).
--
-- sha256 of the uploaded file bytes. Lets the app detect the same invoice
-- uploaded from two machines (which otherwise produced two rows that both
-- synced) and prompt the user to resolve. Synced like the rest of the row.

ALTER TABLE public.invoice_extractions
  ADD COLUMN IF NOT EXISTS content_hash text;

CREATE INDEX IF NOT EXISTS idx_invoice_extractions_content_hash
  ON public.invoice_extractions(workspace_id, content_hash);
