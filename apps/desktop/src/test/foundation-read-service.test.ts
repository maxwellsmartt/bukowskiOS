import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { foundationMigrationSql } from "@db";

import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { bootstrapLegacyRentmanDemo } from "../../electron/main/services/data/legacyRentmanDemo";
import { seedFoundationData } from "../../electron/main/services/data/foundationSeed";

const createTempDatabase = () => {
  const databasePath = path.join(os.tmpdir(), `bukowski-foundation-test-${Date.now()}-${Math.random()}.sqlite`);
  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(foundationMigrationSql);
  seedFoundationData(database);
  bootstrapLegacyRentmanDemo(database);

  return { database, databasePath };
};

describe("foundation read service", () => {
  it("hydrates shell, imported assets and finance snapshots from the local foundation database", () => {
    const { database, databasePath } = createTempDatabase();
    const reads = createFoundationReadService(database);

    expect(reads.getShellBootstrap().workspaceName).toBe("Metadata Cine");
    expect(reads.getOverviewSnapshot().metrics).toHaveLength(5);
    expect(reads.getAssets().length).toBeGreaterThan(780);
    expect(reads.getAssetDetail("asset-legacy-rentman-1").asset?.code).toBe("485");
    expect(reads.getAssetDetail("asset-legacy-rentman-1").asset?.quantity).toBe(2);
    expect(reads.getAssetDetail("asset-legacy-rentman-1").legacy?.folderPath).toBe("Gripería/Tripodes");
    expect(reads.getAssetDetail("asset-legacy-rentman-1").timeline.length).toBeGreaterThan(0);
    expect(reads.getFinanceOverview().metrics).toHaveLength(4);
    expect(reads.getFinanceEntries()).toHaveLength(2);

    database.close();
    fs.unlinkSync(databasePath);
  });
});
