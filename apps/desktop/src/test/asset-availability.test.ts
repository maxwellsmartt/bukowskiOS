import { describe, expect, it } from "vitest";

import { resolveAssetAvailability, summarizeUnavailableAssets } from "@shared/lib/assetAvailability";

const baseAsset = {
  status: "Available",
  quantity: 1,
  assignedQuantity: 0,
  checkedOutQuantity: 0,
  linkedKitCount: 0,
  linkedKitCodes: [],
  project: "—",
};

describe("asset availability", () => {
  it("marks stock as available for assignment and packing", () => {
    expect(resolveAssetAvailability(baseAsset)).toMatchObject({
      isAvailable: true,
      label: "Available",
      tone: "success",
    });
  });

  it("blocks kit members before other stock states", () => {
    expect(
      resolveAssetAvailability({
        ...baseAsset,
        quantity: 0,
        linkedKitCount: 1,
        linkedKitCodes: ["KIT-01"],
      }),
    ).toMatchObject({
      isAvailable: false,
      label: "In kit",
      tone: "warning",
    });
  });

  it("explains retired and repair assets as unavailable", () => {
    expect(resolveAssetAvailability({ ...baseAsset, status: "Retired" })).toMatchObject({
      isAvailable: false,
      label: "Retired",
      tone: "critical",
    });

    expect(resolveAssetAvailability({ ...baseAsset, status: "Maintenance" })).toMatchObject({
      isAvailable: false,
      label: "In repair",
      tone: "warning",
    });
  });

  it("distinguishes checked out, assigned and no-stock cases", () => {
    expect(resolveAssetAvailability({ ...baseAsset, checkedOutQuantity: 1, project: "Shiver" })).toMatchObject({
      isAvailable: false,
      label: "Checked out",
      reason: "1 checked out on Shiver.",
    });

    expect(resolveAssetAvailability({ ...baseAsset, quantity: 0, assignedQuantity: 2, project: "Shiver" })).toMatchObject({
      isAvailable: false,
      label: "Assigned",
      reason: "2 reserved for Shiver.",
    });

    expect(resolveAssetAvailability({ ...baseAsset, quantity: 0 })).toMatchObject({
      isAvailable: false,
      label: "No stock",
      tone: "neutral",
    });
  });

  it("summarizes unavailable selections for user-facing warnings", () => {
    expect(
      summarizeUnavailableAssets([
        { ...baseAsset, status: "Maintenance" },
        { ...baseAsset, status: "Retired" },
        { ...baseAsset, quantity: 0 },
        { ...baseAsset, quantity: 0, assignedQuantity: 1 },
      ]),
    ).toBe("1 in repair, 1 retired, 1 no stock, 1 assigned");
  });
});
