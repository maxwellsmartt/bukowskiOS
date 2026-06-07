import { describe, expect, it } from "vitest";

import {
  applyNotificationLocalMigration,
  createNotificationLocalService,
} from "../../electron/main/services/data/notificationLocalService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const workspaceId = "workspace-metadata";
const userId = "11111111-1111-4111-8111-111111111111";

describe("notification local service", () => {
  it("creates local notifications, marks them read and enqueues sync idempotently", () => {
    const { cleanup, database } = createTestDatabase("notification-local-service");
    applyNotificationLocalMigration(database);
    const service = createNotificationLocalService(database);

    const created = service.createNotification({
      userId,
      workspaceId,
      kind: "project",
      title: "Proyecto actualizado",
      body: "Fechas modificadas",
      sourceType: "project",
      sourceRef: { projectId: "project-aurora" },
      linkTo: "/projects/project-aurora/info",
    });

    expect(created.id).toBeTruthy();
    expect(service.listNotifications({ userId, workspaceId })).toHaveLength(1);

    service.markRead({ userId, workspaceId, notificationId: created.id, readAt: "2026-06-07T10:00:00.000Z" });
    expect(service.listNotifications({ userId, workspaceId })[0].readAt).toBe("2026-06-07T10:00:00.000Z");

    const outbox = database
      .prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE entity_type = 'notification' AND entity_id = ?")
      .get(created.id) as { count: number };
    expect(outbox.count).toBe(1);

    cleanup();
  });

  it("applies remote personal work rows without duplicating local state", () => {
    const { cleanup, database } = createTestDatabase("notification-local-remote-rows");
    applyNotificationLocalMigration(database);
    const service = createNotificationLocalService(database);

    const remoteTodo = {
      id: "22222222-2222-4222-8222-222222222222",
      user_id: userId,
      workspace_id: workspaceId,
      title: "Revisar factura",
      notes: "Pendiente de DGII",
      due_at: null,
      recurrence_rule: null,
      priority: 2,
      completed_at: null,
      created_by: "agent",
      agent_action_ref: { threadId: "thread-1" },
      created_at: "2026-06-07T09:00:00.000Z",
      updated_at: "2026-06-07T09:00:00.000Z",
    };

    service.applyRemoteRows({ table: "todos", rows: [remoteTodo, remoteTodo] });

    const todos = service.listTodos({ userId, workspaceId });
    expect(todos).toHaveLength(1);
    expect(todos[0].agentActionRef).toEqual({ threadId: "thread-1" });

    cleanup();
  });
});
