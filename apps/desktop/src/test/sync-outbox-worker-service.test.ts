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

  it("returns a sanitized payload preview instead of raw outbox payloads", () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-outbox-preview");

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
        "outbox-sensitive-preview",
        "workspace-metadata",
        "bank_statement_import",
        "import-1",
        null,
        "upsert",
        JSON.stringify({
          file_path: "/Users/ernestomaxwell/Documents/private.csv",
          access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fakeSignatureValue123",
          rows: [{ description: "keep visible", amount: 100 }],
        }),
        "failed",
        2,
        "Remote rejected payload",
        null,
        "2026-04-12T18:00:00.000Z",
        "2026-04-12T18:01:00.000Z",
      );

    const service = createSyncOutboxWorkerService(database);
    const rows = service.listRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.payloadJson).toContain('"file_path": "[redacted]"');
    expect(rows[0]?.payloadJson).toContain('"access_token": "[redacted]"');
    expect(rows[0]?.payloadJson).toContain('"description": "keep visible"');
    expect(rows[0]?.payloadJson).not.toContain("/Users/ernestomaxwell/Documents/private.csv");
    expect(rows[0]?.payloadJson).not.toContain("fakeSignatureValue123");

    cleanup();
  });

  it("does not leave recoverable Supabase schema-cache failures sleeping until their old retry time", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-outbox-recoverable-schema-cache");
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
        "outbox-schema-cache",
        "workspace-metadata",
        "bank_account",
        "account-1",
        null,
        "upsert",
        JSON.stringify({ accountId: "account-1" }),
        "failed",
        7,
        "Supabase outbox push failed (400): Could not find the 'instrument_kind' column of 'bank_accounts' in the schema cache",
        "2026-04-12T19:00:00.000Z",
        fixedNow,
        fixedNow,
      );

    const service = createSyncOutboxWorkerService(database, {
      now: () => fixedNow,
      batchSize: 10,
      transport: (row) => {
        sentRows.push(row.id);
      },
    });

    const summary = await service.runDueEntries();

    expect(summary.recoveredStaleRows).toBe(1);
    expect(summary.sentRows).toBe(1);
    expect(sentRows).toEqual(["outbox-schema-cache"]);

    const row = database
      .prepare(
        `
          SELECT status, last_error, next_retry_at
          FROM sync_outbox
          WHERE id = 'outbox-schema-cache'
          LIMIT 1
        `,
      )
      .get() as { status: string; last_error: string | null; next_retry_at: string | null };

    expect(row).toEqual({ status: "sent", last_error: null, next_retry_at: null });

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

  it("uploads workspace file bytes before publishing canonical metadata", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const objectKey = `${workspaceId}/assets/asset-1/asset-file-1/manual.pdf`;
    const transport = createSupabaseOutboxTransport({
      supabaseUrl: "https://bukowski.test/",
      anonKey: "anon-test-key",
      getAccessToken: async () => "access-test-token",
      resolveWorkspaceFileUpload: () => ({
        objectKey,
        contentType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
        metadata: {
          id: "asset-file-1",
          workspace_id: workspaceId,
          domain: "assets",
          entity_id: "asset-1",
          storage_object_key: objectKey,
          original_name: "manual.pdf",
          mime_type: "application/pdf",
          byte_size: 3,
          status: "available",
          created_at: "2026-06-21T20:40:00.000Z",
          updated_at: "2026-06-21T20:40:00.000Z",
          deleted_at: null,
        },
      }),
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    });

    await transport({
      id: "outbox-workspace-file-upsert-asset-file-1",
      workspace_id: workspaceId,
      entity_type: "workspace_file",
      entity_id: "asset-file-1",
      event_id: null,
      operation_type: "upsert",
      payload_json: "{}",
      attempt_count: 0,
      created_at: "2026-06-21T20:40:00.000Z",
      updated_at: "2026-06-21T20:40:00.000Z",
    });

    expect(requests.map((request) => request.url)).toEqual([
      `https://bukowski.test/storage/v1/object/workspace-documents/${objectKey}`,
      "https://bukowski.test/rest/v1/workspace_files?on_conflict=id",
      "https://bukowski.test/rest/v1/sync_outbox?on_conflict=id",
    ]);
    expect(requests[0]?.init).toMatchObject({ method: "POST" });
    expect(requests[0]?.init.headers).toMatchObject({
      apikey: "anon-test-key",
      Authorization: "Bearer access-test-token",
      "x-upsert": "true",
    });
    expect(JSON.parse(String(requests[1]?.init.body))).toMatchObject({
      id: "asset-file-1",
      storage_object_key: objectKey,
      status: "available",
    });
  });

  it("deletes workspace file bytes before publishing its tombstone", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const objectKey = `${workspaceId}/incidents/incident-1/incident-file-1/evidence.png`;
    const transport = createSupabaseOutboxTransport({
      supabaseUrl: "https://bukowski.test/",
      anonKey: "anon-test-key",
      getAccessToken: async () => "access-test-token",
      resolveWorkspaceFileUpload: () => ({
        objectKey,
        contentType: "image/png",
        bytes: null,
        metadata: {
          id: "incident-file-1",
          workspace_id: workspaceId,
          domain: "incidents",
          entity_id: "incident-1",
          storage_object_key: objectKey,
          original_name: "evidence.png",
          mime_type: "image/png",
          byte_size: 3,
          status: "deleted",
          created_at: "2026-06-21T20:40:00.000Z",
          updated_at: "2026-06-21T20:45:00.000Z",
          deleted_at: "2026-06-21T20:45:00.000Z",
        },
      }),
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });

    await transport({
      id: "outbox-workspace-file-delete-incident-file-1",
      workspace_id: workspaceId,
      entity_type: "workspace_file",
      entity_id: "incident-file-1",
      event_id: null,
      operation_type: "delete",
      payload_json: "{}",
      attempt_count: 0,
      created_at: "2026-06-21T20:45:00.000Z",
      updated_at: "2026-06-21T20:45:00.000Z",
    });

    expect(requests.map((request) => request.url)).toEqual([
      `https://bukowski.test/storage/v1/object/workspace-documents/${objectKey}`,
      "https://bukowski.test/rest/v1/workspace_files?on_conflict=id",
      "https://bukowski.test/rest/v1/sync_outbox?on_conflict=id",
    ]);
    expect(requests[0]?.init.method).toBe("DELETE");
    expect(JSON.parse(String(requests[1]?.init.body))).toMatchObject({ status: "deleted" });
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

  it("materializes financial-domain rows to their real tables before acknowledging", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport = createSupabaseOutboxTransport({
      supabaseUrl: "https://bukowski.test/",
      anonKey: "anon-test-key",
      getAccessToken: async () => "access-test-token",
      resolveDomainUpserts: (row) =>
        row.entity_type === "bank_statement_import"
          ? [
              {
                table: "bank_statement_imports",
                onConflict: "id",
                rows: [{ id: row.entity_id, workspace_id: row.workspace_id, source_format: "csv" }],
              },
              {
                table: "bank_transactions",
                onConflict: "id",
                rows: [
                  { id: "txn-1", import_id: row.entity_id, amount: 100, direction: "credit" },
                  { id: "txn-2", import_id: row.entity_id, amount: 50, direction: "debit" },
                ],
              },
            ]
          : null,
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    });

    await transport({
      id: "outbox-import-1",
      workspace_id: "11111111-1111-4111-8111-111111111111",
      entity_type: "bank_statement_import",
      entity_id: "import-1",
      event_id: null,
      operation_type: "upsert",
      payload_json: JSON.stringify({ sourceFormat: "csv" }),
      attempt_count: 0,
      created_at: "2026-04-12T18:00:00.000Z",
      updated_at: "2026-04-12T18:01:00.000Z",
    });

    expect(requests.map((request) => request.url)).toEqual([
      "https://bukowski.test/rest/v1/bank_statement_imports?on_conflict=id",
      "https://bukowski.test/rest/v1/bank_transactions?on_conflict=id",
      "https://bukowski.test/rest/v1/bank_transactions?on_conflict=id",
      "https://bukowski.test/rest/v1/sync_outbox?on_conflict=id",
    ]);
    expect(JSON.parse(String(requests[1]?.init.body))).toMatchObject({ id: "txn-1", import_id: "import-1" });
  });

  it("recovers transaction link pushes that already exist by semantic dedupe key", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport = createSupabaseOutboxTransport({
      supabaseUrl: "https://bukowski.test/",
      anonKey: "anon-test-key",
      getAccessToken: async () => "access-test-token",
      resolveDomainUpserts: (row) =>
        row.entity_type === "transaction_link"
          ? [
              {
                table: "transaction_links",
                onConflict: "id",
                rows: [
                  {
                    id: row.entity_id,
                    workspace_id: row.workspace_id,
                    transaction_id: null,
                    payment_instrument_id: "card-1",
                    linked_entity_type: "invoice_extraction",
                    linked_entity_id: "invoice-1",
                    amount_applied: 875,
                    amount_currency: "DOP",
                    allocation_status: "pending",
                    created_at: "2026-06-09T19:20:00.000Z",
                    updated_at: "2026-06-09T19:20:00.000Z",
                  },
                ],
              },
            ]
          : null,
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        if (String(url).includes("/transaction_links?on_conflict=id")) {
          return new Response(
            JSON.stringify({
              message: 'duplicate key value violates unique constraint "idx_txn_links_dedupe_v4"',
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });

    await transport({
      id: "outbox-transaction-link-duplicate",
      workspace_id: "11111111-1111-4111-8111-111111111111",
      entity_type: "transaction_link",
      entity_id: "link-local-duplicate",
      event_id: null,
      operation_type: "upsert",
      payload_json: JSON.stringify({ linkedEntityType: "invoice_extraction" }),
      attempt_count: 3,
      created_at: "2026-06-09T19:20:00.000Z",
      updated_at: "2026-06-09T19:21:00.000Z",
    });

    expect(requests.map((request) => `${request.init.method ?? "POST"} ${request.url}`)).toEqual([
      "POST https://bukowski.test/rest/v1/transaction_links?on_conflict=id",
      "PATCH https://bukowski.test/rest/v1/transaction_links?workspace_id=eq.11111111-1111-4111-8111-111111111111&linked_entity_type=eq.invoice_extraction&linked_entity_id=eq.invoice-1&transaction_id=is.null&payment_instrument_id=eq.card-1",
      "POST https://bukowski.test/rest/v1/sync_outbox?on_conflict=id",
    ]);
    expect(JSON.parse(String(requests[1]?.init.body))).toMatchObject({
      id: "link-local-duplicate",
      payment_instrument_id: "card-1",
      linked_entity_id: "invoice-1",
    });
  });

  it("can replace child domain rows before inserting the current remote projection", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport = createSupabaseOutboxTransport({
      supabaseUrl: "https://bukowski.test/",
      anonKey: "anon-test-key",
      getAccessToken: async () => "access-test-token",
      resolveDomainUpserts: (row) =>
        row.entity_type === "quote"
          ? [
              {
                table: "quotes",
                onConflict: "id",
                rows: [{ id: row.entity_id, workspace_id: row.workspace_id, quote_number: "2026-0001" }],
              },
              {
                table: "quote_items",
                onConflict: "id",
                deleteBeforeInsert: { column: "quote_id", value: row.entity_id },
                rows: [{ id: "quote-1-item-001-0", quote_id: row.entity_id, title: "Current item" }],
              },
            ]
          : null,
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    });

    await transport({
      id: "outbox-quote-1",
      workspace_id: "11111111-1111-4111-8111-111111111111",
      entity_type: "quote",
      entity_id: "quote-1",
      event_id: null,
      operation_type: "upsert",
      payload_json: JSON.stringify({ quoteId: "quote-1" }),
      attempt_count: 0,
      created_at: "2026-04-12T18:00:00.000Z",
      updated_at: "2026-04-12T18:01:00.000Z",
    });

    expect(requests.map((request) => `${request.init.method ?? "POST"} ${request.url}`)).toEqual([
      "POST https://bukowski.test/rest/v1/quotes?on_conflict=id",
      "DELETE https://bukowski.test/rest/v1/quote_items?quote_id=eq.quote-1&workspace_id=eq.11111111-1111-4111-8111-111111111111",
      "POST https://bukowski.test/rest/v1/quote_items?on_conflict=id",
      "POST https://bukowski.test/rest/v1/sync_outbox?on_conflict=id",
    ]);
  });

  it("can replace aggregate child rows that inherit workspace scope from the parent", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport = createSupabaseOutboxTransport({
      supabaseUrl: "https://bukowski.test/",
      anonKey: "anon-test-key",
      getAccessToken: async () => "access-test-token",
      resolveDomainUpserts: (row) =>
        row.entity_type === "kit"
          ? [
              {
                table: "kits",
                onConflict: "id",
                rows: [{ id: row.entity_id, workspace_id: row.workspace_id, code: "KIT-1" }],
              },
              {
                table: "kit_assets",
                onConflict: "kit_id,asset_id",
                deleteBeforeInsert: { column: "kit_id", value: row.entity_id, workspaceScoped: false },
                rows: [{ kit_id: row.entity_id, asset_id: "asset-1", quantity: 1 }],
              },
            ]
          : null,
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    });

    await transport({
      id: "outbox-kit-1",
      workspace_id: "11111111-1111-4111-8111-111111111111",
      entity_type: "kit",
      entity_id: "kit-1",
      event_id: null,
      operation_type: "upsert",
      payload_json: JSON.stringify({ id: "kit-1" }),
      attempt_count: 0,
      created_at: "2026-07-03T20:00:00.000Z",
      updated_at: "2026-07-03T20:01:00.000Z",
    });

    expect(requests.map((request) => `${request.init.method ?? "POST"} ${request.url}`)).toEqual([
      "POST https://bukowski.test/rest/v1/kits?on_conflict=id",
      "DELETE https://bukowski.test/rest/v1/kit_assets?kit_id=eq.kit-1",
      "POST https://bukowski.test/rest/v1/kit_assets?on_conflict=kit_id,asset_id",
      "POST https://bukowski.test/rest/v1/sync_outbox?on_conflict=id",
    ]);
  });

  it("propagates a local deletion by removing the cloud rows (delete op)", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    let upsertResolverCalled = false;
    const transport = createSupabaseOutboxTransport({
      supabaseUrl: "https://bukowski.test/",
      anonKey: "anon-test-key",
      getAccessToken: async () => "access-test-token",
      resolveDomainUpserts: () => {
        upsertResolverCalled = true;
        return null;
      },
      resolveDomainDeletes: (row) =>
        row.entity_type === "bank_statement_import"
          ? [
              { table: "bank_transactions", filters: [{ column: "import_id", value: row.entity_id }] },
              { table: "bank_statement_imports", filters: [{ column: "id", value: row.entity_id }] },
            ]
          : null,
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });

    await transport({
      id: "outbox-del-1",
      workspace_id: "11111111-1111-4111-8111-111111111111",
      entity_type: "bank_statement_import",
      entity_id: "import/9 ?",
      event_id: null,
      operation_type: "delete",
      payload_json: JSON.stringify({ deleted: true }),
      attempt_count: 0,
      created_at: "2026-04-12T18:00:00.000Z",
      updated_at: "2026-04-12T18:01:00.000Z",
    });

    expect(requests.map((request) => `${request.init.method ?? "POST"} ${request.url}`)).toEqual([
      "DELETE https://bukowski.test/rest/v1/bank_transactions?import_id=eq.import%2F9%20%3F&workspace_id=eq.11111111-1111-4111-8111-111111111111",
      "DELETE https://bukowski.test/rest/v1/bank_statement_imports?id=eq.import%2F9%20%3F&workspace_id=eq.11111111-1111-4111-8111-111111111111",
      "POST https://bukowski.test/rest/v1/sync_outbox?on_conflict=id",
    ]);
    // Delete ops must not run the upsert resolvers (no resurrecting rows).
    expect(upsertResolverCalled).toBe(false);
  });

  it("records an operational project tombstone instead of hard-deleting the project", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    let deleteResolverCalled = false;
    const transport = createSupabaseOutboxTransport({
      supabaseUrl: "https://bukowski.test/",
      anonKey: "anon-test-key",
      getAccessToken: async () => "access-test-token",
      resolveOperationalSnapshot: (row) => ({
        workspace_id: row.workspace_id,
        entity_type: "project",
        entity_id: row.entity_id,
        snapshot_json: {},
        updated_at: row.updated_at,
        deleted_at: row.updated_at,
      }),
      resolveDomainDeletes: () => {
        deleteResolverCalled = true;
        return [{ table: "projects", filters: [{ column: "id", value: "project-1" }] }];
      },
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    });

    await transport({
      id: "outbox-project-delete",
      workspace_id: "11111111-1111-4111-8111-111111111111",
      entity_type: "project",
      entity_id: "project-1",
      event_id: null,
      operation_type: "delete",
      payload_json: JSON.stringify({ deleted: true }),
      attempt_count: 0,
      created_at: "2026-04-12T18:00:00.000Z",
      updated_at: "2026-04-12T18:01:00.000Z",
    });

    expect(requests.map((request) => `${request.init.method ?? "POST"} ${request.url}`)).toEqual([
      "POST https://bukowski.test/rest/v1/operational_snapshots?on_conflict=workspace_id,entity_type,entity_id",
      "POST https://bukowski.test/rest/v1/sync_outbox?on_conflict=id",
    ]);
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      entity_type: "project",
      entity_id: "project-1",
      snapshot_json: {},
      deleted_at: "2026-04-12T18:01:00.000Z",
    });
    expect(deleteResolverCalled).toBe(false);
  });

  it.each([
    { label: "empty filters", filters: [] },
    { label: "an empty column", filters: [{ column: " ", value: "import-9" }] },
    { label: "an invalid column", filters: [{ column: "id&workspace_id", value: "import-9" }] },
    { label: "a resolver workspace filter", filters: [{ column: "workspace_id", value: "other-workspace" }] },
  ])("rejects $label before deleting or acknowledging", async ({ filters }) => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport = createSupabaseOutboxTransport({
      supabaseUrl: "https://bukowski.test/",
      anonKey: "anon-test-key",
      getAccessToken: async () => "access-test-token",
      resolveDomainDeletes: () => [
        {
          table: "bank_statement_imports",
          filters: filters as [{ column: string; value: string }],
        },
      ],
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });

    await expect(
      transport({
        id: "outbox-invalid-delete-filter",
        workspace_id: "11111111-1111-4111-8111-111111111111",
        entity_type: "bank_statement_import",
        entity_id: "import-9",
        event_id: null,
        operation_type: "delete",
        payload_json: JSON.stringify({ deleted: true }),
        attempt_count: 0,
        created_at: "2026-04-12T18:00:00.000Z",
        updated_at: "2026-04-12T18:01:00.000Z",
      }),
    ).rejects.toThrow(/Supabase delete/);

    expect(requests).toEqual([]);
  });

  it.each([
    { label: "an absent resolver", resolver: undefined },
    { label: "a null resolver result", resolver: () => null },
    { label: "an empty resolver result", resolver: () => [] },
  ])("rejects a delete with $label without recording the remote outbox", async ({ resolver }) => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport = createSupabaseOutboxTransport({
      supabaseUrl: "https://bukowski.test/",
      anonKey: "anon-test-key",
      getAccessToken: async () => "access-test-token",
      resolveDomainDeletes: resolver,
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });

    await expect(
      transport({
        id: "outbox-del-without-target",
        workspace_id: "11111111-1111-4111-8111-111111111111",
        entity_type: "bank_statement_import",
        entity_id: "import-without-target",
        event_id: null,
        operation_type: "delete",
        payload_json: JSON.stringify({ deleted: true }),
        attempt_count: 0,
        created_at: "2026-04-12T18:00:00.000Z",
        updated_at: "2026-04-12T18:01:00.000Z",
      }),
    ).rejects.toThrow("Supabase delete targets unavailable for outbox row outbox-del-without-target.");

    expect(requests).toEqual([]);
  });
});
