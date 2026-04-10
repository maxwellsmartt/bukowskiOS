import { describe, expect, it } from "vitest";

import { assetsSubnav, financeSubnav, primaryNav } from "@app/shell/navigation";
import { resolveActiveRoute } from "@app/routing/route-meta";
import { appRoutes } from "@app/routing/routes";

describe("foundation navigation shell", () => {
  it("keeps the approved primary domains visible", () => {
    expect(primaryNav.map((item) => item.label)).toEqual(["Overview", "Assets", "Finance"]);
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

  it("treats project workspaces as their own scope mode", () => {
    const resolved = resolveActiveRoute("/projects/project-arch/packing");

    expect(resolved.scopeMode).toBe("project");
    expect(resolved.projectSection).toBe("packing");
    expect(resolved.projectId).toBe("project-arch");
  });

  it("keeps global assets unfiltered by project route memory", () => {
    const resolved = resolveActiveRoute("/assets");

    expect(resolved.scopeMode).toBe("global");
    expect(resolved.domain).toBe("assets");
    expect(resolved.projectId).toBeNull();
  });

  it("registers the full project workspace route map", () => {
    expect(appRoutes.some((route) => route.path === "/projects/:projectId/overview")).toBe(true);
    expect(appRoutes.some((route) => route.path === "/projects/:projectId/assets")).toBe(true);
    expect(appRoutes.some((route) => route.path === "/projects/:projectId/packing")).toBe(true);
    expect(appRoutes.some((route) => route.path === "/projects/:projectId/incidents")).toBe(true);
    expect(appRoutes.some((route) => route.path === "/projects/:projectId/budget")).toBe(true);
    expect(appRoutes.some((route) => route.path === "/projects/:projectId/info")).toBe(true);
  });
});
