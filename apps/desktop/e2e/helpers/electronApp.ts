import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";

type LaunchDesktopAppOptions = {
  env?: Record<string, string>;
  firstWindowTimeoutMs?: number;
};

export const launchDesktopApp = async (options: LaunchDesktopAppOptions = {}) => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-desktop-e2e-"));
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = path.resolve(currentDir, "../..");

  const electronApp = await electron.launch({
    args: ["."],
    cwd: appRoot,
    env: {
      ...process.env,
      BUKOWSKI_E2E: "1",
      HOME: temporaryHome,
      ...options.env,
    },
  });

  const page = await electronApp.firstWindow({ timeout: options.firstWindowTimeoutMs ?? 30_000 });
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(".app-shell")).toBeVisible();

  return {
    electronApp,
    page,
    cleanup: async () => {
      await electronApp.close();
      fs.rmSync(temporaryHome, { force: true, recursive: true });
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
