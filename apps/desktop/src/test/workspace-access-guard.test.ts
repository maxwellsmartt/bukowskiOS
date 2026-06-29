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

const insertCachedWorkspaceMembership = (
  database: ReturnType<typeof createTestDatabase>["database"],
  permissionKey: string,
) => {
  const timestamp = "2026-04-24T00:00:00.000Z";
  database
    .prepare(
      `
        INSERT INTO users (id, full_name, email, phone, is_active, created_at, updated_at)
        VALUES (?, ?, ?, NULL, 1, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `,
    )
    .run("user-remote", "Remote user", "remote@example.test", timestamp, timestamp);
  database
    .prepare(
      `
        INSERT INTO roles (id, workspace_id, key, name, description, is_system_role, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO NOTHING
      `,
    )
    .run("role-remote-assets-reader", remoteWorkspaceId, "assets_reader", "Assets reader", "Cached read-only role", timestamp);
  database
    .prepare(
      `
        INSERT INTO permissions (id, key, label, description)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO NOTHING
      `,
    )
    .run(`permission-${permissionKey}`, permissionKey, permissionKey, "Cached test permission");
  database
    .prepare(
      `
        INSERT INTO role_permissions (role_id, permission_id, created_at)
        SELECT ?, permissions.id, ?
        FROM permissions
        WHERE permissions.key = ?
        ON CONFLICT(role_id, permission_id) DO NOTHING
      `,
    )
    .run("role-remote-assets-reader", timestamp, permissionKey);
  database
    .prepare(
      `
        INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id, status, joined_at, created_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(workspace_id, user_id) DO UPDATE SET
          role_id = excluded.role_id,
          status = 'active'
      `,
    )
    .run(
      "membership-remote-assets-reader",
      remoteWorkspaceId,
      "user-remote",
      "role-remote-assets-reader",
      timestamp,
      timestamp,
    );
};

