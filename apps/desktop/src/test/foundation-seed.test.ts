import { describe, expect, it } from "vitest";

import { createTestDatabase } from "./helpers/createTestDatabase";

describe("foundation seed", () => {
  it("seeds the structural foundation but no demo fixtures in packaged databases", () => {
    const { cleanup, database } = createTestDatabase("bukowski-foundation-no-demo", { includeDemoData: false });
    try {
      const workspaces = database.prepare("SELECT COUNT(*) AS count FROM workspaces").get() as { count: number };
      const permissions = database.prepare("SELECT COUNT(*) AS count FROM permissions").get() as { count: number };
      const projects = database.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
      const adminRole = database.prepare("SELECT id FROM roles WHERE id = 'role-admin'").get() as
        | { id: string }
        | undefined;
      const demoUsers = database
        .prepare("SELECT COUNT(*) AS count FROM users WHERE id IN ('user-paola', 'user-luis', 'user-miguel')")
        .get() as { count: number };

      // The offline foundation — the local fallback workspace and the base
      // role-admin — must exist even in production: the command actor and the
      // fresh-database re-hydration both depend on `role-admin`.
      expect(workspaces.count).toBe(1);
      expect(adminRole?.id).toBe("role-admin");
      expect(permissions.count).toBeGreaterThan(0);
      // …but the fictional demo fixtures (projects, demo crew) must NOT be seeded.
      expect(projects.count).toBe(0);
      expect(demoUsers.count).toBe(0);
    } finally {
      cleanup();
    }
  });
});
