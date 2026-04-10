import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ProjectDetailSnapshot } from "@contracts";
import { IncidentReportPanel } from "@features/incidents/IncidentReportPanel";
import { reportIncident } from "@features/incidents/useIncidentsData";
import { useCatalogData } from "@features/projects/useProjectsData";
import { DataTable } from "@shared/components/DataTable";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";

type ProjectDetailPanelProps = {
  data: ProjectDetailSnapshot;
  error: string | null;
  isLoading: boolean;
  onIncidentCreated: () => void | Promise<void>;
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

export const ProjectDetailPanel = ({ data, error, isLoading, onIncidentCreated }: ProjectDetailPanelProps) => {
  const navigate = useNavigate();
  const { projects, refreshProjects } = useShellContext();
  const { data: catalog, error: catalogError } = useCatalogData();
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedIncidentIds, setSelectedIncidentIds] = useState<string[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        className="project-overview-card"
      >
        <div className="chip-row">
          <StatusBadge>{data.project.client}</StatusBadge>
          <StatusBadge>{data.project.departments}</StatusBadge>
          <StatusBadge tone="warning">{data.project.exposure}</StatusBadge>
          {data.schedule?.windowLabel ? <StatusBadge tone="info">{data.schedule.windowLabel}</StatusBadge> : null}
        </div>

        <div className="compact-summary-grid project-overview-summary">
          <div className="summary-row">
            <span className="summary-label">Assigned assets</span>
            <span className="summary-value">{data.project.assetCount}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Open incidents</span>
            <span className="summary-value">{data.project.incidentCount}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Client</span>
            <span className="summary-value">{data.project.client}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Departments</span>
            <span className="summary-value">{data.project.departments}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Timeline</span>
            <span className="summary-value">{data.schedule?.windowLabel ?? "Unscheduled"}</span>
          </div>
        </div>

        <div className="action-panel-actions action-panel-actions-start">
          <button
            className="action-primary-button"
            onClick={() => {
              setReportOpen(true);
              setReportError(null);
              setReportFeedback(null);
            }}
            type="button"
          >
            Report incident for this project
          </button>
        </div>
      </SurfaceCard>

      {catalogError ? <div className="empty-state">Incident catalog unavailable: {catalogError}</div> : null}
      {reportFeedback ? <div className="action-feedback action-feedback-success">{reportFeedback}</div> : null}

      {reportOpen ? (
        <IncidentReportPanel
          assetOptions={data.assets.map((asset) => ({
            id: asset.id,
            code: asset.code,
            name: asset.name,
          }))}
          departments={catalog.departments}
          error={reportError}
          initialValue={{
            projectId: data.project.id,
            severity: "Medium",
          }}
          isSubmitting={isSubmitting}
          onClose={() => {
            setReportOpen(false);
            setReportError(null);
          }}
          onSubmit={async (value) => {
            try {
              setIsSubmitting(true);
              const result = await reportIncident({
                commandId: crypto.randomUUID(),
                workspaceId: "workspace-metadata",
                assetId: value.assetId,
                projectId: value.projectId ?? data.project?.id,
                projectUnitId: value.projectUnitId,
                departmentId: value.departmentId,
                responsibleUserId: value.responsibleUserId,
                incidentType: value.incidentType,
                severity: value.severity,
                title: value.title,
                description: value.description,
                costEstimate: value.costEstimate,
                notes: value.notes,
                actorType: "user",
                sourceChannel: "desktop",
              });

              await Promise.all([Promise.resolve(onIncidentCreated()), refreshProjects()]);
              setReportOpen(false);
              setReportError(null);
              setReportFeedback(result.summary);
            } catch (nextError) {
              setReportError(nextError instanceof Error ? nextError.message : "Unable to create incident.");
            } finally {
              setIsSubmitting(false);
            }
          }}
          projectLocked
          projects={projects}
          users={catalog.users}
        />
      ) : null}

      <div className="metric-grid">
        {data.metrics.map((metric) => (
          <SurfaceCard key={metric.label}>
            <span className={`metric-value metric-tone-${metric.tone}`}>{metric.value}</span>
            <p className="metric-label">{metric.label}</p>
          </SurfaceCard>
        ))}
      </div>

      <div className="project-detail-support-grid">
        <SurfaceCard
          className="project-scroll-card"
          title="Unit snapshot"
          subtitle="Active and upcoming units shaping the schedule of this project."
        >
          {data.units.length ? (
            <div className="queue-list">
              {data.units.map((unit) => (
                <div key={unit.id} className="queue-item">
                  <div className="identity-cell">
                    <span className="identity-title">
                      {unit.code} · {unit.name}
                    </span>
                    <span className="identity-meta">
                      {unit.startDate ?? "No start"} - {unit.endDate ?? "Open"} · {unit.crewAssignments.length} crew linked
                    </span>
                  </div>
                  <StatusBadge tone={unit.status === "active" ? "info" : unit.status === "planned" ? "warning" : unit.status === "wrapped" ? "success" : "critical"}>
                    {unit.status}
                  </StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No units defined yet. Use Project Info to model Main, Second or Splinter work.</div>
          )}
        </SurfaceCard>

        <SurfaceCard
          className="project-scroll-card"
          title="Responsibles"
          subtitle="People currently carrying project inventory or open incidents."
        >
          {data.responsibles.length ? (
            <div className="queue-list project-scroll-list">
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

        <SurfaceCard
          className="project-scroll-card"
          title="Budget shell"
          subtitle="Initial FinanceOps structure tied to the project."
        >
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

      <SurfaceCard
        className="project-scroll-card"
        title="Assigned assets"
        subtitle="Current inventory assigned to this project. Double click an asset to open its full profile."
      >
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
            { key: "unit", label: "Unit", width: 150, minWidth: 124, render: (row) => row.projectUnit },
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
          onRowDoubleClick={(row) => navigate(`/assets/${row.id}`)}
          persistKey="project-detail-assets"
          rows={data.assets}
          shellClassName="table-shell-natural"
          selectable
          selectedRowIds={selectedAssetIds}
          onSelectedRowIdsChange={setSelectedAssetIds}
        />
      </SurfaceCard>

      <SurfaceCard
        className="project-scroll-card"
        title="Incident queue"
        subtitle="Project incidents with direct operational and financial linkage."
      >
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
            { key: "unit", label: "Unit", width: 150, minWidth: 124, render: (row) => row.projectUnit },
            { key: "severity", label: "Severity", width: 100, minWidth: 90, render: (row) => row.severity },
            { key: "costEstimate", label: "Cost", align: "right", width: 110, minWidth: 96, render: (row) => row.costEstimate },
            { key: "status", label: "Status", width: 108, minWidth: 92, render: (row) => row.status },
          ]}
          getRowId={(row) => row.id}
          persistKey="project-detail-incidents"
          rows={data.incidents}
          shellClassName="table-shell-natural"
          selectable
          selectedRowIds={selectedIncidentIds}
          onSelectedRowIdsChange={setSelectedIncidentIds}
        />
      </SurfaceCard>
    </div>
  );
};
