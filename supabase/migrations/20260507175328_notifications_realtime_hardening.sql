CREATE INDEX IF NOT EXISTS notifications_user_workspace_created_idx
  ON public.notifications (user_id, workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_workspace_unread_idx
  ON public.notifications (user_id, workspace_id)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS todos_user_workspace_due_idx
  ON public.todos (user_id, workspace_id, due_at)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS reminders_user_workspace_due_idx
  ON public.reminders (user_id, workspace_id, remind_at)
  WHERE completed_at IS NULL;

DROP POLICY IF EXISTS "users can insert own notifications" ON public.notifications;
CREATE POLICY "users can insert own notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.todos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
