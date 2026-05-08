import { ChevronRight, Folder } from "lucide-react";
import { useMemo } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";

import { resolveActiveRoute, type DomainKey } from "@app/routing/route-meta";
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

// Source of truth for the root-of-domain crumb. Mirrors the primary nav labels
// so the breadcrumb never lies about where you actually are in the app.
const domainRoots: Record<string, { label: string; path: string }> = {
  assets: { label: "Assets", path: "/assets" },
  projects: { label: "Projects", path: "/projects" },
  finance: { label: "Finance", path: "/finance" },
  agents: { label: "Automation", path: "/agents/mission-control" },
};

// Per-leaf labels. Keep them aligned with the actual subnav copy.
const leafLabels: Record<string, string> = {
  "/assets": "Assets",
  "/packing-slips": "Packing slips",
  "/incidents": "Incidents",
  "/inbox": "Inbox",
  "/rma": "Repair cases",
  "/projects": "Projects",
  "/projects/schedule": "Schedule overview",
  "/finance": "Overview",
  "/finance/cost-links": "Review queue",
  "/finance/entries": "Entries",
  "/finance/quotes": "Quotes",
  "/finance/quotes/new": "New quote",
  "/agents/mission-control": "Overview",
  "/agents": "Team",
  "/agents/runs": "Activity",
  "/agents/models": "AI Models",
  "/agents/connectors": "Channels",
  "/catalog": "Catalog",
  "/compare": "Compare",
  "/settings": "Settings",
  "/settings/account": "Account",
  "/settings/workspace": "Workspace",
  "/settings/sync": "Sync activity",
};

const utilityLeafParents: Record<string, string> = {
  "/settings/account": "/settings",
  "/settings/workspace": "/settings",
  "/settings/sync": "/settings",
};

const resolveDomainRoot = (domain: DomainKey, pathname: string): { label: string; path: string } | null => {
  const direct = domainRoots[domain];
  if (direct) return direct;
  // utility domain (settings/catalog/compare) has no domain root crumb above the leaf
  if (domain === "utility") {
    if (pathname.startsWith("/settings")) return { label: "Settings", path: "/settings" };
  }
  return null;
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

    // Settings sub-routes → Workspace › Settings › <leaf>
    const utilityParent = utilityLeafParents[location.pathname];
    if (utilityParent && leafLabels[utilityParent] && leafLabels[location.pathname]) {
      list.push({ label: leafLabels[utilityParent], to: utilityParent });
      list.push({ label: leafLabels[location.pathname] });
      return list;
    }

    // Domain-rooted leaves (assets, projects, finance, agents)
    const domainRoot = resolveDomainRoot(route.domain, location.pathname);
    const leafLabel = leafLabels[location.pathname];

    if (domainRoot) {
      // If the current path is the domain root itself, just show one crumb (no link).
      if (location.pathname === domainRoot.path) {
        list.push({ label: domainRoot.label });
        return list;
      }

      list.push({ label: domainRoot.label, to: domainRoot.path });
      if (leafLabel) {
        list.push({ label: leafLabel });
      }
      return list;
    }

    // Standalone utility leaves (catalog, compare, settings root)
    if (leafLabel) {
      list.push({ label: leafLabel });
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
