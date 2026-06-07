import type { Json } from "@bukowski/supabase-client";

export type NotificationKind =
  | "agent_completion"
  | "agent_approval"
  | "app_update"
  | "exchange_rate"
  | "invoice_inbox"
  | "project"
  | "reminder"
  | "system"
  | "invite"
  | "archive_done"
  | "sync"
  | "operation";

export type NotificationRow = {
  id: string;
  userId: string;
  workspaceId: string;
  kind: NotificationKind | string;
  title: string;
  body: string | null;
  sourceType: string | null;
  sourceRef: Json | null;
  linkTo: string | null;
  readAt: string | null;
  createdAt: string;
};

export type TodoRow = {
  id: string;
  userId: string;
  workspaceId: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  recurrenceRule: string | null;
  priority: number;
  completedAt: string | null;
  createdBy: "user" | "agent";
  agentActionRef: Json | null;
  createdAt: string;
  updatedAt: string;
};

export type ReminderRow = {
  id: string;
  userId: string;
  workspaceId: string;
  title: string;
  body: string | null;
  remindAt: string;
  recurrenceRule: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  createdBy: "user" | "agent";
  createdAt: string;
};

export type AgentNotificationIntent =
  | {
      type: "create_notification";
      title: string;
      body?: string | null;
      kind?: string | null;
      linkTo?: string | null;
      notifyNow?: boolean;
      sourceRef?: Json | null;
    }
  | {
      type: "create_todo";
      title: string;
      notes?: string | null;
      dueAt?: string | null;
      recurrenceRule?: string | null;
      priority?: number;
      sourceRef?: Json | null;
    }
  | {
      type: "create_reminder";
      title: string;
      body?: string | null;
      remindAt: string;
      recurrenceRule?: string | null;
      sourceRef?: Json | null;
    };

export type NativeNotificationAction = "mark_done" | "snooze_15m" | "snooze_1h" | "approve_run";

export type ShowNativeNotificationCommand = {
  id?: string | null;
  title: string;
  body?: string | null;
  linkTo?: string | null;
  reminderId?: string | null;
  agentRunId?: string | null;
  workspaceId?: string | null;
  actions?: NativeNotificationAction[];
  /** Localized labels for the action buttons; falls back to English defaults. */
  actionLabels?: Partial<Record<NativeNotificationAction, string>>;
};

export type NotificationCategory =
  | "invoiceInbox"
  | "agentsDone"
  | "agentsApproval"
  | "exchangeRates"
  | "projects"
  | "todosReminders"
  | "appUpdates";

export type NativeNotificationPreferences = {
  enabled: boolean;
  categories: Record<NotificationCategory, boolean>;
};

export type NotificationListQuery = {
  userId: string;
  workspaceId: string;
  limit?: number;
};

export type NotificationCreateCommand = {
  userId: string;
  workspaceId: string;
  kind?: string;
  title: string;
  body?: string | null;
  sourceType?: string | null;
  sourceRef?: Json | null;
  linkTo?: string | null;
  id?: string | null;
};

export type NotificationMarkReadCommand = {
  userId: string;
  workspaceId: string;
  notificationId: string;
  readAt?: string | null;
};

export type NotificationMarkAllReadCommand = {
  userId: string;
  workspaceId: string;
  readAt?: string | null;
};

export type TodoCreateCommand = {
  userId: string;
  workspaceId: string;
  title: string;
  notes?: string | null;
  dueAt?: string | null;
  recurrenceRule?: string | null;
  priority?: number;
  createdBy?: "user" | "agent";
  agentActionRef?: Json | null;
  id?: string | null;
};

export type TodoUpdateCommand = {
  userId: string;
  workspaceId: string;
  id: string;
  title?: string;
  notes?: string | null;
  dueAt?: string | null;
  recurrenceRule?: string | null;
  priority?: number;
  completedAt?: string | null;
};

export type ReminderCreateCommand = {
  userId: string;
  workspaceId: string;
  title: string;
  body?: string | null;
  remindAt: string;
  recurrenceRule?: string | null;
  createdBy?: "user" | "agent";
  id?: string | null;
};

export type ReminderUpdateCommand = {
  userId: string;
  workspaceId: string;
  id: string;
  title?: string;
  body?: string | null;
  remindAt?: string;
  recurrenceRule?: string | null;
  snoozedUntil?: string | null;
  completedAt?: string | null;
};
