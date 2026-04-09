import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ProjectDetailSnapshot } from "@contracts";
import { DataTable } from "@shared/components/DataTable";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

type ProjectDetailPanelProps = {
  data: ProjectDetailSnapshot;
  error: string | null;
  isLoading: boolean;
};

const toneForStatus = (status: string) => {
  switch (status) {
    case "Active":
      return "info" as const;
    case "Open":
    case "In review":
      return "critical" as const;
    case "Prep":
      return "warning" as const;
    default:
      return undefined;
  }
};

export const ProjectDetailPanel = ({ data, error, isLoading }: ProjectDetailPanelProps) => {
  const navigate = useNavigate();
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedIncidentIds, setSelectedIncidentIds] = useState<string[]>([]);

  if (error) {
    return <div className="empty-state">Project detail unavailable: {error}</div>;
  }

  if (isLoading) {
    return <div className="empty-state">Loading project detail...</div>;
  }

  if (!data.project) {
    return <div className="empty-state">Select a project to inspect assets, incidents, responsibles and budget hooks.</div>;
  }

  return (
    <div className="project-detail-stack">
      <SurfaceCard
        title={`${data.project.code} · ${data.project.name}`}
        subtitle={data.project.description}
        aside={<StatusBadge tone={toneForStatus(data.project.status)}>{data.project.status}</StatusBadge>}
      >
        <div className="chip-row">
          <StatusBadge>{data.project.client}</StatusBadge>
          <StatusBadge>{data.project.departments}</StatusBadge>
          <StatusBadge tone="warning">{data.project.exposure}</StatusBadge>
        </div>
      </SurfaceCard>

      <div className="metric-grid">
        {data.metrics.map((metric) => (
          <SurfaceCard key={metric.label}>
            <span className={`metric-value metric-tone-${metric.tone}`}>{metric.value}</span>
            <p className="metric-label">{metric.label}</p>
          </SurfaceCard>
        ))}
      </div>

      <div className="project-detail-support-grid">
        <SurfaceCard title="Responsibles" subtitle="People currently carrying project inventory or open incidents.">
          {data.responsibles.length ? (
            <div className="queue-list">
              {data.responsibles.map((row) => (
                <div key={row.name} className="queue-item">
                  <div className="identity-cell">
                    <span className="identity-title">{row.name}</span>
                    <span className="identity-meta">
                      {row.assetCount} assets · {row.incidentCount} open incidents
                    </span>
                  </div>
                  <StatusBadge tone={row.incidentCount ? "critical" : "info"}>
                    {row.incidentCount ? "Needs follow-up" : "Stable"}
                  </StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No responsibles linked yet. Assign assets to turn this project operational.</div>
          )}
        </SurfaceCard>

        <SurfaceCard title="Budget shell" subtitle="Initial FinanceOps structure tied to the project.">
          <div className="project-budget-grid">
            <div className="summary-row">
              <span className="summary-label">Total entries</span>
              <span className="summary-value">{data.budget.totalEntries}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Reserve</span>
              <span className="summary-value">{data.budget.reserve}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Exposure</span>
              <span className="summary-value">{data.budget.exposure}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Status</span>
              <span className="summary-value">{data.budget.status}</span>
            </div>
          </div>
          <p className="surface-card-subtitle project-budget-note">{data.budget.note}</p>
        </SurfaceCard>
      </div>

      <SurfaceCard title="Assigned assets" subtitle="Current inventory assigned to this project. Double click an asset to open its full profile.">
        <DataTable
          columns={[
            {
              key: "asset",
              label: "Asset",
              width: 230,
              minWidth: 180,
              render: (row) => (
                <div className="identity-cell">
                  <span className="identity-title">{row.name}</span>
                  <span className="identity-meta">{row.code}</span>
                </div>
              ),
            },
            { key: "status", label: "Status", width: 110, minWidth: 92, render: (row) => row.status },
            { key: "location", label: "Location", width: 180, minWidth: 140, render: (row) => row.location },
            { key: "responsible", label: "Responsible", width: 160, minWidth: 132, render: (row) => row.responsible },
            { key: "condition", label: "Condition", width: 110, minWidth: 94, render: (row) => row.condition },
            {
              key: "replacementValue",
              label: "Replacement",
              align: "right",
              width: 124,
              minWidth: 108,
              render: (row) => row.replacementValue,
            },
          ]}
          getRowId={(row) => row.id}
          maxHeight="min(38vh, 360px)"
          onRowDoubleClick={(row) => navigate(`/assets/${row.id}`)}
          persistKey="project-detail-assets"
          rows={data.assets}
          selectable
          selectedRowIds={selectedAssetIds}
          onSelectedRowIdsChange={setSelectedAssetIds}
        />
      </SurfaceCard>

      <SurfaceCard title="Incident queue" subtitle="Project incidents with direct operational and financial linkage.">
        <DataTable
          columns={[
            {
              key: "incident",
              label: "Incident",
              width: 250,
              minWidth: 190,
              render: (row) => (
                <div className="identity-cell">
                  <span className="identity-title">{row.title}</span>
                  <span className="identity-meta">{row.asset}</span>
                </div>
              ),
            },
            { key: "responsible", label: "Responsible", width: 160, minWidth: 132, render: (row) => row.responsible },
            { key: "severity", label: "Severity", width: 100, minWidth: 90, render: (row) => row.severity },
            { key: "costEstimate", label: "Cost", align: "right", width: 110, minWidth: 96, render: (row) => row.costEstimate },
            { key: "status", label: "Status", width: 108, minWidth: 92, render: (row) => row.status },
          ]}
          getRowId={(row) => `${row.title}-${row.asset}`}
          maxHeight="min(34vh, 320px)"
          persistKey="project-detail-incidents"
          rows={data.incidents}
          selectable
          selectedRowIds={selectedIncidentIds}
          onSelectedRowIdsChange={setSelectedIncidentIds}
        />
      </SurfaceCard>
    </div>
  );
};
