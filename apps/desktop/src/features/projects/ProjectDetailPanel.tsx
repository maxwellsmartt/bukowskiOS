import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { ProjectDetailSnapshot } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { IncidentReportPanel } from "@features/incidents/IncidentReportPanel";
import { reportIncident } from "@features/incidents/useIncidentsData";
import { useCatalogData } from "@features/projects/useProjectsData";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useShellContext } from "@shared/hooks/useShellContext";
import { formatProjectAssignmentInline } from "@shared/lib/assetQuantityPresentation";
import { resolveProjectColor } from "@shared/lib/projectColors";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { hasFinanceAccess } from "@shared/lib/financeAccess";

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeMembership, activeWorkspaceId } = useWorkspace();
  const canAccessFinance = hasFinanceAccess(activeMembership);
  const { projects, refreshProjects } = useShellContext();
  const { data: catalog, error: catalogError } = useCatalogData();
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
            <span
              aria-hidden="true"
              className="project-color-dot"
              style={{ background: resolveProjectColor(data.schedule?.colorKey) }}
            />
            <span>{`${project.code} · ${project.name}`}</span>
            <StatusBadge tone={toneForStatus(project.status)}>{t(`projects.statuses.${project.status}`, { defaultValue: project.status })}</StatusBadge>
          </span>
        }
        subtitle={project.description}
        aside={
          <div className="project-detail-header-actions">
            <button
              className="ghost-control action-row-button"
              onClick={() => navigate(`/projects/${project.id}/info`)}
              type="button"
            >
              {t("projects.detail.editProject")}
            </button>
            <button
              className="action-primary-button action-row-button"
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
          {canAccessFinance ? (
            <div className="summary-row">
              <span className="summary-label">{t("projects.detail.summary.exposure")}</span>
              <span className="summary-value">{project.exposure}</span>
            </div>
          ) : null}
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
        {data.assets.length ? (
          <div className="queue-list project-scroll-list">
            {data.assets.map((row) => (
              <button
                key={row.id}
                className="queue-item queue-item-button"
                onClick={() => navigate(`/assets/${row.id}`)}
                type="button"
              >
                <div className="identity-cell">
                  <span className="identity-title">{row.name}</span>
                  <span className="identity-meta">
                    {row.code} · {row.location} ·{" "}
                    {formatProjectAssignmentInline(
                      {
                        totalQuantity: row.totalQuantity,
                        assignedQuantity: row.assignedQuantity,
                        checkedOutQuantity: row.checkedOutQuantity,
                      },
                      t,
                    )}
                  </span>
                </div>
                <StatusBadge tone="neutral">{row.condition}</StatusBadge>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">{t("projects.detail.assets.empty")}</div>
        )}
      </SurfaceCard>

      <SurfaceCard className="project-scroll-card" title={t("projects.detail.incidents.title")}>
        {data.incidents.length ? (
          <div className="queue-list project-scroll-list">
            {data.incidents.map((row) => (
              <div key={row.id} className="queue-item">
                <div className="identity-cell">
                  <span className="identity-title">{row.title}</span>
                  <span className="identity-meta">
                    {row.asset} · {t(`incidents.severity.${row.severity}`, { defaultValue: row.severity })}
                    {row.costEstimate ? ` · ${row.costEstimate}` : ""}
                  </span>
                </div>
                <StatusBadge tone={row.status === "Open" || row.status === "In review" ? "critical" : "success"}>
                  {t(`incidents.statuses.${row.status}`, { defaultValue: row.status })}
                </StatusBadge>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">{t("projects.detail.incidents.empty")}</div>
        )}
      </SurfaceCard>
    </div>
  );
};
