import { describe, expect, it } from "vitest";

import { createTestDatabase } from "./helpers/createTestDatabase";

describe("foundation seed", () => {
  it("keeps packaged-style databases free of demo workspaces while retaining permission definitions", () => {
    const { cleanup, database } = createTestDatabase("bukowski-foundation-no-demo", { includeDemoData: false });
    try {
      const workspaces = database.prepare("SELECT COUNT(*) AS count FROM workspaces").get() as { count: number };
      const permissions = database.prepare("SELECT COUNT(*) AS count FROM permissions").get() as { count: number };
      const projects = database.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };

      expect(workspaces.count).toBe(0);
      expect(permissions.count).toBeGreaterThan(0);
      expect(projects.count).toBe(0);
    } finally {
      cleanup();
    }
  });
});
