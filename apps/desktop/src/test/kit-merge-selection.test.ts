import { describe, expect, it } from "vitest";

import { mergeKitAssetSelections } from "../features/assets/kitMergeSelection";

describe("mergeKitAssetSelections", () => {
  it("keeps existing members when adding new assets to a kit", () => {
    const existing = [
      { assetId: "a", quantity: 1 },
      { assetId: "b", quantity: 2 },
    ];
    const added = [
      { assetId: "c", quantity: 1 },
      { assetId: "d", quantity: 3 },
    ];

    const merged = mergeKitAssetSelections(existing, added);

    expect(merged).toEqual([
      { assetId: "a", quantity: 1 },
      { assetId: "b", quantity: 2 },
      { assetId: "c", quantity: 1 },
      { assetId: "d", quantity: 3 },
    ]);
  });

  it("does not duplicate an asset already in the kit and keeps its existing quantity", () => {
    const existing = [{ assetId: "a", quantity: 4 }];
    const added = [
      { assetId: "a", quantity: 1 },
      { assetId: "b", quantity: 1 },
    ];

    const merged = mergeKitAssetSelections(existing, added);

    expect(merged).toEqual([
      { assetId: "a", quantity: 4 },
      { assetId: "b", quantity: 1 },
    ]);
  });

  it("clamps quantities below 1 up to 1", () => {
    expect(mergeKitAssetSelections([], [{ assetId: "a", quantity: 0 }])).toEqual([{ assetId: "a", quantity: 1 }]);
    expect(mergeKitAssetSelections([{ assetId: "a", quantity: -2 }], [])).toEqual([{ assetId: "a", quantity: 1 }]);
  });

  it("returns existing members unchanged when nothing is added", () => {
    const existing = [{ assetId: "a", quantity: 2 }];
    expect(mergeKitAssetSelections(existing, [])).toEqual([{ assetId: "a", quantity: 2 }]);
  });
});
