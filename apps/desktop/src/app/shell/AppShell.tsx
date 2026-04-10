import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation } from "react-router-dom";

import { resolveActiveRoute } from "@app/routing/route-meta";
import { AppRoutes } from "@app/routing/routes";
import { useShellContext } from "@shared/hooks/useShellContext";
import { readNumberPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

import { assetsSubnav, buildProjectSubnav, financeSubnav } from "./navigation";
import { ShellErrorBoundary } from "./ShellErrorBoundary";
import { ShellSidebar } from "./ShellSidebar";
import { SubnavTabs } from "./SubnavTabs";
import { TopContextBar } from "./TopContextBar";

const sidebarWidthMin = 220;
const sidebarWidthMax = 420;
const sidebarWidthDefault = 248;

const clampSidebarWidth = (width: number) => Math.min(sidebarWidthMax, Math.max(sidebarWidthMin, width));

export const AppShell = () => {
  const location = useLocation();
  const { activeProjectId, activeProjectRouteSection, isScopeReady } = useShellContext();
  const activeRoute = resolveActiveRoute(location.pathname);
  const [sidebarWidth, setSidebarWidth] = useState(sidebarWidthDefault);

  const subnavItems = useMemo(() => {
    if (activeRoute.scopeMode === "project" && activeProjectId) {
      return buildProjectSubnav(activeProjectId);
    }

    if (activeRoute.domain === "finance") {
      return financeSubnav;
    }

    if (activeRoute.domain === "assets") {
      return assetsSubnav;
    }

    return [];
  }, [activeProjectId, activeRoute.domain, activeRoute.scopeMode]);

  useEffect(() => {
    setSidebarWidth(clampSidebarWidth(readNumberPreference(uiPreferenceKeys.shellSidebarWidth, sidebarWidthDefault)));
  }, []);

  useEffect(() => {
    writePreference(uiPreferenceKeys.shellSidebarWidth, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (location.pathname !== "/") {
      writePreference(uiPreferenceKeys.lastRoutePath, location.pathname);

      if (activeRoute.scopeMode === "project") {
        writePreference(uiPreferenceKeys.lastProjectRoutePath, location.pathname);
        writePreference(uiPreferenceKeys.lastProjectRouteSection, activeProjectRouteSection ?? "overview");
      } else {
        writePreference(uiPreferenceKeys.lastGlobalRoutePath, location.pathname);
      }
    }
  }, [activeProjectRouteSection, activeRoute.scopeMode, location.pathname]);

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
    document.body.classList.add("is-resizing-sidebar");

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = clampSidebarWidth(initialWidth + moveEvent.clientX - startX);
      setSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      document.body.classList.remove("is-resizing-sidebar");
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
      <ShellSidebar />
      <div
        aria-label="Resize sidebar"
        className="shell-sidebar-resize-handle"
        onMouseDown={handleSidebarResizeStart}
        role="separator"
      />

      <div className="shell-main">
        <TopContextBar />
        {subnavItems.length ? <SubnavTabs items={subnavItems} /> : null}
        <main className={`shell-content${activeRoute.scopeMode === "project" ? " shell-content-project" : ""}`}>
          {!isScopeReady ? (
            <div className="shell-loading-state">
              <div className="empty-state">
                Validating project workspace before restoring the last route.
              </div>
            </div>
          ) : (
            <ShellErrorBoundary>
              <AppRoutes />
            </ShellErrorBoundary>
          )}
        </main>
      </div>
    </div>
  );
};
