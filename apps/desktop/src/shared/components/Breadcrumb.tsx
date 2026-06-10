import { ChevronLeft, ChevronRight, Folder } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { matchPath, useLocation, useNavigate } from "react-router-dom";

import { resolveActiveRoute, type DomainKey } from "@app/routing/route-meta";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useShellContext } from "@shared/hooks/useShellContext";

type Crumb = {
  label: string;
  to?: string;
};

const projectSectionLabelKeys: Record<string, string> = {
  overview: "shell.nav.project.overview",
  info: "shell.nav.project.info",
  assets: "shell.nav.project.assets",
  packing: "shell.nav.project.packing",
  incidents: "shell.nav.project.incidents",
  budget: "shell.nav.project.budget",
};

// Source of truth for the root-of-domain crumb. Mirrors the primary nav labels
// so the breadcrumb never lies about where you actually are in the app.
const domainRoots: Record<string, { labelKey: string; path: string }> = {
  assets: { labelKey: "shell.nav.primary.assets", path: "/assets" },
  projects: { labelKey: "shell.nav.primary.projects", path: "/projects" },
  finance: { labelKey: "shell.nav.primary.finance", path: "/finance" },
  agents: { labelKey: "shell.nav.primary.automation", path: "/agents/mission-control" },
};

// Per-leaf labels. Keep them aligned with the actual subnav copy.
const leafLabelKeys: Record<string, string> = {
  "/assets": "shell.nav.assets.assets",
  "/packing-slips": "shell.nav.assets.packingSlips",
  "/incidents": "shell.nav.assets.incidents",
  "/inbox": "shell.nav.primary.inbox",
  "/rma": "rma.title",
  "/projects": "shell.nav.projects.projects",
  "/projects/schedule": "projects.schedule.title",
  "/finance": "shell.nav.finance.overview",
  "/finance/treasury": "shell.nav.finance.treasury",
  "/finance/cost-links": "shell.nav.finance.reviewQueue",
  "/finance/entries": "shell.nav.finance.entries",
  "/finance/quotes": "shell.nav.finance.quotes",
  "/finance/quotes/new": "finance.quotes.newQuote",
  "/agents/mission-control": "shell.nav.agents.overview",
  "/agents": "shell.nav.agents.team",
  "/agents/runs": "shell.nav.agents.activity",
  "/agents/models": "shell.nav.agents.models",
  "/agents/connectors": "shell.nav.agents.channels",
  "/catalog": "shell.nav.utility.catalog",
  "/compare": "shell.compareTray.title",
  "/settings": "shell.nav.utility.settings",
  "/settings/workspace": "settings.workspace.title",
  "/settings/sync": "settings.sync.title",
};

const utilityLeafParents: Record<string, string> = {
  "/settings/workspace": "/settings",
  "/settings/sync": "/settings",
};

const resolveDomainRoot = (domain: DomainKey, pathname: string): { labelKey: string; path: string } | null => {
  const direct = domainRoots[domain];
  if (direct) return direct;
  // utility domain (settings/catalog/compare) has no domain root crumb above the leaf
  if (domain === "utility") {
    if (pathname.startsWith("/settings")) return { labelKey: "shell.nav.utility.settings", path: "/settings" };
  }
  return null;
};

export const Breadcrumb = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { activeWorkspaceName } = useWorkspace();
  const { activeProject } = useShellContext();

  const crumbs = useMemo<Crumb[]>(() => {
    const route = resolveActiveRoute(location.pathname);
    const list: Crumb[] = [{ label: activeWorkspaceName || t("common.workspace"), to: "/settings/workspace" }];

    // Project-scoped routes → Workspace › Projects › Project name › Section
    if (route.scopeMode === "project" && activeProject) {
      list.push({ label: t("shell.nav.primary.projects"), to: "/projects" });
      list.push({
        label: activeProject.name,
        to: `/projects/${activeProject.id}/info`,
      });

      if (route.projectSection && projectSectionLabelKeys[route.projectSection]) {
        list.push({ label: t(projectSectionLabelKeys[route.projectSection]) });
      }

      return list;
    }

    // Asset detail → Workspace › Assets › Asset detail
    const assetMatch = matchPath({ path: "/assets/:assetId", end: true }, location.pathname);
    if (assetMatch?.params.assetId) {
      list.push({ label: t("shell.nav.primary.assets"), to: "/assets" });
      list.push({ label: t("assets.detail.title") });
      return list;
    }

    // Settings sub-routes → Workspace › Settings › <leaf>
    const utilityParent = utilityLeafParents[location.pathname];
    if (utilityParent && leafLabelKeys[utilityParent] && leafLabelKeys[location.pathname]) {
      list.push({ label: t(leafLabelKeys[utilityParent]), to: utilityParent });
      list.push({ label: t(leafLabelKeys[location.pathname]) });
      return list;
    }

    // Domain-rooted leaves (assets, projects, finance, agents)
    const domainRoot = resolveDomainRoot(route.domain, location.pathname);
    const leafLabelKey = leafLabelKeys[location.pathname];

    if (domainRoot) {
      // If the current path is the domain root itself, just show one crumb (no link).
      if (location.pathname === domainRoot.path) {
        list.push({ label: t(domainRoot.labelKey) });
        return list;
      }

      list.push({ label: t(domainRoot.labelKey), to: domainRoot.path });
      if (leafLabelKey) {
        list.push({ label: t(leafLabelKey) });
      }
      return list;
    }

    // Standalone utility leaves (catalog, compare, settings root)
    if (leafLabelKey) {
      list.push({ label: t(leafLabelKey) });
    }

    return list;
  }, [activeProject, activeWorkspaceName, location.pathname, t]);

  if (crumbs.length <= 1) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="breadcrumb-bar">
      <div className="breadcrumb-history-nav">
        <button
          aria-label={t("shell.breadcrumb.back")}
          className="icon-ghost-control breadcrumb-history-button"
          data-tooltip={t("shell.breadcrumb.back")}
          onClick={() => navigate(-1)}
          type="button"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          aria-label={t("shell.breadcrumb.forward")}
          className="icon-ghost-control breadcrumb-history-button"
          data-tooltip={t("shell.breadcrumb.forward")}
          onClick={() => navigate(1)}
          type="button"
        >
          <ChevronRight size={15} />
        </button>
      </div>
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
