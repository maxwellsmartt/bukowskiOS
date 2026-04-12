import { matchPath, NavLink, useLocation } from "react-router-dom";

import type { NavItem } from "./navigation";

type SubnavTabsProps = {
  items: NavItem[];
};

export const isSubnavItemActive = (pathname: string, path: string) => {
  if (path === "/assets/overview") {
    return pathname === "/assets/overview";
  }

  if (path === "/assets") {
    return pathname === "/assets" || Boolean(matchPath({ path: "/assets/:assetId", end: true }, pathname));
  }

  return Boolean(matchPath({ path, end: true }, pathname));
};

export const SubnavTabs = ({ items }: SubnavTabsProps) => {
  const location = useLocation();

  return (
    <div className="subnav-tabs">
      {items.map((item) => {
        const isActive = isSubnavItemActive(location.pathname, item.path);

        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={() => `subnav-tab${isActive ? " active" : ""}`}
            end
            draggable={false}
          >
            {item.label}
          </NavLink>
        );
      })}
    </div>
  );
};
