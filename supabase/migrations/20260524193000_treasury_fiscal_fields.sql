ALTER TABLE public.transaction_annotations
  ADD COLUMN IF NOT EXISTS supplier_ncf text,
  ADD COLUMN IF NOT EXISTS dgii_expense_type text,
  ADD COLUMN IF NOT EXISTS withholding_type text,
  ADD COLUMN IF NOT EXISTS withholding_rate numeric(8,4),
  ADD COLUMN IF NOT EXISTS withholding_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS fiscal_period text;

CREATE INDEX IF NOT EXISTS idx_txn_annotations_fiscal_period
  ON public.transaction_annotations(workspace_id, fiscal_period);
