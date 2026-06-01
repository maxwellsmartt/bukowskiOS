import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkspaceBrandingAssetService } from "../../electron/main/services/data/workspaceBrandingAssetService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const tempDirs: string[] = [];
const makeUserDataPath = () => {
  const dir = mkdtempSync(join(tmpdir(), "branding-assets-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("workspace branding asset service", () => {
  it("downloads workspace asset bytes from storage and caches them locally", async () => {
    const { cleanup, database } = createTestDatabase("workspace-branding-assets");
    const logoBytes = Buffer.from("fake-logo-bytes");
    let downloadCount = 0;
    const storage = {
      enabled: true,
      download: async (objectKey: string) => {
        downloadCount += 1;
        return objectKey === "workspace-metadata/logo-123.png" ? logoBytes : null;
      },
    };
    const service = createWorkspaceBrandingAssetService(database, {
      userDataPath: makeUserDataPath(),
      storage,
    });

    const url = "file:///storage/v1/object/public/workspace-assets/workspace-metadata/logo-123.png";
    const first = await service.resolveAssetBuffer("workspace-metadata", "logo", url);
    const second = await service.resolveAssetBuffer("workspace-metadata", "logo", url);
    const row = database
      .prepare(
        `SELECT storage_path, storage_object_key, byte_size
         FROM workspace_branding_assets
         WHERE workspace_id = ? AND asset_key = ?`,
      )
      .get("workspace-metadata", "logo") as
      | { storage_path: string; storage_object_key: string; byte_size: number }
      | undefined;

    expect(first?.toString("utf8")).toBe("fake-logo-bytes");
    expect(second?.toString("utf8")).toBe("fake-logo-bytes");
    expect(downloadCount).toBe(1);
    expect(row?.storage_object_key).toBe("workspace-metadata/logo-123.png");
    expect(row?.byte_size).toBe(logoBytes.length);

    cleanup();
  });
});
