import { matchPath, NavLink, useLocation } from "react-router-dom";

import type { NavItem } from "./navigation";

type SubnavTabsProps = {
  items: NavItem[];
};

export const isSubnavItemActive = (pathname: string, path: string) => {
  if (path === "/assets") {
    return pathname === "/assets" || (pathname !== "/assets/licenses" && Boolean(matchPath({ path: "/assets/:assetId", end: true }, pathname)));
  }
  if (path === "/finance/quotes") {
    // Keep "Quotes" highlighted on /new and /:quoteId detail too.
    return (
      pathname === "/finance/quotes" ||
      pathname === "/finance/quotes/new" ||
      Boolean(matchPath({ path: "/finance/quotes/:quoteId", end: true }, pathname))
    );
  }

  return Boolean(matchPath({ path, end: true }, pathname));
};

export const SubnavTabs = ({ items }: SubnavTabsProps) => {
  const location = useLocation();
  const activePath = items.find((item) => isSubnavItemActive(location.pathname, item.path))?.path ?? null;

  return (
    <div className="subnav-tabs">
      {items.map((item) => {
        const isActive = activePath === item.path;

        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={() =>
              `subnav-tab${isActive ? " active" : ""}${item.tone === "accent" ? " subnav-tab-accent" : ""}${item.path === "/catalog" ? " subnav-tab-catalog" : ""}`
            }
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
