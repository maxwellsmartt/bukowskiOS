import { NavLink } from "react-router-dom";

import type { NavItem } from "./navigation";

type SubnavTabsProps = {
  items: NavItem[];
};

export const SubnavTabs = ({ items }: SubnavTabsProps) => (
  <div className="subnav-tabs">
    {items.map((item) => (
      <NavLink
        key={item.path}
        to={item.path}
        className={({ isActive }) => `subnav-tab${isActive ? " active" : ""}`}
      >
        {item.label}
      </NavLink>
    ))}
  </div>
);
