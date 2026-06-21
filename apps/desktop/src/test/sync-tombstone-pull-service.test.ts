import { describe, expect, it } from "vitest";

import { applyNotificationLocalMigration } from "../../electron/main/services/data/notificationLocalService";
import { createSyncTombstonePullService } from "../../electron/main/services/data/syncTombstonePullService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("sync tombstone pull service", () => {
  it("removes a local row deleted by another machine", () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-tombstone-delete");
    const workspaceId = "workspace-metadata";
    database.prepare(
      `INSERT INTO locations (id, workspace_id, code, name, type, is_active, created_at, updated_at)
       VALUES ('location-remote-delete', ?, 'DEL', 'Delete me', 'warehouse', 1, ?, ?)`,
    ).run(workspaceId, "2026-06-19T10:00:00.000Z", "2026-06-19T10:00:00.000Z");

    const result = createSyncTombstonePullService(database).apply(workspaceId, [{
      workspace_id: workspaceId,
      table_name: "locations",
      entity_id: "location-remote-delete",
      deleted_at: "2026-06-19T11:00:00.000Z",
    }]);

    expect(result.errors).toEqual([]);
    expect(result.appliedCount).toBe(1);
    expect(database.prepare("SELECT id FROM locations WHERE id = ?").get("location-remote-delete")).toBeUndefined();
    cleanup();
  });

  it("does not delete a row with an unsent local mutation", () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-tombstone-pending");
    const workspaceId = "workspace-metadata";
    database.prepare(
      `INSERT INTO locations (id, workspace_id, code, name, type, is_active, created_at, updated_at)
       VALUES ('location-local-pending', ?, 'KEEP', 'Keep me', 'warehouse', 1, ?, ?)`,
    ).run(workspaceId, "2026-06-19T10:00:00.000Z", "2026-06-19T10:00:00.000Z");
    database.prepare(
      `INSERT INTO sync_outbox (
        id, workspace_id, entity_type, entity_id, operation_type, payload_json,
        status, attempt_count, created_at, updated_at
      ) VALUES ('pending-location', ?, 'location', 'location-local-pending', 'upsert', '{}', 'pending', 0, ?, ?)`,
    ).run(workspaceId, "2026-06-19T10:30:00.000Z", "2026-06-19T10:30:00.000Z");

    const result = createSyncTombstonePullService(database).apply(workspaceId, [{
      workspace_id: workspaceId,
      table_name: "locations",
      entity_id: "location-local-pending",
      deleted_at: "2026-06-19T11:00:00.000Z",
    }]);

    expect(result.skippedDueToOutboxCount).toBe(1);
    expect(database.prepare("SELECT id FROM locations WHERE id = ?").get("location-local-pending")).toBeTruthy();
    expect(
      (database.prepare(
        "SELECT last_synced_at FROM sync_pull_cursors WHERE workspace_id = ? AND entity_type = 'sync_tombstones'",
      ).get(workspaceId) as { last_synced_at: string | null }).last_synced_at,
    ).toBeNull();
    cleanup();
  });

  it("uses updated_at to protect a recreated transaction link", () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-tombstone-link-freshness");
    const workspaceId = "workspace-metadata";
    database.prepare(
      `INSERT INTO transaction_links (
        id, workspace_id, transaction_id, linked_entity_type, linked_entity_id,
        allocation_status, created_at, updated_at
      ) VALUES ('link-recreated', ?, NULL, 'invoice', 'invoice-1', 'pending', ?, ?)`,
    ).run(workspaceId, "2026-06-19T09:00:00.000Z", "2026-06-19T12:00:00.000Z");

    const result = createSyncTombstonePullService(database).apply(workspaceId, [{
      workspace_id: workspaceId,
      table_name: "transaction_links",
      entity_id: "link-recreated",
      deleted_at: "2026-06-19T11:00:00.000Z",
    }]);

    expect(result.errors).toEqual([]);
    expect(result.skippedDueToNewerCount).toBe(1);
    expect(database.prepare("SELECT 1 FROM transaction_links WHERE id = 'link-recreated'").get()).toBeTruthy();
    cleanup();
  });

  it.each([
    ["older", "2026-06-19T09:59:59.999Z", false],
    ["equal", "2026-06-19T10:00:00.000Z", true],
    ["newer", "2026-06-19T10:00:00.001Z", true],
  ])("handles a %s tombstone using parsed timestamps", (_label, deletedAt, shouldDelete) => {
    const { cleanup, database } = createTestDatabase(`bukowski-sync-tombstone-freshness-${_label}`);
    const workspaceId = "workspace-metadata";
    const entityId = `location-freshness-${_label}`;
    database.prepare(
      `INSERT INTO locations (id, workspace_id, code, name, type, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'Freshness', 'warehouse', 1, ?, ?)`,
    ).run(entityId, workspaceId, `F-${_label}`, "2026-06-19T10:00:00.000Z", "2026-06-19T10:00:00.000Z");

    const result = createSyncTombstonePullService(database).apply(workspaceId, [{
      workspace_id: workspaceId,
      table_name: "locations",
      entity_id: entityId,
      deleted_at: deletedAt,
    }]);

    expect(result.errors).toEqual([]);
    expect(result.skippedDueToNewerCount).toBe(shouldDelete ? 0 : 1);
    expect(Boolean(database.prepare("SELECT 1 FROM locations WHERE id = ?").get(entityId))).toBe(!shouldDelete);
    cleanup();
  });

  it("does not treat the same id under another entity_type as an outbox conflict", () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-tombstone-entity-type");
    const workspaceId = "workspace-metadata";
    database.prepare(
      `INSERT INTO locations (id, workspace_id, code, name, type, is_active, created_at, updated_at)
       VALUES ('shared-id', ?, 'SHARED', 'Shared id', 'warehouse', 1, ?, ?)`,
    ).run(workspaceId, "2026-06-19T10:00:00.000Z", "2026-06-19T10:00:00.000Z");
    database.prepare(
      `INSERT INTO sync_outbox (
        id, workspace_id, entity_type, entity_id, operation_type, payload_json,
        status, attempt_count, created_at, updated_at
      ) VALUES ('pending-client-shared-id', ?, 'client', 'shared-id', 'upsert', '{}', 'pending', 0, ?, ?)`,
    ).run(workspaceId, "2026-06-19T10:30:00.000Z", "2026-06-19T10:30:00.000Z");

    const result = createSyncTombstonePullService(database).apply(workspaceId, [{
      workspace_id: workspaceId,
      table_name: "locations",
      entity_id: "shared-id",
      deleted_at: "2026-06-19T11:00:00.000Z",
    }]);

    expect(result.skippedDueToOutboxCount).toBe(0);
    expect(result.appliedCount).toBe(1);
    cleanup();
  });

  it("protects a pending aggregate child before deleting its parent", () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-tombstone-aggregate-child");
    const workspaceId = "workspace-metadata";
    database.prepare(
      `INSERT INTO bank_accounts (
        id, workspace_id, bank_name, account_label, currency, opening_balance,
        is_active, created_at, updated_at
      ) VALUES ('account-aggregate', ?, 'popular', 'Aggregate', 'DOP', 0, 1, ?, ?)`,
    ).run(workspaceId, "2026-06-19T09:00:00.000Z", "2026-06-19T09:00:00.000Z");
    database.prepare(
      `INSERT INTO bank_transactions (
        id, workspace_id, bank_account_id, txn_date, amount, direction,
        currency, dedupe_hash, created_at
      ) VALUES ('transaction-aggregate', ?, 'account-aggregate', '2026-06-19', 100,
        'debit', 'DOP', 'aggregate-hash', ?)`,
    ).run(workspaceId, "2026-06-19T10:00:00.000Z");
    database.prepare(
      `INSERT INTO transaction_project_allocations (
        id, workspace_id, transaction_id, amount, created_at, updated_at
      ) VALUES ('allocation-pending', ?, 'transaction-aggregate', 100, ?, ?)`,
    ).run(workspaceId, "2026-06-19T10:01:00.000Z", "2026-06-19T10:01:00.000Z");
    database.prepare(
      `INSERT INTO sync_outbox (
        id, workspace_id, entity_type, entity_id, operation_type, payload_json,
        status, attempt_count, created_at, updated_at
      ) VALUES ('pending-allocation', ?, 'transaction_allocations', 'transaction-aggregate',
        'upsert', '{}', 'pending', 0, ?, ?)`,
    ).run(workspaceId, "2026-06-19T10:02:00.000Z", "2026-06-19T10:02:00.000Z");

    const result = createSyncTombstonePullService(database).apply(workspaceId, [{
      workspace_id: workspaceId,
      table_name: "bank_transactions",
      entity_id: "transaction-aggregate",
      deleted_at: "2026-06-19T11:00:00.000Z",
    }]);

    expect(result.skippedDueToOutboxCount).toBe(1);
    expect(database.prepare("SELECT 1 FROM bank_transactions WHERE id = 'transaction-aggregate'").get()).toBeTruthy();
    expect(database.prepare("SELECT 1 FROM transaction_project_allocations WHERE id = 'allocation-pending'").get()).toBeTruthy();
    cleanup();
  });

  it("supports exchange_rates, todos and reminders", () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-tombstone-new-targets");
    const workspaceId = "workspace-metadata";
    applyNotificationLocalMigration(database);
    database.prepare(
      `INSERT INTO exchange_rates (
        id, workspace_id, base_currency, quote_currency, rate, effective_date, created_at
      ) VALUES ('rate-delete', ?, 'USD', 'DOP', 60, '2026-06-19', ?)`,
    ).run(workspaceId, "2026-06-19T10:00:00.000Z");
    database.prepare(
      `INSERT INTO todos (id, user_id, workspace_id, title, created_at, updated_at)
       VALUES ('todo-delete', 'user-ops', ?, 'Delete todo', ?, ?)`,
    ).run(workspaceId, "2026-06-19T10:00:00.000Z", "2026-06-19T10:00:00.000Z");
    database.prepare(
      `INSERT INTO reminders (id, user_id, workspace_id, title, remind_at, created_at)
       VALUES ('reminder-delete', 'user-ops', ?, 'Delete reminder', ?, ?)`,
    ).run(workspaceId, "2026-06-20T10:00:00.000Z", "2026-06-19T10:00:00.000Z");

    const result = createSyncTombstonePullService(database).apply(workspaceId, [
      { workspace_id: workspaceId, table_name: "exchange_rates", entity_id: "rate-delete", deleted_at: "2026-06-19T11:00:00.000Z" },
      { workspace_id: workspaceId, table_name: "todos", entity_id: "todo-delete", deleted_at: "2026-06-19T11:00:00.000Z" },
      { workspace_id: workspaceId, table_name: "reminders", entity_id: "reminder-delete", deleted_at: "2026-06-19T11:00:00.000Z" },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.appliedCount).toBe(3);
    expect(database.prepare("SELECT 1 FROM exchange_rates WHERE id = 'rate-delete'").get()).toBeUndefined();
    expect(database.prepare("SELECT 1 FROM todos WHERE id = 'todo-delete'").get()).toBeUndefined();
    expect(database.prepare("SELECT 1 FROM reminders WHERE id = 'reminder-delete'").get()).toBeUndefined();
    cleanup();
  });

  it("reports an invalid remote timestamp without deleting the local row", () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-tombstone-invalid-timestamp");
    const workspaceId = "workspace-metadata";
    database.prepare(
      `INSERT INTO locations (id, workspace_id, code, name, type, is_active, created_at, updated_at)
       VALUES ('location-invalid-time', ?, 'BAD-TIME', 'Keep invalid', 'warehouse', 1, ?, ?)`,
    ).run(workspaceId, "2026-06-19T10:00:00.000Z", "2026-06-19T10:00:00.000Z");

    const result = createSyncTombstonePullService(database).apply(workspaceId, [{
      workspace_id: workspaceId,
      table_name: "locations",
      entity_id: "location-invalid-time",
      deleted_at: "not-a-timestamp",
    }]);

    expect(result.errors).toEqual(["locations:location-invalid-time: invalid remote deleted_at timestamp"]);
    expect(database.prepare("SELECT 1 FROM locations WHERE id = 'location-invalid-time'").get()).toBeTruthy();
    expect(
      (database.prepare(
        "SELECT last_synced_at FROM sync_pull_cursors WHERE workspace_id = ? AND entity_type = 'sync_tombstones'",
      ).get(workspaceId) as { last_synced_at: string | null }).last_synced_at,
    ).toBeNull();
    cleanup();
  });
});
