import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createFileUploadService } from "../../electron/main/services/data/fileUploadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("file upload service", () => {
  it("imports asset files into local storage and exposes them through asset detail reads", () => {
    const { cleanup, database } = createTestDatabase("bukowski-file-upload-asset");
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-asset-files-"));
    const sourceFilePath = path.join(tempRoot, "fixture-asset.pdf");
    fs.writeFileSync(sourceFilePath, "asset-file");

    const service = createFileUploadService(database, {
      userDataPath: tempRoot,
      shellApi: {
        openPath: vi.fn().mockResolvedValue(""),
      },
    });

    const result = service.importAssetFiles("asset-legacy-rentman-1", [sourceFilePath]);
    const reads = createFoundationReadService(database);
    const detail = reads.getAssetDetail("asset-legacy-rentman-1");

    expect(result.uploadedCount).toBe(1);
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0]?.originalName).toBe("fixture-asset.pdf");
    expect(detail.files[0]?.status).toBe("available");
    expect(detail.files[0]?.mimeType).toBe("application/pdf");

    cleanup();
    fs.rmSync(tempRoot, { force: true, recursive: true });
  });

  it("marks missing incident evidence when the stored file disappears", () => {
    const { cleanup, database } = createTestDatabase("bukowski-file-upload-incident");
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-incident-files-"));
    const sourceFilePath = path.join(tempRoot, "fixture-incident.png");
    fs.writeFileSync(sourceFilePath, "incident-file");

    const service = createFileUploadService(database, {
      userDataPath: tempRoot,
      shellApi: {
        openPath: vi.fn().mockResolvedValue(""),
      },
    });

    service.importIncidentFiles("incident-cine7-scratch", [sourceFilePath]);

    const storedPath = database
      .prepare("SELECT storage_path FROM incident_files WHERE incident_id = ? LIMIT 1")
      .get("incident-cine7-scratch") as { storage_path: string } | undefined;

    expect(storedPath?.storage_path).toBeTruthy();
    fs.unlinkSync(storedPath!.storage_path);

    const reads = createFoundationReadService(database);
    const detail = reads.getIncidentDetail("incident-cine7-scratch");

    expect(detail.files).toHaveLength(1);
    expect(detail.files[0]?.status).toBe("missing");

    cleanup();
    fs.rmSync(tempRoot, { force: true, recursive: true });
  });
});
