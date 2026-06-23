import { describe, expect, it } from "vitest";

import { createSupabaseOutboxTransport } from "../../../../packages/sync/src/transport/supabaseOutboxTransport";

const baseRow = {
  id: "f5c4b4c4-5c8e-4d0e-b445-f62d0939028e",
  entity_type: "notification",
  entity_id: "f5c4b4c4-5c8e-4d0e-b445-f62d0939028e",
  event_id: null,
  operation_type: "upsert",
  payload_json: JSON.stringify({ id: "f5c4b4c4-5c8e-4d0e-b445-f62d0939028e" }),
  attempt_count: 0,
  created_at: "2026-06-23T00:00:00.000Z",
  updated_at: "2026-06-23T00:00:00.000Z",
};

const buildTransport = (calls: string[]) =>
  createSupabaseOutboxTransport({
    supabaseUrl: "https://example.supabase.co",
    anonKey: "anon-key",
    getAccessToken: async () => "access-token",
    fetchImpl: (async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, text: async () => "" } as unknown as Response;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  });

describe("supabase outbox transport · workspace gating", () => {
  it("skips all remote writes for a non-UUID local workspace", async () => {
    const calls: string[] = [];
    const transport = buildTransport(calls);

    await transport({ ...baseRow, workspace_id: "workspace-metadata" });

    expect(calls).toHaveLength(0);
  });

  it("attempts the remote push for a real UUID workspace", async () => {
    const calls: string[] = [];
    const transport = buildTransport(calls);

    await transport({ ...baseRow, workspace_id: "11111111-1111-4111-8111-111111111111" });

    expect(calls.length).toBeGreaterThan(0);
  });
});
