import { expect, test } from "@playwright/test";

import { launchDesktopApp, navigateRouteByHash } from "../helpers/electronApp";

const logMetric = (label: string, durationMs: number) => {
  // Keep the metric visible in Playwright output for quick regression checks.
  console.log(`[perf] ${label}: ${durationMs.toFixed(0)}ms`);
};

test.describe("desktop perf profile", () => {
  test("boots and navigates core heavy surfaces within sane local budgets", async () => {
    test.setTimeout(90_000);
    const bootStartedAt = Date.now();
    const app = await launchDesktopApp({
      env: {
        BUKOWSKI_PROFILE_DATASET: "1",
      },
      firstWindowTimeoutMs: 60_000,
    });
    const bootDuration = Date.now() - bootStartedAt;

    try {
      logMetric("boot-heavy-dataset", bootDuration);
      expect(bootDuration).toBeLessThan(12_000);

      const missionStartedAt = Date.now();
      await navigateRouteByHash(app.page, "#/agents/mission-control", "Mission Control");
      await expect(app.page.getByText("Mission graph", { exact: false })).toBeVisible();
      const missionDuration = Date.now() - missionStartedAt;
      logMetric("mission-control-heavy-dataset", missionDuration);
      expect(missionDuration).toBeLessThan(5_000);

      const settingsStartedAt = Date.now();
      await navigateRouteByHash(app.page, "#/settings/sync", "Local sync queue");
      await expect(app.page.getByText("Retry all failed")).toBeVisible();
      const syncDuration = Date.now() - settingsStartedAt;
      logMetric("sync-outbox-heavy-dataset", syncDuration);
      expect(syncDuration).toBeLessThan(4_000);

      const searchStartedAt = Date.now();
      await app.page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+K`);
      const searchInput = app.page.getByPlaceholder("Search assets, projects, units and incidents");
      await expect(searchInput).toBeVisible();
      await searchInput.fill("Performance Project 012");
      const projectSearchResult = app.page.getByRole("button", {
        name: /PERF-012 Performance Project 012/i,
      });
      await expect(projectSearchResult).toBeVisible();
      const searchDuration = Date.now() - searchStartedAt;
      logMetric("global-search-heavy-dataset", searchDuration);
      expect(searchDuration).toBeLessThan(4_000);
      await app.page.keyboard.press("Escape");

      const overviewStartedAt = Date.now();
      await navigateRouteByHash(app.page, "#/overview", "Overview");
      await expect(app.page.getByText("Show more projects", { exact: false })).toBeVisible();
      const overviewDuration = Date.now() - overviewStartedAt;
      logMetric("timeline-overview-heavy-dataset", overviewDuration);
      expect(overviewDuration).toBeLessThan(5_000);

      const chatStartedAt = Date.now();
      await app.page.getByRole("button", { name: "Open global assistant", exact: true }).click();
      await expect(app.page.getByLabel("Global assistant chat")).toBeVisible();
      await expect(app.page.getByText("Performance thread 001", { exact: false })).toBeVisible();
      const chatDuration = Date.now() - chatStartedAt;
      logMetric("assistant-chat-heavy-dataset", chatDuration);
      expect(chatDuration).toBeLessThan(4_000);
    } finally {
      await app.cleanup();
    }
  });
});
