import { describe, expect, it } from "vitest";

import { resetWorkspaceInventory } from "../../electron/main/services/data/inventoryResetService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const countAssets = (database: ReturnType<typeof createTestDatabase>["database"]) =>
  (database.prepare("SELECT COUNT(*) AS c FROM assets WHERE workspace_id = 'workspace-metadata'").get() as { c: number }).c;

describe("inventory reset service", () => {
  it("previews the wipe without deleting anything (dry run)", () => {
    const { cleanup, database } = createTestDatabase("bukowski-inventory-reset-preview");
    try {
      const before = countAssets(database);
      const report = resetWorkspaceInventory(database, { workspaceId: "workspace-metadata", dryRun: true });

      expect(report.dryRun).toBe(true);
      expect(report.assetCount).toBe(before);
      expect(report.assetCount).toBeGreaterThan(0);
      expect(report.references.some((reference) => reference.table === "asset_current_state")).toBe(true);
      // Nothing was actually deleted.
      expect(countAssets(database)).toBe(before);
    } finally {
      cleanup();
    }
  });

  it("wipes the asset graph but preserves operational records by unlinking them", () => {
    const { cleanup, database } = createTestDatabase("bukowski-inventory-reset-wipe");
    try {
      const incidentBefore = database
        .prepare("SELECT id FROM incidents WHERE workspace_id = 'workspace-metadata' AND asset_id IS NOT NULL LIMIT 1")
        .get() as { id: string } | undefined;

      const report = resetWorkspaceInventory(database, { workspaceId: "workspace-metadata", dryRun: false });

      expect(report.dryRun).toBe(false);
      expect(report.assetCount).toBeGreaterThan(0);
      expect(countAssets(database)).toBe(0);
      expect((database.prepare("SELECT COUNT(*) AS c FROM asset_current_state").get() as { c: number }).c).toBe(0);
      expect(
        (database.prepare("SELECT COUNT(*) AS c FROM legacy_rentman_items WHERE workspace_id = 'workspace-metadata'").get() as { c: number }).c,
      ).toBe(0);

      // The incident survives — just unlinked from the now-deleted asset.
      if (incidentBefore) {
        const incidentAfter = database.prepare("SELECT asset_id FROM incidents WHERE id = ?").get(incidentBefore.id) as
          | { asset_id: string | null }
          | undefined;
        expect(incidentAfter).toBeTruthy();
        expect(incidentAfter?.asset_id).toBeNull();
      }
    } finally {
      cleanup();
    }
  });
});
