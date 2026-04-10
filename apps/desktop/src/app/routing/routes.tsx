import { Navigate, Route, Routes } from "react-router-dom";

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
import { ProjectAssetsPage } from "@features/projects/ProjectAssetsPage";
import { ProjectBudgetPage } from "@features/projects/ProjectBudgetPage";
import { ProjectIncidentsPage } from "@features/projects/ProjectIncidentsPage";
import { ProjectInfoPage } from "@features/projects/ProjectInfoPage";
import { ProjectOverviewPage } from "@features/projects/ProjectOverviewPage";
import { ProjectPackingPage } from "@features/projects/ProjectPackingPage";
import { ProjectsPage } from "@features/projects/ProjectsPage";

import { appRouteMeta, resolveInitialPath } from "./route-meta";

const routeElements = {
  "/overview": <OverviewPage />,
  "/assets": <AssetsPage />,
  "/assets/:assetId": <AssetDetailPage />,
  "/packing-slips": <PackingPage />,
  "/incidents": <IncidentsPage />,
  "/projects": <ProjectsPage />,
  "/catalog": <CatalogPage />,
  "/finance": <FinanceOverviewPage />,
  "/finance/cost-links": <FinanceCostLinksPage />,
  "/finance/entries": <FinanceEntriesPage />,
  "/settings": <SettingsPage />,
  "/projects/:projectId/overview": <ProjectOverviewPage />,
  "/projects/:projectId/assets": <ProjectAssetsPage />,
  "/projects/:projectId/packing": <ProjectPackingPage />,
  "/projects/:projectId/incidents": <ProjectIncidentsPage />,
  "/projects/:projectId/budget": <ProjectBudgetPage />,
  "/projects/:projectId/info": <ProjectInfoPage />,
} as const;

export const appRoutes = appRouteMeta.map((route) => ({
  ...route,
  element: routeElements[route.path as keyof typeof routeElements],
}));

export const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Navigate to={resolveInitialPath()} replace />} />
    {appRoutes.map((route) => (
      <Route key={route.path} path={route.path} element={route.element} />
    ))}
  </Routes>
);
