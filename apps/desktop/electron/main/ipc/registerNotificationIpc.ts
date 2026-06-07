import { z } from "zod";

import { ipcChannels } from "@contracts/ipc/channels";

import { getFreshStoredUserId, isSupabaseAuthConfigured } from "../services/auth/supabaseAuthBridge";
import {
  getNativeNotificationForegroundState,
  setNativeNotificationDockBadge,
  showNativeNotification,
} from "../services/notifications/nativeNotifier";
import { safeHandle, safeHandleReadWithSchema } from "./ipcSafeHandler";

/**
 * Notifications, todos and reminders are always scoped to the signed-in user.
 * Never trust the `userId` the renderer sends: derive it from the main-process
 * session so a compromised renderer cannot read or write another user's rows.
 * In the local-dev/offline build (no Supabase) there is no remote session, so
 * the renderer-provided local user id is the only identity available.
 */
const resolveTrustedUserId = async (rendererUserId: string): Promise<string> => {
  try {
    return await getFreshStoredUserId();
  } catch (error) {
    if (!isSupabaseAuthConfigured()) {
      return rendererUserId;
    }
    throw error instanceof Error ? error : new Error("An authenticated session is required for notifications.");
  }
};

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
  actionLabels: z
    .record(z.enum(["mark_done", "snooze_15m", "snooze_1h", "approve_run"]), z.string().trim().min(1).max(40))
    .optional(),
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
    async (_event, query) =>
      service.listNotifications({ ...(query as { userId: string; workspaceId: string; limit?: number }), userId: await resolveTrustedUserId((query as { userId: string }).userId) }),
    "The app could not load notifications.",
  );

  safeHandle(
    ipcChannels.notifications.create,
    notificationCreateSchema,
    async (_event, input) =>
      service.createNotification({
        ...input,
        userId: await resolveTrustedUserId(input.userId),
      } as import("@contracts").NotificationCreateCommand),
    "The app could not create this notification.",
  );

  safeHandle(
    ipcChannels.notifications.markRead,
    markReadSchema,
    async (_event, input) => service.markRead({ ...input, userId: await resolveTrustedUserId(input.userId) }),
    "The app could not mark this notification as read.",
  );

  safeHandle(
    ipcChannels.notifications.markAllRead,
    markAllReadSchema,
    async (_event, input) => service.markAllRead({ ...input, userId: await resolveTrustedUserId(input.userId) }),
    "The app could not mark notifications as read.",
  );

  safeHandleReadWithSchema(
    ipcChannels.notifications.listTodos,
    z.tuple([listQuerySchema]),
    async (_event, query) => service.listTodos({ ...(query as { userId: string; workspaceId: string; limit?: number }), userId: await resolveTrustedUserId((query as { userId: string }).userId) }),
    "The app could not load todos.",
  );

  safeHandle(
    ipcChannels.notifications.createTodo,
    todoCreateSchema,
    async (_event, input) =>
      service.createTodo({ ...input, userId: await resolveTrustedUserId(input.userId) } as import("@contracts").TodoCreateCommand),
    "The app could not create this todo.",
  );

  safeHandle(
    ipcChannels.notifications.updateTodo,
    todoUpdateSchema,
    async (_event, input) => service.updateTodo({ ...input, userId: await resolveTrustedUserId(input.userId) }),
    "The app could not update this todo.",
  );

  safeHandle(
    ipcChannels.notifications.deleteTodo,
    deleteSchema,
    async (_event, input) => service.deleteTodo({ ...input, userId: await resolveTrustedUserId(input.userId) }),
    "The app could not delete this todo.",
  );

  safeHandleReadWithSchema(
    ipcChannels.notifications.listReminders,
    z.tuple([listQuerySchema]),
    async (_event, query) => service.listReminders({ ...(query as { userId: string; workspaceId: string; limit?: number }), userId: await resolveTrustedUserId((query as { userId: string }).userId) }),
    "The app could not load reminders.",
  );

  safeHandle(
    ipcChannels.notifications.createReminder,
    reminderCreateSchema,
    async (_event, input) => service.createReminder({ ...input, userId: await resolveTrustedUserId(input.userId) }),
    "The app could not create this reminder.",
  );

  safeHandle(
    ipcChannels.notifications.updateReminder,
    reminderUpdateSchema,
    async (_event, input) => service.updateReminder({ ...input, userId: await resolveTrustedUserId(input.userId) }),
    "The app could not update this reminder.",
  );

  safeHandle(
    ipcChannels.notifications.deleteReminder,
    deleteSchema,
    async (_event, input) => service.deleteReminder({ ...input, userId: await resolveTrustedUserId(input.userId) }),
    "The app could not delete this reminder.",
  );

  safeHandle(
    ipcChannels.notifications.applyRemoteRows,
    applyRemoteRowsSchema,
    async (_event, input) => {
      if (input.rows.length === 0) {
        return;
      }
      // Stamp every applied row with the trusted user id so a compromised
      // renderer cannot inject rows that impersonate another user locally.
      const trustedUserId = await resolveTrustedUserId(
        typeof input.rows[0]?.user_id === "string" ? (input.rows[0].user_id as string) : "",
      );
      service.applyRemoteRows({
        table: input.table,
        rows: input.rows.map((row) => ({ ...row, user_id: trustedUserId })),
      });
    },
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
