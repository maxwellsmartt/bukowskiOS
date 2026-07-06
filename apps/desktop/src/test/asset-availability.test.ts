import { describe, expect, it } from "vitest";

import { resolveAssetAvailability, resolveAssetPackingAvailability, summarizeUnavailableAssets } from "@shared/lib/assetAvailability";

const baseAsset = {
  status: "Available",
  quantity: 1,
  assignedQuantity: 0,
  checkedOutQuantity: 0,
  linkedKitCount: 0,
  linkedKitCodes: [],
  project: "—",
  projectId: null,
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
    ).toBe("1 in repair, 1 retired, 1 out of stock, 1 assigned");
  });

  it("allows packing assets that are already reserved for the selected project", () => {
    expect(
      resolveAssetPackingAvailability(
        { ...baseAsset, quantity: 0, assignedQuantity: 2, project: "Shiver", projectId: "project-shiver" },
        "project-shiver",
      ),
    ).toMatchObject({
      isAvailable: true,
      label: "Reserved for project",
      tone: "success",
    });
  });

  it("does not let project reservations override repair or checkout blockers", () => {
    expect(
      resolveAssetPackingAvailability(
        { ...baseAsset, status: "Maintenance", quantity: 0, assignedQuantity: 1, projectId: "project-shiver" },
        "project-shiver",
      ),
    ).toMatchObject({
      isAvailable: false,
      label: "In repair",
    });

    expect(
      resolveAssetPackingAvailability(
        { ...baseAsset, quantity: 0, assignedQuantity: 1, checkedOutQuantity: 1, projectId: "project-shiver" },
        "project-shiver",
      ),
    ).toMatchObject({
      isAvailable: false,
      label: "Checked out",
    });
  });

  it("blocks packing assets reserved for a different project", () => {
    expect(
      resolveAssetPackingAvailability(
        { ...baseAsset, quantity: 1, assignedQuantity: 1, project: "Shiver", projectId: "project-shiver" },
        "project-wave",
      ),
    ).toMatchObject({
      isAvailable: false,
      label: "Assigned",
      reason: "1 reserved for Shiver.",
    });
  });

  it("allows packing kit members only when the action is sourced from that kit", () => {
    const kitAsset = { ...baseAsset, quantity: 0, linkedKitCount: 1, linkedKitCodes: ["KIT-01"] };

    expect(resolveAssetPackingAvailability(kitAsset, "project-shiver")).toMatchObject({
      isAvailable: false,
      label: "In kit",
    });

    expect(resolveAssetPackingAvailability(kitAsset, "project-shiver", "kit-01")).toMatchObject({
      isAvailable: true,
      label: "Kit ready",
    });
  });
});
