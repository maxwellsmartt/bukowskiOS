import { lazy, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { GuestOnlyRoute, AuthGuard } from "./AuthGuard";
import { appRouteMeta, resolveInitialPath } from "./route-meta";

const lazyPage = <TModule extends Record<string, ComponentType<object>>, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  key: TKey,
) =>
  lazy(async () => {
    const module = await loader();
    return { default: module[key] };
  });

const SettingsPage = lazyPage(() => import("@features/admin/SettingsPage"), "SettingsPage");
const SyncOutboxPage = lazyPage(() => import("@features/admin/SyncOutboxPage"), "SyncOutboxPage");
const WorkspaceSettingsPage = lazyPage(() => import("@features/admin/WorkspaceSettingsPage"), "WorkspaceSettingsPage");
const AgentConnectorsPage = lazyPage(() => import("@features/agents/AgentConnectorsPage"), "AgentConnectorsPage");
const AgentModelsPage = lazyPage(() => import("@features/agents/AgentModelsPage"), "AgentModelsPage");
const AgentRunsPage = lazyPage(() => import("@features/agents/AgentRunsPage"), "AgentRunsPage");
const AgentsMissionControlPage = lazyPage(
  () => import("@features/agents/AgentsMissionControlPage"),
  "AgentsMissionControlPage",
);
const AgentsPage = lazyPage(() => import("@features/agents/AgentsPage"), "AgentsPage");
const AssetDetailPage = lazyPage(() => import("@features/assets/AssetDetailPage"), "AssetDetailPage");
const AssetsPage = lazyPage(() => import("@features/assets/AssetsPage"), "AssetsPage");
const CompareView = lazyPage(() => import("@features/compare/CompareView"), "CompareView");
const FinanceCostLinksPage = lazyPage(() => import("@features/finance/FinanceCostLinksPage"), "FinanceCostLinksPage");
const FinanceEntriesPage = lazyPage(() => import("@features/finance/FinanceEntriesPage"), "FinanceEntriesPage");
const FinanceOverviewPage = lazyPage(() => import("@features/finance/FinanceOverviewPage"), "FinanceOverviewPage");
const IncidentsPage = lazyPage(() => import("@features/incidents/IncidentsPage"), "IncidentsPage");
const PackingPage = lazyPage(() => import("@features/packing/PackingPage"), "PackingPage");
const CatalogPage = lazyPage(() => import("@features/projects/CatalogPage"), "CatalogPage");
const ProjectAssetsPage = lazyPage(() => import("@features/projects/ProjectAssetsPage"), "ProjectAssetsPage");
const ProjectBudgetPage = lazyPage(() => import("@features/projects/ProjectBudgetPage"), "ProjectBudgetPage");
const ProjectIncidentsPage = lazyPage(() => import("@features/projects/ProjectIncidentsPage"), "ProjectIncidentsPage");
const ProjectInfoPage = lazyPage(() => import("@features/projects/ProjectInfoPage"), "ProjectInfoPage");
const ProjectOverviewPage = lazyPage(() => import("@features/projects/ProjectOverviewPage"), "ProjectOverviewPage");
const ProjectPackingPage = lazyPage(() => import("@features/projects/ProjectPackingPage"), "ProjectPackingPage");
const ProjectsPage = lazyPage(() => import("@features/projects/ProjectsPage"), "ProjectsPage");
const ProjectsSchedulePage = lazyPage(() => import("@features/projects/ProjectsSchedulePage"), "ProjectsSchedulePage");
const RmaPage = lazyPage(() => import("@features/rma/RmaPage"), "RmaPage");
const LoginScreen = lazyPage(() => import("@features/auth/LoginScreen"), "LoginScreen");
const PasswordResetScreen = lazyPage(() => import("@features/auth/PasswordResetScreen"), "PasswordResetScreen");
const ResetPasswordScreen = lazyPage(() => import("@features/auth/ResetPasswordScreen"), "ResetPasswordScreen");
const TwoFactorChallengeScreen = lazyPage(() => import("@features/auth/TwoFactorChallengeScreen"), "TwoFactorChallengeScreen");
const WorkspacePickerScreen = lazyPage(() => import("@features/auth/WorkspacePickerScreen"), "WorkspacePickerScreen");
const WorkspaceCreateScreen = lazyPage(() => import("@features/auth/WorkspaceCreateScreen"), "WorkspaceCreateScreen");

const routeElements = {
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
  "/settings/workspace": <WorkspaceSettingsPage />,
  "/settings/sync": <SyncOutboxPage />,
  "/projects/schedule": <ProjectsSchedulePage />,
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
    <Route
      path="/login"
      element={
        <GuestOnlyRoute>
          <LoginScreen />
        </GuestOnlyRoute>
      }
    />
    <Route
      path="/login/recovery"
      element={
        <GuestOnlyRoute>
          <PasswordResetScreen />
        </GuestOnlyRoute>
      }
    />
    <Route path="/login/reset-password" element={<ResetPasswordScreen />} />
    <Route
      path="/login/mfa"
      element={
        <GuestOnlyRoute>
          <TwoFactorChallengeScreen />
        </GuestOnlyRoute>
      }
    />
    <Route
      path="/workspaces/select"
      element={
        <AuthGuard>
          <WorkspacePickerScreen />
        </AuthGuard>
      }
    />
    <Route
      path="/workspaces/create"
      element={
        <AuthGuard>
          <WorkspaceCreateScreen />
        </AuthGuard>
      }
    />
    <Route path="/" element={<AuthGuard><Navigate to={resolveInitialPath()} replace /></AuthGuard>} />
    <Route path="/overview" element={<AuthGuard><Navigate to="/assets" replace /></AuthGuard>} />
    <Route path="/assets/overview" element={<AuthGuard><Navigate to="/assets" replace /></AuthGuard>} />
    {appRoutes.map((route) => (
      <Route key={route.path} path={route.path} element={<AuthGuard>{route.element}</AuthGuard>} />
    ))}
  </Routes>
);
