import { describe, expect, it } from "vitest";

import { createOperationalSnapshotService, resolveOperationalSnapshot } from "../../electron/main/services/data/operationalSnapshotService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("operational snapshot service", () => {
  it("never serializes machine-local incident file paths", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-file-paths");
    try {
      database.prepare(
        `INSERT INTO incident_files (
           id, incident_id, file_url, file_type, uploaded_by_user_id, created_at,
           storage_path, original_name, byte_size, mime_type, status, deleted_at,
           content_hash, storage_object_key, updated_at
         ) VALUES (?, ?, ?, 'image', NULL, ?, ?, 'evidence.png', 10, 'image/png', 'available', NULL, ?, ?, ?)`,
      ).run(
        "incident-file-private-path",
        "incident-cine7-scratch",
        "/Users/operator/private/evidence.png",
        "2026-06-21T20:30:00.000Z",
        "/Users/operator/private/evidence.png",
        "hash-private-path",
        "workspace-metadata/incidents/incident-cine7-scratch/incident-file-private-path/evidence.png",
        "2026-06-21T20:30:00.000Z",
      );

      const snapshot = resolveOperationalSnapshot(database, {
        workspace_id: "workspace-metadata",
        entity_type: "incident",
        entity_id: "incident-cine7-scratch",
        updated_at: "2026-06-21T20:30:00.000Z",
      });
      const files = snapshot?.snapshot_json.files as Array<Record<string, unknown>>;

      expect(files[0]?.storage_path).toBeNull();
      expect(files[0]?.file_url).toBeNull();
      expect(JSON.stringify(snapshot)).not.toContain("/Users/operator/private");
      expect(files[0]?.storage_object_key).toContain("workspace-metadata/incidents/");
    } finally {
      cleanup();
    }
  });

  it("makes project snapshots self-contained for crew assignments", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-project-crew-catalog");
    try {
      const snapshot = resolveOperationalSnapshot(database, {
        workspace_id: "workspace-metadata",
        entity_type: "project",
        entity_id: "project-aurora",
        updated_at: "2026-06-19T12:00:00.000Z",
      });
      const crewMembers = snapshot?.snapshot_json.crewMembers as Array<{ id: string; full_name: string }>;
      expect(crewMembers.map((row) => row.id)).toEqual(expect.arrayContaining(["crew-user-paola", "crew-user-luis"]));
      expect(crewMembers.every((row) => Boolean(row.full_name))).toBe(true);
    } finally {
      cleanup();
    }
  });
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

  it("defers project snapshots when catalog references have not arrived yet", () => {
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
              client_name: null,
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

      expect(result.errors).toEqual([
        "project-remote-missing-catalog: Project references unavailable client client-not-local-yet; snapshot deferred.",
      ]);
      expect(result.appliedCount).toBe(0);
      expect(result.cursorAfter).toBeNull();

      const project = database
        .prepare("SELECT client_id, production_company_id FROM projects WHERE id = ?")
        .get("project-remote-missing-catalog");

      expect(project).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("adopts equivalent local catalog ids before applying a project snapshot", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-project-catalog-rekey");

    try {
      const localClient = database.prepare(
        "SELECT id, name FROM clients WHERE workspace_id = 'workspace-metadata' ORDER BY id LIMIT 1",
      ).get() as { id: string; name: string };

      const result = createOperationalSnapshotService(database).applyRemoteSnapshots(
        "workspace-metadata",
        "project",
        [{
          workspace_id: "workspace-metadata",
          entity_type: "project",
          entity_id: "project-with-equivalent-client",
          updated_at: "2026-05-06T12:05:00.000Z",
          deleted_at: null,
          snapshot_json: {
            project: {
              id: "project-with-equivalent-client",
              workspace_id: "workspace-metadata",
              code: "PEC",
              name: "Project with equivalent client",
              client_id: "client-server-canonical",
              client_name: localClient.name.toUpperCase(),
              production_company_id: null,
              production_company_name: null,
              status: "Prep",
              start_date: "2026-06-01",
              end_date: "2026-06-02",
              description: null,
              color_key: null,
              has_preproduction: 0,
              preproduction_start_date: null,
              preproduction_end_date: null,
              archived_at: null,
              created_at: "2026-05-06T12:05:00.000Z",
              updated_at: "2026-05-06T12:05:00.000Z",
            },
            units: [],
            unitWindows: [],
            projectDepartments: [],
            unitDepartments: [],
            crewAssignments: [],
          },
        }],
      );

      expect(result.errors).toEqual([]);
      expect(result.appliedCount).toBe(1);
      expect(database.prepare("SELECT 1 FROM clients WHERE id = ?").get(localClient.id)).toBeUndefined();
      expect(database.prepare("SELECT 1 FROM clients WHERE id = 'client-server-canonical'").get()).toBeTruthy();
      expect(
        (database.prepare("SELECT client_id FROM projects WHERE id = 'project-with-equivalent-client'").get() as { client_id: string }).client_id,
      ).toBe("client-server-canonical");
    } finally {
      cleanup();
    }
  });

  it("hydrates named legacy clients and reconciles encoded department ids", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-legacy-dependencies");

    try {
      const localDepartment = database.prepare(
        "SELECT id, code FROM departments WHERE workspace_id = 'workspace-metadata' ORDER BY id LIMIT 1",
      ).get() as { id: string; code: string };
      const canonicalDepartmentId = `department-${localDepartment.code.toLowerCase()}-remote`;
      const timestamp = "2026-05-06T12:06:00.000Z";

      const result = createOperationalSnapshotService(database).applyRemoteSnapshots(
        "workspace-metadata",
        "project",
        [{
          workspace_id: "workspace-metadata",
          entity_type: "project",
          entity_id: "project-legacy-dependencies",
          updated_at: timestamp,
          deleted_at: null,
          snapshot_json: {
            project: {
              id: "project-legacy-dependencies",
              workspace_id: "workspace-metadata",
              code: "PLD",
              name: "Legacy dependencies",
              client_id: "client-legacy-snapshot",
              client_name: "Legacy Snapshot Client",
              production_company_id: null,
              production_company_name: null,
              status: "Prep",
              start_date: "2026-06-01",
              end_date: "2026-06-02",
              description: null,
              color_key: null,
              has_preproduction: 0,
              preproduction_start_date: null,
              preproduction_end_date: null,
              archived_at: null,
              created_at: timestamp,
              updated_at: timestamp,
            },
            units: [],
            unitWindows: [],
            projectDepartments: [{
              project_id: "project-legacy-dependencies",
              department_id: canonicalDepartmentId,
              created_at: timestamp,
            }],
            unitDepartments: [],
            crewAssignments: [],
          },
        }],
      );

      expect(result.errors).toEqual([]);
      expect(result.appliedCount).toBe(1);
      expect(
        (database.prepare("SELECT name FROM clients WHERE id = 'client-legacy-snapshot'").get() as { name: string }).name,
      ).toBe("Legacy Snapshot Client");
      expect(database.prepare("SELECT 1 FROM departments WHERE id = ?").get(localDepartment.id)).toBeUndefined();
      expect(database.prepare("SELECT 1 FROM departments WHERE id = ?").get(canonicalDepartmentId)).toBeTruthy();
      expect(database.prepare(
        "SELECT 1 FROM project_departments WHERE project_id = 'project-legacy-dependencies' AND department_id = ?",
      ).get(canonicalDepartmentId)).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it("reconciles removed project children from remote snapshots", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-project-reconcile");

    try {
      const service = createOperationalSnapshotService(database);
      const projectId = "project-remote-reconcile";
      const unitId = "unit-remote-reconcile-main";
      const windowId = "window-remote-reconcile-main";
      const assignmentId = "assignment-remote-reconcile-paola";

      const baseProject = {
        id: projectId,
        workspace_id: "workspace-metadata",
        code: "RRC",
        name: "Remote Reconcile",
        client_name: null,
        status: "Prep",
        start_date: "2026-06-01",
        end_date: "2026-06-10",
        description: null,
        created_at: "2026-05-06T12:20:00.000Z",
        updated_at: "2026-05-06T12:20:00.000Z",
        client_id: null,
        color_key: null,
        production_company_id: null,
        production_company_name: null,
        has_preproduction: 0,
        preproduction_start_date: null,
        preproduction_end_date: null,
        archived_at: null,
      };
      const baseUnit = {
        id: unitId,
        workspace_id: "workspace-metadata",
        project_id: projectId,
        code: "MAIN",
        name: "Main Unit",
        sort_order: 0,
        status: "planned",
        status_source: "derived",
        color_key: null,
        start_date: "2026-06-01",
        end_date: "2026-06-10",
        notes: null,
        created_at: "2026-05-06T12:20:00.000Z",
        updated_at: "2026-05-06T12:20:00.000Z",
      };

      const first = service.applyRemoteSnapshots("workspace-metadata", "project", [
        {
          workspace_id: "workspace-metadata",
          entity_type: "project",
          entity_id: projectId,
          updated_at: "2026-05-06T12:20:00.000Z",
          deleted_at: null,
          snapshot_json: {
            project: baseProject,
            units: [baseUnit],
            unitWindows: [
              {
                id: windowId,
                project_unit_id: unitId,
                start_date: "2026-06-01",
                end_date: "2026-06-10",
                sort_order: 0,
                label: null,
                created_at: "2026-05-06T12:20:00.000Z",
                updated_at: "2026-05-06T12:20:00.000Z",
              },
            ],
            projectDepartments: [{ project_id: projectId, department_id: "dept-video", created_at: "2026-05-06T12:20:00.000Z" }],
            unitDepartments: [{ project_unit_id: unitId, department_id: "dept-video", created_at: "2026-05-06T12:20:00.000Z" }],
            crewAssignments: [
              {
                id: assignmentId,
                workspace_id: "workspace-metadata",
                project_unit_id: unitId,
                department_id: "dept-video",
                crew_member_id: "crew-user-paola",
                role_label: "VTR Operator",
                start_date: "2026-06-01",
                end_date: "2026-06-10",
                notes: null,
                created_at: "2026-05-06T12:20:00.000Z",
                updated_at: "2026-05-06T12:20:00.000Z",
              },
            ],
          },
        },
      ]);

      expect(first.errors).toEqual([]);
      expect(first.appliedCount).toBe(1);

      const second = service.applyRemoteSnapshots("workspace-metadata", "project", [
        {
          workspace_id: "workspace-metadata",
          entity_type: "project",
          entity_id: projectId,
          updated_at: "2026-05-06T12:21:00.000Z",
          deleted_at: null,
          snapshot_json: {
            project: { ...baseProject, updated_at: "2026-05-06T12:21:00.000Z" },
            units: [{ ...baseUnit, updated_at: "2026-05-06T12:21:00.000Z" }],
            unitWindows: [],
            projectDepartments: [],
            unitDepartments: [],
            crewAssignments: [],
          },
        },
      ]);

      expect(second.errors).toEqual([]);
      expect(second.appliedCount).toBe(1);

      const counts = database
        .prepare(
          `
            SELECT
              (SELECT COUNT(*) FROM project_unit_windows WHERE project_unit_id = ?) AS windows,
              (SELECT COUNT(*) FROM project_departments WHERE project_id = ?) AS project_departments,
              (SELECT COUNT(*) FROM project_unit_departments WHERE project_unit_id = ?) AS unit_departments,
              (SELECT COUNT(*) FROM project_unit_crew_assignments WHERE project_unit_id = ?) AS crew
          `,
        )
        .get(unitId, projectId, unitId, unitId) as {
        windows: number;
        project_departments: number;
        unit_departments: number;
        crew: number;
      };

      expect(counts).toEqual({ windows: 0, project_departments: 0, unit_departments: 0, crew: 0 });
    } finally {
      cleanup();
    }
  });

  it("merges equivalent project crew assignments from remote snapshots when ids differ", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-project-crew-dedupe");

    try {
      const service = createOperationalSnapshotService(database);
      const projectId = "project-remote-crew-dedupe";
      const unitId = "unit-remote-crew-dedupe-main";
      const timestamp = "2026-05-06T12:24:00.000Z";

      const result = service.applyRemoteSnapshots("workspace-metadata", "project", [
        {
          workspace_id: "workspace-metadata",
          entity_type: "project",
          entity_id: projectId,
          updated_at: timestamp,
          deleted_at: null,
          snapshot_json: {
            project: {
              id: projectId,
              workspace_id: "workspace-metadata",
              code: "RCD",
              name: "Remote Crew Dedupe",
              client_name: null,
              status: "Prep",
              start_date: "2026-06-01",
              end_date: "2026-06-10",
              description: null,
              created_at: timestamp,
              updated_at: timestamp,
              client_id: null,
              color_key: null,
              production_company_id: null,
              production_company_name: null,
              has_preproduction: 0,
              preproduction_start_date: null,
              preproduction_end_date: null,
              archived_at: null,
            },
            units: [
              {
                id: unitId,
                workspace_id: "workspace-metadata",
                project_id: projectId,
                code: "MAIN",
                name: "Main Unit",
                sort_order: 0,
                status: "planned",
                status_source: "derived",
                color_key: null,
                start_date: "2026-06-01",
                end_date: "2026-06-10",
                notes: null,
                created_at: timestamp,
                updated_at: timestamp,
              },
            ],
            unitWindows: [],
            projectDepartments: [{ project_id: projectId, department_id: "dept-video", created_at: timestamp }],
            unitDepartments: [{ project_unit_id: unitId, department_id: "dept-video", created_at: timestamp }],
            crewAssignments: [
              {
                id: "assignment-remote-crew-dedupe-a",
                workspace_id: "workspace-metadata",
                project_unit_id: unitId,
                department_id: "dept-video",
                crew_member_id: "crew-user-paola",
                role_label: "Video Assist",
                start_date: "2026-06-01",
                end_date: "2026-06-10",
                notes: null,
                created_at: timestamp,
                updated_at: timestamp,
              },
              {
                id: "assignment-remote-crew-dedupe-b",
                workspace_id: "workspace-metadata",
                project_unit_id: unitId,
                department_id: "dept-video",
                crew_member_id: "crew-user-paola",
                role_label: "Video Assist Lead",
                start_date: "2026-06-01",
                end_date: "2026-06-10",
                notes: "latest remote copy",
                created_at: timestamp,
                updated_at: "2026-05-06T12:25:00.000Z",
              },
            ],
          },
        },
      ]);

      expect(result.errors).toEqual([]);
      expect(result.appliedCount).toBe(1);

      const assignment = database
        .prepare(
          `
            SELECT COUNT(*) AS count, MAX(role_label) AS role_label, MAX(notes) AS notes
            FROM project_unit_crew_assignments
            WHERE project_unit_id = ?
              AND department_id = 'dept-video'
              AND crew_member_id = 'crew-user-paola'
          `,
        )
        .get(unitId) as { count: number; role_label: string | null; notes: string | null };

      expect(assignment).toEqual({ count: 1, role_label: "Video Assist Lead", notes: "latest remote copy" });
    } finally {
      cleanup();
    }
  });

  it("rejects project snapshots that do not match the synced entity", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-project-scope");

    try {
      const service = createOperationalSnapshotService(database);
      const result = service.applyRemoteSnapshots("workspace-metadata", "project", [
        {
          workspace_id: "workspace-metadata",
          entity_type: "project",
          entity_id: "project-remote-expected",
          updated_at: "2026-05-06T12:25:00.000Z",
          deleted_at: null,
          snapshot_json: {
            project: {
              id: "project-remote-poison",
              workspace_id: "workspace-metadata",
              code: "BAD",
              name: "Poisoned Project",
              client_name: null,
              status: "Prep",
              start_date: "2026-06-01",
              end_date: "2026-06-10",
              description: null,
              created_at: "2026-05-06T12:25:00.000Z",
              updated_at: "2026-05-06T12:25:00.000Z",
              client_id: null,
              color_key: null,
              production_company_id: null,
              production_company_name: null,
              has_preproduction: 0,
              preproduction_start_date: null,
              preproduction_end_date: null,
              archived_at: null,
            },
            units: [],
            unitWindows: [],
            projectDepartments: [],
            unitDepartments: [],
            crewAssignments: [],
          },
        },
      ]);

      expect(result.appliedCount).toBe(0);
      expect(result.errors[0]).toContain("does not match the synced entity");
      expect(database.prepare("SELECT COUNT(*) AS count FROM projects WHERE id = ?").get("project-remote-poison")).toEqual({ count: 0 });
    } finally {
      cleanup();
    }
  });

  it("rolls back project mutations and deletions when a remote snapshot fails", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-row-rollback");

    try {
      const service = createOperationalSnapshotService(database);
      const projectId = "project-remote-rollback";
      const unitId = "unit-remote-rollback";
      const localUpdatedAt = "2026-05-06T12:20:00.000Z";
      const remoteUpdatedAt = "2026-05-06T12:21:00.000Z";

      database
        .prepare(
          `
            INSERT INTO projects (
              id, workspace_id, code, name, client_id, client_name, production_company_id,
              production_company_name, status, start_date, end_date, has_preproduction,
              preproduction_start_date, preproduction_end_date, color_key, description,
              archived_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 'Prep', ?, ?, 0, NULL, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          projectId,
          "workspace-metadata",
          "ROLLBACK",
          "Original Project Name",
          "2026-06-01",
          "2026-06-10",
          localUpdatedAt,
          localUpdatedAt,
        );
      database
        .prepare(
          `
            INSERT INTO project_units (
              id, workspace_id, project_id, code, name, sort_order, status, status_source,
              color_key, start_date, end_date, notes, created_at, updated_at
            )
            VALUES (?, ?, ?, 'MAIN', 'Original Unit', 0, 'planned', 'derived', NULL, ?, ?, NULL, ?, ?)
          `,
        )
        .run(unitId, "workspace-metadata", projectId, "2026-06-01", "2026-06-10", localUpdatedAt, localUpdatedAt);

      const result = service.applyRemoteSnapshots("workspace-metadata", "project", [
        {
          workspace_id: "workspace-metadata",
          entity_type: "project",
          entity_id: projectId,
          updated_at: remoteUpdatedAt,
          deleted_at: null,
          snapshot_json: {
            project: {
              id: projectId,
              workspace_id: "workspace-metadata",
              code: "ROLLBACK",
              name: "Partially Applied Remote Name",
              client_id: null,
              client_name: null,
              production_company_id: null,
              production_company_name: null,
              status: "Prep",
              start_date: "2026-06-01",
              end_date: "2026-06-10",
              has_preproduction: 0,
              preproduction_start_date: null,
              preproduction_end_date: null,
              color_key: null,
              description: null,
              archived_at: null,
              created_at: localUpdatedAt,
              updated_at: remoteUpdatedAt,
            },
            units: [],
            unitWindows: [],
            projectDepartments: [
              { project_id: projectId, department_id: "department-not-local-yet", created_at: remoteUpdatedAt },
            ],
            unitDepartments: [],
            crewAssignments: [],
          },
        },
      ]);

      expect(result.appliedCount).toBe(0);
      expect(result.errors[0]).toContain("department-not-local-yet");
      expect(database.prepare("SELECT name, updated_at FROM projects WHERE id = ?").get(projectId)).toEqual({
        name: "Original Project Name",
        updated_at: localUpdatedAt,
      });
      expect(database.prepare("SELECT name FROM project_units WHERE id = ?").get(unitId)).toEqual({ name: "Original Unit" });
    } finally {
      cleanup();
    }
  });

  it("ignores project snapshot children outside the synced project scope", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-project-child-scope");

    try {
      const service = createOperationalSnapshotService(database);
      const projectId = "project-remote-safe";
      const validUnitId = "unit-remote-safe-main";
      const poisonedUnitId = "unit-remote-poison";
      const result = service.applyRemoteSnapshots("workspace-metadata", "project", [
        {
          workspace_id: "workspace-metadata",
          entity_type: "project",
          entity_id: projectId,
          updated_at: "2026-05-06T12:30:00.000Z",
          deleted_at: null,
          snapshot_json: {
            project: {
              id: projectId,
              workspace_id: "workspace-metadata",
              code: "SAFE",
              name: "Safe Project",
              client_name: null,
              status: "Prep",
              start_date: "2026-06-01",
              end_date: "2026-06-10",
              description: null,
              created_at: "2026-05-06T12:30:00.000Z",
              updated_at: "2026-05-06T12:30:00.000Z",
              client_id: null,
              color_key: null,
              production_company_id: null,
              production_company_name: null,
              has_preproduction: 0,
              preproduction_start_date: null,
              preproduction_end_date: null,
              archived_at: null,
            },
            units: [
              {
                id: validUnitId,
                workspace_id: "workspace-metadata",
                project_id: projectId,
                code: "MAIN",
                name: "Main Unit",
                sort_order: 0,
                status: "planned",
                status_source: "derived",
                color_key: null,
                start_date: "2026-06-01",
                end_date: "2026-06-10",
                notes: null,
                created_at: "2026-05-06T12:30:00.000Z",
                updated_at: "2026-05-06T12:30:00.000Z",
              },
              {
                id: poisonedUnitId,
                workspace_id: "workspace-metadata",
                project_id: "project-aurora",
                code: "BAD",
                name: "Bad Unit",
                sort_order: 0,
                status: "planned",
                status_source: "derived",
                color_key: null,
                start_date: "2026-06-01",
                end_date: "2026-06-10",
                notes: null,
                created_at: "2026-05-06T12:30:00.000Z",
                updated_at: "2026-05-06T12:30:00.000Z",
              },
            ],
            unitWindows: [],
            projectDepartments: [],
            unitDepartments: [{ project_unit_id: poisonedUnitId, department_id: "dept-video", created_at: "2026-05-06T12:30:00.000Z" }],
            crewAssignments: [
              {
                id: "assignment-remote-poison",
                workspace_id: "workspace-metadata",
                project_unit_id: poisonedUnitId,
                department_id: "dept-video",
                crew_member_id: "crew-user-paola",
                role_label: "Bad Link",
                start_date: "2026-06-01",
                end_date: "2026-06-10",
                notes: null,
                created_at: "2026-05-06T12:30:00.000Z",
                updated_at: "2026-05-06T12:30:00.000Z",
              },
            ],
          },
        },
      ]);

      expect(result.errors).toEqual([]);
      expect(result.appliedCount).toBe(1);
      expect(database.prepare("SELECT COUNT(*) AS count FROM project_units WHERE id = ?").get(validUnitId)).toEqual({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM project_units WHERE id = ?").get(poisonedUnitId)).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM project_unit_crew_assignments WHERE id = ?").get("assignment-remote-poison")).toEqual({ count: 0 });
    } finally {
      cleanup();
    }
  });

  it("resolves a tombstone snapshot when an outbound operational entity no longer exists locally", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-tombstone");

    try {
      const service = createOperationalSnapshotService(database);
      const snapshot = service.resolveSnapshot({
        workspace_id: "workspace-metadata",
        entity_type: "project",
        entity_id: "project-already-removed",
        updated_at: "2026-05-06T12:06:00.000Z",
      });

      expect(snapshot).toEqual({
        workspace_id: "workspace-metadata",
        entity_type: "project",
        entity_id: "project-already-removed",
        snapshot_json: {},
        updated_at: "2026-05-06T12:06:00.000Z",
        deleted_at: "2026-05-06T12:06:00.000Z",
      });
    } finally {
      cleanup();
    }
  });

  it("applies remote project tombstones to remove local project snapshots", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-project-tombstone-apply");

    try {
      const service = createOperationalSnapshotService(database);
      database
        .prepare(
          `
            INSERT INTO projects (
              id, workspace_id, code, name, client_id, client_name, production_company_id,
              production_company_name, status, start_date, end_date, has_preproduction,
              preproduction_start_date, preproduction_end_date, color_key, description,
              archived_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 'Prep', ?, ?, 0, NULL, NULL, NULL, NULL, NULL, ?, ?)
          `,
        )
        .run(
          "project-remote-tombstone",
          "workspace-metadata",
          "RDT",
          "Remote Delete Target",
          "2026-06-01",
          "2026-06-10",
          "2026-05-06T12:35:00.000Z",
          "2026-05-06T12:35:00.000Z",
        );
      database
        .prepare(
          `
            INSERT INTO project_units (
              id, workspace_id, project_id, code, name, sort_order, status, status_source,
              color_key, start_date, end_date, notes, created_at, updated_at
            )
            VALUES (?, ?, ?, 'MAIN', 'Main Unit', 0, 'planned', 'derived', NULL, ?, ?, NULL, ?, ?)
          `,
        )
        .run(
          "unit-remote-tombstone-main",
          "workspace-metadata",
          "project-remote-tombstone",
          "2026-06-01",
          "2026-06-10",
          "2026-05-06T12:35:00.000Z",
          "2026-05-06T12:35:00.000Z",
        );
      database
        .prepare("INSERT INTO project_unit_departments (project_unit_id, department_id, created_at) VALUES (?, ?, ?)")
        .run("unit-remote-tombstone-main", "dept-video", "2026-05-06T12:35:00.000Z");

      const result = service.applyRemoteSnapshots("workspace-metadata", "project", [
        {
          workspace_id: "workspace-metadata",
          entity_type: "project",
          entity_id: "project-remote-tombstone",
          updated_at: "2026-05-06T12:36:00.000Z",
          deleted_at: "2026-05-06T12:36:00.000Z",
          snapshot_json: {},
        },
      ]);

      expect(result.errors).toEqual([]);
      expect(result.appliedCount).toBe(1);
      expect(database.prepare("SELECT COUNT(*) AS count FROM projects WHERE id = ?").get("project-remote-tombstone")).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM project_units WHERE project_id = ?").get("project-remote-tombstone")).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM project_unit_departments WHERE project_unit_id = ?").get("unit-remote-tombstone-main")).toEqual({ count: 0 });
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

  it("defers a packing snapshot with a missing asset without leaving a partial slip", () => {
    const { cleanup, database } = createTestDatabase("bukowski-operational-snapshot-packing-rollback");

    try {
      const service = createOperationalSnapshotService(database);
      const packingSlipId = "packing-remote-missing-asset";
      const updatedAt = "2026-05-06T12:12:00.000Z";
      const result = service.applyRemoteSnapshots("workspace-metadata", "packing_slip", [
        {
          workspace_id: "workspace-metadata",
          entity_type: "packing_slip",
          entity_id: packingSlipId,
          updated_at: updatedAt,
          deleted_at: null,
          snapshot_json: {
            packingSlip: {
              id: packingSlipId,
              workspace_id: "workspace-metadata",
              project_id: "project-archipielago",
              project_unit_id: "unit-arch-main",
              department_id: null,
              prepared_by_user_id: "user-ops",
              approved_by_user_id: null,
              responsible_user_id: "user-ops",
              lifecycle_state: "operational",
              status: "Issued",
              issue_date: updatedAt,
              return_due_date: null,
              notes: "Must roll back",
              created_at: updatedAt,
              updated_at: updatedAt,
            },
            items: [
              {
                id: "packing-item-before-missing-asset",
                packing_slip_id: packingSlipId,
                asset_id: "asset-smallhd-cine7",
                quantity: 1,
                condition_out: "Good",
                condition_in: null,
                returned_at: null,
                notes: null,
                source_flow: "available",
              },
              {
                id: "packing-item-missing-asset",
                packing_slip_id: packingSlipId,
                asset_id: "asset-not-local-yet",
                quantity: 1,
                condition_out: "Good",
                condition_in: null,
                returned_at: null,
                notes: null,
                source_flow: "available",
              },
            ],
          },
        },
      ]);

      expect(result.appliedCount).toBe(0);
      expect(result.errors).toEqual([
        `${packingSlipId}: Packing item references unavailable asset asset-not-local-yet; snapshot deferred.`,
      ]);
      expect(database.prepare("SELECT COUNT(*) AS count FROM packing_slips WHERE id = ?").get(packingSlipId)).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM packing_slip_items WHERE packing_slip_id = ?").get(packingSlipId)).toEqual({ count: 0 });
    } finally {
      cleanup();
    }
  });
});
