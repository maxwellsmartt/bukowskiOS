import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { matchPath, useLocation, useNavigate } from "react-router-dom";

import { resolveActiveRoute } from "@app/routing/route-meta";
import { AppRoutes } from "@app/routing/routes";
import { useAutoLogout } from "@shared/hooks/useAutoLogout";
import { useAssetSnapshotPull } from "@shared/hooks/useAssetSnapshotPull";
import { useCatalogPull } from "@shared/hooks/useCatalogPull";
import { useCollaboratorPaymentPull } from "@shared/hooks/useCollaboratorPaymentPull";
import { useFinanceBusinessPull } from "@shared/hooks/useFinanceBusinessPull";
import { useOperationalSnapshotPull } from "@shared/hooks/useOperationalSnapshotPull";
import { useRealtimeWorkspaceSync } from "@shared/hooks/useRealtimeWorkspaceSync";
import { useShellContext } from "@shared/hooks/useShellContext";
import { useTreasuryPull } from "@shared/hooks/useTreasuryPull";
import { notifyWorkspaceDataChanged } from "@shared/hooks/useWorkspaceDataRefresh";
import { useSession } from "@app/providers/SessionProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useNotifications } from "@app/providers/NotificationsProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { AppStartupGate } from "@shared/components/AppStartupGate";
import { Breadcrumb } from "@shared/components/Breadcrumb";
import { hasFinanceAccess } from "@shared/lib/financeAccess";
import { readNumberPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";
import { pushRecentEntityKey } from "@shared/lib/recentEntities";

import { OnboardingTour } from "@features/onboarding/OnboardingTour";
import { reviewAgentRun } from "@features/agents/useAgentsData";
import { newCommandId } from "@features/finance/quoteHelpers";

import { CompareTrayBar } from "./CompareTrayBar";
import { FloatingTooltipLayer } from "./FloatingTooltipLayer";
import { GlobalAssistantChat } from "./GlobalAssistantChat";
import { GlobalSearchPalette } from "./GlobalSearchPalette";
import { agentsSubnav, assetsSubnav, buildProjectSubnav, financeSubnav, projectsSubnav } from "./navigation";
import { NotificationsTray } from "./NotificationsTray";
import { ShellErrorBoundary } from "./ShellErrorBoundary";
import { ShellSidebar } from "./ShellSidebar";
import { SubnavTabs } from "./SubnavTabs";
import { TopContextBar } from "./TopContextBar";
import { WindowTitleBar } from "./WindowTitleBar";

const sidebarWidthMin = 220;
const sidebarWidthMax = 420;
const sidebarWidthDefault = 248;

const clampSidebarWidth = (width: number) => Math.min(sidebarWidthMax, Math.max(sidebarWidthMin, width));

export const AppShell = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeProjectId, activeProjectRouteSection, isScopeReady } = useShellContext();
  const { handleAuthDeepLink } = useSession();
  const { t } = useTranslation();
  const toast = useToast();
  const { markReminderDone, snoozeReminder } = useNotifications();
  const { activeMembership, activeWorkspaceId } = useWorkspace();
  useAutoLogout();
  useCatalogPull();
  useAssetSnapshotPull();
  useOperationalSnapshotPull();
  useTreasuryPull();
  useCollaboratorPaymentPull();
  useFinanceBusinessPull();
  useRealtimeWorkspaceSync();
  const [workspaceTransitionActive, setWorkspaceTransitionActive] = useState(false);
  const prevWorkspaceIdRef = useRef(activeWorkspaceId);

  useEffect(() => {
    if (prevWorkspaceIdRef.current && activeWorkspaceId && prevWorkspaceIdRef.current !== activeWorkspaceId) {
      setWorkspaceTransitionActive(true);
      const timer = window.setTimeout(() => setWorkspaceTransitionActive(false), 600);
      prevWorkspaceIdRef.current = activeWorkspaceId;
      return () => window.clearTimeout(timer);
    }
    prevWorkspaceIdRef.current = activeWorkspaceId;
    return undefined;
  }, [activeWorkspaceId]);
  const activeRoute = resolveActiveRoute(location.pathname);
  const canAccessFinance = hasFinanceAccess(activeMembership);
  const isLicensesRoute = location.pathname === "/assets/licenses";
  const isCatalogRoute = location.pathname === "/catalog";
  const isPackingRoute = location.pathname === "/packing-slips";
  const isIncidentsRoute = location.pathname === "/incidents";
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampSidebarWidth(readNumberPreference(uiPreferenceKeys.shellSidebarWidth, sidebarWidthDefault)),
  );
  const [searchOpen, setSearchOpen] = useState(false);

  const subnavItems = useMemo(() => {
    if (activeRoute.scopeMode === "project" && activeProjectId) {
      return buildProjectSubnav(activeProjectId, { includeBudget: canAccessFinance });
    }

    if (activeRoute.domain === "finance") {
      return canAccessFinance ? financeSubnav : [];
    }

    if (activeRoute.domain === "agents") {
      return agentsSubnav;
    }

    if (activeRoute.domain === "assets") {
      return assetsSubnav;
    }

    if (activeRoute.domain === "projects") {
      return projectsSubnav;
    }

    return [];
  }, [activeProjectId, activeRoute.domain, activeRoute.scopeMode, canAccessFinance]);

  useEffect(() => {
    if (location.pathname !== "/") {
      if ((activeRoute.domain === "finance" || activeRoute.projectSection === "budget") && !canAccessFinance) {
        return;
      }

      writePreference(uiPreferenceKeys.lastRoutePath, location.pathname);

      if (activeRoute.scopeMode === "project") {
        writePreference(uiPreferenceKeys.lastProjectRoutePath, location.pathname);
        writePreference(uiPreferenceKeys.lastProjectRouteSection, activeProjectRouteSection ?? "info");
      } else {
        writePreference(uiPreferenceKeys.lastGlobalRoutePath, location.pathname);
      }
    }
  }, [
    activeProjectRouteSection,
    activeRoute.domain,
    activeRoute.projectSection,
    activeRoute.scopeMode,
    canAccessFinance,
    location.pathname,
  ]);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const assetMatch = matchPath({ path: "/assets/:assetId", end: true }, location.pathname);

    if (typeof assetMatch?.params.assetId === "string") {
      pushRecentEntityKey("asset", assetMatch.params.assetId);
      return;
    }

    if (activeRoute.scopeMode === "project" && activeRoute.projectId) {
      pushRecentEntityKey("project", activeRoute.projectId);

      const focusedUnitId = searchParams.get("unit");
      if (focusedUnitId) {
        pushRecentEntityKey("project_unit", focusedUnitId);
      }

      return;
    }

    if (location.pathname === "/packing-slips") {
      const focusedPackingId = searchParams.get("focus");
      if (focusedPackingId) {
        pushRecentEntityKey("packing_slip", focusedPackingId);
      }
      return;
    }

    if (location.pathname === "/incidents") {
      const focusedIncidentId = searchParams.get("focus");
      if (focusedIncidentId) {
        pushRecentEntityKey("incident", focusedIncidentId);
      }
      return;
    }

    if (location.pathname === "/finance/entries") {
      const focusedEntryId = searchParams.get("focus");
      if (focusedEntryId) {
        pushRecentEntityKey("financial_entry", focusedEntryId);
      }
    }
  }, [activeRoute.projectId, activeRoute.scopeMode, location.pathname, location.search]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!window.bukowskiShell?.onAppAction) {
      return undefined;
    }

    return window.bukowskiShell.onAppAction((action) => {
      if (action.type === "open-search") {
        setSearchOpen(true);
        return;
      }

      if (action.type === "navigate") {
        navigate(action.path);
        return;
      }

      if (action.type === "open-onboarding") {
        window.dispatchEvent(new CustomEvent("bukowski:open-onboarding"));
        return;
      }

      if (action.type === "open-assistant-chat") {
        window.dispatchEvent(new CustomEvent("bukowski:open-assistant-chat"));
        return;
      }

      if (action.type === "switch-workspace") {
        navigate("/workspaces/select");
        return;
      }

      if (action.type === "workspace-data-changed") {
        notifyWorkspaceDataChanged({
          source: action.source === "assistant-tool" ? "assistant-tool" : "sync",
          entities: action.entities,
        });
        return;
      }

      if (action.type === "notification-clicked") {
        if (action.linkTo) {
          // Absolute http(s) links (e.g. GitHub release pages) must open in the
          // browser; only in-app router paths should go through navigate().
          if (/^https?:\/\//i.test(action.linkTo)) {
            void window.bukowskiApp?.openExternal(action.linkTo);
          } else {
            navigate(action.linkTo);
          }
        }
        return;
      }

      if (action.type === "reminder-native-action") {
        if (action.action === "mark_done") {
          void markReminderDone(action.reminderId);
        } else if (action.action === "snooze_15m") {
          void snoozeReminder(action.reminderId, 15);
        } else if (action.action === "snooze_1h") {
          void snoozeReminder(action.reminderId, 60);
        }
        return;
      }

      if (action.type === "agent-run-native-action") {
        navigate("/agents/runs");
        void reviewAgentRun({
          commandId: newCommandId("agent-native-approve"),
          workspaceId: action.workspaceId,
          runId: action.runId,
          decision: action.decision,
        })
          .then((result) => {
            toast.success(t("notifications.agentApproval.approvedTitle"), result.summary);
          })
          .catch((error) => {
            toast.error(
              t("notifications.agentApproval.failedTitle"),
              error instanceof Error ? error.message : t("notifications.agentApproval.failedBody"),
            );
          });
        return;
      }

      if (action.type === "auth-deep-link") {
        void handleAuthDeepLink(action.url).then((targetPath) => navigate(targetPath, { replace: true }));
      }
    });
  }, [handleAuthDeepLink, markReminderDone, navigate, snoozeReminder, t, toast]);

  useEffect(
    () => () => {
      document.body.classList.remove("is-resizing-sidebar");
    },
    [],
  );

  const handleSidebarResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startX = event.clientX;
    const initialWidth = sidebarWidth;
    let nextWidth = initialWidth;
    document.body.classList.add("is-resizing-sidebar");

    const handleMouseMove = (moveEvent: MouseEvent) => {
      nextWidth = clampSidebarWidth(initialWidth + moveEvent.clientX - startX);
      setSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      document.body.classList.remove("is-resizing-sidebar");
      writePreference(uiPreferenceKeys.shellSidebarWidth, String(nextWidth));
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp, { once: true });
  };

  const shellStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;
  const isAuthSurface =
    location.pathname.startsWith("/login") ||
    location.pathname.startsWith("/workspaces/select") ||
    location.pathname.startsWith("/workspaces/create");

  if (isAuthSurface) {
    return (
      <div className="app-shell app-shell-auth" style={shellStyle}>
        <WindowTitleBar />
        <main className="auth-shell-main">
          <ShellErrorBoundary>
            <Suspense fallback={<AppStartupGate detail="Preparing authentication..." />}>
              <AppRoutes />
            </Suspense>
          </ShellErrorBoundary>
        </main>
        <FloatingTooltipLayer />
      </div>
    );
  }

  return (
    <div className="app-shell" style={shellStyle}>
      <WindowTitleBar />

      <div className="app-shell-body">
        <ShellSidebar />
        <div
          aria-label="Resize sidebar"
          className="shell-sidebar-resize-handle"
          onMouseDown={handleSidebarResizeStart}
          role="separator"
        />

        <div className="shell-main">
          <TopContextBar onOpenSearch={() => setSearchOpen(true)} />
          <Breadcrumb />
          {subnavItems.length ? <SubnavTabs items={subnavItems} /> : null}
          <RouteTransitionMain
            className={`shell-content${activeRoute.scopeMode === "project" ? " shell-content-project" : ""}${activeRoute.domain === "assets" ? " shell-content-assets" : ""}${isLicensesRoute ? " shell-content-licenses" : ""}${isCatalogRoute ? " shell-content-catalog" : ""}${isPackingRoute ? " shell-content-packing" : ""}${isIncidentsRoute ? " shell-content-incidents" : ""}`}
            transitionKey={location.pathname}
          >
            {!isScopeReady ? (
              <AppStartupGate detail="Opening your last view..." />
            ) : (
              <ShellErrorBoundary>
                <Suspense fallback={<AppStartupGate detail="Preparing this view..." />}>
                  <AppRoutes />
                </Suspense>
              </ShellErrorBoundary>
            )}
          </RouteTransitionMain>
          <CompareTrayBar />
        </div>
      </div>
      <GlobalSearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <NotificationsTray />
      <GlobalAssistantChat />
      <OnboardingTour />
      <FloatingTooltipLayer />
      {workspaceTransitionActive ? (
        <div className="workspace-switch-overlay" role="status" aria-live="polite">
          <div className="auth-blocking-card">
            <span className="auth-blocking-spinner" aria-hidden="true" />
            <strong>Switching workspace…</strong>
          </div>
        </div>
      ) : null}
    </div>
  );
};

type RouteTransitionMainProps = {
  className: string;
  transitionKey: string;
  children: React.ReactNode;
};

const RouteTransitionMain = ({ className, transitionKey, children }: RouteTransitionMainProps) => {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.classList.remove("is-entering");
    void node.offsetWidth;
    node.classList.add("is-entering");
  }, [transitionKey]);

  return (
    <main className={className} ref={ref}>
      {children}
    </main>
  );
};
