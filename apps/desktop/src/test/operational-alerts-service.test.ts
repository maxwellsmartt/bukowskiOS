import { describe, expect, it } from "vitest";

import { createOperationalAlertsService } from "../../electron/main/services/data/operationalAlertsService";
import {
  applyNotificationLocalMigration,
  createNotificationLocalService,
} from "../../electron/main/services/data/notificationLocalService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const WORKSPACE = "workspace-metadata";

const countAlerts = (database: ReturnType<typeof createTestDatabase>["database"], userId: string) =>
  (
    database
      .prepare(
        "SELECT COUNT(*) AS n FROM notifications WHERE workspace_id = ? AND user_id = ? AND kind = 'operational_alert'",
      )
      .get(WORKSPACE, userId) as { n: number }
  ).n;

describe("operational alerts service", () => {
  it("notifies coordinators of computed alerts and does not duplicate on re-sweep", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-alerts");
    const now = new Date().toISOString();

    // Two coordinators: an admin and a supervisor.
    for (const [id, role] of [
      ["user-alert-admin", "role-admin"],
      ["user-alert-sup", "role-supervisor"],
    ] as const) {
      database
        .prepare(
          `INSERT INTO users (id, full_name, email, phone, is_active, created_at, updated_at)
           VALUES (?, ?, ?, '', 1, ?, ?)`,
        )
        .run(id, id, `${id}@bukowskios.local`, now, now);
      database
        .prepare(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id, status, joined_at, created_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        )
        .run(`m-${id}`, WORKSPACE, id, role, now, now);
    }

    applyNotificationLocalMigration(database);
    const notifications = createNotificationLocalService(database);
    const foundationReads = {
      getPackingSlips: () => [
        { id: "slip-1", number: "PS-001", project: "Aurora", department: "CAM", dueDate: "2026-06-01", status: "Overdue" },
        { id: "slip-2", number: "PS-002", project: "Aurora", department: "GE", dueDate: "2026-06-02", status: "Returned" },
      ],
      getIncidents: () => [
        { id: "inc-1", title: "Lente rayado", project: "Aurora", severity: "High", status: "Open", costEstimate: "Pending" },
        { id: "inc-2", title: "Cable", project: "Aurora", severity: "Low", status: "Open", costEstimate: "RD$ 500" },
      ],
      getProjectConflicts: () => [{ a: 1 }, { a: 2 }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const service = createOperationalAlertsService(database, { foundationReads, notifications });

    // 3 alerts (1 overdue slip + 1 incident missing cost + 1 conflicts rollup).
    expect(service.computeAlerts()).toHaveLength(3);

    const first = service.runSweep(WORKSPACE);
    expect(first.alerts).toBe(3);
    // Each coordinator gets one notification per alert (admin + supervisor here,
    // plus any already-seeded coordinators). Our two get all three.
    expect(first.notified).toBeGreaterThanOrEqual(6);
    expect(countAlerts(database, "user-alert-admin")).toBe(3);
    expect(countAlerts(database, "user-alert-sup")).toBe(3);

    // Re-sweep: existing unread alerts must not be duplicated.
    const second = service.runSweep(WORKSPACE);
    expect(second.notified).toBe(0);
    expect(countAlerts(database, "user-alert-admin")).toBe(3);

    // Marking alerts as read must NOT cause them to re-fire on the next sweep
    // (dedup is by existence within the window, not by unread state).
    database
      .prepare(
        "UPDATE notifications SET read_at = ? WHERE workspace_id = ? AND user_id = ? AND kind = 'operational_alert'",
      )
      .run(now, WORKSPACE, "user-alert-admin");
    const third = service.runSweep(WORKSPACE);
    expect(countAlerts(database, "user-alert-admin")).toBe(3);
    expect(third.notified).toBe(0);

    cleanup();
  });
});
