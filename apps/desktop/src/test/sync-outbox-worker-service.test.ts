import { describe, expect, it } from "vitest";

import {
  createSyncOutboxWorkerService,
  summarizeSyncOutboxWorker,
} from "../../electron/main/services/data/syncOutboxWorkerService";
import { createSupabaseOutboxTransport } from "@sync";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("sync outbox worker service", () => {
  it("marks valid pending rows as sent and schedules retries for invalid payloads", async () => {
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

    const summary = await service.runDueEntries();

    expect(summary.recoveredStaleRows).toBe(1);
    expect(summary.sentRows).toBe(2);
    expect(summary.failedRows).toBe(1);
    expect(summary.pendingAfter).toBe(0);
    expect(summary.failedAfter).toBe(1);
    expect(summarizeSyncOutboxWorker(summary)).toContain("2 rows sent");

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

    expect(service.retryAllFailedRows()).toBe(1);

    const retriedRow = database
      .prepare(
        `
          SELECT status, last_error, next_retry_at
          FROM sync_outbox
          WHERE id = 'outbox-invalid'
          LIMIT 1
        `,
      )
      .get() as {
      status: string;
      last_error: string | null;
      next_retry_at: string | null;
    };

    expect(retriedRow).toEqual({
      status: "pending",
      last_error: null,
      next_retry_at: null,
    });

    cleanup();
  });

  it("uses an injected transport and preserves retry backoff when the transport fails", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-outbox-transport");
    const fixedNow = "2026-04-12T18:00:00.000Z";
    const sentRows: string[] = [];

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
        "outbox-transport-success",
        "workspace-metadata",
        "asset",
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
        "outbox-transport-failure",
        "workspace-metadata",
        "asset",
        "asset-2",
        null,
        "upsert",
        JSON.stringify({ assetId: "asset-2" }),
        "pending",
        0,
        null,
        null,
        fixedNow,
        fixedNow,
      );

    const service = createSyncOutboxWorkerService(database, {
      now: () => fixedNow,
      batchSize: 10,
      transport: async (row) => {
        if (row.id === "outbox-transport-failure") {
          throw new Error("Supabase transport unavailable.");
        }

        sentRows.push(row.id);
      },
    });

    const summary = await service.runDueEntries();

    expect(summary.sentRows).toBe(1);
    expect(summary.failedRows).toBe(1);
    expect(sentRows).toEqual(["outbox-transport-success"]);

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
        id: "outbox-transport-failure",
        status: "failed",
        attempt_count: 1,
        last_error: "Supabase transport unavailable.",
        next_retry_at: "2026-04-12T18:01:00.000Z",
      },
      {
        id: "outbox-transport-success",
        status: "sent",
        attempt_count: 1,
        last_error: null,
        next_retry_at: null,
      },
    ]);

    cleanup();
  });

  it("pushes outbox rows to Supabase REST with the stored user token", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport = createSupabaseOutboxTransport({
      supabaseUrl: "https://bukowski.test/",
      anonKey: "anon-test-key",
      getAccessToken: async () => "access-test-token",
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    });

    await transport({
      id: "outbox-asset-1",
      workspace_id: "11111111-1111-4111-8111-111111111111",
      entity_type: "asset",
      entity_id: "asset-1",
      event_id: null,
      operation_type: "upsert",
      payload_json: JSON.stringify({ assetId: "asset-1" }),
      attempt_count: 2,
      created_at: "2026-04-12T18:00:00.000Z",
      updated_at: "2026-04-12T18:01:00.000Z",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://bukowski.test/rest/v1/sync_outbox?on_conflict=id");
    expect(requests[0]?.init.headers).toMatchObject({
      apikey: "anon-test-key",
      Authorization: "Bearer access-test-token",
      "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    });
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      id: "outbox-asset-1",
      workspace_id: "11111111-1111-4111-8111-111111111111",
      entity_type: "asset",
      entity_id: "asset-1",
      operation_type: "upsert",
      payload_json: { assetId: "asset-1" },
      status: "sent",
      attempt_count: 2,
    });
  });

  it("upserts asset projections before acknowledging asset_event rows remotely", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport = createSupabaseOutboxTransport({
      supabaseUrl: "https://bukowski.test/",
      anonKey: "anon-test-key",
      getAccessToken: async () => "access-test-token",
      resolveAssetSnapshot: async () => ({
        asset: {
          id: "asset-1",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          internal_code: "CAM-001",
          name: "A camera",
          is_active: true,
          created_at: "2026-04-12T18:00:00.000Z",
          updated_at: "2026-04-12T18:01:00.000Z",
        },
        currentState: {
          asset_id: "asset-1",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          condition_status: "Good",
          operational_status: "available",
          custody_status: "available",
          last_event_id: "event-1",
          version: 2,
          total_quantity: 3,
          available_quantity: 3,
          assigned_quantity: 0,
          checked_out_quantity: 0,
          updated_at: "2026-04-12T18:01:00.000Z",
        },
        event: {
          id: "event-1",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          asset_id: "asset-1",
          event_type: "asset_created",
          event_timestamp: "2026-04-12T18:00:00.000Z",
          command_id: "command-1",
          actor_type: "user",
          source_channel: "desktop",
          metadata_json: { kind: "asset_created" },
          created_at: "2026-04-12T18:00:00.000Z",
        },
      }),
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    });

    await transport({
      id: "outbox-event-1",
      workspace_id: "11111111-1111-4111-8111-111111111111",
      entity_type: "asset_event",
      entity_id: "asset-1",
      event_id: "event-1",
      operation_type: "upsert",
      payload_json: JSON.stringify({ kind: "asset_created" }),
      attempt_count: 1,
      created_at: "2026-04-12T18:00:00.000Z",
      updated_at: "2026-04-12T18:01:00.000Z",
    });

    expect(requests.map((request) => request.url)).toEqual([
      "https://bukowski.test/rest/v1/assets?on_conflict=id",
      "https://bukowski.test/rest/v1/asset_current_state?on_conflict=asset_id",
      "https://bukowski.test/rest/v1/asset_events?on_conflict=id",
      "https://bukowski.test/rest/v1/sync_outbox?on_conflict=id",
    ]);
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      id: "asset-1",
      internal_code: "CAM-001",
      name: "A camera",
      is_active: true,
    });
    expect(JSON.parse(String(requests[1]?.init.body))).toMatchObject({
      asset_id: "asset-1",
      version: 2,
      total_quantity: 3,
    });
    expect(JSON.parse(String(requests[2]?.init.body))).toMatchObject({
      id: "event-1",
      asset_id: "asset-1",
      metadata_json: { kind: "asset_created" },
    });
    expect(JSON.parse(String(requests[3]?.init.body))).toMatchObject({
      id: "outbox-event-1",
      entity_type: "asset_event",
      payload_json: { kind: "asset_created" },
    });
  });
});
