import { NavLink, useLocation } from "react-router-dom";

import { resolveActiveRoute, resolvePrimaryNavKey } from "@app/routing/route-meta";
import brandLogoWhite1x from "@shared/assets/inbox/logos/bukowskiOS_logo_white.png";
import brandLogoWhite from "@shared/assets/logos/bukowskiOS_logo_white@2x.png";

import { ShellProjectsPanel } from "./ShellProjectsPanel";
import { primaryNav, utilityNav } from "./navigation";

export const ShellSidebar = () => {
  const location = useLocation();
  const primaryNavKey = resolvePrimaryNavKey(location.pathname);
  const activeRoute = resolveActiveRoute(location.pathname);

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
            const Icon = item.icon;
            const navKey = item.path.startsWith("/projects")
              ? "projects"
              : item.path.startsWith("/finance")
                ? "finance"
                : item.path.startsWith("/agents")
                  ? "agents"
                  : "assets";
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
          <span className="shell-nav-label">Setup</span>
          {utilityNav.map((item) => {
            const Icon = item.icon;
            const isActive = activeRoute.scopeMode === "global" && location.pathname === item.path;

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
