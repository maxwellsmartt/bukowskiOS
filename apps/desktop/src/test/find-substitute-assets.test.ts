import { describe, expect, it } from "vitest";

import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("findSubstituteAssets", () => {
  it("returns only available, same-category alternatives excluding the target", () => {
    const { cleanup, database } = createTestDatabase("bukowski-substitutes");
    const reads = createFoundationReadService(database);

    const target = reads.getAssets()[0];
    expect(target).toBeTruthy();

    const result = reads.findSubstituteAssets({ assetId: target.id });
    expect(result).not.toBeNull();
    expect(result?.target.id).toBe(target.id);

    for (const sub of result?.substitutes ?? []) {
      expect(sub.id).not.toBe(target.id);
      expect(sub.category).toBe(target.category);
      expect(sub.availableQuantity).toBeGreaterThan(0);
      expect(["direct_equivalent", "same_category"]).toContain(sub.compatibility);
    }
    expect(result?.totalCompatibleAvailable).toBe(result?.substitutes.length);

    cleanup();
  });

  it("returns null for an unknown asset id", () => {
    const { cleanup, database } = createTestDatabase("bukowski-substitutes-missing");
    const reads = createFoundationReadService(database);
    expect(reads.findSubstituteAssets({ assetId: "asset-does-not-exist" })).toBeNull();
    cleanup();
  });
});
