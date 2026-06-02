import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("does not read local files from persisted branding source URLs", async () => {
    const { cleanup, database } = createTestDatabase("workspace-branding-assets-file-url");
    const userDataPath = makeUserDataPath();
    const outsideRoot = makeUserDataPath();
    const privateFile = join(outsideRoot, "private.txt");
    writeFileSync(privateFile, "private-branding-leak");

    const service = createWorkspaceBrandingAssetService(database, {
      userDataPath,
    });

    const result = await service.resolveAssetBuffer("workspace-metadata", "logo", `file://${privateFile}`);

    expect(result).toBeNull();
    expect(existsSync(privateFile)).toBe(true);

    cleanup();
  });

  it("does not read cached branding paths outside the configured storage root", async () => {
    const { cleanup, database } = createTestDatabase("workspace-branding-assets-cache-escape");
    const userDataPath = makeUserDataPath();
    const outsideRoot = makeUserDataPath();
    const privateFile = join(outsideRoot, "private.txt");
    writeFileSync(privateFile, "private-branding-cache");
    const service = createWorkspaceBrandingAssetService(database, {
      userDataPath,
      storage: {
        enabled: false,
        download: async () => null,
      },
    });
    database
      .prepare(
        `
          INSERT INTO workspace_branding_assets (
            workspace_id, asset_key, source_url, storage_object_key, mime_type,
            original_name, storage_path, byte_size, content_hash, status, created_at, updated_at
          ) VALUES (?, 'logo', ?, NULL, 'image/png', 'logo.png', ?, 22, 'hash', 'available', ?, ?)
        `,
      )
      .run("workspace-metadata", "ftp://example.com/logo.png", privateFile, "2026-04-12T12:00:00.000Z", "2026-04-12T12:00:00.000Z");

    const result = await service.resolveAssetBuffer("workspace-metadata", "logo", "ftp://example.com/logo.png");

    expect(result).toBeNull();
    expect(existsSync(privateFile)).toBe(true);

    cleanup();
  });
});
