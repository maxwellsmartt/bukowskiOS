import { NavLink } from "react-router-dom";

import { primaryNav, utilityNav } from "./navigation";

export const ShellSidebar = () => (
  <aside className="shell-sidebar">
    <div className="shell-brand">
      <div className="shell-brand-mark">B</div>
      <div>
        <p className="shell-brand-kicker">Metadata Cine</p>
        <h1 className="shell-brand-title">BUKOWSKI</h1>
      </div>
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
