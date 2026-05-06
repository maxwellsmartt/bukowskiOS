import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";

import { resolveActiveRoute } from "@app/routing/route-meta";
import { AppRoutes } from "@app/routing/routes";
import { useAutoLogout } from "@shared/hooks/useAutoLogout";
import { useAssetSnapshotPull } from "@shared/hooks/useAssetSnapshotPull";
import { useCatalogPull } from "@shared/hooks/useCatalogPull";
import { useOperationalSnapshotPull } from "@shared/hooks/useOperationalSnapshotPull";
import { useShellContext } from "@shared/hooks/useShellContext";
import { notifyWorkspaceDataChanged } from "@shared/hooks/useWorkspaceDataRefresh";
import { useSession } from "@app/providers/SessionProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { Breadcrumb } from "@shared/components/Breadcrumb";
import { readNumberPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";
import { pushRecentEntityKey } from "@shared/lib/recentEntities";

import { OnboardingTour } from "@features/onboarding/OnboardingTour";

import { CompareTrayBar } from "./CompareTrayBar";
import { FloatingTooltipLayer } from "./FloatingTooltipLayer";
import { GlobalAssistantChat } from "./GlobalAssistantChat";
import { GlobalSearchPalette } from "./GlobalSearchPalette";
import { agentsSubnav, assetsSubnav, buildProjectSubnav, financeSubnav, projectsSubnav } from "./navigation";
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
  const { activeWorkspaceId } = useWorkspace();
  useAutoLogout();
  useCatalogPull();
  useAssetSnapshotPull();
  useOperationalSnapshotPull();
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
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampSidebarWidth(readNumberPreference(uiPreferenceKeys.shellSidebarWidth, sidebarWidthDefault)),
  );
  const [searchOpen, setSearchOpen] = useState(false);

  const subnavItems = useMemo(() => {
    if (activeRoute.scopeMode === "project" && activeProjectId) {
      return buildProjectSubnav(activeProjectId);
    }

    if (activeRoute.domain === "finance") {
      return financeSubnav;
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
  }, [activeProjectId, activeRoute.domain, activeRoute.scopeMode]);

  useEffect(() => {
    if (location.pathname !== "/") {
      writePreference(uiPreferenceKeys.lastRoutePath, location.pathname);

      if (activeRoute.scopeMode === "project") {
        writePreference(uiPreferenceKeys.lastProjectRoutePath, location.pathname);
        writePreference(uiPreferenceKeys.lastProjectRouteSection, activeProjectRouteSection ?? "info");
      } else {
        writePreference(uiPreferenceKeys.lastGlobalRoutePath, location.pathname);
      }
    }
  }, [activeProjectRouteSection, activeRoute.scopeMode, location.pathname]);

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

      if (action.type === "auth-deep-link") {
        void handleAuthDeepLink(action.url).then((targetPath) => navigate(targetPath, { replace: true }));
      }
    });
  }, [handleAuthDeepLink, navigate]);

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
            className={`shell-content${activeRoute.scopeMode === "project" ? " shell-content-project" : ""}`}
            transitionKey={location.pathname}
          >
            {!isScopeReady ? (
              <div className="shell-loading-state">
                <div className="empty-state">Opening your last view…</div>
              </div>
            ) : (
              <ShellErrorBoundary>
                <Suspense
                  fallback={
                    <div className="shell-loading-state">
                      <div className="empty-state">Loading…</div>
                    </div>
                  }
                >
                  <AppRoutes />
                </Suspense>
              </ShellErrorBoundary>
            )}
          </RouteTransitionMain>
          <CompareTrayBar />
        </div>
      </div>
      <GlobalSearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
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
