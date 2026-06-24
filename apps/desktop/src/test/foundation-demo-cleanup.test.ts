import { describe, expect, it } from "vitest";

import { cleanupFoundationDemoData } from "../../electron/main/services/data/foundationSeed";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("cleanupFoundationDemoData", () => {
  it("removes the seeded demo dataset under workspace-metadata", () => {
    // createTestDatabase seeds the demo dataset (includeDemoData defaults true).
    const { cleanup, database } = createTestDatabase("bukowski-demo-cleanup");

    const countProjects = () =>
      (database.prepare("SELECT COUNT(*) AS n FROM projects WHERE id IN ('project-aurora','project-studio','project-house')").get() as {
        n: number;
      }).n;
    const countAssets = () =>
      (database.prepare("SELECT COUNT(*) AS n FROM assets WHERE id LIKE 'asset-%'").get() as { n: number }).n;

    expect(countProjects()).toBeGreaterThan(0);
    expect(countAssets()).toBeGreaterThan(0);

    cleanupFoundationDemoData(database);

    expect(countProjects()).toBe(0);
    const remainingDemoAssets = (database
      .prepare(
        "SELECT COUNT(*) AS n FROM assets WHERE id IN ('asset-teradek-bolt','asset-sachtler-flowtech','asset-smallhd-cine7','asset-aputure-600d')",
      )
      .get() as { n: number }).n;
    expect(remainingDemoAssets).toBe(0);

    // Foreign keys are back on after the sweep.
    const fkRow = database.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number } | undefined;
    expect(fkRow?.foreign_keys).toBe(1);

    // The sweep must leave the database FK-consistent — the real startup runs a
    // global foreign_key_check right after and aborts (hanging the loading
    // screen) if any dangling reference remains.
    const violations = database.prepare("PRAGMA foreign_key_check").all();
    expect(violations).toEqual([]);

    cleanup();
  });

  it("is idempotent on a database with no demo data", () => {
    const { cleanup, database } = createTestDatabase("bukowski-demo-cleanup-empty", { includeDemoData: false });
    expect(() => cleanupFoundationDemoData(database)).not.toThrow();
    cleanup();
  });
});
