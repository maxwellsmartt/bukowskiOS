import { describe, expect, it } from "vitest";

import { createOperationalSnapshotService } from "../../electron/main/services/data/operationalSnapshotService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("operational snapshot service", () => {
  it("queues historical operational snapshots idempotently", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshots");

    try {
      database.prepare("DELETE FROM sync_outbox").run();

      const service = createOperationalSnapshotService(database);
      const first = service.enqueueBackfill("workspace-metadata");

      expect(first.enqueuedCount).toBeGreaterThan(0);
      expect(first.byEntityType.map((row) => row.entityType)).toEqual([
        "project",
        "packing_slip",
        "incident",
        "rma_case",
      ]);

      const queued = database
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM sync_outbox
            WHERE operation_type = 'snapshot_backfill'
          `,
        )
        .get() as { count: number };

      expect(queued.count).toBe(first.enqueuedCount);

      database
        .prepare(
          `
            UPDATE sync_outbox
            SET status = 'sent'
            WHERE operation_type = 'snapshot_backfill'
          `,
        )
        .run();

      const second = service.enqueueBackfill("workspace-metadata");
      expect(second.enqueuedCount).toBe(0);
      expect(second.skippedCount).toBe(first.enqueuedCount);
    } finally {
      cleanup();
    }
  });

  it("keeps the pull cursor before failed remote rows so they retry", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-retry");

    try {
      const service = createOperationalSnapshotService(database);
      const result = service.applyRemoteSnapshots("workspace-metadata", "packing_slip", [
        {
          workspace_id: "workspace-metadata",
          entity_type: "packing_slip",
          entity_id: "packing-retry-missing-project",
          updated_at: "2026-05-06T12:00:00.000Z",
          deleted_at: null,
          snapshot_json: {
            packingSlip: {
              id: "packing-retry-missing-project",
              workspace_id: "workspace-metadata",
              project_id: "project-not-local-yet",
              project_unit_id: null,
              department_id: null,
              prepared_by_user_id: "user-ops",
              approved_by_user_id: null,
              responsible_user_id: null,
              lifecycle_state: "operational",
              status: "Issued",
              issue_date: "2026-05-06T12:00:00.000Z",
              return_due_date: null,
              notes: null,
              created_at: "2026-05-06T12:00:00.000Z",
              updated_at: "2026-05-06T12:00:00.000Z",
            },
            items: [],
          },
        },
      ]);

      expect(result.appliedCount).toBe(0);
      expect(result.errors[0]).toContain("project-not-local-yet");
      expect(result.cursorAfter).toBeNull();

      const cursor = database
        .prepare("SELECT last_synced_at, last_error FROM sync_pull_cursors WHERE entity_type = 'packing_slips'")
        .get() as { last_synced_at: string | null; last_error: string | null } | undefined;

      expect(cursor?.last_synced_at).toBeNull();
      expect(cursor?.last_error).toContain("project-not-local-yet");
    } finally {
      cleanup();
    }
  });

  it("applies project snapshots even when optional catalog references are missing", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-project-fk");

    try {
      const service = createOperationalSnapshotService(database);
      const result = service.applyRemoteSnapshots("workspace-metadata", "project", [
        {
          workspace_id: "workspace-metadata",
          entity_type: "project",
          entity_id: "project-remote-missing-catalog",
          updated_at: "2026-05-06T12:05:00.000Z",
          deleted_at: null,
          snapshot_json: {
            project: {
              id: "project-remote-missing-catalog",
              workspace_id: "workspace-metadata",
              code: "RMC",
              name: "Remote Missing Catalog",
              client_name: "Remote Client Snapshot",
              status: "Prep",
              start_date: "2026-06-01",
              end_date: "2026-06-02",
              description: null,
              created_at: "2026-05-06T12:05:00.000Z",
              updated_at: "2026-05-06T12:05:00.000Z",
              client_id: "client-not-local-yet",
              color_key: null,
              production_company_id: "production-company-not-local-yet",
              production_company_name: "Remote Production Snapshot",
              has_preproduction: 0,
              preproduction_start_date: null,
              preproduction_end_date: null,
              archived_at: null,
            },
            units: [],
            unitWindows: [],
            projectDepartments: [
              {
                project_id: "project-remote-missing-catalog",
                department_id: "department-not-local-yet",
                created_at: "2026-05-06T12:05:00.000Z",
              },
            ],
            unitDepartments: [],
            crewAssignments: [],
          },
        },
      ]);

      expect(result.errors).toEqual([]);
      expect(result.appliedCount).toBe(1);

      const project = database
        .prepare("SELECT client_id, production_company_id FROM projects WHERE id = ?")
        .get("project-remote-missing-catalog") as { client_id: string | null; production_company_id: string | null };

      expect(project.client_id).toBeNull();
      expect(project.production_company_id).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("upserts packing items by slip and asset when remote ids differ", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-packing-item");

    try {
      const service = createOperationalSnapshotService(database);
      database
        .prepare(
          `
            INSERT INTO packing_slips (
              id, workspace_id, project_id, project_unit_id, department_id, prepared_by_user_id,
              approved_by_user_id, responsible_user_id, lifecycle_state, status, issue_date,
              return_due_date, notes, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, 'operational', 'Issued', ?, NULL, NULL, ?, ?)
          `,
        )
        .run(
          "packing-remote-composite",
          "workspace-metadata",
          "project-archipielago",
          "unit-arch-main",
          "user-ops",
          "user-ops",
          "2026-05-06T12:10:00.000Z",
          "2026-05-06T12:10:00.000Z",
          "2026-05-06T12:10:00.000Z",
        );
      database
        .prepare(
          `
            INSERT INTO packing_slip_items (
              id, packing_slip_id, asset_id, quantity, condition_out, condition_in, returned_at, notes, source_flow
            )
            VALUES (?, ?, ?, 1, 'Good', NULL, NULL, NULL, 'available')
          `,
        )
        .run("packing-item-local-id", "packing-remote-composite", "asset-smallhd-cine7");

      const result = service.applyRemoteSnapshots("workspace-metadata", "packing_slip", [
        {
          workspace_id: "workspace-metadata",
          entity_type: "packing_slip",
          entity_id: "packing-remote-composite",
          updated_at: "2026-05-06T12:11:00.000Z",
          deleted_at: null,
          snapshot_json: {
            packingSlip: {
              id: "packing-remote-composite",
              workspace_id: "workspace-metadata",
              project_id: "project-archipielago",
              project_unit_id: "unit-arch-main",
              department_id: null,
              prepared_by_user_id: "user-ops",
              approved_by_user_id: null,
              responsible_user_id: "user-ops",
              lifecycle_state: "operational",
              status: "Issued",
              issue_date: "2026-05-06T12:10:00.000Z",
              return_due_date: null,
              notes: null,
              created_at: "2026-05-06T12:10:00.000Z",
              updated_at: "2026-05-06T12:11:00.000Z",
            },
            items: [
              {
                id: "packing-item-remote-id",
                packing_slip_id: "packing-remote-composite",
                asset_id: "asset-smallhd-cine7",
                quantity: 2,
                condition_out: "Good",
                condition_in: null,
                returned_at: null,
                notes: "Remote quantity changed.",
                source_flow: "available",
              },
            ],
          },
        },
      ]);

      expect(result.errors).toEqual([]);
      expect(result.appliedCount).toBe(1);

      const item = database
        .prepare("SELECT id, quantity, notes FROM packing_slip_items WHERE packing_slip_id = ? AND asset_id = ?")
        .get("packing-remote-composite", "asset-smallhd-cine7") as { id: string; quantity: number; notes: string };

      expect(item.id).toBe("packing-item-remote-id");
      expect(item.quantity).toBe(2);
      expect(item.notes).toBe("Remote quantity changed.");
    } finally {
      cleanup();
    }
  });
});
