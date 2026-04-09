import { useMemo } from "react";
import { matchPath, useLocation } from "react-router-dom";

import { AppRoutes, appRoutes } from "@app/routing/routes";

import { assetsSubnav, financeSubnav } from "./navigation";
import { ShellSidebar } from "./ShellSidebar";
import { SubnavTabs } from "./SubnavTabs";
import { TopContextBar } from "./TopContextBar";

const resolveActiveRoute = (pathname: string) =>
  appRoutes.find((route) => matchPath({ path: route.path, end: true }, pathname)) ?? appRoutes[0];

export const AppShell = () => {
  const location = useLocation();
  const activeRoute = resolveActiveRoute(location.pathname);

  const subnavItems = useMemo(() => {
    if (activeRoute.domain === "finance") {
      return financeSubnav;
    }

    if (activeRoute.domain === "assets") {
      return assetsSubnav;
    }

    return [];
  }, [activeRoute.domain]);

  return (
    <div className="app-shell">
      <ShellSidebar />

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
