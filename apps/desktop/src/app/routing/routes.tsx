import type { ReactNode } from "react";
import { matchPath, Navigate, Route, Routes } from "react-router-dom";

import { SettingsPage } from "@features/admin/SettingsPage";
import { AssetDetailPage } from "@features/assets/AssetDetailPage";
import { AssetsPage } from "@features/assets/AssetsPage";
import { FinanceCostLinksPage } from "@features/finance/FinanceCostLinksPage";
import { FinanceEntriesPage } from "@features/finance/FinanceEntriesPage";
import { FinanceOverviewPage } from "@features/finance/FinanceOverviewPage";
import { IncidentsPage } from "@features/incidents/IncidentsPage";
import { OverviewPage } from "@features/overview/OverviewPage";
import { PackingPage } from "@features/packing/PackingPage";
import { CatalogPage } from "@features/projects/CatalogPage";
import { ProjectsPage } from "@features/projects/ProjectsPage";
import { readStringPreference, uiPreferenceKeys } from "@shared/lib/preferences";

export type DomainKey = "overview" | "assets" | "finance" | "utility";

export type AppRouteDefinition = {
  path: string;
  label: string;
  domain: DomainKey;
  element: ReactNode;
};

export const appRoutes: AppRouteDefinition[] = [
  { path: "/overview", label: "Overview", domain: "overview", element: <OverviewPage /> },
  { path: "/assets", label: "Assets", domain: "assets", element: <AssetsPage /> },
  { path: "/assets/:assetId", label: "Asset Detail", domain: "assets", element: <AssetDetailPage /> },
  { path: "/packing-slips", label: "Packing Slips", domain: "assets", element: <PackingPage /> },
  { path: "/incidents", label: "Incidents", domain: "assets", element: <IncidentsPage /> },
  { path: "/projects", label: "Projects", domain: "assets", element: <ProjectsPage /> },
  { path: "/catalog", label: "Catalog", domain: "assets", element: <CatalogPage /> },
  { path: "/finance", label: "Finance Overview", domain: "finance", element: <FinanceOverviewPage /> },
  {
    path: "/finance/cost-links",
    label: "Cost Links",
    domain: "finance",
    element: <FinanceCostLinksPage />,
  },
  {
    path: "/finance/entries",
    label: "Entries",
    domain: "finance",
    element: <FinanceEntriesPage />,
  },
  { path: "/settings", label: "Settings", domain: "utility", element: <SettingsPage /> },
];

const resolveInitialPath = () => {
  const rememberedPath = readStringPreference(uiPreferenceKeys.lastRoutePath);

  if (!rememberedPath) {
    return "/overview";
  }

  const isKnownRoute = appRoutes.some((route) => matchPath({ path: route.path, end: true }, rememberedPath));
  return isKnownRoute ? rememberedPath : "/overview";
};

export const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Navigate to={resolveInitialPath()} replace />} />
    {appRoutes.map((route) => (
      <Route key={route.path} path={route.path} element={route.element} />
    ))}
  </Routes>
);
