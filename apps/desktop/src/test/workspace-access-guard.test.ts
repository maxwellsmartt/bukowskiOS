import { describe, expect, it, vi } from "vitest";

import { createWorkspaceAccessGuard } from "../../electron/main/services/auth/workspaceAccessGuard";
import { createTestDatabase } from "./helpers/createTestDatabase";

const remoteWorkspaceId = "11111111-1111-4111-8111-111111111111";

const createJwt = (payload: Record<string, unknown>) => {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
};

const insertRemoteWorkspace = (database: ReturnType<typeof createTestDatabase>["database"]) => {
  database
    .prepare(
      `
        INSERT INTO workspaces (id, slug, name, base_currency, is_active, created_at, updated_at)
        VALUES (?, ?, ?, 'USD', 1, ?, ?)
      `,
    )
    .run(remoteWorkspaceId, "remote-test", "Remote Test", "2026-04-24T00:00:00.000Z", "2026-04-24T00:00:00.000Z");
};

describe("workspace access guard", () => {
  it("allows the seeded local workspace without Supabase configuration", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access");
    const guard = createWorkspaceAccessGuard({
      database,
      getTokens: async () => ({ accessToken: null }),
    });

    await expect(
      guard.assertWorkspaceAccess({
        workspaceId: "workspace-metadata",
        action: "load assets",
        accessLevel: "write",
      }),
    ).resolves.toBeUndefined();

    cleanup();
  });

  it("verifies remote workspace membership before allowing writes", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access");
    insertRemoteWorkspace(database);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(true), { status: 200 }));
    const guard = createWorkspaceAccessGuard({
      database,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
      getTokens: async () => ({ accessToken: createJwt({ sub: "user-remote", exp: 9_999_999_999 }) }),
      fetchImpl,
      now: () => 1_000,
    });

    await expect(
      guard.assertWorkspaceAccess({
        workspaceId: remoteWorkspaceId,
        action: "assign assets",
        accessLevel: "write",
        requiredPermission: "assets.manage",
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();

    cleanup();
  });

  it("blocks remote writes when membership is missing", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access");
    insertRemoteWorkspace(database);
    const guard = createWorkspaceAccessGuard({
      database,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
      getTokens: async () => ({ accessToken: createJwt({ sub: "user-remote", exp: 9_999_999_999 }) }),
      fetchImpl: async () => new Response(JSON.stringify(false), { status: 200 }),
      now: () => 1_000,
    });

    await expect(
      guard.assertWorkspaceAccess({
        workspaceId: remoteWorkspaceId,
        action: "assign assets",
        accessLevel: "write",
        requiredPermission: "assets.manage",
      }),
    ).rejects.toThrow("You do not have permission to assign assets.");

    cleanup();
  });

  it("keeps cached reads available when Supabase cannot be reached", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access");
    insertRemoteWorkspace(database);
    const guard = createWorkspaceAccessGuard({
      database,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
      getTokens: async () => ({ accessToken: createJwt({ sub: "user-remote", exp: 9_999_999_999 }) }),
      fetchImpl: async () => {
        throw new Error("network down");
      },
      now: () => 1_000,
    });

    await expect(
      guard.assertWorkspaceAccess({
        workspaceId: remoteWorkspaceId,
        action: "load assets",
        accessLevel: "read",
        requiredPermission: "assets.read",
      }),
    ).resolves.toBeUndefined();

    cleanup();
  });

  it("resolves packing slip and incident workspace before checking access", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(true), { status: 200 }));
    const guard = createWorkspaceAccessGuard({
      database,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
      getTokens: async () => ({ accessToken: createJwt({ sub: "user-remote", exp: 9_999_999_999 }) }),
      fetchImpl,
      now: () => 1_000,
    });

    await expect(
      guard.assertPackingSlipAccess("packing-1042", "load that packing slip", "read", "packing-slips.read"),
    ).resolves.toBeUndefined();
    await expect(
      guard.assertIncidentAccess("incident-cine7-scratch", "load that incident", "read", "incidents.read"),
    ).resolves.toBeUndefined();

    expect(fetchImpl).not.toHaveBeenCalled();

    cleanup();
  });
});
