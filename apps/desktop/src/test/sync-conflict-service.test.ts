import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import {
  applyOperationalSnapshotLocally,
  createOperationalSnapshotService,
} from "../../electron/main/services/data/operationalSnapshotService";
import { applyFinancialEntryLocally } from "../../electron/main/services/data/financialDomainPullService";
import { createFinancialDomainPullService } from "../../electron/main/services/data/financialDomainPullService";
import { createSyncConflictService } from "../../electron/main/services/data/syncConflictService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const WORKSPACE = "workspace-metadata";
const INCIDENT_ID = "incident-cine7-scratch";
const FINANCIAL_ENTRY_ID = "entry-incident-reserve";

const enqueuePendingOutbox = (db: DatabaseSync, entityType: string, entityId: string) => {
  db.prepare(
    `
      INSERT INTO sync_outbox (
        id, workspace_id, entity_type, entity_id, event_id, operation_type,
        payload_json, status, attempt_count, last_error, next_retry_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, NULL, 'update', '{}', 'pending', 0, NULL, NULL, ?, ?)
    `,
  ).run(`outbox-${entityType}-${entityId}`, WORKSPACE, entityType, entityId, "2026-06-22T00:00:00.000Z", "2026-06-22T00:00:00.000Z");
};

const buildAppliers = () => ({
  packing_slip: (db: DatabaseSync, conflict: { workspaceId: string; entityId: string; remoteSnapshot: Record<string, unknown> | null }) =>
    applyOperationalSnapshotLocally(db, {
      workspaceId: conflict.workspaceId,
      entityType: "packing_slip" as const,
      entityId: conflict.entityId,
      remoteSnapshot: conflict.remoteSnapshot,
    }),
  incident: (db: DatabaseSync, conflict: { workspaceId: string; entityId: string; remoteSnapshot: Record<string, unknown> | null }) =>
    applyOperationalSnapshotLocally(db, {
      workspaceId: conflict.workspaceId,
      entityType: "incident" as const,
      entityId: conflict.entityId,
      remoteSnapshot: conflict.remoteSnapshot,
    }),
  rma_case: (db: DatabaseSync, conflict: { workspaceId: string; entityId: string; remoteSnapshot: Record<string, unknown> | null }) =>
    applyOperationalSnapshotLocally(db, {
      workspaceId: conflict.workspaceId,
      entityType: "rma_case" as const,
      entityId: conflict.entityId,
      remoteSnapshot: conflict.remoteSnapshot,
    }),
  financial_entry: (db: DatabaseSync, conflict: { remoteSnapshot: Record<string, unknown> | null }) =>
    applyFinancialEntryLocally(db, conflict.remoteSnapshot),
});

const readIncidentTitle = (db: DatabaseSync, id: string) =>
  (db.prepare("SELECT title FROM incidents WHERE id = ?").get(id) as { title: string } | undefined)?.title ?? null;

const buildRemoteIncidentRow = (db: DatabaseSync, nextTitle: string) => {
  const incident = db.prepare("SELECT * FROM incidents WHERE id = ?").get(INCIDENT_ID) as Record<string, unknown>;
  return {
    workspace_id: WORKSPACE,
    entity_type: "incident" as const,
    entity_id: INCIDENT_ID,
    snapshot_json: { incident: { ...incident, title: nextTitle, updated_at: "2026-06-23T00:00:00.000Z" }, files: [] },
    updated_at: "2026-06-23T00:00:00.000Z",
  };
};

