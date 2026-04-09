import { describe, expect, it } from "vitest";

import { assetsSubnav, financeSubnav, primaryNav } from "@app/shell/navigation";
import { appRoutes } from "@app/routing/routes";

describe("foundation navigation shell", () => {
  it("keeps the approved primary domains visible", () => {
    expect(primaryNav.map((item) => item.label)).toEqual(["Overview", "AssetsOps", "FinanceOps"]);
  });

  it("keeps finance shell structurally real", () => {
    expect(financeSubnav.map((item) => item.label)).toEqual(["Overview", "Cost Links", "Entries"]);
    expect(appRoutes.some((route) => route.path === "/finance/entries")).toBe(true);
  });

  it("preserves the full asset operations sub-navigation", () => {
    expect(assetsSubnav.map((item) => item.label)).toEqual([
      "Assets",
      "Packing Slips",
      "Incidents",
      "Projects",
      "Catalog",
    ]);
  });
});
