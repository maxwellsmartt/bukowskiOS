import { expect, test } from "@playwright/test";

import { launchDesktopApp, navigateRouteByHash } from "../helpers/electronApp";

test.describe("catalog smoke", () => {
  test("renders catalog actions, empty search state and detail rail chrome", async () => {
    const app = await launchDesktopApp();

    try {
      await navigateRouteByHash(app.page, "#/catalog", /Catálogo|Catalog/);

      const onboarding = app.page.locator(".onboarding-backdrop");
      const skipOnboarding = app.page.getByRole("button", { name: /Omitir tour|Omitir onboarding|Skip tour|Skip onboarding/i }).first();
      if (await onboarding.isVisible().catch(() => false)) {
        await skipOnboarding.click();
        await expect(onboarding).toBeHidden();
      }

      await expect(app.page.locator(".catalog-toolbar-button svg.lucide-upload")).toBeVisible();
      await expect(app.page.locator(".catalog-toolbar-button svg.lucide-download").first()).toBeVisible();

      const search = app.page.locator(".list-toolbar-search-input");
      await search.fill("__codex_no_catalog_match__");
      await expect(app.page.getByText(/No hay .*coincidan|No .* match/i)).toBeVisible();

      await search.fill("");
      await expect(app.page.locator("tr.data-table-row-clickable").first()).toBeVisible();
      await app.page.locator("tr.data-table-row-clickable").first().click();
      await expect(app.page.locator(".catalog-side-rail .detail-rail-card")).toBeVisible();

      await app.page.getByRole("button", { name: /^Clientes/i }).click();
      await app.page.locator(".catalog-toolbar-button-primary").click();
      await expect(app.page.locator(".catalog-side-rail .detail-rail-card")).toBeVisible();
      await expect(app.page.getByText("RNC", { exact: true })).toBeVisible();

      await app.page.getByRole("button", { name: /^Productoras/i }).click();
      await app.page.locator(".catalog-toolbar-button-primary").click();
      await expect(app.page.getByText("PUR", { exact: true })).toBeVisible();
    } finally {
      await app.cleanup();
    }
  });
});
