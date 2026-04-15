import { describe, expect, it } from "vitest";

import { agentsSubnav, assetsSubnav, financeSubnav, primaryNav, projectsSubnav } from "@app/shell/navigation";
import { resolveActiveRoute } from "@app/routing/route-meta";
import { appRoutes } from "@app/routing/routes";
import { isSubnavItemActive } from "@app/shell/SubnavTabs";

describe("foundation navigation shell", () => {
  it("keeps the approved primary domains visible", () => {
    expect(primaryNav.map((item) => item.label)).toEqual(["Projects", "Assets", "Finance", "Automation"]);
  });

  it("keeps finance shell structurally real", () => {
    expect(financeSubnav.map((item) => item.label)).toEqual(["Overview", "Entries", "Review Queue"]);
    expect(appRoutes.some((route) => route.path === "/finance/entries")).toBe(true);
  });

  it("adds an agents control plane without breaking the rest of the shell", () => {
    expect(agentsSubnav.map((item) => item.label)).toEqual(["Overview", "Team", "Activity", "AI Models", "Channels"]);
    expect(resolveActiveRoute("/agents/mission-control").domain).toBe("agents");
  });

  it("keeps agents sub-navigation addressable route by route", () => {
    expect(isSubnavItemActive("/agents/mission-control", "/agents/mission-control")).toBe(true);
    expect(isSubnavItemActive("/agents", "/agents")).toBe(true);
    expect(isSubnavItemActive("/agents/runs", "/agents")).toBe(false);
    expect(isSubnavItemActive("/agents/models", "/agents/models")).toBe(true);
    expect(isSubnavItemActive("/agents/connectors", "/agents/connectors")).toBe(true);
    expect(resolveActiveRoute("/agents").label).toBe("Automation Team");
  });

  it("preserves the full asset operations sub-navigation", () => {
    expect(assetsSubnav.map((item) => item.label)).toEqual(["Assets", "Packing Slips", "Incidents"]);
  });

  it("adds the global project schedule to projects navigation", () => {
    expect(projectsSubnav.map((item) => item.label)).toEqual(["Schedule Overview", "Projects"]);
    expect(resolveActiveRoute("/projects/schedule").domain).toBe("projects");
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

  it("registers global operations routes", () => {
    expect(appRoutes.some((route) => route.path === "/assets")).toBe(true);
    expect(appRoutes.some((route) => route.path === "/projects/schedule")).toBe(true);
    expect(appRoutes.some((route) => route.path === "/rma")).toBe(true);
    expect(appRoutes.some((route) => route.path === "/compare")).toBe(true);
    expect(appRoutes.some((route) => route.path === "/agents/mission-control")).toBe(true);
    expect(appRoutes.some((route) => route.path === "/agents/connectors")).toBe(true);
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