describe("workspace access guard", () => {
  it("rejects writes to the local fallback workspace when Supabase is configured", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access-fallback-write");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    const guard = createWorkspaceAccessGuard({
      database,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
      // A valid token proves the rejection is the fallback guard itself, not the
      // downstream sign-in check.
      getTokens: async () => ({ accessToken: createJwt({ sub: "user-remote", exp: 9_999_999_999 }) }),
      fetchImpl,
      now: () => 1_000,
    });

    await expect(
      guard.assertWorkspaceAccess({
        workspaceId: "workspace-metadata",
        action: "import statements",
        accessLevel: "write",
      }),
    ).rejects.toThrow(/not available on this device/i);

    // Rejected immediately — never reaches the Supabase membership round-trip.
    expect(fetchImpl).not.toHaveBeenCalled();

    cleanup();
  });

  it("still validates the default workspace for reads when Supabase is configured (no spoof bypass)", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access-default");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    const guard = createWorkspaceAccessGuard({
      database,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
      getTokens: async () => ({ accessToken: null }),
      fetchImpl,
      now: () => 1_000,
    });

    await expect(
      guard.assertWorkspaceAccess({
        workspaceId: "workspace-metadata",
        action: "load assets",
        accessLevel: "read",
      }),
    ).rejects.toThrow(/Sign in again/);

    expect(fetchImpl).not.toHaveBeenCalled();

    cleanup();
  });

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
    insertCachedWorkspaceMembership(database, "assets.read");
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

  it("fails closed for cached finance reads when Supabase cannot be reached", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access-finance-offline");
    insertRemoteWorkspace(database);
    insertCachedWorkspaceMembership(database, "finance.read");
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
        action: "load finance",
        accessLevel: "read",
        requiredPermission: "finance.read",
      }),
    ).rejects.toThrow(/Supabase must be reachable/i);

    cleanup();
  });

  it("does not reuse the in-memory TTL cache for sensitive finance permissions", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access-finance-ttl");
    insertRemoteWorkspace(database);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(true), { status: 200 }));
    const guard = createWorkspaceAccessGuard({
      database,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
      getTokens: async () => ({ accessToken: createJwt({ sub: "user-remote", exp: 9_999_999_999 }) }),
      fetchImpl,
      now: () => 1_000,
      cacheTtlMs: 60_000,
    });

    await expect(
      guard.assertWorkspaceAccess({
        workspaceId: remoteWorkspaceId,
        action: "load finance",
        accessLevel: "read",
        requiredPermission: "finance.read",
      }),
    ).resolves.toBeUndefined();
    await expect(
      guard.assertWorkspaceAccess({
        workspaceId: remoteWorkspaceId,
        action: "load finance again",
        accessLevel: "read",
        requiredPermission: "finance.read",
      }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it("denies reads for unknown workspaces when Supabase is unreachable", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access");
    // Note: we do NOT insert the workspace locally.
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
        workspaceId: "workspace-not-local",
        action: "load assets",
        accessLevel: "read",
        requiredPermission: "assets.read",
      }),
    ).rejects.toThrow(/not available on this device/i);

    cleanup();
  });

  it("verifies the crew member workspace before opening or removing crew documents", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access");
    insertRemoteWorkspace(database);
    database
      .prepare(
        `INSERT INTO crew_members (id, workspace_id, full_name, is_active, created_at, updated_at)
         VALUES (?, ?, 'Remote Operator', 1, ?, ?)`,
      )
      .run("crew-remote-1", remoteWorkspaceId, "2026-04-24T00:00:00.000Z", "2026-04-24T00:00:00.000Z");
    database
      .prepare(
        `INSERT INTO crew_documents (id, crew_member_id, file_type, original_name, uploaded_at)
         VALUES (?, ?, 'document', 'cedula.pdf', ?)`,
      )
      .run("crew-doc-remote-1", "crew-remote-1", "2026-04-24T00:00:00.000Z");

    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(false), { status: 200 }));
    const guard = createWorkspaceAccessGuard({
      database,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
      getTokens: async () => ({ accessToken: createJwt({ sub: "user-remote", exp: 9_999_999_999 }) }),
      fetchImpl,
      now: () => 1_000,
    });

    await expect(
      guard.assertCrewDocumentAccess("crew-doc-remote-1", "remove that crew document", "write"),
    ).rejects.toThrow(/permission|access|sign in/i);
    expect(fetchImpl).toHaveBeenCalledOnce();

    await expect(
      guard.assertCrewDocumentAccess("crew-doc-missing", "open that crew document", "read"),
    ).rejects.toThrow(/crew document was not found/i);

    cleanup();
  });

  it("resolves project, packing slip, incident and RMA workspace before checking access", async () => {
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
      guard.assertProjectAccess("project-aurora", "load that project", "read", "projects.read"),
    ).resolves.toBe("workspace-metadata");
    await expect(
      guard.assertPackingSlipAccess("packing-1042", "load that packing slip", "read", "packing-slips.read"),
    ).resolves.toBeUndefined();
    await expect(
      guard.assertIncidentAccess("incident-cine7-scratch", "load that incident", "read", "incidents.read"),
    ).resolves.toBeUndefined();
    await expect(
      guard.assertRmaCaseAccess("rma-flowtech-latch", "load that RMA case", "read", "rma.read"),
    ).resolves.toBe("workspace-metadata");

    // Default workspace now goes through Supabase membership checks (the
    // legacy bypass was a spoof vector). Each distinct permission key (4
    // here) triggers one verify call; identical keys would be cached.
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    cleanup();
  });

  it("resolves the signed-in user's real name for assistant turn labels", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access-actor-name");
    const timestamp = "2026-04-24T00:00:00.000Z";
    database
      .prepare(
        `INSERT INTO users (id, full_name, email, phone, is_active, created_at, updated_at)
           VALUES (?, ?, ?, NULL, 1, ?, ?) ON CONFLICT(id) DO NOTHING`,
      )
      .run("user-remote", "Ernesto Martínez", "ernesto@example.test", timestamp, timestamp);

    const guard = createWorkspaceAccessGuard({
      database,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
      getTokens: async () => ({ accessToken: createJwt({ sub: "user-remote", email: "ernesto@example.test", exp: 9_999_999_999 }) }),
      fetchImpl: vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
      now: () => 1_000,
    });

    await expect(guard.getCurrentActorName()).resolves.toBe("Ernesto Martínez");

    cleanup();
  });

  it("uses the JWT profile full name when no local users row carries one", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access-actor-metadata");
    const guard = createWorkspaceAccessGuard({
      database,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
      getTokens: async () => ({
        accessToken: createJwt({
          sub: "user-no-local-row",
          email: "ernesto@example.test",
          user_metadata: { full_name: "Ernesto Maxwell" },
          exp: 9_999_999_999,
        }),
      }),
      fetchImpl: vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
      now: () => 1_000,
    });

    await expect(guard.getCurrentActorName()).resolves.toBe("Ernesto Maxwell");

    cleanup();
  });

  it("falls back to the email when neither a full name source is set", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access-actor-email");
    const guard = createWorkspaceAccessGuard({
      database,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
      getTokens: async () => ({
        accessToken: createJwt({ sub: "user-email-only", email: "ernesto@example.test", exp: 9_999_999_999 }),
      }),
      fetchImpl: vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
      now: () => 1_000,
    });

    await expect(guard.getCurrentActorName()).resolves.toBe("ernesto@example.test");

    cleanup();
  });

  it("falls back to the generic label when no session is present", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-access-actor-fallback");
    const guard = createWorkspaceAccessGuard({
      database,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
      getTokens: async () => ({ accessToken: null }),
      fetchImpl: vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
      now: () => 1_000,
    });

    await expect(guard.getCurrentActorName()).resolves.toBe("Desktop user");

    cleanup();
  });
});
