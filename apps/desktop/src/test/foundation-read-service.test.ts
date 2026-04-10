import { describe, expect, it } from "vitest";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("foundation read service", () => {
  it("hydrates shell, imported assets and finance snapshots from the local foundation database", () => {
    const { cleanup, database } = createTestDatabase("bukowski-foundation-test");
    const reads = createFoundationReadService(database);

    expect(reads.getShellBootstrap().workspaceName).toBe("Metadata Cine");
    expect(reads.getOverviewSnapshot().metrics).toHaveLength(5);
    expect(reads.getAssets().length).toBeGreaterThan(780);
    expect(reads.getAssetDetail("asset-legacy-rentman-1").asset?.code).toBe("485");
    expect(reads.getAssetDetail("asset-legacy-rentman-1").asset?.quantity).toBe(2);
    expect(reads.getAssetDetail("asset-legacy-rentman-1").legacy?.folderPath).toBe("Gripería/Tripodes");
    expect(reads.getAssetDetail("asset-legacy-rentman-1").editor?.primaryCodeValue).toBeTruthy();
    expect(reads.getAssetDetail("asset-legacy-rentman-1").scannableCodes.length).toBeGreaterThan(0);
    expect(reads.getAssetDetail("asset-legacy-rentman-1").timeline.length).toBeGreaterThan(0);
    expect(reads.getPackingSlips().length).toBeGreaterThan(0);
    expect(reads.getPackingSlipDetail("packing-1042").slip?.number).toBe("PS-1042");
    expect(reads.getPackingSlipDetail("packing-1042").slip?.primaryCodeValue).toBeTruthy();
    expect(reads.getPackingSlipDetail("packing-1042").items.length).toBeGreaterThan(0);
    expect(reads.getProjectDetail("project-aurora").project?.name).toBe("Aurora Campaign");
    expect(reads.getProjectDetail("project-aurora").project?.client).toBe("Altura");
    expect(reads.getProjectDetail("project-aurora").assets.length).toBeGreaterThan(0);
    expect(reads.getProjectDetail("project-aurora").incidents.length).toBeGreaterThan(0);
    expect(reads.getProjectDetail("project-aurora").metrics).toHaveLength(4);
    expect(reads.getCatalogSnapshot().clients.length).toBeGreaterThan(0);
    expect(reads.getCatalogSnapshot().crewMembers.length).toBeGreaterThan(0);
    expect(reads.getCatalogSnapshot().categories.length).toBeGreaterThan(0);
    expect(reads.getFinanceOverview().metrics).toHaveLength(4);
    expect(reads.getFinanceEntries()).toHaveLength(2);

    cleanup();
  });
});
