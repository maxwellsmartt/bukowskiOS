import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { matchPath, useLocation } from "react-router-dom";

import { AppRoutes, appRoutes } from "@app/routing/routes";

import { assetsSubnav, financeSubnav } from "./navigation";
import { ShellSidebar } from "./ShellSidebar";
import { SubnavTabs } from "./SubnavTabs";
import { TopContextBar } from "./TopContextBar";

const resolveActiveRoute = (pathname: string) =>
  appRoutes.find((route) => matchPath({ path: route.path, end: true }, pathname)) ?? appRoutes[0];

const sidebarWidthStorageKey = "bukowski:shell-sidebar-width";
const sidebarWidthMin = 220;
const sidebarWidthMax = 420;
const sidebarWidthDefault = 248;

const clampSidebarWidth = (width: number) => Math.min(sidebarWidthMax, Math.max(sidebarWidthMin, width));

export const AppShell = () => {
  const location = useLocation();
  const activeRoute = resolveActiveRoute(location.pathname);
  const [sidebarWidth, setSidebarWidth] = useState(sidebarWidthDefault);

  const subnavItems = useMemo(() => {
    if (activeRoute.domain === "finance") {
      return financeSubnav;
    }

    if (activeRoute.domain === "assets") {
      return assetsSubnav;
    }

    return [];
  }, [activeRoute.domain]);

  useEffect(() => {
    const storedWidth = window.localStorage.getItem(sidebarWidthStorageKey);

    if (!storedWidth) {
      return;
    }

    const parsedWidth = Number.parseInt(storedWidth, 10);

    if (!Number.isNaN(parsedWidth)) {
      setSidebarWidth(clampSidebarWidth(parsedWidth));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth));
  }, [sidebarWidth]);

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
        <main className="shell-content">
          <AppRoutes />
        </main>
      </div>
    </div>
  );
};
