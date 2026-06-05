import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { resolveActiveRoute, resolvePrimaryNavKey } from "@app/routing/route-meta";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import brandLogoWhite1x from "@shared/assets/inbox/logos/bukowskiOS_logo_white.png";
import brandLogoWhite from "@shared/assets/logos/bukowskiOS_logo_white@2x.png";
import { hasFinanceAccess } from "@shared/lib/financeAccess";

import { ShellProjectsPanel } from "./ShellProjectsPanel";
import { SidebarUserMenu } from "./SidebarUserMenu";
import { primaryNav, utilityNav } from "./navigation";

export const ShellSidebar = () => {
  const location = useLocation();
  const { t } = useTranslation();
  const { activeMembership } = useWorkspace();
  const primaryNavKey = resolvePrimaryNavKey(location.pathname);
  const activeRoute = resolveActiveRoute(location.pathname);
  const canAccessFinance = hasFinanceAccess(activeMembership);

  return (
    <aside className="shell-sidebar">
      <div className="shell-brand">
        <img
          className="shell-brand-lockup"
          src={brandLogoWhite1x}
          srcSet={`${brandLogoWhite1x} 1x, ${brandLogoWhite} 2x`}
          alt="bukowskiOS"
        />
      </div>

      <div className="shell-sidebar-scroll-zone">
        <nav className="shell-nav">
          {primaryNav.map((item) => {
            if (item.path.startsWith("/finance") && !canAccessFinance) {
              return null;
            }

            const Icon = item.icon;
            const navKey = item.path.startsWith("/projects")
              ? "projects"
              : item.path.startsWith("/finance")
                ? "finance"
                : item.path.startsWith("/inbox")
                  ? "inbox"
                : item.path.startsWith("/agents")
                  ? "agents"
                  : "assets";
            const isActive = primaryNavKey === navKey;

            return (
              <NavLink key={item.path} to={item.path} className={() => `shell-nav-link${isActive ? " active" : ""}`}>
                {Icon ? <Icon size={16} /> : null}
                <span>{t(item.label)}</span>
              </NavLink>
            );
          })}
        </nav>

        <ShellProjectsPanel />
      </div>

      <div className="shell-sidebar-utility-zone">
        <nav className="shell-nav">
          {utilityNav.map((item) => {
            const Icon = item.icon;
            const isExactMatch = location.pathname === item.path;
            const isSubRouteMatch = location.pathname.startsWith(`${item.path}/`);
            const isActive = activeRoute.scopeMode === "global" && (isExactMatch || isSubRouteMatch);

            return (
              <NavLink key={item.path} to={item.path} className={() => `shell-nav-link${isActive ? " active" : ""}`}>
                {Icon ? <Icon size={16} /> : null}
                <span>{t(item.label)}</span>
              </NavLink>
            );
          })}
        </nav>

        <SidebarUserMenu />
      </div>
    </aside>
  );
};
