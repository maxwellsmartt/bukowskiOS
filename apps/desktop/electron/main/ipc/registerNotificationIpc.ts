import { z } from "zod";

import { ipcChannels } from "@contracts/ipc/channels";

import {
  getNativeNotificationForegroundState,
  setNativeNotificationDockBadge,
  showNativeNotification,
} from "../services/notifications/nativeNotifier";
import { safeHandle, safeHandleReadWithSchema } from "./ipcSafeHandler";

type NotificationLocalService = {
  listNotifications: (query: { userId: string; workspaceId: string; limit?: number }) => unknown;
  createNotification: (input: import("@contracts").NotificationCreateCommand) => unknown;
  markRead: (input: import("@contracts").NotificationMarkReadCommand) => void;
  markAllRead: (input: import("@contracts").NotificationMarkAllReadCommand) => void;
  listTodos: (query: { userId: string; workspaceId: string; limit?: number }) => unknown;
  createTodo: (input: import("@contracts").TodoCreateCommand) => unknown;
  updateTodo: (input: import("@contracts").TodoUpdateCommand) => void;
  deleteTodo: (input: { userId: string; workspaceId: string; id: string }) => void;
  listReminders: (query: { userId: string; workspaceId: string; limit?: number }) => unknown;
  createReminder: (input: import("@contracts").ReminderCreateCommand) => unknown;
  updateReminder: (input: import("@contracts").ReminderUpdateCommand) => void;
  deleteReminder: (input: { userId: string; workspaceId: string; id: string }) => void;
  applyRemoteRows: (input: { table: "notifications" | "todos" | "reminders"; rows: Record<string, unknown>[] }) => void;
};

const jsonSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonSchema), z.record(z.string(), jsonSchema)]),
);

const idSchema = z.string().trim().min(1).max(120);
const routeSchema = z.string().trim().max(500).nullable().optional();
const textSchema = z.string().trim().min(1).max(240);
const bodySchema = z.string().trim().max(800).nullable().optional();
const listQuerySchema = z.object({
  userId: idSchema,
  workspaceId: idSchema,
  limit: z.number().int().min(1).max(120).optional(),
});

const nativeNotificationSchema = z.object({
  id: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(400).nullable().optional(),
  linkTo: z.string().trim().max(500).nullable().optional(),
  reminderId: z.string().trim().min(1).max(120).nullable().optional(),
  agentRunId: z.string().trim().min(1).max(120).nullable().optional(),
  workspaceId: z.string().trim().min(1).max(120).nullable().optional(),
  actions: z.array(z.enum(["mark_done", "snooze_15m", "snooze_1h", "approve_run"])).max(3).optional(),
});

const notificationCreateSchema = z.object({
  id: idSchema.nullable().optional(),
  userId: idSchema,
  workspaceId: idSchema,
  kind: z.string().trim().min(1).max(80).optional(),
  title: textSchema,
  body: bodySchema,
  sourceType: z.string().trim().max(80).nullable().optional(),
  sourceRef: jsonSchema.nullable().optional(),
  linkTo: routeSchema,
});

const markReadSchema = z.object({
  userId: idSchema,
  workspaceId: idSchema,
  notificationId: idSchema,
  readAt: z.string().trim().max(80).nullable().optional(),
});

const markAllReadSchema = z.object({
  userId: idSchema,
  workspaceId: idSchema,
  readAt: z.string().trim().max(80).nullable().optional(),
});

const todoCreateSchema = z.object({
  id: idSchema.nullable().optional(),
  userId: idSchema,
  workspaceId: idSchema,
  title: textSchema,
  notes: bodySchema,
  dueAt: z.string().trim().max(80).nullable().optional(),
  recurrenceRule: z.string().trim().max(240).nullable().optional(),
  priority: z.number().int().min(0).max(3).optional(),
  createdBy: z.enum(["user", "agent"]).optional(),
  agentActionRef: jsonSchema.nullable().optional(),
});

const todoUpdateSchema = z.object({
  userId: idSchema,
  workspaceId: idSchema,
  id: idSchema,
  title: textSchema.optional(),
  notes: bodySchema,
  dueAt: z.string().trim().max(80).nullable().optional(),
  recurrenceRule: z.string().trim().max(240).nullable().optional(),
  priority: z.number().int().min(0).max(3).optional(),
  completedAt: z.string().trim().max(80).nullable().optional(),
});

