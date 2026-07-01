import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Json } from "@bukowski/supabase-client";
import type {
  AgentNotificationIntent,
  NativeNotificationAction,
  NotificationCategory,
  NotificationRow,
  ReminderRow,
  TodoRow,
} from "@contracts";
import { useUserSetting } from "@shared/hooks/useUserSetting";
import {
  defaultNativeNotificationPreferences,
  mergeNativeNotificationPreferences,
  userSettingKeys,
} from "@shared/lib/userSettings";

import { useToast } from "./ToastProvider";
import { useAppUpdate } from "./AppUpdateProvider";
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
  recurrenceRule?: string | null;
  priority?: number;
  createdBy?: "user" | "agent";
  agentActionRef?: Json | null;
};

type TodoUpdateInput = {
  id: string;
  title: string;
  notes?: string | null;
  dueAt?: string | null;
  recurrenceRule?: string | null;
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
  agentUnreadCount: number;
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

// In-session de-dupe sets are capped so a long-running session cannot grow them
// unbounded. Sets preserve insertion order, so we evict the oldest keys first.
const seenIdsCap = 600;
const firedReminderIdsCap = 400;
const processedIntentKeysCap = 600;

const boundedAdd = (set: Set<string>, key: string, cap: number) => {
  set.add(key);
  if (set.size <= cap) {
    return;
  }
  const overflow = set.size - cap;
  let removed = 0;
  for (const value of set) {
    if (removed >= overflow) {
      break;
    }
    set.delete(value);
    removed += 1;
  }
};

const stableAgentIntentKey = (intent: AgentNotificationIntent, threadId: string) => {
  if (intent.type === "create_todo") {
    return ["todo", threadId, intent.title, intent.dueAt ?? "", intent.recurrenceRule ?? "", intent.priority ?? 0].join("|");
  }
  if (intent.type === "create_reminder") {
    return ["reminder", threadId, intent.title, intent.remindAt, intent.recurrenceRule ?? ""].join("|");
  }
  return ["notification", threadId, intent.title, intent.body ?? "", intent.linkTo ?? ""].join("|");
};

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

const isAgentNotification = (row: Pick<NotificationRow, "kind" | "sourceType">) =>
  row.sourceType === "agent" || row.kind === "agent_completion" || row.kind === "agent_approval";

const toTodoRow = (row: {
  id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  recurrence_rule?: string | null;
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
  recurrenceRule: row.recurrence_rule ?? null,
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
const remoteRefreshFailureBackoffMs = 2 * 60 * 1000;
const appUpdateLastNotifiedKey = "bukowski:notifications:last-app-update-notified";
const todoColumnsBase = "id,user_id,workspace_id,title,notes,due_at,priority,completed_at,created_by,agent_action_ref,created_at,updated_at";
const todoColumnsWithRecurrence =
  "id,user_id,workspace_id,title,notes,due_at,recurrence_rule,priority,completed_at,created_by,agent_action_ref,created_at,updated_at";
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
    if (normalized.includes("BYDAY=MO,TU,WE,TH,FR")) {
      while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
        next.setUTCDate(next.getUTCDate() + 1);
      }
    }
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

const isNavigatorOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

const nativeCategoryForNotification = (row: Pick<NotificationRow, "kind" | "sourceRef">): NotificationCategory | null => {
  if (row.kind === "invoice_inbox") return "invoiceInbox";
  if (row.kind === "agent_approval") return "agentsApproval";
  if (row.kind === "agent_completion") return "agentsDone";
  if (row.kind === "exchange_rate") return "exchangeRates";
  if (row.kind === "project") return "projects";
  if (row.kind === "reminder") return "todosReminders";
  if (row.kind === "app_update") return "appUpdates";
  if (
    row.sourceRef &&
    typeof row.sourceRef === "object" &&
    !Array.isArray(row.sourceRef) &&
    "draftRunId" in row.sourceRef
  ) {
    return "agentsApproval";
  }
  return null;
};

export const NotificationsProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation();
  const { status, user, supabase } = useSession();
  const { status: appUpdateStatus } = useAppUpdate();
  const { activeWorkspaceId, isWorkspaceReady } = useWorkspace();
  const toast = useToast();
  const [nativeNotificationSettings] = useUserSetting(userSettingKeys.nativeNotifications);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isTrayOpen, setTrayOpen] = useState(false);
  const [trayAnchor, setTrayAnchor] = useState<DOMRect | null>(null);
  const [isOnline, setIsOnline] = useState(isNavigatorOnline);
  const seenIdsRef = useRef(new Set<string>());
  const firedReminderIdsRef = useRef(new Set<string>());
  const processedAgentIntentKeysRef = useRef(new Set<string>());
  const remotePausedUntilRef = useRef(0);
  const activeUserId = user?.id ?? null;
  const nativePreferences = useMemo(
    () => mergeNativeNotificationPreferences(nativeNotificationSettings ?? defaultNativeNotificationPreferences),
    [nativeNotificationSettings],
  );
  const canUseLocal = Boolean(activeUserId && activeWorkspaceId && isWorkspaceReady && status === "authenticated" && window.bukowskiNotifications);
  const canUseRemote = Boolean(supabase && activeUserId && activeWorkspaceId && isWorkspaceReady && status === "authenticated");

  const unreadCount = useMemo(() => items.filter((item) => !item.readAt).length, [items]);
  const agentUnreadCount = useMemo(
    () => items.filter((item) => !item.readAt && isAgentNotification(item)).length,
    [items],
  );

  const nativeActionLabels = useCallback(
    (actions: NativeNotificationAction[]): Partial<Record<NativeNotificationAction, string>> =>
      Object.fromEntries(actions.map((action) => [action, t(`notifications.nativeActions.${action}`)])),
    [t],
  );

  const canAttemptRemoteRefresh = useCallback(
    () => Boolean(canUseRemote && supabase && isOnline && Date.now() >= remotePausedUntilRef.current),
    [canUseRemote, isOnline, supabase],
  );

  const pauseRemoteAfterFailure = useCallback(() => {
    remotePausedUntilRef.current = Date.now() + remoteRefreshFailureBackoffMs;
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      remotePausedUntilRef.current = 0;
      setIsOnline(true);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setIsOnline(isNavigatorOnline());

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const showNewNotification = useCallback(
    async (row: NotificationRow) => {
      toast.info(row.title, row.body ?? undefined);

      const foregroundState = await window.bukowskiNotifications?.getForegroundState().catch(() => ({ isForeground: true }));
      const shouldUseNative = !foregroundState?.isForeground || !document.hasFocus();
      const category = nativeCategoryForNotification(row);
      const nativeAllowed =
        nativePreferences.enabled && (category == null || nativePreferences.categories[category]);

      if (shouldUseNative && nativeAllowed) {
        const sourceRef =
          row.sourceRef && typeof row.sourceRef === "object" && !Array.isArray(row.sourceRef)
            ? (row.sourceRef as Record<string, unknown>)
            : null;
        const draftRunId = typeof sourceRef?.draftRunId === "string" ? sourceRef.draftRunId : null;
        const actions: NativeNotificationAction[] | undefined =
          draftRunId && nativePreferences.categories.agentsApproval ? ["approve_run"] : undefined;
        await window.bukowskiNotifications?.showNative({
          id: row.id,
          title: row.title,
          body: row.body,
          linkTo: row.linkTo,
          workspaceId: draftRunId ? row.workspaceId : null,
          agentRunId: draftRunId,
          actions,
          actionLabels: actions ? nativeActionLabels(actions) : undefined,
        }).catch(() => undefined);
      }
    },
    [nativeActionLabels, nativePreferences, toast],
  );

  useEffect(() => {
    void window.bukowskiNotifications?.setDockBadge(unreadCount).catch(() => undefined);
  }, [unreadCount]);

  const refreshNotifications = useCallback(async () => {
    if (!canUseLocal || !activeUserId || !activeWorkspaceId) {
      return;
    }

    const localRows = await window.bukowskiNotifications?.list({
      userId: activeUserId,
      workspaceId: activeWorkspaceId,
      limit: maxTrayItems,
    });
    if (localRows) {
      localRows.forEach((item) => boundedAdd(seenIdsRef.current, item.id, seenIdsCap));
      setItems(sortNotifications(localRows));
    }

    if (!canAttemptRemoteRefresh() || !supabase) {
      return;
    }

    try {
      const looseSupabase = asLooseSupabase(supabase);
      const { data } = await looseSupabase
        .from("notifications")
        .select("id,user_id,workspace_id,kind,title,body,source_type,source_ref,link_to,read_at,created_at")
        .eq("user_id", activeUserId)
        .eq("workspace_id", activeWorkspaceId)
        .order("created_at", { ascending: false })
        .limit(maxTrayItems);

      await window.bukowskiNotifications?.applyRemoteRows({
        table: "notifications",
        rows: (data ?? []) as Record<string, unknown>[],
      });
      const nextItems = await window.bukowskiNotifications?.list({
        userId: activeUserId,
        workspaceId: activeWorkspaceId,
        limit: maxTrayItems,
      }) ?? ((data ?? []) as Parameters<typeof toNotificationRow>[0][]).map(toNotificationRow);
      nextItems.forEach((item) => boundedAdd(seenIdsRef.current, item.id, seenIdsCap));
      setItems(sortNotifications(nextItems));
    } catch {
      pauseRemoteAfterFailure();
    }
  }, [activeUserId, activeWorkspaceId, canAttemptRemoteRefresh, canUseLocal, pauseRemoteAfterFailure, supabase]);

  const refreshPersonalWork = useCallback(async () => {
    if (!canUseLocal || !activeUserId || !activeWorkspaceId) {
      return;
    }

    const [localTodos, localReminders] = await Promise.all([
      window.bukowskiNotifications?.listTodos({ userId: activeUserId, workspaceId: activeWorkspaceId, limit: 80 }),
      window.bukowskiNotifications?.listReminders({ userId: activeUserId, workspaceId: activeWorkspaceId, limit: 80 }),
    ]);
    if (localTodos) setTodos(localTodos);
    if (localReminders) setReminders(localReminders);

    if (!canAttemptRemoteRefresh() || !supabase) {
      return;
    }

    try {
      const looseSupabase = asLooseSupabase(supabase);
      const [todosResultWithRecurrence, remindersResult] = await Promise.all([
        looseSupabase
          .from("todos")
          .select(todoColumnsWithRecurrence)
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
      const todosResult = todosResultWithRecurrence.error
        ? await looseSupabase
            .from("todos")
            .select(todoColumnsBase)
            .eq("user_id", activeUserId)
            .eq("workspace_id", activeWorkspaceId)
            .order("created_at", { ascending: false })
            .limit(80)
        : todosResultWithRecurrence;

      await Promise.all([
        window.bukowskiNotifications?.applyRemoteRows({
          table: "todos",
          rows: (todosResult.data ?? []) as Record<string, unknown>[],
        }),
        window.bukowskiNotifications?.applyRemoteRows({
          table: "reminders",
          rows: (remindersResult.data ?? []) as Record<string, unknown>[],
        }),
        window.bukowskiNotifications?.reconcileRemoteRows?.({
          table: "todos",
          userId: activeUserId,
          workspaceId: activeWorkspaceId,
          remoteIds: ((todosResult.data ?? []) as Array<{ id: string }>).map((row) => row.id),
        }),
        window.bukowskiNotifications?.reconcileRemoteRows?.({
          table: "reminders",
          userId: activeUserId,
          workspaceId: activeWorkspaceId,
          remoteIds: ((remindersResult.data ?? []) as Array<{ id: string }>).map((row) => row.id),
        }),
      ]);

      const [nextTodos, nextReminders] = await Promise.all([
        window.bukowskiNotifications?.listTodos({ userId: activeUserId, workspaceId: activeWorkspaceId, limit: 80 }),
        window.bukowskiNotifications?.listReminders({ userId: activeUserId, workspaceId: activeWorkspaceId, limit: 80 }),
      ]);
      setTodos(nextTodos ?? ((todosResult.data ?? []) as Parameters<typeof toTodoRow>[0][]).map(toTodoRow));
      setReminders(nextReminders ?? ((remindersResult.data ?? []) as Parameters<typeof toReminderRow>[0][]).map(toReminderRow));
    } catch {
      pauseRemoteAfterFailure();
    }
  }, [activeUserId, activeWorkspaceId, canAttemptRemoteRefresh, canUseLocal, pauseRemoteAfterFailure, supabase]);

  useEffect(() => {
    if (!canUseLocal || !activeUserId || !activeWorkspaceId) {
      setItems([]);
      setTodos([]);
      setReminders([]);
      setIsLoading(false);
      seenIdsRef.current.clear();
      firedReminderIdsRef.current.clear();
      processedAgentIntentKeysRef.current.clear();
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

    if (!canUseRemote || !supabase || !isOnline) {
      return () => {
        isMounted = false;
      };
    }

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

          void window.bukowskiNotifications?.applyRemoteRows({ table: "notifications", rows: [payload.new as Record<string, unknown>] }).catch(
            () => undefined,
          );
          const alreadySeen = isRecentSelfEcho(nextRow, seenIdsRef.current);
          boundedAdd(seenIdsRef.current, nextRow.id, seenIdsCap);
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
          boundedAdd(seenIdsRef.current, nextRow.id, seenIdsCap);
          void window.bukowskiNotifications?.applyRemoteRows({ table: "notifications", rows: [payload.new as Record<string, unknown>] }).catch(
            () => undefined,
          );
          setItems((current) => sortNotifications(current.map((item) => (item.id === nextRow.id ? nextRow : item))));
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      void Promise.resolve(supabase.removeChannel(channel));
    };
  }, [activeUserId, activeWorkspaceId, canUseLocal, canUseRemote, isOnline, refreshNotifications, refreshPersonalWork, showNewNotification, supabase]);

  useEffect(() => {
    if (!canUseLocal) {
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
  }, [canUseLocal, refreshNotifications, refreshPersonalWork]);

  useEffect(() => {
    if (!isOnline || !canUseLocal) {
      return;
    }

    void refreshNotifications().catch(() => undefined);
    void refreshPersonalWork().catch(() => undefined);
  }, [canUseLocal, isOnline, refreshNotifications, refreshPersonalWork]);

  const markRead = useCallback(
    async (notificationId: string) => {
      if (!activeUserId || !activeWorkspaceId) return;
      const readAt = new Date().toISOString();
      setItems((current) => current.map((item) => (item.id === notificationId ? { ...item, readAt } : item)));
      await window.bukowskiNotifications?.markRead({
        userId: activeUserId,
        workspaceId: activeWorkspaceId,
        notificationId,
        readAt,
      });
    },
    [activeUserId, activeWorkspaceId],
  );

  const markAllRead = useCallback(async () => {
    if (!activeUserId || !activeWorkspaceId) return;
    const readAt = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
    await window.bukowskiNotifications?.markAllRead({
      userId: activeUserId,
      workspaceId: activeWorkspaceId,
      readAt,
    });
  }, [activeUserId, activeWorkspaceId]);

  const createNotification = useCallback(
    async (input: NotificationInsertInput) => {
      if (!activeUserId || !activeWorkspaceId) {
        return null;
      }

      const row = await window.bukowskiNotifications?.create({
        userId: activeUserId,
        workspaceId: activeWorkspaceId,
        kind: input.kind ?? "system",
        title: input.title,
        body: input.body ?? null,
        linkTo: input.linkTo ?? null,
        sourceType: input.sourceType ?? "user",
        sourceRef: input.sourceRef ?? null,
      });
      if (!row) {
        throw new Error("Notification was not created.");
      }
      boundedAdd(seenIdsRef.current, row.id, seenIdsCap);
      setItems((current) => sortNotifications([row, ...current.filter((item) => item.id !== row.id)]));
      if (input.notifyNow) {
        void showNewNotification(row);
      }
      return row;
    },
    [activeUserId, activeWorkspaceId, showNewNotification],
  );

  const createTodo = useCallback(
    async (input: TodoInsertInput) => {
      if (!activeUserId || !activeWorkspaceId) {
        return null;
      }

      const row = await window.bukowskiNotifications?.createTodo({
        userId: activeUserId,
        workspaceId: activeWorkspaceId,
        title: input.title,
        notes: input.notes ?? null,
        dueAt: input.dueAt ?? null,
        recurrenceRule: input.recurrenceRule ?? null,
        priority: Math.max(0, Math.min(3, Math.floor(input.priority ?? 0))),
        createdBy: input.createdBy ?? "user",
        agentActionRef: input.agentActionRef ?? null,
      });
      if (!row) {
        throw new Error("Todo was not created.");
      }
      setTodos((current) => [row, ...current.filter((item) => item.id !== row.id)].slice(0, 80));
      return row;
    },
    [activeUserId, activeWorkspaceId],
  );

  const createReminder = useCallback(
    async (input: ReminderInsertInput) => {
      if (!activeUserId || !activeWorkspaceId) {
        return null;
      }

      const remindAt = new Date(input.remindAt);
      if (!Number.isFinite(remindAt.getTime())) {
        throw new Error("Reminder time is invalid.");
      }

      const row = await window.bukowskiNotifications?.createReminder({
        userId: activeUserId,
        workspaceId: activeWorkspaceId,
        title: input.title,
        body: input.body ?? null,
        remindAt: remindAt.toISOString(),
        recurrenceRule: input.recurrenceRule ?? null,
        createdBy: input.createdBy ?? "user",
      });
      if (!row) {
        throw new Error("Reminder was not created.");
      }
      setReminders((current) =>
        [row, ...current.filter((item) => item.id !== row.id)]
          .sort((left, right) => new Date(left.remindAt).getTime() - new Date(right.remindAt).getTime())
          .slice(0, 80),
      );
      return row;
    },
    [activeUserId, activeWorkspaceId],
  );

  const updateTodo = useCallback(
    async (input: TodoUpdateInput) => {
      if (!activeUserId || !activeWorkspaceId) return;
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
                recurrenceRule: input.recurrenceRule ?? null,
                priority,
                updatedAt,
              }
            : item,
        ),
      );
      await window.bukowskiNotifications?.updateTodo({
        userId: activeUserId,
        workspaceId: activeWorkspaceId,
        id: input.id,
        title: input.title,
        notes: input.notes ?? null,
        dueAt: input.dueAt ?? null,
        recurrenceRule: input.recurrenceRule ?? null,
        priority,
      });
    },
    [activeUserId, activeWorkspaceId],
  );

  const deleteTodo = useCallback(
    async (todoId: string) => {
      if (!activeUserId || !activeWorkspaceId) return;
      setTodos((current) => current.filter((item) => item.id !== todoId));
      await window.bukowskiNotifications?.deleteTodo({ userId: activeUserId, workspaceId: activeWorkspaceId, id: todoId });
    },
    [activeUserId, activeWorkspaceId],
  );

  const updateReminder = useCallback(
    async (input: ReminderUpdateInput) => {
      if (!activeUserId || !activeWorkspaceId) return;
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
      await window.bukowskiNotifications?.updateReminder({
          userId: activeUserId,
          workspaceId: activeWorkspaceId,
          id: input.id,
          title: input.title,
          body: input.body ?? null,
          remindAt: nextRemindAt,
          recurrenceRule: input.recurrenceRule ?? null,
          snoozedUntil: null,
          completedAt: null,
        });
    },
    [activeUserId, activeWorkspaceId],
  );

  const deleteReminder = useCallback(
    async (reminderId: string) => {
      if (!activeUserId || !activeWorkspaceId) return;
      setReminders((current) => current.filter((item) => item.id !== reminderId));
      firedReminderIdsRef.current.delete(reminderId);
      await window.bukowskiNotifications?.deleteReminder({ userId: activeUserId, workspaceId: activeWorkspaceId, id: reminderId });
    },
    [activeUserId, activeWorkspaceId],
  );

  const markTodoDone = useCallback(
    async (todoId: string) => {
      if (!activeUserId || !activeWorkspaceId) return;
      const todo = todos.find((item) => item.id === todoId);
      const nextDueAt = todo?.dueAt ? parseBasicRecurrenceNext(todo.recurrenceRule, todo.dueAt) : null;
      if (nextDueAt) {
        setTodos((current) => current.map((item) => (item.id === todoId ? { ...item, dueAt: nextDueAt, completedAt: null } : item)));
        await window.bukowskiNotifications?.updateTodo({
          userId: activeUserId,
          workspaceId: activeWorkspaceId,
          id: todoId,
          dueAt: nextDueAt,
          completedAt: null,
        });
        return;
      }
      const completedAt = new Date().toISOString();
      setTodos((current) => current.map((item) => (item.id === todoId ? { ...item, completedAt } : item)));
      await window.bukowskiNotifications?.updateTodo({
        userId: activeUserId,
        workspaceId: activeWorkspaceId,
        id: todoId,
        completedAt,
      });
    },
    [activeUserId, activeWorkspaceId, todos],
  );

  const markReminderDone = useCallback(
    async (reminderId: string) => {
      if (!activeUserId || !activeWorkspaceId) return;
      const completedAt = new Date().toISOString();
      setReminders((current) => current.map((item) => (item.id === reminderId ? { ...item, completedAt } : item)));
      await window.bukowskiNotifications?.updateReminder({
        userId: activeUserId,
        workspaceId: activeWorkspaceId,
        id: reminderId,
        completedAt,
      });
    },
    [activeUserId, activeWorkspaceId],
  );

  const snoozeReminder = useCallback(
    async (reminderId: string, minutes: number) => {
      if (!activeUserId || !activeWorkspaceId) return;
      const snoozedUntil = new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString();
      setReminders((current) => current.map((item) => (item.id === reminderId ? { ...item, snoozedUntil, completedAt: null } : item)));
      firedReminderIdsRef.current.delete(reminderId);
      await window.bukowskiNotifications?.updateReminder({
        userId: activeUserId,
        workspaceId: activeWorkspaceId,
        id: reminderId,
        snoozedUntil,
        completedAt: null,
      });
    },
    [activeUserId, activeWorkspaceId],
  );

  const applyAgentNotificationIntents = useCallback(
    async (intents: AgentNotificationIntent[], threadId: string) => {
      for (const intent of intents) {
        const intentKey = stableAgentIntentKey(intent, threadId);
        if (processedAgentIntentKeysRef.current.has(intentKey)) {
          continue;
        }
        boundedAdd(processedAgentIntentKeysRef.current, intentKey, processedIntentKeysCap);

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
            recurrenceRule: intent.recurrenceRule ?? null,
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
              title: t("notifications.events.todoAddedTitle"),
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
              title: t("notifications.events.reminderScheduledTitle"),
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
    if (!canUseLocal || !activeUserId || !activeWorkspaceId || !isOnline) {
      return;
    }
    if (!appUpdateStatus?.available || !appUpdateStatus.latestVersion) {
      return;
    }
    if (window.localStorage.getItem(appUpdateLastNotifiedKey) === appUpdateStatus.latestVersion) {
      return;
    }

    window.localStorage.setItem(appUpdateLastNotifiedKey, appUpdateStatus.latestVersion);
    void createNotification({
      kind: "app_update",
      title: t("notifications.events.appUpdateTitle"),
      body: t("notifications.events.appUpdateBody", { version: appUpdateStatus.releaseName || appUpdateStatus.latestVersion }),
      linkTo: appUpdateStatus.releasePageUrl,
      sourceType: "app_update",
      sourceRef: {
        latestVersion: appUpdateStatus.latestVersion,
        currentVersion: appUpdateStatus.currentVersion,
      },
      notifyNow: true,
    }).catch(() => undefined);
  }, [activeUserId, activeWorkspaceId, appUpdateStatus, canUseLocal, createNotification, isOnline, t]);

  useEffect(() => {
    if (!canUseLocal || !activeUserId || !activeWorkspaceId) {
      return undefined;
    }

    const runReminderPoll = async () => {
      const now = new Date().toISOString();
      const localReminders =
        (await window.bukowskiNotifications?.listReminders({
          userId: activeUserId,
          workspaceId: activeWorkspaceId,
          limit: 80,
        })) ?? [];

      const dueReminders = localReminders
        .filter((reminder) => !reminder.snoozedUntil || reminder.snoozedUntil <= now)
        .filter((reminder) => !reminder.completedAt && reminder.remindAt <= now)
        .slice(0, 10);
      for (const reminder of dueReminders) {
        if (firedReminderIdsRef.current.has(reminder.id)) {
          continue;
        }

        boundedAdd(firedReminderIdsRef.current, reminder.id, firedReminderIdsCap);
        await createNotification({
          kind: "reminder",
          title: reminder.title,
          body: reminder.body,
          linkTo: "/inbox",
          sourceType: "reminder",
          sourceRef: { reminderId: reminder.id },
          notifyNow: false,
        }).then(async (notification) => {
          // Stay consistent with showNewNotification: when the app is in front and
          // focused, a toast is enough; only escalate to a native OS alert (with
          // its quick actions) when the window is in the background.
          const foregroundState = await window.bukowskiNotifications
            ?.getForegroundState()
            .catch(() => ({ isForeground: true }));
          const isForeground = (foregroundState?.isForeground ?? true) && document.hasFocus();

          if (isForeground) {
            toast.info(reminder.title, reminder.body ?? undefined);
            return;
          }

          if (nativePreferences.enabled && nativePreferences.categories.todosReminders) {
            const reminderActions: NativeNotificationAction[] = ["mark_done", "snooze_15m"];
            void window.bukowskiNotifications?.showNative({
              id: notification?.id ?? reminder.id,
              title: reminder.title,
              body: reminder.body,
              linkTo: "/inbox",
              reminderId: reminder.id,
              actions: reminderActions,
              actionLabels: nativeActionLabels(reminderActions),
            }).catch(() => undefined);
          }
        }).catch(() => undefined);

        const nextRemindAt = parseBasicRecurrenceNext(reminder.recurrenceRule, reminder.remindAt);
        if (nextRemindAt) {
          await window.bukowskiNotifications?.updateReminder({
            userId: activeUserId,
            workspaceId: activeWorkspaceId,
            id: reminder.id,
            remindAt: nextRemindAt,
            snoozedUntil: null,
          }).catch(() => undefined);
          setReminders((current) =>
            current.map((item) => (item.id === reminder.id ? { ...item, remindAt: nextRemindAt, snoozedUntil: null } : item)),
          );
          firedReminderIdsRef.current.delete(reminder.id);
        } else {
          const completedAt = new Date().toISOString();
          await window.bukowskiNotifications?.updateReminder({
            userId: activeUserId,
            workspaceId: activeWorkspaceId,
            id: reminder.id,
            completedAt,
          }).catch(() => undefined);
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
  }, [activeUserId, activeWorkspaceId, canUseLocal, createNotification, nativeActionLabels, nativePreferences, toast]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      items,
      todos,
      reminders,
      unreadCount,
      agentUnreadCount,
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
      agentUnreadCount,
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
