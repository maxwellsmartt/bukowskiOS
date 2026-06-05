import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";

type LaunchDesktopAppOptions = {
  env?: Record<string, string>;
  firstWindowTimeoutMs?: number;
  cleanupHome?: boolean;
  homePath?: string;
};

export const launchDesktopApp = async (options: LaunchDesktopAppOptions = {}) => {
  const homePath = options.homePath ?? fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-desktop-e2e-"));
  const userDataPath = path.join(homePath, "userData");
  const shouldCleanupHome = options.cleanupHome ?? !options.homePath;
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = path.resolve(currentDir, "../..");

  const electronApp = await electron.launch({
    args: ["."],
    cwd: appRoot,
    env: {
      ...process.env,
      BUKOWSKI_E2E: "1",
      BUKOWSKI_E2E_USER_DATA_PATH: userDataPath,
      HOME: homePath,
      ...options.env,
    },
  });

  const page = await electronApp.firstWindow({ timeout: options.firstWindowTimeoutMs ?? 30_000 });
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(".app-shell")).toBeVisible();

  return {
    electronApp,
    getUserDataPath: () => electronApp.evaluate(({ app }) => app.getPath("userData")),
    homePath,
    page,
    cleanup: async () => {
      await electronApp.close();
      if (shouldCleanupHome) {
        fs.rmSync(homePath, { force: true, recursive: true });
      }
    },
  };
};

export const openRoute = async (page: Page, href: string, expectedHeading: RegExp | string) => {
  await page.locator(`a[href="${href}"]`).first().click();
  await expect(page.locator("main").getByRole("heading", { name: expectedHeading, exact: true }).first()).toBeVisible();
};

export const navigateRouteByHash = async (page: Page, href: string, expectedHeading: RegExp | string) => {
  await page.evaluate((nextHref) => {
    window.location.hash = nextHref.startsWith("#") ? nextHref.slice(1) : nextHref;
  }, href);
  await expect(page.locator("main").getByRole("heading", { name: expectedHeading, exact: true }).first()).toBeVisible();
};

export type DesktopElectronApp = ElectronApplication;
