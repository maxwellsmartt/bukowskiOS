import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { AssetListQuery, IncidentListQuery, IncidentSortField } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useAssetsList } from "@features/assets/useAssetsData";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useRmaSnapshot } from "@features/rma/useRmaData";
import { useCatalogData } from "@features/projects/useProjectsData";
import { DataTable } from "@shared/components/DataTable";
import { ListToolbar } from "@shared/components/ListToolbar";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { useShellContext } from "@shared/hooks/useShellContext";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import { IncidentReportPanel } from "./IncidentReportPanel";
import { IncidentDetailPanel } from "./IncidentDetailPanel";
import { reportIncident, resolveIncident, updateIncident, useIncidentDetail, useIncidentsData } from "./useIncidentsData";

type IncidentsPageProps = {
  projectId?: string | null;
  projectName?: string | null;
};

const incidentSortOptions: Array<ListSortOption<IncidentSortField> & { labelKey: string }> = [
  { value: "reportedAt", label: "Reported date", labelKey: "incidents.sort.reportedAt" },
  { value: "title", label: "Title", labelKey: "incidents.sort.title", columnKey: "title" },
  { value: "asset", label: "Asset", labelKey: "incidents.sort.asset", columnKey: "title" },
  { value: "project", label: "Project", labelKey: "incidents.sort.project", columnKey: "project" },
  { value: "responsible", label: "Responsible", labelKey: "incidents.sort.responsible", columnKey: "responsible" },
  { value: "severity", label: "Severity", labelKey: "incidents.sort.severity", columnKey: "severity" },
  { value: "costEstimate", label: "Cost estimate", labelKey: "incidents.sort.costEstimate", columnKey: "cost" },
  { value: "status", label: "Status", labelKey: "incidents.sort.status", columnKey: "status" },
];

const resolveIncidentStatusTone = (status: string) => {
  if (status === "Resolved") {
    return "success" as const;
  }

  if (status === "In review") {
    return "info" as const;
  }

  return "warning" as const;
};