describe("sync conflict service", () => {
  it("captures a conflict when a sensitive remote change collides with a pending local change", () => {
    const { cleanup, database } = createTestDatabase("bukowski-conflict-capture");
    try {
      enqueuePendingOutbox(database, "incident", INCIDENT_ID);
      const service = createOperationalSnapshotService(database);

      const result = service.applyRemoteSnapshots(WORKSPACE, "incident", [buildRemoteIncidentRow(database, "REMOTE TITLE")]);

      expect(result.skippedDueToOutboxCount).toBe(1);
      expect(result.appliedCount).toBe(0);

      const conflicts = createSyncConflictService(database, { appliers: buildAppliers() }).listConflicts(WORKSPACE);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.entityType).toBe("incident");
      expect(conflicts[0]?.entityId).toBe(INCIDENT_ID);
      expect(conflicts[0]?.remoteSnapshotJson).toContain("REMOTE TITLE");
      // The local incident is untouched until the user decides.
      expect(readIncidentTitle(database, INCIDENT_ID)).not.toBe("REMOTE TITLE");
    } finally {
      cleanup();
    }
  });

  it("does not capture conflicts for non-sensitive entities", () => {
    const { cleanup, database } = createTestDatabase("bukowski-conflict-nonsensitive");
    try {
      enqueuePendingOutbox(database, "project", "project-aurora");
      const service = createOperationalSnapshotService(database);

      const result = service.applyRemoteSnapshots(WORKSPACE, "project", [
        {
          workspace_id: WORKSPACE,
          entity_type: "project",
          entity_id: "project-aurora",
          snapshot_json: {},
          updated_at: "2026-06-23T00:00:00.000Z",
        },
      ]);

      expect(result.skippedDueToOutboxCount).toBe(1);
      const conflicts = createSyncConflictService(database, { appliers: buildAppliers() }).listConflicts(WORKSPACE);
      expect(conflicts).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("take_remote applies the cloud version and clears the pending local change", () => {
    const { cleanup, database } = createTestDatabase("bukowski-conflict-take-remote");
    try {
      enqueuePendingOutbox(database, "incident", INCIDENT_ID);
      createOperationalSnapshotService(database).applyRemoteSnapshots(WORKSPACE, "incident", [
        buildRemoteIncidentRow(database, "REMOTE TITLE"),
      ]);

      const conflictService = createSyncConflictService(database, { appliers: buildAppliers() });
      const conflictId = conflictService.listConflicts(WORKSPACE)[0]!.id;

      const resolved = conflictService.resolveConflict(conflictId, "take_remote");

      expect(resolved?.status).toBe("resolved");
      expect(resolved?.resolution).toBe("take_remote");
      expect(readIncidentTitle(database, INCIDENT_ID)).toBe("REMOTE TITLE");
      const pending = database
        .prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE entity_type = 'incident' AND entity_id = ? AND status IN ('pending','processing','failed')")
        .get(INCIDENT_ID) as { count: number };
      expect(pending.count).toBe(0);
      expect(conflictService.listConflicts(WORKSPACE)).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("keep_local resolves the conflict without touching local data or the outbox", () => {
    const { cleanup, database } = createTestDatabase("bukowski-conflict-keep-local");
    try {
      const localTitle = readIncidentTitle(database, INCIDENT_ID);
      enqueuePendingOutbox(database, "incident", INCIDENT_ID);
      createOperationalSnapshotService(database).applyRemoteSnapshots(WORKSPACE, "incident", [
        buildRemoteIncidentRow(database, "REMOTE TITLE"),
      ]);

      const conflictService = createSyncConflictService(database, { appliers: buildAppliers() });
      const conflictId = conflictService.listConflicts(WORKSPACE)[0]!.id;

      const resolved = conflictService.resolveConflict(conflictId, "keep_local");

      expect(resolved?.status).toBe("resolved");
      expect(resolved?.resolution).toBe("keep_local");
      expect(readIncidentTitle(database, INCIDENT_ID)).toBe(localTitle);
      const pending = database
        .prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE entity_type = 'incident' AND entity_id = ? AND status = 'pending'")
        .get(INCIDENT_ID) as { count: number };
      expect(pending.count).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("captures and resolves a financial_entry conflict from the finance pull", () => {
    const { cleanup, database } = createTestDatabase("bukowski-conflict-finance");
    try {
      enqueuePendingOutbox(database, "financial_entry", FINANCIAL_ENTRY_ID);
      const local = database.prepare("SELECT * FROM financial_entries WHERE id = ?").get(FINANCIAL_ENTRY_ID) as Record<string, unknown>;
      const remoteRow = { ...local, amount: 999, base_currency_amount: 999, updated_at: "2026-06-23T00:00:00.000Z" };

      const finance = createFinancialDomainPullService(database);
      const result = finance.applyRemoteFinanceBusinessRows(WORKSPACE, "financial_entries", [remoteRow]);
      expect(result.skippedDueToOutboxCount).toBe(1);

      const conflictService = createSyncConflictService(database, { appliers: buildAppliers() });
      const conflictId = conflictService.listConflicts(WORKSPACE)[0]!.id;
      expect(conflictId).toBeTruthy();

      conflictService.resolveConflict(conflictId, "take_remote");
      const amount = (database.prepare("SELECT amount FROM financial_entries WHERE id = ?").get(FINANCIAL_ENTRY_ID) as { amount: number }).amount;
      expect(amount).toBe(999);
    } finally {
      cleanup();
    }
  });
});
