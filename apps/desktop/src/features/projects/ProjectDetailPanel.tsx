import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ProjectDetailSnapshot } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { IncidentReportPanel } from "@features/incidents/IncidentReportPanel";
import { reportIncident } from "@features/incidents/useIncidentsData";
import { useCatalogData } from "@features/projects/useProjectsData";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useShellContext } from "@shared/hooks/useShellContext";
import { formatProjectAssignmentInline } from "@shared/lib/assetQuantityPresentation";

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
  const { activeWorkspaceId } = useWorkspace();
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
    return (
      <SurfaceCard title="Project Overview">
        <TableSkeleton body="Loading the latest project details." columns={5} />
      </SurfaceCard>
    );
  }

  if (!data.project) {
    return (
      <GuidedEmptyState
        title="Choose a project"
        body="Open a project to review inventory, issues, schedule and ownership."
        tips={["Open a project to review units and inventory", "Use Details when you need to update project information"]}
        actionLabel="Open projects"
        onAction={() => navigate("/projects")}
      />
    );
  }

  const project = data.project;

  return (
    <div className="project-detail-stack">
      <SurfaceCard
        title={
          <span className="project-detail-title-group">
            <span>{`${project.code} · ${project.name}`}</span>
            <StatusBadge tone={toneForStatus(project.status)}>{project.status}</StatusBadge>
          </span>
        }
        subtitle={project.description}
        aside={
          <div className="project-detail-header-actions">
            <button className="ghost-control" onClick={() => navigate(`/projects/${project.id}/info`)} type="button">
              Edit project
            </button>
            <button
              className="action-primary-button"
              onClick={() => {
                setReportOpen(true);
                setReportError(null);
                setReportFeedback(null);
              }}
              type="button"
            >
              Report incident
            </button>
          </div>
        }
        className="project-overview-card"
      >
        <div className="compact-summary-grid project-overview-summary">
          <div className="summary-row">
            <span className="summary-label">Assigned assets</span>
            <span className="summary-value">{project.assetCount}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Open incidents</span>
            <span className="summary-value">{project.incidentCount}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Client</span>
            <span className="summary-value">{project.client}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Exposure</span>
            <span className="summary-value">{project.exposure}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Timeline</span>
            <span className="summary-value">{data.schedule?.windowLabel ?? "Unscheduled"}</span>
          </div>
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
                workspaceId: activeWorkspaceId,
                assetId: value.assetId,
                projectId: value.projectId ?? project.id,
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
        <SurfaceCard className="project-scroll-card" title="Units">
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
            <div className="empty-state">No units yet. Open Details to add the first one.</div>
          )}
        </SurfaceCard>

        <SurfaceCard className="project-scroll-card" title="Responsibility">
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
            <div className="empty-state">No owners assigned yet.</div>
          )}
        </SurfaceCard>
      </div>

      <SurfaceCard className="project-scroll-card" title="Assets">
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
            {
              key: "stock",
              label: "Stock",
              width: 176,
              minWidth: 150,
              render: (row) => (
                <span className="stock-inline-text">
                  {formatProjectAssignmentInline({
                    totalQuantity: row.totalQuantity,
                    assignedQuantity: row.assignedQuantity,
                    checkedOutQuantity: row.checkedOutQuantity,
                  })}
                </span>
              ),
            },
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
          emptyMessage="No assets assigned yet. Add inventory from Assets to keep this project moving."
          onRowDoubleClick={(row) => navigate(`/assets/${row.id}`)}
          persistKey="project-detail-assets"
          rows={data.assets}
          shellClassName="table-shell-natural"
          selectable
          selectedRowIds={selectedAssetIds}
          onSelectedRowIdsChange={setSelectedAssetIds}
        />
      </SurfaceCard>

      <SurfaceCard className="project-scroll-card" title="Incidents">
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
          emptyMessage="No incidents linked yet. Use the action above to report the first project incident."
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
