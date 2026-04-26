import type { MissionControlSnapshot } from "@contracts";
import { useNavigate } from "react-router-dom";

import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useAssetsOverview } from "@features/assets/useAssetsData";
import { useFinanceOverview } from "@features/finance/useFinanceData";
import { useIncidentsData } from "@features/incidents/useIncidentsData";
import { useProjectsRegistry } from "@features/projects/useProjectsData";
import { useRmaSnapshot } from "@features/rma/useRmaData";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { getAgentRunStatusLabel, titleCaseEnum } from "@shared/labels/statusLabels";

import { useAgentConnectors } from "./useAgentsData";

type AgentDomainInsightPanelProps = {
  domain: string;
  missionControl: MissionControlSnapshot;
};

type ShortcutItem = {
  label: string;
  path: string;
};

type FocusItem = {
  title: string;
  detail: string;
};

const InsightsList = ({ items }: { items: string[] }) => (
  <div className="agent-domain-insights">
    {items.map((item) => (
      <div key={item} className="agent-domain-insight-row">
        <span>{item}</span>
      </div>
    ))}
  </div>
);

const FocusList = ({ items }: { items: FocusItem[] }) => (
  <div className="agent-domain-focus-list">
    {items.map((item) => (
      <div key={`${item.title}-${item.detail}`} className="agent-domain-focus-item">
        <strong className="agent-domain-focus-title">{item.title}</strong>
        <span className="agent-domain-focus-detail">{item.detail}</span>
      </div>
    ))}
  </div>
);

