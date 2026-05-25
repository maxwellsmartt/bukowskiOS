-- Migration 0024: Treasury fiscal capture fields for Dominican deductible reporting.
--
-- These columns keep the imported bank row immutable while letting Jeannette
-- capture the fiscal data Carlos must provide for future 606-style reporting.

ALTER TABLE transaction_annotations ADD COLUMN supplier_ncf TEXT;
ALTER TABLE transaction_annotations ADD COLUMN dgii_expense_type TEXT;
ALTER TABLE transaction_annotations ADD COLUMN withholding_type TEXT;
ALTER TABLE transaction_annotations ADD COLUMN withholding_rate REAL;
ALTER TABLE transaction_annotations ADD COLUMN withholding_amount REAL;
ALTER TABLE transaction_annotations ADD COLUMN fiscal_period TEXT;

CREATE INDEX IF NOT EXISTS idx_txn_annotations_fiscal_period
  ON transaction_annotations(workspace_id, fiscal_period);
