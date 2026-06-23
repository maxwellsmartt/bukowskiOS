import { describe, expect, it } from "vitest";

import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("getFinancialPriorities", () => {
  it("ranks projects by priority score, highest first, with sequential ranks", () => {
    const { cleanup, database } = createTestDatabase("bukowski-financial-priorities");
    const reads = createFoundationReadService(database);

    // Ensure at least one project carries material exposure.
    const incident = database
      .prepare("SELECT id FROM incidents WHERE project_id IS NOT NULL AND TRIM(project_id) <> '' LIMIT 1")
      .get() as { id: string } | undefined;
    if (incident) {
      database.prepare("UPDATE incidents SET cost_estimate = 9999 WHERE id = ?").run(incident.id);
    }

    const result = reads.getFinancialPriorities({ limit: 6 });

    expect(result.items.length).toBeGreaterThan(0);
    // Sorted descending by priority score.
    for (let i = 1; i < result.items.length; i += 1) {
      expect(result.items[i - 1].priorityScore).toBeGreaterThanOrEqual(result.items[i].priorityScore);
    }
    // Ranks are sequential starting at 1.
    result.items.forEach((item, index) => {
      expect(item.priorityRank).toBe(index + 1);
      expect(typeof item.reason).toBe("string");
    });
    expect(result.topPriority?.project).toBe(result.items[0].project);

    cleanup();
  });
});
