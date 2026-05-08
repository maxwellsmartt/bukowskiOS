import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Json } from "@bukowski/supabase-client";
import type { AgentNotificationIntent, NotificationRow, ReminderRow, TodoRow } from "@contracts";

import { useToast } from "./ToastProvider";
import { useSession } from "./SessionProvider";
import { useWorkspace } from "./WorkspaceProvider";

type NotificationInsertInput = {
  kind?: string;
  title: string;
  body?: string | null;
  linkTo?: string | null;
  sourceType?: string | null;
  sourceRef?: Json | null;
  notifyNow?: boolean;
};

type TodoInsertInput = {
  title: string;
  notes?: string | null;
  dueAt?: string | null;
  priority?: number;
  createdBy?: "user" | "agent";
  agentActionRef?: Json | null;
};

type TodoUpdateInput = {
  id: string;
  title: string;
  notes?: string | null;
  dueAt?: string | null;
  priority?: number;
};

type ReminderInsertInput = {
  title: string;
  body?: string | null;
  remindAt: string;
  recurrenceRule?: string | null;
  createdBy?: "user" | "agent";
};

type ReminderUpdateInput = {
  id: string;
  title: string;
  body?: string | null;
  remindAt: string;
  recurrenceRule?: string | null;
};

type NotificationsContextValue = {
  items: NotificationRow[];
  todos: TodoRow[];
  reminders: ReminderRow[];
  unreadCount: number;
  isLoading: boolean;
  isTrayOpen: boolean;
  trayAnchor: DOMRect | null;
  openTray: () => void;
  closeTray: () => void;
  toggleTray: (anchor?: DOMRect | null) => void;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  createNotification: (input: NotificationInsertInput) => Promise<NotificationRow | null>;
  createTodo: (input: TodoInsertInput) => Promise<TodoRow | null>;
  updateTodo: (input: TodoUpdateInput) => Promise<void>;
  deleteTodo: (todoId: string) => Promise<void>;
  createReminder: (input: ReminderInsertInput) => Promise<ReminderRow | null>;
  updateReminder: (input: ReminderUpdateInput) => Promise<void>;
  deleteReminder: (reminderId: string) => Promise<void>;
  markTodoDone: (todoId: string) => Promise<void>;
  markReminderDone: (reminderId: string) => Promise<void>;
  snoozeReminder: (reminderId: string, minutes: number) => Promise<void>;
  applyAgentNotificationIntents: (intents: AgentNotificationIntent[], threadId: string) => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const maxTrayItems = 80;

const toNotificationRow = (row: {
  id: string;
  user_id: string;
  workspace_id: string;
  kind: string;
  title: string;
  body: string | null;
  source_type: string | null;
  source_ref: Json | null;
  link_to: string | null;
  read_at: string | null;
  created_at: string;
}): NotificationRow => ({
  id: row.id,
  userId: row.user_id,
  workspaceId: row.workspace_id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  sourceType: row.source_type,
  sourceRef: row.source_ref,
  linkTo: row.link_to,
  readAt: row.read_at,
  createdAt: row.created_at,
});

const toTodoRow = (row: {
  id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  priority: number;
  completed_at: string | null;
  created_by: "user" | "agent";
  agent_action_ref: Json | null;
  created_at: string;
  updated_at: string;
}): TodoRow => ({
  id: row.id,
  userId: row.user_id,
  workspaceId: row.workspace_id,
  title: row.title,
  notes: row.notes,
  dueAt: row.due_at,
  priority: row.priority,
  completedAt: row.completed_at,
  createdBy: row.created_by,
  agentActionRef: row.agent_action_ref,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toReminderRow = (row: {
  id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  body: string | null;
  remind_at: string;
  recurrence_rule: string | null;
  snoozed_until: string | null;
  completed_at: string | null;
  created_by: "user" | "agent";
  created_at: string;
}): ReminderRow => ({
  id: row.id,
  userId: row.user_id,
  workspaceId: row.workspace_id,
  title: row.title,
  body: row.body,
  remindAt: row.remind_at,
  recurrenceRule: row.recurrence_rule,
  snoozedUntil: row.snoozed_until,
  completedAt: row.completed_at,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const sortNotifications = (rows: NotificationRow[]) =>
  [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, maxTrayItems);

const isRecentSelfEcho = (row: NotificationRow, seenIds: Set<string>) => seenIds.has(row.id);
const reminderPollMs = 30_000;
const notificationRefreshMs = 20_000;
const parseBasicRecurrenceNext = (rule: string | null, current: string) => {
  if (!rule) {
    return null;
  }

  const next = new Date(current);
  if (!Number.isFinite(next.getTime())) {
    return null;
  }

  const normalized = rule.toUpperCase();
  if (normalized.includes("FREQ=DAILY")) {
    next.setUTCDate(next.getUTCDate() + 1);
  } else if (normalized.includes("FREQ=WEEKLY")) {
    next.setUTCDate(next.getUTCDate() + 7);
  } else if (normalized.includes("FREQ=MONTHLY")) {
    next.setUTCMonth(next.getUTCMonth() + 1);
  } else {
    return null;
  }

  return next.toISOString();
};

const asLooseSupabase = (supabase: NonNullable<ReturnType<typeof useSession>["supabase"]>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase as any;

export const NotificationsProvider = ({ children }: { children: ReactNode }) => {
  const { status, user, supabase } = useSession();
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const toast = useToast();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isTrayOpen, setTrayOpen] = useState(false);
  const [trayAnchor, setTrayAnchor] = useState<DOMRect | null>(null);
  const seenIdsRef = useRef(new Set<string>());
  const firedReminderIdsRef = useRef(new Set<string>());
  const activeUserId = user?.id ?? null;
  const canUseRemote = Boolean(supabase && activeUserId && activeWorkspaceId && isWorkspaceReady && status === "authenticated");

  const unreadCount = useMemo(() => items.filter((item) => !item.readAt).length, [items]);

  const showNewNotification = useCallback(
    async (row: NotificationRow) => {
      toast.info(row.title, row.body ?? undefined);

      const foregroundState = await window.bukowskiNotifications?.getForegroundState().catch(() => ({ isForeground: true }));
      const shouldUseNative = !foregroundState?.isForeground || !document.hasFocus();

      if (shouldUseNative) {
        await window.bukowskiNotifications?.showNative({
          id: row.id,
          title: row.title,
          body: row.body,
          linkTo: row.linkTo,
        }).catch(() => undefined);
      }
    },
    [toast],
  );

  useEffect(() => {
    void window.bukowskiNotifications?.setDockBadge(unreadCount).catch(() => undefined);
  }, [unreadCount]);

  const refreshNotifications = useCallback(async () => {
    if (!canUseRemote || !supabase || !activeUserId || !activeWorkspaceId) {
      return;
    }

    const looseSupabase = asLooseSupabase(supabase);
    const { data } = await looseSupabase
      .from("notifications")
      .select("id,user_id,workspace_id,kind,title,body,source_type,source_ref,link_to,read_at,created_at")
      .eq("user_id", activeUserId)
      .eq("workspace_id", activeWorkspaceId)
      .order("created_at", { ascending: false })
      .limit(maxTrayItems);

    const nextItems = ((data ?? []) as Parameters<typeof toNotificationRow>[0][]).map(toNotificationRow);
    nextItems.forEach((item) => seenIdsRef.current.add(item.id));
    setItems(nextItems);
  }, [activeUserId, activeWorkspaceId, canUseRemote, supabase]);

  const refreshPersonalWork = useCallback(async () => {
    if (!canUseRemote || !supabase || !activeUserId || !activeWorkspaceId) {
      return;
    }

    const looseSupabase = asLooseSupabase(supabase);
    const [todosResult, remindersResult] = await Promise.all([
      looseSupabase
        .from("todos")
        .select("id,user_id,workspace_id,title,notes,due_at,priority,completed_at,created_by,agent_action_ref,created_at,updated_at")
        .eq("user_id", activeUserId)
        .eq("workspace_id", activeWorkspaceId)
        .order("created_at", { ascending: false })
        .limit(80),
      looseSupabase
        .from("reminders")
        .select("id,user_id,workspace_id,title,body,remind_at,recurrence_rule,snoozed_until,completed_at,created_by,created_at")
        .eq("user_id", activeUserId)
        .eq("workspace_id", activeWorkspaceId)
        .order("remind_at", { ascending: true })
        .limit(80),
    ]);

    setTodos(((todosResult.data ?? []) as Parameters<typeof toTodoRow>[0][]).map(toTodoRow));
    setReminders(((remindersResult.data ?? []) as Parameters<typeof toReminderRow>[0][]).map(toReminderRow));
  }, [activeUserId, activeWorkspaceId, canUseRemote, supabase]);

  useEffect(() => {
    if (!canUseRemote || !supabase || !activeUserId || !activeWorkspaceId) {
      setItems([]);
      setTodos([]);
      setReminders([]);
      setIsLoading(false);
      seenIdsRef.current.clear();
      firedReminderIdsRef.current.clear();
      return undefined;
    }

    let isMounted = true;
    setIsLoading(true);

    void Promise.all([refreshNotifications(), refreshPersonalWork()])
      .then(() => {
        if (!isMounted) return;
        setIsLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setIsLoading(false);
      });

    const channel = supabase
      .channel(`notifications:${activeUserId}:${activeWorkspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${activeUserId}`,
        },
        (payload) => {
          const nextRow = toNotificationRow(payload.new as Parameters<typeof toNotificationRow>[0]);
          if (nextRow.workspaceId !== activeWorkspaceId) {
            return;
          }

          const alreadySeen = isRecentSelfEcho(nextRow, seenIdsRef.current);
          seenIdsRef.current.add(nextRow.id);
          setItems((current) => sortNotifications([nextRow, ...current.filter((item) => item.id !== nextRow.id)]));

          if (!alreadySeen) {
            void showNewNotification(nextRow);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${activeUserId}`,
        },
        (payload) => {
          const nextRow = toNotificationRow(payload.new as Parameters<typeof toNotificationRow>[0]);
          if (nextRow.workspaceId !== activeWorkspaceId) {
            return;
          }
          seenIdsRef.current.add(nextRow.id);
          setItems((current) => sortNotifications(current.map((item) => (item.id === nextRow.id ? nextRow : item))));
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      void Promise.resolve(supabase.removeChannel(channel));
    };
  }, [activeUserId, activeWorkspaceId, canUseRemote, refreshNotifications, refreshPersonalWork, showNewNotification, supabase]);

  useEffect(() => {
    if (!canUseRemote) {
      return undefined;
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshNotifications().catch(() => undefined);
        void refreshPersonalWork().catch(() => undefined);
      }
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshNotifications().catch(() => undefined);
        void refreshPersonalWork().catch(() => undefined);
      }
    }, notificationRefreshMs);

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [canUseRemote, refreshNotifications, refreshPersonalWork]);

  const markRead = useCallback(
    async (notificationId: string) => {
      if (!supabase) return;
      const looseSupabase = asLooseSupabase(supabase);
      const readAt = new Date().toISOString();
      setItems((current) => current.map((item) => (item.id === notificationId ? { ...item, readAt } : item)));
      await looseSupabase.from("notifications").update({ read_at: readAt }).eq("id", notificationId);
    },
    [supabase],
  );

  const markAllRead = useCallback(async () => {
    if (!supabase || !activeUserId || !activeWorkspaceId) return;
    const looseSupabase = asLooseSupabase(supabase);
    const readAt = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
    await looseSupabase
      .from("notifications")
      .update({ read_at: readAt })
      .eq("user_id", activeUserId)
      .eq("workspace_id", activeWorkspaceId)
      .is("read_at", null);
  }, [activeUserId, activeWorkspaceId, supabase]);

  const createNotification = useCallback(
    async (input: NotificationInsertInput) => {
      if (!supabase || !activeUserId || !activeWorkspaceId) {
        return null;
      }

      const looseSupabase = asLooseSupabase(supabase);
      const { data, error } = await looseSupabase
        .from("notifications")
        .insert({
          user_id: activeUserId,
          workspace_id: activeWorkspaceId,
          kind: input.kind ?? "system",
          title: input.title,
          body: input.body ?? null,
          link_to: input.linkTo ?? null,
          source_type: input.sourceType ?? "user",
          source_ref: input.sourceRef ?? null,
        })
        .select("id,user_id,workspace_id,kind,title,body,source_type,source_ref,link_to,read_at,created_at")
        .single();

      if (error || !data) {
        throw error ?? new Error("Notification was not created.");
      }

      const row = toNotificationRow(data as Parameters<typeof toNotificationRow>[0]);
      seenIdsRef.current.add(row.id);
      setItems((current) => sortNotifications([row, ...current.filter((item) => item.id !== row.id)]));
      if (input.notifyNow) {
        void showNewNotification(row);
      }
      return row;
    },
    [activeUserId, activeWorkspaceId, showNewNotification, supabase],
  );

  const createTodo = useCallback(
    async (input: TodoInsertInput) => {
      if (!supabase || !activeUserId || !activeWorkspaceId) {
        return null;
      }

      const looseSupabase = asLooseSupabase(supabase);
      const { data, error } = await looseSupabase
        .from("todos")
        .insert({
          user_id: activeUserId,
          workspace_id: activeWorkspaceId,
          title: input.title,
          notes: input.notes ?? null,
          due_at: input.dueAt ?? null,
          priority: Math.max(0, Math.min(3, Math.floor(input.priority ?? 0))),
          created_by: input.createdBy ?? "user",
          agent_action_ref: input.agentActionRef ?? null,
        })
        .select("id,user_id,workspace_id,title,notes,due_at,priority,completed_at,created_by,agent_action_ref,created_at,updated_at")
        .single();

      if (error || !data) {
        throw error ?? new Error("Todo was not created.");
      }

      const row = toTodoRow(data as Parameters<typeof toTodoRow>[0]);
      setTodos((current) => [row, ...current.filter((item) => item.id !== row.id)].slice(0, 80));
      return row;
    },
    [activeUserId, activeWorkspaceId, supabase],
  );

  const createReminder = useCallback(
    async (input: ReminderInsertInput) => {
      if (!supabase || !activeUserId || !activeWorkspaceId) {
        return null;
      }

      const remindAt = new Date(input.remindAt);
      if (!Number.isFinite(remindAt.getTime())) {
        throw new Error("Reminder time is invalid.");
      }

      const looseSupabase = asLooseSupabase(supabase);
      const { data, error } = await looseSupabase
        .from("reminders")
        .insert({
          user_id: activeUserId,
          workspace_id: activeWorkspaceId,
          title: input.title,
          body: input.body ?? null,
          remind_at: remindAt.toISOString(),
          recurrence_rule: input.recurrenceRule ?? null,
          created_by: input.createdBy ?? "user",
        })
        .select("id,user_id,workspace_id,title,body,remind_at,recurrence_rule,snoozed_until,completed_at,created_by,created_at")
        .single();

      if (error || !data) {
        throw error ?? new Error("Reminder was not created.");
      }

      const row = toReminderRow(data as Parameters<typeof toReminderRow>[0]);
      setReminders((current) =>
        [row, ...current.filter((item) => item.id !== row.id)]
          .sort((left, right) => new Date(left.remindAt).getTime() - new Date(right.remindAt).getTime())
          .slice(0, 80),
      );
      return row;
    },
    [activeUserId, activeWorkspaceId, supabase],
  );

  const updateTodo = useCallback(
    async (input: TodoUpdateInput) => {
      if (!supabase) return;
      const priority = Math.max(0, Math.min(3, Math.floor(input.priority ?? 0)));
      const updatedAt = new Date().toISOString();
      setTodos((current) =>
        current.map((item) =>
          item.id === input.id
            ? {
                ...item,
                title: input.title,
                notes: input.notes ?? null,
                dueAt: input.dueAt ?? null,
                priority,
                updatedAt,
              }
            : item,
        ),
      );
      await asLooseSupabase(supabase)
        .from("todos")
        .update({
          title: input.title,
          notes: input.notes ?? null,
          due_at: input.dueAt ?? null,
          priority,
          updated_at: updatedAt,
        })
        .eq("id", input.id);
    },
    [supabase],
  );

  const deleteTodo = useCallback(
    async (todoId: string) => {
      if (!supabase) return;
      setTodos((current) => current.filter((item) => item.id !== todoId));
      await asLooseSupabase(supabase).from("todos").delete().eq("id", todoId);
    },
    [supabase],
  );

  const updateReminder = useCallback(
    async (input: ReminderUpdateInput) => {
      if (!supabase) return;
      const remindAt = new Date(input.remindAt);
      if (!Number.isFinite(remindAt.getTime())) {
        throw new Error("Reminder time is invalid.");
      }
      const nextRemindAt = remindAt.toISOString();
      setReminders((current) =>
        current.map((item) =>
          item.id === input.id
            ? {
                ...item,
                title: input.title,
                body: input.body ?? null,
                remindAt: nextRemindAt,
                recurrenceRule: input.recurrenceRule ?? null,
                snoozedUntil: null,
                completedAt: null,
              }
            : item,
        ),
      );
      firedReminderIdsRef.current.delete(input.id);
      await asLooseSupabase(supabase)
        .from("reminders")
        .update({
          title: input.title,
          body: input.body ?? null,
          remind_at: nextRemindAt,
          recurrence_rule: input.recurrenceRule ?? null,
          snoozed_until: null,
          completed_at: null,
        })
        .eq("id", input.id);
    },
    [supabase],
  );

  const deleteReminder = useCallback(
    async (reminderId: string) => {
      if (!supabase) return;
      setReminders((current) => current.filter((item) => item.id !== reminderId));
      firedReminderIdsRef.current.delete(reminderId);
      await asLooseSupabase(supabase).from("reminders").delete().eq("id", reminderId);
    },
    [supabase],
  );

  const markTodoDone = useCallback(
    async (todoId: string) => {
      if (!supabase) return;
      const completedAt = new Date().toISOString();
      setTodos((current) => current.map((item) => (item.id === todoId ? { ...item, completedAt } : item)));
      await asLooseSupabase(supabase).from("todos").update({ completed_at: completedAt }).eq("id", todoId);
    },
    [supabase],
  );

  const markReminderDone = useCallback(
    async (reminderId: string) => {
      if (!supabase) return;
      const completedAt = new Date().toISOString();
      setReminders((current) => current.map((item) => (item.id === reminderId ? { ...item, completedAt } : item)));
      await asLooseSupabase(supabase).from("reminders").update({ completed_at: completedAt }).eq("id", reminderId);
    },
    [supabase],
  );

  const snoozeReminder = useCallback(
    async (reminderId: string, minutes: number) => {
      if (!supabase) return;
      const snoozedUntil = new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString();
      setReminders((current) => current.map((item) => (item.id === reminderId ? { ...item, snoozedUntil, completedAt: null } : item)));
      firedReminderIdsRef.current.delete(reminderId);
      await asLooseSupabase(supabase)
        .from("reminders")
        .update({ snoozed_until: snoozedUntil, completed_at: null })
        .eq("id", reminderId);
    },
    [supabase],
  );

  const applyAgentNotificationIntents = useCallback(
    async (intents: AgentNotificationIntent[], threadId: string) => {
      for (const intent of intents) {
        if (intent.type === "create_notification") {
          await createNotification({
            kind: intent.kind ?? "operation",
            title: intent.title,
            body: intent.body ?? null,
            linkTo: intent.linkTo ?? null,
            sourceType: "agent",
            sourceRef: {
              threadId,
              ...(typeof intent.sourceRef === "object" && intent.sourceRef && !Array.isArray(intent.sourceRef) ? intent.sourceRef : {}),
            },
            notifyNow: intent.notifyNow ?? true,
          });
        } else if (intent.type === "create_todo") {
          const todo = await createTodo({
            title: intent.title,
            notes: intent.notes ?? null,
            dueAt: intent.dueAt ?? null,
            priority: intent.priority ?? 0,
            createdBy: "agent",
            agentActionRef: {
              threadId,
              ...(typeof intent.sourceRef === "object" && intent.sourceRef && !Array.isArray(intent.sourceRef) ? intent.sourceRef : {}),
            },
          });
          if (todo) {
            await createNotification({
              kind: "operation",
              title: "Todo added",
              body: todo.title,
              linkTo: "/inbox",
              sourceType: "agent",
              sourceRef: { threadId, todoId: todo.id },
              notifyNow: false,
            });
          }
        } else if (intent.type === "create_reminder") {
          const reminder = await createReminder({
            title: intent.title,
            body: intent.body ?? null,
            remindAt: intent.remindAt,
            recurrenceRule: intent.recurrenceRule ?? null,
            createdBy: "agent",
          });
          if (reminder) {
            await createNotification({
              kind: "operation",
              title: "Reminder scheduled",
              body: reminder.title,
              linkTo: "/inbox",
              sourceType: "agent",
              sourceRef: { threadId, reminderId: reminder.id },
              notifyNow: false,
            });
          }
        }
      }
    },
    [createNotification, createReminder, createTodo],
  );

  useEffect(() => {
    if (!canUseRemote || !supabase || !activeUserId || !activeWorkspaceId) {
      return undefined;
    }

    const looseSupabase = asLooseSupabase(supabase);

    const runReminderPoll = async () => {
      const now = new Date().toISOString();
      const { data } = await looseSupabase
        .from("reminders")
        .select("id,user_id,workspace_id,title,body,remind_at,recurrence_rule,snoozed_until,completed_at,created_by,created_at")
        .eq("user_id", activeUserId)
        .eq("workspace_id", activeWorkspaceId)
        .is("completed_at", null)
        .lte("remind_at", now)
        .order("remind_at", { ascending: true })
        .limit(20);

      const dueReminders = ((data ?? []) as Parameters<typeof toReminderRow>[0][])
        .map(toReminderRow)
        .filter((reminder) => !reminder.snoozedUntil || reminder.snoozedUntil <= now)
        .slice(0, 10);
      for (const reminder of dueReminders) {
        if (firedReminderIdsRef.current.has(reminder.id)) {
          continue;
        }

        firedReminderIdsRef.current.add(reminder.id);
        await createNotification({
          kind: "reminder",
          title: reminder.title,
          body: reminder.body,
          linkTo: "/inbox",
          sourceType: "reminder",
          sourceRef: { reminderId: reminder.id },
          notifyNow: false,
        }).then((notification) => {
          void window.bukowskiNotifications?.showNative({
            id: notification?.id ?? reminder.id,
            title: reminder.title,
            body: reminder.body,
            linkTo: "/inbox",
            reminderId: reminder.id,
            actions: ["mark_done", "snooze_15m"],
          }).catch(() => undefined);
        }).catch(() => undefined);

        const nextRemindAt = parseBasicRecurrenceNext(reminder.recurrenceRule, reminder.remindAt);
        if (nextRemindAt) {
          await looseSupabase
            .from("reminders")
            .update({ remind_at: nextRemindAt, snoozed_until: null })
            .eq("id", reminder.id)
            .catch(() => undefined);
          setReminders((current) =>
            current.map((item) => (item.id === reminder.id ? { ...item, remindAt: nextRemindAt, snoozedUntil: null } : item)),
          );
          firedReminderIdsRef.current.delete(reminder.id);
        } else {
          const completedAt = new Date().toISOString();
          await looseSupabase
            .from("reminders")
            .update({ completed_at: completedAt })
            .eq("id", reminder.id)
            .catch(() => undefined);
          setReminders((current) => current.map((item) => (item.id === reminder.id ? { ...item, completedAt } : item)));
        }
      }
    };

    void runReminderPoll().catch(() => undefined);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void runReminderPoll().catch(() => undefined);
      }
    }, reminderPollMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [activeUserId, activeWorkspaceId, canUseRemote, createNotification, supabase]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      items,
      todos,
      reminders,
      unreadCount,
      isLoading,
      isTrayOpen,
      trayAnchor,
      openTray: () => setTrayOpen(true),
      closeTray: () => setTrayOpen(false),
      toggleTray: (anchor) => {
        if (anchor) {
          setTrayAnchor(anchor);
        }
        setTrayOpen((current) => !current);
      },
      markRead,
      markAllRead,
      createNotification,
      createTodo,
      updateTodo,
      deleteTodo,
      createReminder,
      updateReminder,
      deleteReminder,
      markTodoDone,
      markReminderDone,
      snoozeReminder,
      applyAgentNotificationIntents,
    }),
    [
      applyAgentNotificationIntents,
      createNotification,
      createReminder,
      createTodo,
      deleteReminder,
      deleteTodo,
      isLoading,
      isTrayOpen,
      items,
      markAllRead,
      markRead,
      markReminderDone,
      markTodoDone,
      reminders,
      snoozeReminder,
      trayAnchor,
      todos,
      unreadCount,
      updateReminder,
      updateTodo,
    ],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = () => {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationsProvider.");
  }
  return context;
};
