import type { Json } from "@bukowski/supabase-client";

export type NotificationKind = "agent_completion" | "reminder" | "system" | "invite" | "archive_done" | "sync" | "operation";

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

export type ShowNativeNotificationCommand = {
  id?: string | null;
  title: string;
  body?: string | null;
  linkTo?: string | null;
  reminderId?: string | null;
  actions?: Array<"mark_done" | "snooze_15m" | "snooze_1h">;
};