export const AgentDomainInsightPanel = ({ domain, missionControl }: AgentDomainInsightPanelProps) => {
  const navigate = useNavigate();
  const { activeWorkspaceId } = useWorkspace();
  const { data: assetsOverview } = useAssetsOverview({ workspaceId: activeWorkspaceId });
  const { data: financeOverview } = useFinanceOverview();
  const { data: incidents } = useIncidentsData({
    workspaceId: activeWorkspaceId,
    scopeProjectId: null,
    search: "",
    sortBy: "reportedAt",
    sortDirection: "desc",
  });
  const { data: projects } = useProjectsRegistry({
    workspaceId: activeWorkspaceId,
    search: "",
    sortBy: "name",
    sortDirection: "asc",
  });
  const { data: rmaSnapshot } = useRmaSnapshot({ workspaceId: activeWorkspaceId });
  const { data: connectors } = useAgentConnectors();

  let title = "";
  let insights: string[] = [];
  let focusItems: FocusItem[] = [];
  let shortcuts: ShortcutItem[] = [];

  if (domain === "control") {
    title = "Overview";
    insights = [
      `${missionControl.health.activeAgents} active agents currently under supervision`,
      `${missionControl.health.recentRuns} recent activity items visible right now`,
      `${missionControl.health.connectorsConfigured} channels already configured for outreach`,
    ];
    focusItems = [
      ...missionControl.queue.slice(0, 2).map((run) => ({
        title: run.title,
        detail: `${run.agentDisplayName} · ${getAgentRunStatusLabel(run.status)} · ${run.updatedAtLabel}`,
      })),
      ...missionControl.activity.slice(0, 1).map((activity) => ({
        title: activity.title,
        detail: `${activity.agentDisplayName} · ${activity.timestampLabel}`,
      })),
    ];
    shortcuts = [
      { label: "Activity", path: "/agents/runs" },
      { label: "AI Models", path: "/agents/models" },
      { label: "Channels", path: "/agents/connectors" },
    ];
  }

  if (domain === "assets") {
    title = "Assets";
    insights = [
      `${assetsOverview.totalAssets} total inventory units currently registered`,
      `${assetsOverview.assignedAssets} units currently reserved or checked out`,
      `${assetsOverview.cards.openPackingSlips.value} open packing slips still in motion`,
      `${assetsOverview.cards.overdueReturns.value} overdue return cases needing review`,
    ];
    focusItems = assetsOverview.recentMovements.slice(0, 3).map((movement) => ({
      title: movement.asset,
      detail: `${movement.from} -> ${movement.to} · ${movement.timestamp}`,
    }));
    shortcuts = [
      { label: "Assets", path: "/assets" },
      { label: "Packing slips", path: "/packing-slips" },
    ];
  }

  if (domain === "incidents") {
    const openIncidents = incidents.filter((incident) => incident.status.toLowerCase() !== "closed").length;
    const readyRmas = rmaSnapshot.cases.filter((row) => row.status === "Ready").length;
    title = "Incidents";
    insights = [
      `${openIncidents} open incident records across the app`,
      `${rmaSnapshot.maintenanceAssets.length} maintenance assets currently eligible for RMA follow-up`,
      `${readyRmas} RMA cases already prepared and waiting on next action`,
    ];
    focusItems = [
      ...incidents
        .filter((incident) => incident.status.toLowerCase() !== "closed")
        .slice(0, 2)
        .map((incident) => ({
          title: incident.title,
          detail: `${incident.asset} · ${incident.status} · ${incident.severity}`,
        })),
      ...rmaSnapshot.cases.slice(0, 1).map((rmaCase) => ({
        title: rmaCase.title,
        detail: `${rmaCase.manufacturerName} · ${rmaCase.status} · ${rmaCase.updatedAtLabel}`,
      })),
    ];
    shortcuts = [
      { label: "Incidents", path: "/incidents" },
      { label: "Assets", path: "/assets" },
    ];
  }

  if (domain === "finance") {
    title = "Finance";
    insights = [
      `${financeOverview.totals.trackedSpend} tracked spend in ${financeOverview.activePeriodLabel.toLowerCase()}`,
      `${financeOverview.exposureByProject.length} projects currently represented in exposure tracking`,
      `${financeOverview.costLinks.length} cost-link items still waiting on follow-through`,
    ];
    focusItems = [
      ...financeOverview.exposureByProject.slice(0, 2).map((project) => ({
        title: project.project,
        detail: `${project.exposure} exposure · ${project.incidentCount} incidents`,
      })),
      ...financeOverview.costLinks.slice(0, 1).map((link) => ({
        title: link.incident,
        detail: `${link.project} · ${link.costEstimate} · ${link.financialStatus}`,
      })),
    ];
    shortcuts = [
      { label: "Finance overview", path: "/finance" },
      { label: "Cost links", path: "/finance/cost-links" },
      { label: "Entries", path: "/finance/entries" },
    ];
  }

  if (domain === "projects") {
    const activeProjects = projects.filter((project) => project.status === "Active").length;
    const liveUnits = projects.reduce((sum, project) => sum + project.activeUnitCount, 0);
    title = "Projects";
    insights = [
      `${projects.length} projects visible right now`,
      `${activeProjects} projects currently active`,
      `${liveUnits} active units across the current project surface`,
    ];
    focusItems = projects.slice(0, 3).map((project) => ({
      title: project.name,
      detail: `${project.status} · ${project.activeUnitCount} units · ${project.incidentCount} incidents`,
    }));
    shortcuts = [
      { label: "Projects", path: "/projects" },
      { label: "Schedule Overview", path: "/projects/schedule" },
    ];
  }

  if (domain === "communications") {
    const configured = connectors.filter((connector) => connector.status === "configured").length;
    const disabled = connectors.filter((connector) => connector.status === "disabled").length;
    title = "Channels";
    insights = [
      `${configured} channels already configured`,
      `${disabled} channels intentionally disabled`,
      `${connectors.length} channels visible in this setup`,
    ];
    focusItems = connectors.slice(0, 3).map((connector) => ({
      title: connector.label,
      detail: `${titleCaseEnum(connector.status)} · ${connector.capability}`,
    }));
    shortcuts = [
      { label: "Channels", path: "/agents/connectors" },
      { label: "Overview", path: "/agents/mission-control" },
    ];
  }

  if (!title) {
    return null;
  }

  return (
    <SurfaceCard title={title}>
      <InsightsList items={insights} />

      {shortcuts.length ? (
        <div className="agent-domain-shortcuts">
          {shortcuts.map((shortcut) => (
            <button
              key={shortcut.path}
              className="ghost-control agent-domain-shortcut"
              onClick={() => navigate(shortcut.path)}
              type="button"
            >
              <span>{shortcut.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {focusItems.length ? (
        <div className="agent-domain-focus">
          <span className="agent-detail-kicker">Current focus</span>
          <FocusList items={focusItems} />
        </div>
      ) : null}
    </SurfaceCard>
  );
};
