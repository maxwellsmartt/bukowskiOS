ALTER TABLE public.software_licenses
  ADD COLUMN IF NOT EXISTS vendor text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS license_type text NOT NULL DEFAULT 'subscription',
  ADD COLUMN IF NOT EXISTS seat_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS seat_assignments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS license_key text,
  ADD COLUMN IF NOT EXISTS account_email text,
  ADD COLUMN IF NOT EXISTS starts_at date,
  ADD COLUMN IF NOT EXISTS expires_at date,
  ADD COLUMN IF NOT EXISTS renewal_url text,
  ADD COLUMN IF NOT EXISTS payment_url text,
  ADD COLUMN IF NOT EXISTS invoice_url text,
  ADD COLUMN IF NOT EXISTS reminder_days_before integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.software_licenses
  ALTER COLUMN seat_assignments SET DEFAULT '[]'::jsonb,
  ALTER COLUMN reminder_days_before SET DEFAULT 0;

UPDATE public.software_licenses
SET seat_assignments = '[]'::jsonb
WHERE seat_assignments IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.software_licenses TO authenticated;

NOTIFY pgrst, 'reload schema';
