import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  NotificationCreateCommand,
  NotificationListQuery,
  NotificationMarkAllReadCommand,
  NotificationMarkReadCommand,
  NotificationRow,
  ReminderCreateCommand,
  ReminderRow,
  ReminderUpdateCommand,
  TodoCreateCommand,
  TodoRow,
  TodoUpdateCommand,
} from "@contracts";

const maxListLimit = 120;

const clampLimit = (limit: number | undefined) => Math.max(1, Math.min(maxListLimit, Math.floor(limit ?? 80)));
const normalizePriority = (priority: number | undefined) => Math.max(0, Math.min(3, Math.floor(priority ?? 0)));
const nullableJson = (value: unknown) => (value == null ? null : JSON.stringify(value));
const sqlTextOrNull = (value: unknown) => (value == null ? null : String(value));
const parseJson = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value) as NotificationRow["sourceRef"];
  } catch {
    return null;
  }
};

const enqueueOutbox = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: "notification" | "todo" | "reminder",
  entityId: string,
  operationType: "upsert" | "delete",
  payload: unknown,
  now: string,
) => {
  db.prepare(
    `
      INSERT OR REPLACE INTO sync_outbox (
        id, workspace_id, entity_type, entity_id, event_id, operation_type,
        payload_json, status, attempt_count, last_error, next_retry_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'pending', 0, NULL, NULL, ?, ?)
    `,
  ).run(`${entityType}-${operationType}-${entityId}`, workspaceId, entityType, entityId, operationType, JSON.stringify(payload), now, now);
};

const toNotificationRow = (row: Record<string, unknown>): NotificationRow => ({
  id: String(row.id),
  userId: String(row.user_id),
  workspaceId: String(row.workspace_id),
  kind: String(row.kind),
  title: String(row.title),
  body: row.body == null ? null : String(row.body),
  sourceType: row.source_type == null ? null : String(row.source_type),
  sourceRef: parseJson(row.source_ref == null ? null : String(row.source_ref)),
  linkTo: row.link_to == null ? null : String(row.link_to),
  readAt: row.read_at == null ? null : String(row.read_at),
  createdAt: String(row.created_at),
});

