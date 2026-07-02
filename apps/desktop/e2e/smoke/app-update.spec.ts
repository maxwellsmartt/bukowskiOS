import fs from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { launchDesktopApp } from "../helpers/electronApp";

type FakeUpdateServer = {
  downloadsDir: string;
  releaseAssetName: string;
  releasesUrl: string;
  close: () => Promise<void>;
};

const closeServer = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const startFakeUpdateServer = async (): Promise<FakeUpdateServer> => {
  const payload = Buffer.alloc(256 * 1024, "bukowski-update-smoke");
  const releaseAssetName = `bukowskiOS-2.0.0-${process.arch === "arm64" ? "arm64" : "x64"}.dmg`;
  const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-update-downloads-"));

  const server = createServer((request, response) => {
    const baseUrl = `http://${request.headers.host ?? "127.0.0.1"}`;
    const requestUrl = new URL(request.url ?? "/", baseUrl);

    if (requestUrl.pathname === "/releases") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify([
        {
          tag_name: "v2.0.0",
          name: "bukowskiOS 2.0.0 smoke",
          html_url: `${baseUrl}/release/v2.0.0`,
          draft: false,
          prerelease: false,
          assets: [
            {
              name: releaseAssetName,
              browser_download_url: `${baseUrl}/download/${releaseAssetName}`,
              size: payload.byteLength,
            },
          ],
        },
      ]));
      return;
    }

    if (requestUrl.pathname === `/download/${releaseAssetName}`) {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": String(payload.byteLength),
        "content-type": "application/octet-stream",
      });
      response.end(payload);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake update server did not expose a TCP port.");
  }

  return {
    downloadsDir,
    releaseAssetName,
    releasesUrl: `http://127.0.0.1:${address.port}/releases`,
    close: () => closeServer(server),
  };
};

test.describe("app update download flow", () => {
  test("detects a new major release and downloads the dmg to the configured downloads folder", async () => {
    const fakeUpdate = await startFakeUpdateServer();
    const app = await launchDesktopApp({
      env: {
        BUKOWSKI_UPDATE_CURRENT_VERSION: "1.9.9",
        BUKOWSKI_UPDATE_DOWNLOADS_DIR: fakeUpdate.downloadsDir,
        BUKOWSKI_UPDATE_RELEASES_URL: fakeUpdate.releasesUrl,
        SUPABASE_ANON_KEY: "",
        SUPABASE_URL: "",
        VITE_SUPABASE_ANON_KEY: "",
        VITE_SUPABASE_SYNC_ENABLED: "0",
        VITE_SUPABASE_URL: "",
      },
      firstWindowTimeoutMs: 45_000,
    });

    try {
      const skipTourButton = app.page.getByRole("button", { name: "Omitir tour", exact: true });
      if (await skipTourButton.isVisible().catch(() => false)) {
        await skipTourButton.click();
        await expect(app.page.getByRole("dialog")).not.toBeVisible();
      }

      const updateButton = app.page.getByRole("button", { name: "Update", exact: true });
      await expect(updateButton).toBeVisible({ timeout: 15_000 });

      await updateButton.click();

      await expect(app.page.getByRole("heading", { name: "Update de bukowskiOS", exact: true })).toBeVisible();
      await expect(app.page.getByText(fakeUpdate.releaseAssetName, { exact: true })).toBeVisible();
      await expect(app.page.getByText("Descarga completada", { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(app.page.getByRole("button", { name: "Abrir instalador", exact: true })).toBeVisible();

      const downloadedPath = path.join(fakeUpdate.downloadsDir, fakeUpdate.releaseAssetName);
      expect(fs.existsSync(downloadedPath)).toBe(true);
      expect(fs.statSync(downloadedPath).size).toBe(256 * 1024);
    } finally {
      await app.cleanup();
      await fakeUpdate.close();
      fs.rmSync(fakeUpdate.downloadsDir, { force: true, recursive: true });
    }
  });
});
