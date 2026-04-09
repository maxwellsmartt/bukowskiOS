import { NavLink } from "react-router-dom";

import { ShellProjectsPanel } from "./ShellProjectsPanel";
import { primaryNav, utilityNav } from "./navigation";

export const ShellSidebar = () => (
  <aside className="shell-sidebar">
    <div className="shell-brand">
      <img className="shell-brand-lockup" src="/brand/bukowskiOS_logo_white@2x.png" alt="bukowskiOS" />
    </div>

    <nav className="shell-nav">
      <span className="shell-nav-label">Primary</span>
      {primaryNav.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `shell-nav-link${isActive ? " active" : ""}`}
          >
            {Icon ? <Icon size={16} /> : null}
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>

    <ShellProjectsPanel />

    <nav className="shell-nav shell-nav-utility">
      <span className="shell-nav-label">Utility</span>
      {utilityNav.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `shell-nav-link${isActive ? " active" : ""}`}
          >
            {Icon ? <Icon size={16} /> : null}
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  </aside>
);
