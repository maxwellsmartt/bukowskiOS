import { matchPath } from "react-router-dom";

import { readStringPreference, uiPreferenceKeys } from "@shared/lib/preferences";

export type ScopeMode = "global" | "project";
export type GlobalDomainKey = "projects" | "assets" | "finance" | "agents" | "utility";
export type ProjectRouteSection = "overview" | "assets" | "packing" | "incidents" | "budget" | "info";
export type DomainKey = GlobalDomainKey | "project";
export type PrimaryNavKey = "projects" | "assets" | "finance" | "inbox" | "agents";

export type AppRouteMeta = {
  path: string;
  label: string;
  scopeMode: ScopeMode;
  domain: DomainKey;
  projectSection?: ProjectRouteSection;
};

export type ResolvedRouteMeta = AppRouteMeta & {
  projectId: string | null;
};

export const globalRouteMeta: AppRouteMeta[] = [
  { path: "/assets", label: "Assets", scopeMode: "global", domain: "assets" },
  { path: "/assets/licenses", label: "Licenses", scopeMode: "global", domain: "assets" },
  { path: "/assets/:assetId", label: "Asset Detail", scopeMode: "global", domain: "assets" },
  { path: "/packing-slips", label: "Packing Slips", scopeMode: "global", domain: "assets" },
  { path: "/incidents", label: "Incidents", scopeMode: "global", domain: "assets" },
  { path: "/inbox", label: "Inbox", scopeMode: "global", domain: "utility" },
  { path: "/projects", label: "Projects", scopeMode: "global", domain: "projects" },
  { path: "/projects/schedule", label: "Schedule Overview", scopeMode: "global", domain: "projects" },
  { path: "/rma", label: "RMA", scopeMode: "global", domain: "assets" },
  { path: "/catalog", label: "Catalog", scopeMode: "global", domain: "utility" },
  { path: "/compare", label: "Compare", scopeMode: "global", domain: "utility" },
  { path: "/finance", label: "Finance Overview", scopeMode: "global", domain: "finance" },
  { path: "/finance/cost-links", label: "Review Queue", scopeMode: "global", domain: "finance" },
  { path: "/finance/entries", label: "Entries", scopeMode: "global", domain: "finance" },
  { path: "/finance/quotes", label: "Quotes", scopeMode: "global", domain: "finance" },
  { path: "/finance/quotes/new", label: "New quote", scopeMode: "global", domain: "finance" },
  { path: "/finance/quotes/:quoteId", label: "Quote detail", scopeMode: "global", domain: "finance" },
  { path: "/agents/mission-control", label: "Automation Overview", scopeMode: "global", domain: "agents" },
  { path: "/agents", label: "Automation Team", scopeMode: "global", domain: "agents" },
  { path: "/agents/runs", label: "Automation Activity", scopeMode: "global", domain: "agents" },
  { path: "/agents/models", label: "AI Models", scopeMode: "global", domain: "agents" },
  { path: "/agents/connectors", label: "Channels", scopeMode: "global", domain: "agents" },
  { path: "/settings", label: "Settings", scopeMode: "global", domain: "utility" },
  { path: "/settings/workspace", label: "Workspace Settings", scopeMode: "global", domain: "utility" },
  { path: "/settings/account", label: "Account", scopeMode: "global", domain: "utility" },
  { path: "/settings/sync", label: "Sync Activity", scopeMode: "global", domain: "utility" },
];

export const projectRouteMeta: AppRouteMeta[] = [
  {
    path: "/projects/:projectId/overview",
    label: "Project Overview",
    scopeMode: "project",
    domain: "project",
    projectSection: "overview",
  },
  {
    path: "/projects/:projectId/assets",
    label: "Project Assets",
    scopeMode: "project",
    domain: "project",
    projectSection: "assets",
  },
  {
    path: "/projects/:projectId/packing",
    label: "Project Packing",
    scopeMode: "project",
    domain: "project",
    projectSection: "packing",
  },
  {
    path: "/projects/:projectId/incidents",
    label: "Project Incidents",
    scopeMode: "project",
    domain: "project",
    projectSection: "incidents",
  },
  {
    path: "/projects/:projectId/budget",
    label: "Project Budget",
    scopeMode: "project",
    domain: "project",
    projectSection: "budget",
  },
  {
    path: "/projects/:projectId/info",
    label: "Project Details",
    scopeMode: "project",
    domain: "project",
    projectSection: "info",
  },
];

export const appRouteMeta: AppRouteMeta[] = [...globalRouteMeta, ...projectRouteMeta];
export const projectRouteSections: ProjectRouteSection[] = ["overview", "assets", "packing", "incidents", "budget", "info"];

const normalizeLegacyGlobalPath = (pathname: string | null) => {
  if (!pathname || pathname === "/overview" || pathname === "/assets/overview") {
    return "/assets";
  }

  return pathname;
};

const toResolvedRoute = (route: AppRouteMeta, projectId: string | null = null): ResolvedRouteMeta => ({
  ...route,
  projectId,
});

const findMatchingRoute = (pathname: string) => {
  for (const route of appRouteMeta) {
    const match = matchPath({ path: route.path, end: true }, pathname);

    if (match) {
      return toResolvedRoute(route, typeof match.params.projectId === "string" ? match.params.projectId : null);
    }
  }

  return null;
};

const isGlobalRoutePath = (pathname: string) =>
  globalRouteMeta.some((route) => matchPath({ path: route.path, end: true }, pathname));

export const resolveRememberedGlobalPath = () => {
  const rememberedPath = normalizeLegacyGlobalPath(
    readStringPreference(uiPreferenceKeys.lastGlobalRoutePath, "/assets"),
  );

  if (!rememberedPath) {
    return "/assets";
  }

  return isGlobalRoutePath(rememberedPath) ? rememberedPath : "/assets";
};

export const resolveInitialPath = () => {
  const rememberedPath =
    normalizeLegacyGlobalPath(readStringPreference(uiPreferenceKeys.lastRoutePath)) ??
    readStringPreference(uiPreferenceKeys.lastProjectRoutePath) ??
    resolveRememberedGlobalPath();

  if (!rememberedPath) {
    return "/assets";
  }

  return findMatchingRoute(rememberedPath) ? rememberedPath : resolveRememberedGlobalPath();
};

export const resolveActiveRoute = (pathname: string) =>
  findMatchingRoute(pathname) ?? toResolvedRoute(globalRouteMeta[0], null);

export const resolvePrimaryNavKey = (pathname: string): PrimaryNavKey | null => {
  const activeRoute = resolveActiveRoute(pathname);

  if (activeRoute.scopeMode !== "global") {
    return null;
  }

  if (activeRoute.domain === "projects") {
    return "projects";
  }

  if (activeRoute.domain === "assets") {
    return "assets";
  }

  if (activeRoute.domain === "finance") {
    return "finance";
  }

  if (activeRoute.path === "/inbox") {
    return "inbox";
  }

  if (activeRoute.domain === "agents") {
    return "agents";
  }

  return null;
};
