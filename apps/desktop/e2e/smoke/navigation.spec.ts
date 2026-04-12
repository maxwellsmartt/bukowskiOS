import { expect, test } from "@playwright/test";

import { launchDesktopApp, openRoute } from "../helpers/electronApp";

test.describe("desktop smoke", () => {
  test("boots the shell and renders the primary navigation", async () => {
    const app = await launchDesktopApp();

    try {
      const sidebar = app.page.getByRole("complementary");
      await expect(sidebar.getByRole("link", { name: "Assets", exact: true })).toBeVisible();
      await expect(sidebar.getByRole("link", { name: "Finance", exact: true })).toBeVisible();
      await expect(sidebar.getByRole("link", { name: "Agents", exact: true })).toBeVisible();
      await expect(app.page.locator("main").getByRole("heading", { name: "Overview", exact: true }).first()).toBeVisible();
    } finally {
      await app.cleanup();
    }
  });

  test("navigates to mission control, runs and settings without white-screen regressions", async () => {
    const app = await launchDesktopApp();

    try {
      await openRoute(app.page, "#/agents/mission-control", "Mission Control");
      await expect(app.page.getByText("Mission graph", { exact: false })).toBeVisible();

      await openRoute(app.page, "#/agents/runs", "Runs");
      await expect(app.page.getByText("Recent runs")).toBeVisible();

      await openRoute(app.page, "#/settings", "Settings");
      await expect(app.page.getByText("Run integrity check")).toBeVisible();
      await expect(app.page.getByText("Export all data as JSON")).toBeVisible();

      await app.page.getByRole("button", { name: "Open local sync queue", exact: true }).click();
      await expect(app.page.locator("main").getByRole("heading", { name: "Local sync queue", exact: true }).first()).toBeVisible();
      await expect(app.page.getByText("Retry all failed")).toBeVisible();
    } finally {
      await app.cleanup();
    }
  });
});