const toTodoRow = (row: Record<string, unknown>): TodoRow => ({
  id: String(row.id),
  userId: String(row.user_id),
  workspaceId: String(row.workspace_id),
  title: String(row.title),
  notes: row.notes == null ? null : String(row.notes),
  dueAt: row.due_at == null ? null : String(row.due_at),
  recurrenceRule: row.recurrence_rule == null ? null : String(row.recurrence_rule),
  priority: Number(row.priority ?? 0),
  completedAt: row.completed_at == null ? null : String(row.completed_at),
  createdBy: row.created_by === "agent" ? "agent" : "user",
  agentActionRef: parseJson(row.agent_action_ref == null ? null : String(row.agent_action_ref)),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const toReminderRow = (row: Record<string, unknown>): ReminderRow => ({
  id: String(row.id),
  userId: String(row.user_id),
  workspaceId: String(row.workspace_id),
  title: String(row.title),
  body: row.body == null ? null : String(row.body),
  remindAt: String(row.remind_at),
  recurrenceRule: row.recurrence_rule == null ? null : String(row.recurrence_rule),
  snoozedUntil: row.snoozed_until == null ? null : String(row.snoozed_until),
  completedAt: row.completed_at == null ? null : String(row.completed_at),
  createdBy: row.created_by === "agent" ? "agent" : "user",
  createdAt: String(row.created_at),
});

export const applyNotificationLocalMigration = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      source_type TEXT,
      source_ref TEXT,
      link_to TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user_workspace_created
      ON notifications(user_id, workspace_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_user_workspace_unread
      ON notifications(user_id, workspace_id)
      WHERE read_at IS NULL;

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      notes TEXT,
      due_at TEXT,
      recurrence_rule TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_by TEXT NOT NULL DEFAULT 'user',
      agent_action_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_todos_user_workspace_created
      ON todos(user_id, workspace_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      remind_at TEXT NOT NULL,
      recurrence_rule TEXT,
      snoozed_until TEXT,
      completed_at TEXT,
      created_by TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_user_workspace_due
      ON reminders(user_id, workspace_id, remind_at ASC);
  `);
};

export const createNotificationLocalService = (db: DatabaseSync) => {
  const getNotificationById = (userId: string, workspaceId: string, id: string): NotificationRow => {
    const row = db
      .prepare(
        `
          SELECT id, user_id, workspace_id, kind, title, body, source_type, source_ref, link_to, read_at, created_at
          FROM notifications
          WHERE id = ? AND user_id = ? AND workspace_id = ?
          LIMIT 1
        `,
      )
      .get(id, userId, workspaceId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Notification was not found after writing.");
    return toNotificationRow(row);
  };

  const getTodoById = (userId: string, workspaceId: string, id: string): TodoRow => {
    const row = db
      .prepare(
        `
          SELECT id, user_id, workspace_id, title, notes, due_at, recurrence_rule, priority, completed_at,
                 created_by, agent_action_ref, created_at, updated_at
          FROM todos
          WHERE id = ? AND user_id = ? AND workspace_id = ?
          LIMIT 1
        `,
      )
      .get(id, userId, workspaceId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Todo was not found after writing.");
    return toTodoRow(row);
  };

  const getReminderById = (userId: string, workspaceId: string, id: string): ReminderRow => {
    const row = db
      .prepare(
        `
          SELECT id, user_id, workspace_id, title, body, remind_at, recurrence_rule, snoozed_until,
                 completed_at, created_by, created_at
          FROM reminders
          WHERE id = ? AND user_id = ? AND workspace_id = ?
          LIMIT 1
        `,
      )
      .get(id, userId, workspaceId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Reminder was not found after writing.");
    return toReminderRow(row);
  };

  const listNotifications = (query: NotificationListQuery): NotificationRow[] =>
    (db
      .prepare(
        `
          SELECT id, user_id, workspace_id, kind, title, body, source_type, source_ref, link_to, read_at, created_at
          FROM notifications
          WHERE user_id = ? AND workspace_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `,
      )
      .all(query.userId, query.workspaceId, clampLimit(query.limit)) as Record<string, unknown>[]).map(toNotificationRow);

  const listTodos = (query: NotificationListQuery): TodoRow[] =>
    (db
      .prepare(
        `
          SELECT id, user_id, workspace_id, title, notes, due_at, recurrence_rule, priority, completed_at,
                 created_by, agent_action_ref, created_at, updated_at
          FROM todos
          WHERE user_id = ? AND workspace_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `,
      )
      .all(query.userId, query.workspaceId, clampLimit(query.limit)) as Record<string, unknown>[]).map(toTodoRow);

  const listReminders = (query: NotificationListQuery): ReminderRow[] =>
    (db
      .prepare(
        `
          SELECT id, user_id, workspace_id, title, body, remind_at, recurrence_rule, snoozed_until,
                 completed_at, created_by, created_at
          FROM reminders
          WHERE user_id = ? AND workspace_id = ?
          ORDER BY remind_at ASC
          LIMIT ?
        `,
      )
      .all(query.userId, query.workspaceId, clampLimit(query.limit)) as Record<string, unknown>[]).map(toReminderRow);

  return {
    listNotifications,
    listTodos,
    listReminders,

    createNotification(input: NotificationCreateCommand): NotificationRow {
      const now = new Date().toISOString();
      const id = input.id?.trim() || randomUUID();
      db.prepare(
        `
          INSERT OR REPLACE INTO notifications (
            id, user_id, workspace_id, kind, title, body, source_type, source_ref, link_to, read_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `,
      ).run(
        id,
        input.userId,
        input.workspaceId,
        input.kind ?? "system",
        input.title,
        input.body ?? null,
        input.sourceType ?? "user",
        nullableJson(input.sourceRef ?? null),
        input.linkTo ?? null,
        now,
      );
      enqueueOutbox(db, input.workspaceId, "notification", id, "upsert", { id }, now);
      return getNotificationById(input.userId, input.workspaceId, id);
    },

    markRead(input: NotificationMarkReadCommand): void {
      const readAt = input.readAt ?? new Date().toISOString();
      db.prepare(
        `
          UPDATE notifications
          SET read_at = ?
          WHERE id = ? AND user_id = ? AND workspace_id = ?
        `,
      ).run(readAt, input.notificationId, input.userId, input.workspaceId);
      enqueueOutbox(db, input.workspaceId, "notification", input.notificationId, "upsert", { id: input.notificationId }, readAt);
    },

    markAllRead(input: NotificationMarkAllReadCommand): void {
      const readAt = input.readAt ?? new Date().toISOString();
      const rows = db
        .prepare("SELECT id FROM notifications WHERE user_id = ? AND workspace_id = ? AND read_at IS NULL")
        .all(input.userId, input.workspaceId) as Array<{ id: string }>;
      db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND workspace_id = ? AND read_at IS NULL").run(
        readAt,
        input.userId,
        input.workspaceId,
      );
      rows.forEach((row) => enqueueOutbox(db, input.workspaceId, "notification", row.id, "upsert", { id: row.id }, readAt));
    },

    createTodo(input: TodoCreateCommand): TodoRow {
      const now = new Date().toISOString();
      const id = input.id?.trim() || randomUUID();
      db.prepare(
        `
          INSERT OR REPLACE INTO todos (
            id, user_id, workspace_id, title, notes, due_at, recurrence_rule, priority, completed_at,
            created_by, agent_action_ref, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
        `,
      ).run(
        id,
        input.userId,
        input.workspaceId,
        input.title,
        input.notes ?? null,
        input.dueAt ?? null,
        input.recurrenceRule ?? null,
        normalizePriority(input.priority),
        input.createdBy ?? "user",
        nullableJson(input.agentActionRef ?? null),
        now,
        now,
      );
      enqueueOutbox(db, input.workspaceId, "todo", id, "upsert", { id }, now);
      return getTodoById(input.userId, input.workspaceId, id);
    },

    updateTodo(input: TodoUpdateCommand): void {
      const existing = db
        .prepare("SELECT * FROM todos WHERE id = ? AND user_id = ? AND workspace_id = ? LIMIT 1")
        .get(input.id, input.userId, input.workspaceId) as Record<string, unknown> | undefined;
      if (!existing) return;
      const now = new Date().toISOString();
      db.prepare(
        `
          UPDATE todos
          SET title = ?, notes = ?, due_at = ?, recurrence_rule = ?, priority = ?, completed_at = ?, updated_at = ?
          WHERE id = ? AND user_id = ? AND workspace_id = ?
        `,
      ).run(
        input.title ?? String(existing.title),
        Object.prototype.hasOwnProperty.call(input, "notes") ? input.notes ?? null : sqlTextOrNull(existing.notes),
        Object.prototype.hasOwnProperty.call(input, "dueAt") ? input.dueAt ?? null : sqlTextOrNull(existing.due_at),
        Object.prototype.hasOwnProperty.call(input, "recurrenceRule") ? input.recurrenceRule ?? null : sqlTextOrNull(existing.recurrence_rule),
        input.priority == null ? Number(existing.priority ?? 0) : normalizePriority(input.priority),
        Object.prototype.hasOwnProperty.call(input, "completedAt") ? input.completedAt ?? null : sqlTextOrNull(existing.completed_at),
        now,
        input.id,
        input.userId,
        input.workspaceId,
      );
      enqueueOutbox(db, input.workspaceId, "todo", input.id, "upsert", { id: input.id }, now);
    },

    deleteTodo(input: { userId: string; workspaceId: string; id: string }): void {
      const now = new Date().toISOString();
      db.prepare("DELETE FROM todos WHERE id = ? AND user_id = ? AND workspace_id = ?").run(input.id, input.userId, input.workspaceId);
      enqueueOutbox(db, input.workspaceId, "todo", input.id, "delete", { id: input.id }, now);
    },

    createReminder(input: ReminderCreateCommand): ReminderRow {
      const remindAt = new Date(input.remindAt);
      if (!Number.isFinite(remindAt.getTime())) throw new Error("Reminder time is invalid.");
      const now = new Date().toISOString();
      const id = input.id?.trim() || randomUUID();
      db.prepare(
        `
          INSERT OR REPLACE INTO reminders (
            id, user_id, workspace_id, title, body, remind_at, recurrence_rule, snoozed_until,
            completed_at, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        `,
      ).run(
        id,
        input.userId,
        input.workspaceId,
        input.title,
        input.body ?? null,
        remindAt.toISOString(),
        input.recurrenceRule ?? null,
        input.createdBy ?? "user",
        now,
      );
      enqueueOutbox(db, input.workspaceId, "reminder", id, "upsert", { id }, now);
      return getReminderById(input.userId, input.workspaceId, id);
    },

    updateReminder(input: ReminderUpdateCommand): void {
      const existing = db
        .prepare("SELECT * FROM reminders WHERE id = ? AND user_id = ? AND workspace_id = ? LIMIT 1")
        .get(input.id, input.userId, input.workspaceId) as Record<string, unknown> | undefined;
      if (!existing) return;
      const remindAt = input.remindAt ? new Date(input.remindAt) : null;
      if (remindAt && !Number.isFinite(remindAt.getTime())) throw new Error("Reminder time is invalid.");
      const now = new Date().toISOString();
      db.prepare(
        `
          UPDATE reminders
          SET title = ?, body = ?, remind_at = ?, recurrence_rule = ?, snoozed_until = ?, completed_at = ?
          WHERE id = ? AND user_id = ? AND workspace_id = ?
        `,
      ).run(
        input.title ?? String(existing.title),
        Object.prototype.hasOwnProperty.call(input, "body") ? input.body ?? null : sqlTextOrNull(existing.body),
        remindAt ? remindAt.toISOString() : String(existing.remind_at),
        Object.prototype.hasOwnProperty.call(input, "recurrenceRule") ? input.recurrenceRule ?? null : sqlTextOrNull(existing.recurrence_rule),
        Object.prototype.hasOwnProperty.call(input, "snoozedUntil") ? input.snoozedUntil ?? null : sqlTextOrNull(existing.snoozed_until),
        Object.prototype.hasOwnProperty.call(input, "completedAt") ? input.completedAt ?? null : sqlTextOrNull(existing.completed_at),
        input.id,
        input.userId,
        input.workspaceId,
      );
      enqueueOutbox(db, input.workspaceId, "reminder", input.id, "upsert", { id: input.id }, now);
    },

    deleteReminder(input: { userId: string; workspaceId: string; id: string }): void {
      const now = new Date().toISOString();
      db.prepare("DELETE FROM reminders WHERE id = ? AND user_id = ? AND workspace_id = ?").run(input.id, input.userId, input.workspaceId);
      enqueueOutbox(db, input.workspaceId, "reminder", input.id, "delete", { id: input.id }, now);
    },

    applyRemoteRows(input: { table: "notifications" | "todos" | "reminders"; rows: Record<string, unknown>[] }): void {
      const now = new Date().toISOString();
      if (input.table === "notifications") {
        const statement = db.prepare(
          `
            INSERT OR REPLACE INTO notifications (
              id, user_id, workspace_id, kind, title, body, source_type, source_ref, link_to, read_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        );
        input.rows.forEach((row) =>
          statement.run(
            String(row.id),
            String(row.user_id),
            String(row.workspace_id),
            String(row.kind ?? "system"),
            String(row.title ?? "Notification"),
            sqlTextOrNull(row.body),
            sqlTextOrNull(row.source_type),
            nullableJson(row.source_ref ?? null),
            sqlTextOrNull(row.link_to),
            sqlTextOrNull(row.read_at),
            String(row.created_at ?? now),
          ),
        );
        return;
      }
      if (input.table === "todos") {
        const statement = db.prepare(
          `
            INSERT OR REPLACE INTO todos (
              id, user_id, workspace_id, title, notes, due_at, recurrence_rule, priority, completed_at,
              created_by, agent_action_ref, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        );
        input.rows.forEach((row) =>
          statement.run(
            String(row.id),
            String(row.user_id),
            String(row.workspace_id),
            String(row.title ?? "Todo"),
            sqlTextOrNull(row.notes),
            sqlTextOrNull(row.due_at),
            sqlTextOrNull(row.recurrence_rule),
            normalizePriority(Number(row.priority ?? 0)),
            sqlTextOrNull(row.completed_at),
            row.created_by === "agent" ? "agent" : "user",
            nullableJson(row.agent_action_ref ?? null),
            String(row.created_at ?? now),
            String(row.updated_at ?? now),
          ),
        );
        return;
      }

      const statement = db.prepare(
        `
          INSERT OR REPLACE INTO reminders (
            id, user_id, workspace_id, title, body, remind_at, recurrence_rule, snoozed_until,
            completed_at, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      input.rows.forEach((row) =>
        statement.run(
          String(row.id),
          String(row.user_id),
          String(row.workspace_id),
          String(row.title ?? "Reminder"),
          sqlTextOrNull(row.body),
          String(row.remind_at ?? now),
          sqlTextOrNull(row.recurrence_rule),
          sqlTextOrNull(row.snoozed_until),
          sqlTextOrNull(row.completed_at),
          row.created_by === "agent" ? "agent" : "user",
          String(row.created_at ?? now),
        ),
      );
    },
  };
};
