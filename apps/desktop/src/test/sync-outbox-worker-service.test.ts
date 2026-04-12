import { describe, expect, it } from "vitest";

import {
  createSyncOutboxWorkerService,
  summarizeSyncOutboxWorker,
} from "../../electron/main/services/data/syncOutboxWorkerService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("sync outbox worker service", () => {
  it("marks valid pending rows as sent and schedules retries for invalid payloads", () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-outbox");
    const fixedNow = "2026-04-12T18:00:00.000Z";

    database.prepare("DELETE FROM sync_outbox").run();
    database
      .prepare(
        `
          INSERT INTO sync_outbox (
            id,
            workspace_id,
            entity_type,
            entity_id,
            event_id,
            operation_type,
            payload_json,
            status,
            attempt_count,
            last_error,
            next_retry_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "outbox-valid",
        "workspace-metadata",
        "asset_event",
        "asset-1",
        null,
        "upsert",
        JSON.stringify({ assetId: "asset-1" }),
        "pending",
        0,
        null,
        null,
        fixedNow,
        fixedNow,
      );

    database
      .prepare(
        `
          INSERT INTO sync_outbox (
            id,
            workspace_id,
            entity_type,
            entity_id,
            event_id,
            operation_type,
            payload_json,
            status,
            attempt_count,
            last_error,
            next_retry_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "outbox-invalid",
        "workspace-metadata",
        "finance_entry",
        "finance-1",
        null,
        "upsert",
        "not-json",
        "pending",
        0,
        null,
        null,
        fixedNow,
        fixedNow,
      );

    database
      .prepare(
        `
          INSERT INTO sync_outbox (
            id,
            workspace_id,
            entity_type,
            entity_id,
            event_id,
            operation_type,
            payload_json,
            status,
            attempt_count,
            last_error,
            next_retry_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "outbox-stale-processing",
        "workspace-metadata",
        "incident",
        "incident-1",
        null,
        "upsert",
        JSON.stringify({ incidentId: "incident-1" }),
        "processing",
        0,
        null,
        null,
        "2026-04-12T17:40:00.000Z",
        "2026-04-12T17:40:00.000Z",
      );

    const service = createSyncOutboxWorkerService(database, {
      now: () => fixedNow,
      batchSize: 10,
      staleProcessingMinutes: 5,
    });

    const summary = service.runDueEntries();

    expect(summary.recoveredStaleRows).toBe(1);
    expect(summary.sentRows).toBe(2);
    expect(summary.failedRows).toBe(1);
    expect(summary.pendingAfter).toBe(0);
    expect(summary.failedAfter).toBe(1);
    expect(summarizeSyncOutboxWorker(summary)).toContain("2 rows acknowledged locally");

    const rows = database
      .prepare(
        `
          SELECT id, status, attempt_count, last_error, next_retry_at
          FROM sync_outbox
          ORDER BY id
        `,
      )
      .all() as Array<{
        id: string;
        status: string;
        attempt_count: number;
        last_error: string | null;
        next_retry_at: string | null;
      }>;

    expect(rows).toEqual([
      {
        id: "outbox-invalid",
        status: "failed",
        attempt_count: 1,
        last_error: expect.stringContaining("JSON"),
        next_retry_at: "2026-04-12T18:01:00.000Z",
      },
      {
        id: "outbox-stale-processing",
        status: "sent",
        attempt_count: 1,
        last_error: null,
        next_retry_at: null,
      },
      {
        id: "outbox-valid",
        status: "sent",
        attempt_count: 1,
        last_error: null,
        next_retry_at: null,
      },
    ]);

    cleanup();
  });
});
