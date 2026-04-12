import { Navigate, Route, Routes } from "react-router-dom";

import { SettingsPage } from "@features/admin/SettingsPage";
import { AgentConnectorsPage } from "@features/agents/AgentConnectorsPage";
import { AgentModelsPage } from "@features/agents/AgentModelsPage";
import { AgentRunsPage } from "@features/agents/AgentRunsPage";
import { AgentsMissionControlPage } from "@features/agents/AgentsMissionControlPage";
import { AgentsPage } from "@features/agents/AgentsPage";
import { AssetDetailPage } from "@features/assets/AssetDetailPage";
import { AssetsOverviewPage } from "@features/assets/AssetsOverviewPage";
import { AssetsPage } from "@features/assets/AssetsPage";
import { CompareView } from "@features/compare/CompareView";
import { FinanceCostLinksPage } from "@features/finance/FinanceCostLinksPage";
import { FinanceEntriesPage } from "@features/finance/FinanceEntriesPage";
import { FinanceOverviewPage } from "@features/finance/FinanceOverviewPage";
import { IncidentsPage } from "@features/incidents/IncidentsPage";
import { PackingPage } from "@features/packing/PackingPage";
import { CatalogPage } from "@features/projects/CatalogPage";
import { ProjectAssetsPage } from "@features/projects/ProjectAssetsPage";
import { ProjectBudgetPage } from "@features/projects/ProjectBudgetPage";
import { ProjectIncidentsPage } from "@features/projects/ProjectIncidentsPage";
import { ProjectInfoPage } from "@features/projects/ProjectInfoPage";
import { ProjectOverviewPage } from "@features/projects/ProjectOverviewPage";
import { ProjectPackingPage } from "@features/projects/ProjectPackingPage";
import { ProjectsPage } from "@features/projects/ProjectsPage";
import { RmaPage } from "@features/rma/RmaPage";

import { appRouteMeta, resolveInitialPath } from "./route-meta";

const routeElements = {
  "/overview": <Navigate to="/assets/overview" replace />,
  "/assets/overview": <AssetsOverviewPage />,
  "/assets": <AssetsPage />,
  "/assets/:assetId": <AssetDetailPage />,
  "/packing-slips": <PackingPage />,
  "/incidents": <IncidentsPage />,
  "/projects": <ProjectsPage />,
  "/rma": <RmaPage />,
  "/catalog": <CatalogPage />,
  "/compare": <CompareView />,
  "/finance": <FinanceOverviewPage />,
  "/finance/cost-links": <FinanceCostLinksPage />,
  "/finance/entries": <FinanceEntriesPage />,
  "/agents/mission-control": <AgentsMissionControlPage />,
  "/agents": <AgentsPage />,
  "/agents/runs": <AgentRunsPage />,
  "/agents/models": <AgentModelsPage />,
  "/agents/connectors": <AgentConnectorsPage />,
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
    <Route path="/overview" element={<Navigate to="/assets/overview" replace />} />
    {appRoutes.map((route) => (
      <Route key={route.path} path={route.path} element={route.element} />
    ))}
  </Routes>
);
