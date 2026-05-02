import { ChevronRight, Folder } from "lucide-react";
import { useMemo } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";

import { resolveActiveRoute } from "@app/routing/route-meta";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useShellContext } from "@shared/hooks/useShellContext";

type Crumb = {
  label: string;
  to?: string;
};

const projectSectionLabels: Record<string, string> = {
  overview: "Overview",
  info: "Details",
  assets: "Assets",
  packing: "Packing",
  incidents: "Incidents",
  budget: "Budget",
};

const domainHomeByDomain: Record<string, { label: string; to: string }> = {
  assets: { label: "Assets", to: "/assets" },
  projects: { label: "Projects", to: "/projects" },
  finance: { label: "Finance", to: "/finance" },
  agents: { label: "Agents", to: "/agents" },
};

type RouteEntry = {
  label: string;
  parent?: string;
};

const globalRouteEntries: Record<string, RouteEntry> = {
  "/assets": { label: "Assets" },
  "/packing-slips": { label: "Packing slips", parent: "/assets" },
  "/incidents": { label: "Incidents", parent: "/assets" },
  "/rma": { label: "Repair cases", parent: "/assets" },
  "/projects": { label: "Projects" },
  "/projects/schedule": { label: "Schedule", parent: "/projects" },
  "/finance": { label: "Overview" },
  "/finance/cost-links": { label: "Cost links", parent: "/finance" },
  "/finance/entries": { label: "Entries", parent: "/finance" },
  "/agents": { label: "Team" },
  "/agents/mission-control": { label: "Mission control", parent: "/agents" },
  "/agents/runs": { label: "Activity", parent: "/agents" },
  "/agents/models": { label: "Models", parent: "/agents" },
  "/agents/connectors": { label: "Connectors", parent: "/agents" },
  "/catalog": { label: "Catalog" },
  "/compare": { label: "Compare" },
  "/settings": { label: "Settings" },
  "/settings/workspace": { label: "Workspace", parent: "/settings" },
  "/settings/sync": { label: "Sync activity", parent: "/settings" },
};

const buildGlobalChain = (pathname: string): Crumb[] => {
  const chain: Crumb[] = [];
  let cursor: string | undefined = pathname;

  while (cursor) {
    const entry: RouteEntry | undefined = globalRouteEntries[cursor];
    if (!entry) {
      break;
    }
    chain.unshift({ label: entry.label, to: cursor });
    cursor = entry.parent;
  }

  if (chain.length) {
    // Last crumb has no link (it is the current page).
    chain[chain.length - 1] = { label: chain[chain.length - 1].label };
  }

  return chain;
};

export const Breadcrumb = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeWorkspaceName } = useWorkspace();
  const { activeProject } = useShellContext();

  const crumbs = useMemo<Crumb[]>(() => {
    const route = resolveActiveRoute(location.pathname);
    const list: Crumb[] = [{ label: activeWorkspaceName || "Workspace", to: "/settings/workspace" }];

    // Project-scoped routes → Workspace › Projects › Project name › Section
    if (route.scopeMode === "project" && activeProject) {
      list.push({ label: "Projects", to: "/projects" });
      list.push({
        label: activeProject.name,
        to: `/projects/${activeProject.id}/info`,
      });

      if (route.projectSection && projectSectionLabels[route.projectSection]) {
        list.push({ label: projectSectionLabels[route.projectSection] });
      }

      return list;
    }

    // Asset detail → Workspace › Assets › Asset detail
    const assetMatch = matchPath({ path: "/assets/:assetId", end: true }, location.pathname);
    if (assetMatch?.params.assetId) {
      list.push({ label: "Assets", to: "/assets" });
      list.push({ label: "Asset detail" });
      return list;
    }

    // Global routes with explicit chain (covers nested settings/finance/agents/etc)
    const chain = buildGlobalChain(location.pathname);
    if (chain.length) {
      // If there is a domain home that is not already the chain root, prepend it.
      const domainHome = domainHomeByDomain[route.domain];
      if (domainHome && chain[0].to !== domainHome.to && chain[0].label !== domainHome.label) {
        list.push({ label: domainHome.label, to: domainHome.to });
      }
      list.push(...chain);
      return list;
    }

    return list;
  }, [activeProject, activeWorkspaceName, location.pathname]);

  if (crumbs.length <= 1) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="breadcrumb-bar">
      <Folder aria-hidden="true" className="breadcrumb-leading-icon" size={12} />
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="breadcrumb-item">
            {crumb.to && !isLast ? (
              <button className="breadcrumb-link" onClick={() => navigate(crumb.to!)} type="button">
                {crumb.label}
              </button>
            ) : (
              <span className={`breadcrumb-label${isLast ? " is-current" : ""}`}>{crumb.label}</span>
            )}
            {!isLast ? <ChevronRight aria-hidden="true" className="breadcrumb-separator" size={12} /> : null}
          </span>
        );
      })}
    </nav>
  );
};
