import { describe, expect, it } from "vitest";

import { backfillKitSyncOutbox, cleanupSeedKitOutbox } from "../../electron/main/services/data/kitSyncBackfill";
import { createTestDatabase } from "./helpers/createTestDatabase";

const remoteWorkspaceId = "11111111-1111-4111-8111-111111111111";

const insertRemoteWorkspace = (database: ReturnType<typeof createTestDatabase>["database"]) => {
  const now = "2026-07-03T12:00:00.000Z";
  database
    .prepare(
      `
        INSERT INTO workspaces (id, name, slug, base_currency, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .run(remoteWorkspaceId, "Remote Workspace", "remote-workspace", "USD", now, now);
};

describe("kit sync backfill", () => {
  it("enqueues existing kits from real workspaces once", () => {
    const { cleanup, database } = createTestDatabase("bukowski-kit-sync-backfill", { includeDemoData: false });
    const originalUpdatedAt = "2026-07-01T10:00:00.000Z";
    insertRemoteWorkspace(database);
    database
      .prepare(
        `
          INSERT INTO kits (id, workspace_id, code, name, description, notes, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?)
        `,
      )
      .run("kit-sync-existing", remoteWorkspaceId, "OFFICE-KIT", "Office Test Kit", originalUpdatedAt, originalUpdatedAt);

    backfillKitSyncOutbox(database);
    backfillKitSyncOutbox(database);

    const rows = database
      .prepare(
        `
          SELECT id, workspace_id, entity_type, entity_id, operation_type, payload_json, status
          FROM sync_outbox
          WHERE entity_type = 'kit' AND entity_id = ?
        `,
      )
      .all("kit-sync-existing") as Array<{
      id: string;
      workspace_id: string;
      entity_type: string;
      entity_id: string;
      operation_type: string;
      payload_json: string;
      status: string;
    }>;
    const kit = database.prepare("SELECT updated_at FROM kits WHERE id = ?").get("kit-sync-existing") as { updated_at: string };

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "backfill-kit-kit-sync-existing",
      workspace_id: remoteWorkspaceId,
      entity_type: "kit",
      entity_id: "kit-sync-existing",
      operation_type: "upsert",
      payload_json: JSON.stringify({ id: "kit-sync-existing" }),
      status: "pending",
    });
    expect(Date.parse(kit.updated_at)).toBeGreaterThan(Date.parse(originalUpdatedAt));

    cleanup();
  });

  it("can replay sent kit backfills without duplicating active outbox rows", () => {
    const { cleanup, database } = createTestDatabase("bukowski-kit-sync-backfill-replay", { includeDemoData: false });
    const originalUpdatedAt = "2026-07-01T10:00:00.000Z";
    insertRemoteWorkspace(database);
    database
      .prepare(
        `
          INSERT INTO kits (id, workspace_id, code, name, description, notes, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?)
        `,
      )
      .run("kit-sync-replay", remoteWorkspaceId, "REPLAY-KIT", "Replay Kit", originalUpdatedAt, originalUpdatedAt);

    backfillKitSyncOutbox(database);
    database
      .prepare("UPDATE sync_outbox SET status = 'sent', updated_at = ? WHERE id = ?")
      .run("2026-07-02T10:00:00.000Z", "backfill-kit-kit-sync-replay");
    backfillKitSyncOutbox(database, { batchId: "v2" });
    backfillKitSyncOutbox(database, { batchId: "v2" });

    const rows = database
      .prepare(
        `
          SELECT id, status
          FROM sync_outbox
          WHERE entity_type = 'kit' AND entity_id = ?
          ORDER BY id
        `,
      )
      .all("kit-sync-replay") as Array<{ id: string; status: string }>;

    expect(rows).toEqual([
      { id: "backfill-kit-kit-sync-replay", status: "sent" },
      { id: "backfill-kit-v2-kit-sync-replay", status: "pending" },
    ]);

    cleanup();
  });

  it("skips seed workspace kits and cleans invalid kit outbox rows", () => {
    const { cleanup, database } = createTestDatabase("bukowski-kit-sync-backfill-seed", { includeDemoData: false });
    const now = "2026-07-03T12:00:00.000Z";
    database
      .prepare(
        `
          INSERT INTO kits (id, workspace_id, code, name, description, notes, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?)
        `,
      )
      .run("kit-local-only", "workspace-metadata", "LOCAL-KIT", "Local Only Kit", now, now);
    database
      .prepare(
        `
          INSERT INTO sync_outbox (
            id, workspace_id, entity_type, entity_id, operation_type, payload_json, status,
            attempt_count, last_error, next_retry_at, created_at, updated_at
          ) VALUES (?, ?, 'kit', ?, 'upsert', ?, 'pending', 0, NULL, ?, ?, ?)
        `,
      )
      .run("seed-kit-outbox", "workspace-metadata", "kit-local-only", JSON.stringify({ id: "kit-local-only" }), now, now, now);

    backfillKitSyncOutbox(database);
    cleanupSeedKitOutbox(database);

    const count = database
      .prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE entity_type = 'kit'")
      .get() as { count: number };

    expect(count.count).toBe(0);

    cleanup();
  });
});
