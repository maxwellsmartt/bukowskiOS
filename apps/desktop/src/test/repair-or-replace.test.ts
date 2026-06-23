import { describe, expect, it } from "vitest";

import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("assessRepairOrReplace", () => {
  it("recommends replace when repair cost is a large share of replacement value", () => {
    const { cleanup, database } = createTestDatabase("bukowski-repair-replace-replace");
    const reads = createFoundationReadService(database);

    const asset = database.prepare("SELECT id FROM assets LIMIT 1").get() as { id: string };
    const incident = database.prepare("SELECT id FROM incidents LIMIT 1").get() as { id: string };

    database
      .prepare(
        "UPDATE assets SET replacement_value = 1000, current_book_value = NULL, purchase_price = NULL, additional_costs = NULL WHERE id = ?",
      )
      .run(asset.id);
    database.prepare("UPDATE incidents SET asset_id = ?, cost_estimate = 700 WHERE id = ?").run(asset.id, incident.id);

    const result = reads.assessRepairOrReplace({ incidentId: incident.id });
    expect(result).not.toBeNull();
    expect(result?.recommendation).toBe("replace");
    expect(result?.repairToReplaceRatio).toBe(0.7);

    cleanup();
  });

  it("flags review when the incident has no cost estimate", () => {
    const { cleanup, database } = createTestDatabase("bukowski-repair-replace-review");
    const reads = createFoundationReadService(database);

    const asset = database.prepare("SELECT id FROM assets LIMIT 1").get() as { id: string };
    const incident = database.prepare("SELECT id FROM incidents LIMIT 1").get() as { id: string };

    database.prepare("UPDATE assets SET replacement_value = 1000 WHERE id = ?").run(asset.id);
    database.prepare("UPDATE incidents SET asset_id = ?, cost_estimate = NULL WHERE id = ?").run(asset.id, incident.id);

    const result = reads.assessRepairOrReplace({ incidentId: incident.id });
    expect(result?.recommendation).toBe("review");
    expect(result?.repairToReplaceRatio).toBeNull();

    cleanup();
  });
});
