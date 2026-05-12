import { describe, expect, it } from "vitest";

import { agentsSubnav, assetsSubnav, financeSubnav, primaryNav, projectsSubnav } from "@app/shell/navigation";
import { resolveActiveRoute } from "@app/routing/route-meta";
import { appRoutes } from "@app/routing/routes";
import { isSubnavItemActive } from "@app/shell/SubnavTabs";

describe("foundation navigation shell", () => {
  it("keeps the approved primary domains visible", () => {
    // Labels are i18n keys; the human strings live in src/i18n/locales/*.json.
    expect(primaryNav.map((item) => item.label)).toEqual([
      "shell.nav.primary.projects",
      "shell.nav.primary.assets",
      "shell.nav.primary.finance",
      "shell.nav.primary.inbox",
      "shell.nav.primary.automation",
    ]);
  });

  it("keeps finance shell structurally real", () => {
    expect(financeSubnav.map((item) => item.label)).toEqual([
      "shell.nav.finance.overview",
      "shell.nav.finance.quotes",
      "shell.nav.finance.entries",
      "shell.nav.finance.reviewQueue",
    ]);
    expect(appRoutes.some((route) => route.path === "/finance/entries")).toBe(true);
  });

  it("adds an agents control plane without breaking the rest of the shell", () => {
    expect(agentsSubnav.map((item) => item.label)).toEqual([
      "shell.nav.agents.overview",
      "shell.nav.agents.team",
      "shell.nav.agents.activity",
      "shell.nav.agents.models",
      "shell.nav.agents.channels",
    ]);
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
    expect(assetsSubnav.map((item) => item.label)).toEqual([
      "shell.nav.assets.assets",
      "shell.nav.assets.licenses",
      "shell.nav.assets.packingSlips",
      "shell.nav.assets.incidents",
    ]);
    expect(isSubnavItemActive("/assets/licenses", "/assets/licenses")).toBe(true);
    expect(isSubnavItemActive("/assets/licenses", "/assets")).toBe(false);
  });

  it("adds the global project schedule to projects navigation", () => {
    expect(projectsSubnav.map((item) => item.label)).toEqual([
      "shell.nav.projects.schedule",
      "shell.nav.projects.projects",
    ]);
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
    expect(appRoutes.some((route) => route.path === "/assets/licenses")).toBe(true);
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
