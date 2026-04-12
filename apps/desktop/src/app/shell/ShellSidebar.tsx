import { NavLink, useLocation } from "react-router-dom";

import { resolveActiveRoute, resolvePrimaryNavKey } from "@app/routing/route-meta";

import { ShellProjectsPanel } from "./ShellProjectsPanel";
import { primaryNav, utilityNav } from "./navigation";

export const ShellSidebar = () => {
  const location = useLocation();
  const primaryNavKey = resolvePrimaryNavKey(location.pathname);
  const activeRoute = resolveActiveRoute(location.pathname);

  return (
    <aside className="shell-sidebar">
      <div className="shell-brand">
        <img className="shell-brand-lockup" src="/brand/bukowskiOS_logo_white@2x.png" alt="bukowskiOS" />
      </div>

      <div className="shell-sidebar-scroll-zone">
        <nav className="shell-nav">
          <span className="shell-nav-label">Global</span>
          {primaryNav.map((item) => {
            const Icon = item.icon;
            const navKey = item.path.startsWith("/finance") ? "finance" : item.path.startsWith("/agents") ? "agents" : "assets";
            const isActive = primaryNavKey === navKey;

            return (
              <NavLink key={item.path} to={item.path} className={() => `shell-nav-link${isActive ? " active" : ""}`}>
                {Icon ? <Icon size={16} /> : null}
                <span>{item.label}</span>
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
            const isActive = activeRoute.domain === "utility" && activeRoute.scopeMode === "global";

            return (
              <NavLink key={item.path} to={item.path} className={() => `shell-nav-link${isActive ? " active" : ""}`}>
                {Icon ? <Icon size={16} /> : null}
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </aside>
  );
};