const reminderCreateSchema = z.object({
  id: idSchema.nullable().optional(),
  userId: idSchema,
  workspaceId: idSchema,
  title: textSchema,
  body: bodySchema,
  remindAt: z.string().trim().min(1).max(80),
  recurrenceRule: z.string().trim().max(240).nullable().optional(),
  createdBy: z.enum(["user", "agent"]).optional(),
});

const reminderUpdateSchema = z.object({
  userId: idSchema,
  workspaceId: idSchema,
  id: idSchema,
  title: textSchema.optional(),
  body: bodySchema,
  remindAt: z.string().trim().min(1).max(80).optional(),
  recurrenceRule: z.string().trim().max(240).nullable().optional(),
  snoozedUntil: z.string().trim().max(80).nullable().optional(),
  completedAt: z.string().trim().max(80).nullable().optional(),
});

const deleteSchema = z.object({
  userId: idSchema,
  workspaceId: idSchema,
  id: idSchema,
});

const applyRemoteRowsSchema = z.object({
  table: z.enum(["notifications", "todos", "reminders"]),
  rows: z.array(z.record(z.string(), jsonSchema)).max(200),
});

export const registerNotificationIpc = (service: NotificationLocalService) => {
  safeHandleReadWithSchema(
    ipcChannels.notifications.list,
    z.tuple([listQuerySchema]),
    (_event, query) => service.listNotifications(query as { userId: string; workspaceId: string; limit?: number }),
    "The app could not load notifications.",
  );

  safeHandle(
    ipcChannels.notifications.create,
    notificationCreateSchema,
    (_event, input) => service.createNotification(input as import("@contracts").NotificationCreateCommand),
    "The app could not create this notification.",
  );

  safeHandle(
    ipcChannels.notifications.markRead,
    markReadSchema,
    (_event, input) => service.markRead(input),
    "The app could not mark this notification as read.",
  );

  safeHandle(
    ipcChannels.notifications.markAllRead,
    markAllReadSchema,
    (_event, input) => service.markAllRead(input),
    "The app could not mark notifications as read.",
  );

  safeHandleReadWithSchema(
    ipcChannels.notifications.listTodos,
    z.tuple([listQuerySchema]),
    (_event, query) => service.listTodos(query as { userId: string; workspaceId: string; limit?: number }),
    "The app could not load todos.",
  );

  safeHandle(
    ipcChannels.notifications.createTodo,
    todoCreateSchema,
    (_event, input) => service.createTodo(input as import("@contracts").TodoCreateCommand),
    "The app could not create this todo.",
  );

  safeHandle(
    ipcChannels.notifications.updateTodo,
    todoUpdateSchema,
    (_event, input) => service.updateTodo(input),
    "The app could not update this todo.",
  );

  safeHandle(
    ipcChannels.notifications.deleteTodo,
    deleteSchema,
    (_event, input) => service.deleteTodo(input),
    "The app could not delete this todo.",
  );

  safeHandleReadWithSchema(
    ipcChannels.notifications.listReminders,
    z.tuple([listQuerySchema]),
    (_event, query) => service.listReminders(query as { userId: string; workspaceId: string; limit?: number }),
    "The app could not load reminders.",
  );

  safeHandle(
    ipcChannels.notifications.createReminder,
    reminderCreateSchema,
    (_event, input) => service.createReminder(input),
    "The app could not create this reminder.",
  );

  safeHandle(
    ipcChannels.notifications.updateReminder,
    reminderUpdateSchema,
    (_event, input) => service.updateReminder(input),
    "The app could not update this reminder.",
  );

  safeHandle(
    ipcChannels.notifications.deleteReminder,
    deleteSchema,
    (_event, input) => service.deleteReminder(input),
    "The app could not delete this reminder.",
  );

  safeHandle(
    ipcChannels.notifications.applyRemoteRows,
    applyRemoteRowsSchema,
    (_event, input) => service.applyRemoteRows(input),
    "The app could not apply remote notifications.",
  );

  safeHandle(
    ipcChannels.notifications.showNative,
    nativeNotificationSchema,
    (_event, input) => showNativeNotification(input),
    "The app could not show this notification.",
  );

  safeHandle(
    ipcChannels.notifications.setDockBadge,
    z.number().int().min(0).max(999),
    (_event, count) => setNativeNotificationDockBadge(count),
    "The app could not update the dock badge.",
  );

  safeHandleReadWithSchema(
    ipcChannels.notifications.getForegroundState,
    z.tuple([]),
    getNativeNotificationForegroundState,
    "The app could not read notification state.",
  );
};
