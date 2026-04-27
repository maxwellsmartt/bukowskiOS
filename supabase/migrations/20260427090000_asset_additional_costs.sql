ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS additional_costs numeric;