export const IncidentsPage = ({ projectId = null, projectName = null }: IncidentsPageProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeWorkspaceId } = useWorkspace();
  const { activeProject, projects, refreshProjects } = useShellContext();
  const isProjectMode = Boolean(projectId);
  const effectiveProjectName = projectName ?? (isProjectMode ? activeProject?.name ?? null : null);
  const [searchParams] = useSearchParams();
  const incidentControls = useListControls<IncidentSortField, IncidentListQuery>({
    viewKey: isProjectMode ? "project-incidents-list" : "incidents-list",
    defaults: {
      search: "",
      sortBy: "reportedAt",
      sortDirection: "desc",
    },
    sortOptions: incidentSortOptions,
    defaultDirectionBySort: {
      costEstimate: "desc",
      reportedAt: "desc",
      severity: "desc",
    },
    buildQuery: ({ search, sortBy, sortDirection }) => ({
      workspaceId: activeWorkspaceId,
      scopeProjectId: projectId,
      search,
      sortBy,
      sortDirection,
    }),
  });
  const { data, error, isLoading, reload } = useIncidentsData(incidentControls.query);
  const { data: assets } = useAssetsList({
    workspaceId: activeWorkspaceId,
    scopeProjectId: projectId,
    search: "",
    sortBy: "name",
    sortDirection: "asc",
  } satisfies AssetListQuery);
  const { data: catalog, error: catalogError } = useCatalogData({
    workspaceId: activeWorkspaceId,
    entityType: "location",
    search: "",
    sortBy: "name",
    sortDirection: "asc",
  });
  const { data: rmaSnapshot, error: rmaError } = useRmaSnapshot({ workspaceId: activeWorkspaceId });
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [isSubmittingIncident, setIsSubmittingIncident] = useState(false);
  const toast = useToast();
  const [activeIncidentId, setActiveIncidentId] = useState<string | null>(null);
  const [incidentDetailError, setIncidentDetailError] = useState<string | null>(null);
  const [isSubmittingIncidentDetail, setIsSubmittingIncidentDetail] = useState(false);
  const {
    data: activeIncidentDetail,
    error: activeIncidentDetailLoadError,
    reload: reloadIncidentDetail,
  } = useIncidentDetail(activeIncidentId);
  const focusedIncidentId = searchParams.get("focus");

  useEffect(() => {
    if (focusedIncidentId && data.some((row) => row.id === focusedIncidentId)) {
      setActiveIncidentId(focusedIncidentId);
    }
  }, [data, focusedIncidentId]);

  const activeIncident = activeIncidentDetail.incident;
  const activeIncidentRepairCase =
    activeIncident?.assetId
      ? rmaSnapshot.cases.find(
          (row) =>
            row.assetIds.includes(activeIncident.assetId!) &&
            row.status !== "No repair / retired" &&
            row.status !== "Returned to inventory",
        ) ?? null
      : null;

  const handleCreateRepairCaseFromIncident = () => {
    navigate("/rma");
  };

  const handleOpenRepairCaseFromIncident = (_repairCaseId: string) => {
    navigate("/rma");
  };

  return (
    <div className="page-stack">
      <SectionHeader title={t("incidents.title")} />

      {error ? <div className="empty-state">{t("incidents.unavailable", { message: error })}</div> : null}
      {catalogError ? <div className="empty-state">{t("incidents.catalogUnavailable", { message: catalogError })}</div> : null}
      {!isProjectMode && rmaError ? <div className="empty-state">{t("incidents.repairUnavailable", { message: rmaError })}</div> : null}

      <div className="selection-action-bar">
        <div className="selection-action-copy">
          <span className="selection-action-title">{t("incidents.actionBar.title")}</span>
          <span className="selection-action-subtitle">
            {isProjectMode
              ? effectiveProjectName ?? t("incidents.actionBar.thisProject")
              : t("incidents.actionBar.subtitle")}
          </span>
        </div>
        <button
          className="action-primary-button"
          onClick={() => {
            setReportOpen(true);
            setReportError(null);

          }}
          type="button"
        >
          {t("incidents.actionBar.report")}
        </button>
      </div>

      {reportOpen ? (
        <IncidentReportPanel
          assetOptions={assets.map((asset) => ({
            id: asset.id,
            code: asset.code,
            name: asset.name,
          }))}
          departments={catalog.departments}
          error={reportError}
          initialValue={{ projectId: isProjectMode ? projectId ?? undefined : undefined, severity: "Medium" }}
          isSubmitting={isSubmittingIncident}
          projectLocked={isProjectMode}
          onClose={() => {
            setReportOpen(false);
            setReportError(null);
          }}
          onSubmit={async (value) => {
            try {
              setIsSubmittingIncident(true);
              const result = await reportIncident({
                commandId: crypto.randomUUID(),
                workspaceId: activeWorkspaceId,
                assetId: value.assetId,
                projectId: value.projectId,
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

              await Promise.all([reload(), refreshProjects()]);
              setReportOpen(false);
              setReportError(null);
              toast.success(t("incidents.toasts.reported"), result.summary);
            } catch (nextError) {
              setReportError(getUserFacingErrorMessage(nextError, t("incidents.toasts.createFailed")));
            } finally {
              setIsSubmittingIncident(false);
            }
          }}
          projects={projects}
          users={catalog.users}
        />
      ) : null}

      <SurfaceCard title={t("incidents.cardTitle")}>
        <ListToolbar
          activeSortLabel={
            incidentControls.activeSortOption
              ? t(
                  (incidentControls.activeSortOption as ListSortOption<IncidentSortField> & { labelKey?: string }).labelKey ??
                    incidentControls.activeSortOption.label,
                  { defaultValue: incidentControls.activeSortOption.label },
                )
              : undefined
          }
          onSearchValueChange={incidentControls.setSearchValue}
          onSortByChange={incidentControls.setSortField}
          onToggleSortDirection={incidentControls.toggleSortDirection}
          resultCount={data.length}
          resultLabel={t("incidents.resultLabel")}
          searchPlaceholder={isProjectMode ? t("incidents.toolbar.searchPlaceholderProject") : t("incidents.toolbar.searchPlaceholder")}
          searchValue={incidentControls.searchValue}
          sortBy={incidentControls.sortBy}
          sortDirection={incidentControls.sortDirection}
          sortOptions={incidentSortOptions.map((option) => ({
            ...option,
            label: t(option.labelKey, { defaultValue: option.label }),
          }))}
        />
        {isLoading && data.length === 0 ? (
          <TableSkeleton body={t("incidents.loading")} columns={6} />
        ) : null}
        <DataTable
          activeRowId={activeIncidentId}
          autoScrollToActiveRow
          getRowId={(row) => row.id}
          maxHeight="min(60vh, 640px)"
          onRowClick={(row) => {
            setActiveIncidentId(row.id);
            setIncidentDetailError(null);
          }}
          onSortRequest={incidentControls.handleColumnSortRequest}
          persistKey="incidents-queue"
          columns={[
            {
              key: "title",
              label: t("incidents.columns.incident"),
              render: (row) => (
                <div className="identity-cell">
                  <span className="identity-title">{row.title}</span>
                  <span className="identity-meta">{row.asset}</span>
                </div>
              ),
            },
            { key: "project", label: t("incidents.columns.project"), render: (row) => row.project },
            { key: "responsible", label: t("incidents.columns.responsible"), render: (row) => row.responsible },
            {
              key: "severity",
              label: t("incidents.columns.severity"),
              render: (row) => (
                <StatusBadge tone={row.severity === "High" ? "critical" : row.severity === "Medium" ? "warning" : "neutral"}>
                  {t(`incidents.severity.${row.severity}`, { defaultValue: row.severity })}
                </StatusBadge>
              ),
            },
            { key: "cost", label: t("incidents.columns.costEstimate"), render: (row) => row.costEstimate },
            {
              key: "status",
              label: t("incidents.columns.status"),
              render: (row) => (
                <StatusBadge tone={resolveIncidentStatusTone(row.status)}>
                  {t(`incidents.statuses.${row.status}`, { defaultValue: row.status })}
                </StatusBadge>
              ),
            },
          ]}
          rows={data}
          selectable
          selectedRowIds={selectedRowIds}
          sortState={
            incidentControls.activeColumnKey
              ? {
                  columnKey: incidentControls.activeColumnKey,
                  direction: incidentControls.sortDirection,
                }
              : null
          }
          onSelectedRowIdsChange={setSelectedRowIds}
        />
      </SurfaceCard>

      <IncidentDetailPanel
        detail={activeIncidentDetail}
        error={incidentDetailError ?? activeIncidentDetailLoadError}
        isSubmitting={isSubmittingIncidentDetail}
        repairCase={
          activeIncidentRepairCase
            ? {
                id: activeIncidentRepairCase.id,
                title: activeIncidentRepairCase.title,
                status: activeIncidentRepairCase.status,
              }
            : null
        }
        onClose={() => {
          setActiveIncidentId(null);
          setIncidentDetailError(null);
        }}
        onCreateRepairCase={!isProjectMode ? handleCreateRepairCaseFromIncident : undefined}
        onOpenRepairCase={!isProjectMode ? handleOpenRepairCaseFromIncident : undefined}
        onRefresh={reloadIncidentDetail}
        onResolve={async (value) => {
          if (!activeIncidentId) {
            return;
          }

          try {
            setIsSubmittingIncidentDetail(true);
            const result = await resolveIncident({
              commandId: crypto.randomUUID(),
              workspaceId: activeWorkspaceId,
              incidentId: activeIncidentId,
              resolutionNotes: value.resolutionNotes,
              costEstimate: value.costEstimate,
              financialStatus: value.financialStatus,
              resolvedByUserId: value.resolvedByUserId,
              retireAsset: value.retireAsset,
              actorType: "user",
              sourceChannel: "desktop",
            });

            await Promise.all([reload(), refreshProjects(), reloadIncidentDetail()]);
            setIncidentDetailError(null);
            toast.success(t("incidents.toasts.resolved"), result.summary);
          } catch (nextError) {
            setIncidentDetailError(getUserFacingErrorMessage(nextError, t("incidents.toasts.resolveFailed")));
          } finally {
            setIsSubmittingIncidentDetail(false);
          }
        }}
        onUpdate={async (value) => {
          if (!activeIncidentId) {
            return;
          }

          try {
            setIsSubmittingIncidentDetail(true);
            const result = await updateIncident({
              commandId: crypto.randomUUID(),
              workspaceId: activeWorkspaceId,
              incidentId: activeIncidentId,
              title: value.title,
              description: value.description,
              severity: value.severity,
              status: value.status,
              responsibleUserId: value.responsibleUserId,
              costEstimate: value.costEstimate,
              financialStatus: value.financialStatus,
              notes: value.notes,
              actorType: "user",
              sourceChannel: "desktop",
            });

            await Promise.all([reload(), refreshProjects(), reloadIncidentDetail()]);
            setIncidentDetailError(null);
            toast.success(t("incidents.toasts.updated"), result.summary);
          } catch (nextError) {
            setIncidentDetailError(getUserFacingErrorMessage(nextError, t("incidents.toasts.updateFailed")));
          } finally {
            setIsSubmittingIncidentDetail(false);
          }
        }}
        users={catalog.users}
      />

      {!isProjectMode ? (
        <SurfaceCard
          title={t("incidents.repair.cardTitle")}
          subtitle={t("incidents.repair.cardSubtitle")}
          aside={
            <button className="action-primary-button" onClick={() => navigate("/rma")} type="button">
              {t("incidents.repair.open")}
            </button>
          }
        >
          <p className="surface-card-subtitle">
            {t("incidents.repair.body")}
          </p>
        </SurfaceCard>
      ) : null}

    </div>
  );
};
