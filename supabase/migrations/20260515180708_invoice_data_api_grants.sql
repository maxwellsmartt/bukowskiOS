-- 20260515180708 — Invoice Data API grants.
--
-- Some Supabase projects require explicit table grants for the PostgREST/Data
-- API even when RLS policies are already defined. Keep this as a separate,
-- idempotent migration so projects that already ran the invoice schema can be
-- repaired without re-running the original DDL.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT SELECT, INSERT ON public.invoice_payments TO authenticated;
