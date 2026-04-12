import { describe, expect, it } from "vitest";

import { runIntegrityChecks } from "../../electron/main/services/data/localDatabaseSupport";
import {
  cleanupPerformanceFoundationData,
  seedPerformanceFoundationData,
} from "../../electron/main/services/data/performanceFoundationSeed";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("performance foundation seed", () => {
  it("adds a heavier but valid local dataset without breaking integrity", () => {
    const { cleanup, database } = createTestDatabase("bukowski-performance-seed");

    try {
      seedPerformanceFoundationData(database);
      runIntegrityChecks(database);

      const projectCount = (database.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count;
      const threadCount = (database.prepare("SELECT COUNT(*) AS count FROM assistant_chat_threads").get() as { count: number }).count;
      const runCount = (database.prepare("SELECT COUNT(*) AS count FROM agent_runs").get() as { count: number }).count;

      expect(projectCount).toBeGreaterThan(20);
      expect(threadCount).toBeGreaterThan(10);
      expect(runCount).toBeGreaterThan(50);
    } finally {
      cleanup();
    }
  });

  it("removes the synthetic perf dataset cleanly", () => {
    const { cleanup, database } = createTestDatabase("bukowski-performance-cleanup");

    try {
      seedPerformanceFoundationData(database);

      const projectCountBefore = (
        database.prepare("SELECT COUNT(*) AS count FROM projects WHERE id LIKE 'project-perf-%'").get() as { count: number }
      ).count;
      expect(projectCountBefore).toBeGreaterThan(0);

      const removedRows = cleanupPerformanceFoundationData(database);
      expect(removedRows).toBeGreaterThan(0);

      const projectCountAfter = (
        database.prepare("SELECT COUNT(*) AS count FROM projects WHERE id LIKE 'project-perf-%'").get() as { count: number }
      ).count;
      const threadCountAfter = (
        database.prepare("SELECT COUNT(*) AS count FROM assistant_chat_threads WHERE id LIKE 'thread-perf-%'").get() as {
          count: number;
        }
      ).count;

      expect(projectCountAfter).toBe(0);
      expect(threadCountAfter).toBe(0);
      expect(() => runIntegrityChecks(database)).not.toThrow();
    } finally {
      cleanup();
    }
  });
});
