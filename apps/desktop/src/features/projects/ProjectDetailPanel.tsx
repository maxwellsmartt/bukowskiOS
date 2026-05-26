import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { ProjectDetailSnapshot } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
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
import { getUserFacingErrorMessage } from "@shared/lib/errors";

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

const projectMetricLabelKeys: Record<string, string> = {
  "Assigned assets": "projects.detail.metrics.assignedAssets",
  "Open incidents": "projects.detail.metrics.openIncidents",
  "Incident exposure": "projects.detail.metrics.incidentExposure",
  "Replacement at risk": "projects.detail.metrics.replacementAtRisk",
};

const translateProjectMetricLabel = (label: string, t: TFunction) =>
  projectMetricLabelKeys[label] ? t(projectMetricLabelKeys[label]) : label;

export const ProjectDetailPanel = ({ data, error, isLoading, onIncidentCreated }: ProjectDetailPanelProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeWorkspaceId } = useWorkspace();
  const { projects, refreshProjects } = useShellContext();
  const { data: catalog, error: catalogError } = useCatalogData();
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedIncidentIds, setSelectedIncidentIds] = useState<string[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toast = useToast();

  if (error) {
    return <div className="empty-state">{t("projects.detail.unavailable", { message: error })}</div>;
  }

  if (isLoading) {
    return (
      <SurfaceCard title={t("projects.detail.title")}>
        <TableSkeleton body={t("projects.detail.loading")} columns={5} />
      </SurfaceCard>
    );
  }

  if (!data.project) {
    return (
      <GuidedEmptyState
        title={t("projects.detail.empty.title")}
        body={t("projects.detail.empty.body")}
        tips={[t("projects.detail.empty.tipInventory"), t("projects.detail.empty.tipDetails")]}
        actionLabel={t("projects.detail.empty.action")}
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
            <StatusBadge tone={toneForStatus(project.status)}>{t(`projects.statuses.${project.status}`, { defaultValue: project.status })}</StatusBadge>
          </span>
        }
        subtitle={project.description}
        aside={
          <div className="project-detail-header-actions">
            <button className="ghost-control" onClick={() => navigate(`/projects/${project.id}/info`)} type="button">
              {t("projects.detail.editProject")}
            </button>
            <button
              className="action-primary-button"
              onClick={() => {
                setReportOpen(true);
                setReportError(null);

              }}
              type="button"
            >
              {t("projects.detail.reportIncident")}
            </button>
          </div>
        }
        className="project-overview-card"
      >
        <div className="compact-summary-grid project-overview-summary">
          <div className="summary-row">
            <span className="summary-label">{t("projects.detail.summary.assignedAssets")}</span>
            <span className="summary-value">{project.assetCount}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("projects.detail.summary.openIncidents")}</span>
            <span className="summary-value">{project.incidentCount}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("projects.detail.summary.client")}</span>
            <span className="summary-value">{project.client}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("projects.detail.summary.exposure")}</span>
            <span className="summary-value">{project.exposure}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("projects.detail.summary.timeline")}</span>
            <span className="summary-value">{data.schedule?.windowLabel ?? t("projects.fallbacks.unscheduled")}</span>
          </div>
        </div>
      </SurfaceCard>

      {catalogError ? <div className="empty-state">{t("incidents.catalogUnavailable", { message: catalogError })}</div> : null}

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
              toast.success(t("incidents.toasts.reported"), result.summary);
            } catch (nextError) {
              setReportError(getUserFacingErrorMessage(nextError, t("incidents.toasts.createFailed")));
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
            <p className="metric-label">{translateProjectMetricLabel(metric.label, t)}</p>
          </SurfaceCard>
        ))}
      </div>

      <div className="project-detail-support-grid">
        <SurfaceCard className="project-scroll-card" title={t("projects.detail.units.title")}>
          {data.units.length ? (
            <div className="queue-list">
              {data.units.map((unit) => (
                <div key={unit.id} className="queue-item">
                  <div className="identity-cell">
                    <span className="identity-title">
                      {unit.code} · {unit.name}
                    </span>
                    <span className="identity-meta">
                      {unit.startDate ?? t("projects.fallbacks.noStart")} - {unit.endDate ?? t("projects.fallbacks.open")} ·{" "}
                      {t("projects.detail.units.crewLinked", { count: unit.crewAssignments.length })}
                    </span>
                  </div>
                  <StatusBadge tone={unit.status === "active" ? "info" : unit.status === "planned" ? "warning" : unit.status === "wrapped" ? "success" : "critical"}>
                    {t(`projects.unitStatuses.${unit.status}`, { defaultValue: unit.status })}
                  </StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">{t("projects.detail.units.empty")}</div>
          )}
        </SurfaceCard>

        <SurfaceCard className="project-scroll-card" title={t("projects.detail.responsibility.title")}>
          {data.responsibles.length ? (
            <div className="queue-list project-scroll-list">
              {data.responsibles.map((row) => (
                <div key={row.name} className="queue-item">
                  <div className="identity-cell">
                    <span className="identity-title">{row.name}</span>
                    <span className="identity-meta">
                      {t("projects.detail.responsibility.meta", { assets: row.assetCount, incidents: row.incidentCount })}
                    </span>
                  </div>
                  <StatusBadge tone={row.incidentCount ? "critical" : "info"}>
                    {row.incidentCount ? t("projects.detail.responsibility.needsFollowUp") : t("projects.detail.responsibility.stable")}
                  </StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">{t("projects.detail.responsibility.empty")}</div>
          )}
        </SurfaceCard>
      </div>

      <SurfaceCard className="project-scroll-card" title={t("projects.detail.assets.title")}>
        <DataTable
          columns={[
            {
              key: "asset",
              label: t("projects.detail.assets.columns.asset"),
              width: 230,
              minWidth: 180,
              render: (row) => (
                <div className="identity-cell">
                  <span className="identity-title">{row.name}</span>
                  <span className="identity-meta">{row.code}</span>
                </div>
              ),
            },
            { key: "status", label: t("projects.detail.assets.columns.status"), width: 110, minWidth: 92, render: (row) => row.status },
            {
              key: "stock",
              label: t("projects.detail.assets.columns.stock"),
              width: 176,
              minWidth: 150,
              render: (row) => (
                <span className="stock-inline-text">
                  {formatProjectAssignmentInline({
                    totalQuantity: row.totalQuantity,
                    assignedQuantity: row.assignedQuantity,
                    checkedOutQuantity: row.checkedOutQuantity,
                  }, t)}
                </span>
              ),
            },
            { key: "location", label: t("projects.detail.assets.columns.location"), width: 180, minWidth: 140, render: (row) => row.location },
            { key: "unit", label: t("projects.detail.assets.columns.unit"), width: 150, minWidth: 124, render: (row) => row.projectUnit },
            { key: "responsible", label: t("projects.detail.assets.columns.responsible"), width: 160, minWidth: 132, render: (row) => row.responsible },
            { key: "condition", label: t("projects.detail.assets.columns.condition"), width: 110, minWidth: 94, render: (row) => row.condition },
            {
              key: "replacementValue",
              label: t("projects.detail.assets.columns.replacement"),
              align: "right",
              width: 124,
              minWidth: 108,
              render: (row) => row.replacementValue,
            },
          ]}
          getRowId={(row) => row.id}
          emptyMessage={t("projects.detail.assets.empty")}
          maxHeight="min(42vh, 440px)"
          onRowDoubleClick={(row) => navigate(`/assets/${row.id}`)}
          persistKey="project-detail-assets"
          rows={data.assets}
          shellClassName="table-shell-natural"
          selectable
          selectedRowIds={selectedAssetIds}
          onSelectedRowIdsChange={setSelectedAssetIds}
        />
      </SurfaceCard>

      <SurfaceCard className="project-scroll-card" title={t("projects.detail.incidents.title")}>
        <DataTable
          columns={[
            {
              key: "incident",
              label: t("projects.detail.incidents.columns.incident"),
              width: 250,
              minWidth: 190,
              render: (row) => (
                <div className="identity-cell">
                  <span className="identity-title">{row.title}</span>
                  <span className="identity-meta">{row.asset}</span>
                </div>
              ),
            },
            { key: "responsible", label: t("projects.detail.incidents.columns.responsible"), width: 160, minWidth: 132, render: (row) => row.responsible },
            { key: "unit", label: t("projects.detail.incidents.columns.unit"), width: 150, minWidth: 124, render: (row) => row.projectUnit },
            {
              key: "severity",
              label: t("projects.detail.incidents.columns.severity"),
              width: 100,
              minWidth: 90,
              render: (row) => t(`incidents.severity.${row.severity}`, { defaultValue: row.severity }),
            },
            { key: "costEstimate", label: t("projects.detail.incidents.columns.cost"), align: "right", width: 110, minWidth: 96, render: (row) => row.costEstimate },
            {
              key: "status",
              label: t("projects.detail.incidents.columns.status"),
              width: 108,
              minWidth: 92,
              render: (row) => t(`incidents.statuses.${row.status}`, { defaultValue: row.status }),
            },
          ]}
          getRowId={(row) => row.id}
          emptyMessage={t("projects.detail.incidents.empty")}
          maxHeight="min(42vh, 440px)"
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
