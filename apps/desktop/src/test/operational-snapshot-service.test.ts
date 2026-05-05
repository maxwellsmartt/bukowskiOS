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
});
