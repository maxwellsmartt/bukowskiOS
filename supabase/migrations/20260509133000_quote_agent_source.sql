-- Track whether quotes were created directly by a user or by an agent.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS created_by_actor_type text NOT NULL DEFAULT 'user';

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS source_channel text;
