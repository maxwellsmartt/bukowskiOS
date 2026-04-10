import { matchPath } from "react-router-dom";

import { readStringPreference, uiPreferenceKeys } from "@shared/lib/preferences";

export type ScopeMode = "global" | "project";
export type GlobalDomainKey = "overview" | "assets" | "finance" | "utility";
export type ProjectRouteSection = "overview" | "assets" | "packing" | "incidents" | "budget" | "info";
export type DomainKey = GlobalDomainKey | "project";
export type PrimaryNavKey = "overview" | "assets" | "finance";

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
  { path: "/overview", label: "Overview", scopeMode: "global", domain: "overview" },
  { path: "/assets", label: "Assets", scopeMode: "global", domain: "assets" },
  { path: "/assets/:assetId", label: "Asset Detail", scopeMode: "global", domain: "assets" },
  { path: "/packing-slips", label: "Packing Slips", scopeMode: "global", domain: "assets" },
  { path: "/incidents", label: "Incidents", scopeMode: "global", domain: "assets" },
  { path: "/projects", label: "Projects", scopeMode: "global", domain: "assets" },
  { path: "/catalog", label: "Catalog", scopeMode: "global", domain: "assets" },
  { path: "/finance", label: "Finance Overview", scopeMode: "global", domain: "finance" },
  { path: "/finance/cost-links", label: "Cost Links", scopeMode: "global", domain: "finance" },
  { path: "/finance/entries", label: "Entries", scopeMode: "global", domain: "finance" },
  { path: "/settings", label: "Settings", scopeMode: "global", domain: "utility" },
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
    label: "Project Info",
    scopeMode: "project",
    domain: "project",
    projectSection: "info",
  },
];

export const appRouteMeta: AppRouteMeta[] = [...globalRouteMeta, ...projectRouteMeta];
export const projectRouteSections: ProjectRouteSection[] = ["overview", "assets", "packing", "incidents", "budget", "info"];

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
  const rememberedPath = readStringPreference(uiPreferenceKeys.lastGlobalRoutePath, "/overview");

  if (!rememberedPath) {
    return "/overview";
  }

  return isGlobalRoutePath(rememberedPath) ? rememberedPath : "/overview";
};

export const resolveInitialPath = () => {
  const rememberedPath =
    readStringPreference(uiPreferenceKeys.lastRoutePath) ??
    readStringPreference(uiPreferenceKeys.lastProjectRoutePath) ??
    resolveRememberedGlobalPath();

  if (!rememberedPath) {
    return "/overview";
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

  if (activeRoute.domain === "overview") {
    return "overview";
  }

  if (activeRoute.domain === "assets") {
    return "assets";
  }

  if (activeRoute.domain === "finance") {
    return "finance";
  }

  return null;
};
