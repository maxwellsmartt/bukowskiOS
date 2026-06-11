import { Box, Eye, FileText } from "lucide-react";
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
import { ModalShell } from "@shared/components/ModalShell";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { useShellContext } from "@shared/hooks/useShellContext";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { uiPreferenceKeys } from "@shared/lib/preferences";

import { IncidentReportPanel } from "./IncidentReportPanel";
import { IncidentDetailPanel } from "./IncidentDetailPanel";
import { reportIncident, resolveIncident, updateIncident, useIncidentDetail, useIncidentsData } from "./useIncidentsData";

type IncidentsPageProps = {
  projectId?: string | null;
  projectName?: string | null;
};

const incidentSortOptions: Array<ListSortOption<IncidentSortField>> = [
  { value: "reportedAt", label: "incidents.sort.reportedAt" },
  { value: "title", label: "incidents.sort.title", columnKey: "title" },
  { value: "asset", label: "incidents.sort.asset", columnKey: "assetName" },
  { value: "project", label: "incidents.sort.project", columnKey: "project" },
  { value: "responsible", label: "incidents.sort.responsible", columnKey: "responsible" },
  { value: "severity", label: "incidents.sort.severity", columnKey: "severity" },
  { value: "costEstimate", label: "incidents.sort.costEstimate", columnKey: "cost" },
  { value: "status", label: "incidents.sort.status", columnKey: "status" },
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

export const IncidentsPage = ({ projectId = null }: IncidentsPageProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeWorkspaceId } = useWorkspace();
  const { projects, refreshProjects } = useShellContext();
  const isProjectMode = Boolean(projectId);
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
    navigate(activeIncident?.assetId ? `/rma?newForAsset=${activeIncident.assetId}` : "/rma");
  };

  const handleOpenRepairCaseFromIncident = (repairCaseId: string) => {
    navigate(`/rma?focus=${repairCaseId}`);
  };

  // Quick triage from the row context menu: Open -> In review without opening
  // the detail. updateIncident accepts partial patches, so only the status moves.
  const quickMarkInReview = async (incidentId: string) => {
    try {
      setIsSubmittingIncidentDetail(true);
      const result = await updateIncident({
        commandId: crypto.randomUUID(),
        workspaceId: activeWorkspaceId,
        incidentId,
        status: "In review",
        actorType: "user",
        sourceChannel: "desktop",
      });

      await Promise.all([reload(), activeIncidentId === incidentId ? reloadIncidentDetail() : Promise.resolve()]);
      toast.success(t("incidents.toasts.updated"), result.summary);
    } catch (nextError) {
      toast.error(t("incidents.toasts.updateFailed"), getUserFacingErrorMessage(nextError, t("incidents.toasts.updateFailed")));
    } finally {
      setIsSubmittingIncidentDetail(false);
    }
  };

  const selectedOpenIncidentIds = data.filter((row) => selectedRowIds.includes(row.id) && row.status === "Open").map((row) => row.id);

  const bulkMarkInReview = async () => {
    if (!selectedOpenIncidentIds.length) {
      return;
    }

    try {
      setIsSubmittingIncidentDetail(true);
      const failures: string[] = [];
      for (const incidentId of selectedOpenIncidentIds) {
        try {
          await updateIncident({
            commandId: crypto.randomUUID(),
            workspaceId: activeWorkspaceId,
            incidentId,
            status: "In review",
            actorType: "user",
            sourceChannel: "desktop",
          });
        } catch {
          failures.push(incidentId);
        }
      }

      await Promise.all([reload(), activeIncidentId ? reloadIncidentDetail() : Promise.resolve()]);
      const updatedCount = selectedOpenIncidentIds.length - failures.length;
      if (failures.length) {
        toast.info(
          t("incidents.toasts.updated"),
          t("incidents.selection.markInReviewPartial", { updated: updatedCount, failed: failures.length }),
        );
      } else {
        toast.success(t("incidents.toasts.updated"), t("incidents.selection.markInReviewDone", { count: updatedCount }));
      }
      setSelectedRowIds([]);
    } finally {
      setIsSubmittingIncidentDetail(false);
    }
  };

  const hasActiveSearch = Boolean(incidentControls.searchValue.trim());
  const translatedSortOptions = incidentSortOptions.map((option) => ({ ...option, label: t(option.label) }));

  return (
    <div className={`page-stack incidents-page-stack${isProjectMode ? "" : " incidents-page-stack--fill"}`}>
      <SectionHeader title={t("incidents.title")} />

      {error ? <div className="empty-state">{t("incidents.unavailable", { message: error })}</div> : null}
      {catalogError ? <div className="empty-state">{t("incidents.catalogUnavailable", { message: catalogError })}</div> : null}
      {rmaError ? <div className="empty-state">{t("incidents.repairUnavailable", { message: rmaError })}</div> : null}

      {reportOpen ? (
        <ModalShell
          onClose={() => {
            setReportOpen(false);
            setReportError(null);
          }}
        >
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
        </ModalShell>
      ) : null}

      <ResizableSideRailLayout
        className="split-layout"
        defaultWidth={420}
        maxWidth={640}
        minWidth={320}
        storageKey={uiPreferenceKeys.splitSideRailWidth}
      >
        <SurfaceCard
          className="rail-table-card"
          title={t("incidents.cardTitle")}
          aside={
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
          }
        >
        <ListToolbar
          activeSortLabel={incidentControls.activeSortOption ? t(incidentControls.activeSortOption.label) : undefined}
          onSearchValueChange={incidentControls.setSearchValue}
          onSortByChange={incidentControls.setSortField}
          onToggleSortDirection={incidentControls.toggleSortDirection}
          resultCount={data.length}
          resultLabel={t("incidents.resultLabel")}
          searchPlaceholder={isProjectMode ? t("incidents.toolbar.searchPlaceholderProject") : t("incidents.toolbar.searchPlaceholder")}
          searchValue={incidentControls.searchValue}
          sortBy={incidentControls.sortBy}
          sortDirection={incidentControls.sortDirection}
          sortOptions={translatedSortOptions}
        />
        {selectedRowIds.length ? (
          <div className="selection-action-bar">
            <div className="selection-action-copy">
              <span className="selection-action-title">{t("incidents.selection.title", { count: selectedRowIds.length })}</span>
              <span className="selection-action-subtitle">{t("incidents.selection.subtitle")}</span>
            </div>
            <div className="selection-action-buttons">
              <button
                className="ghost-control"
                disabled={!selectedOpenIncidentIds.length || isSubmittingIncidentDetail}
                onClick={() => void bulkMarkInReview()}
                type="button"
              >
                {t("incidents.selection.markInReview", { count: selectedOpenIncidentIds.length })}
              </button>
              <button className="ghost-control" onClick={() => setSelectedRowIds([])} type="button">
                {t("incidents.selection.clear")}
              </button>
            </div>
          </div>
        ) : null}
        {isLoading && data.length === 0 ? (
          <TableSkeleton body={t("incidents.loading")} columns={6} />
        ) : null}
        <DataTable
          activeRowId={activeIncidentId}
          autoScrollToActiveRow
          shellClassName="table-shell-fill"
          emptyContent={
            <div className="table-empty-state">
              <span className="table-empty-kicker">{t(hasActiveSearch ? "incidents.empty.filteredKicker" : "incidents.empty.kicker")}</span>
              <strong>{t(hasActiveSearch ? "incidents.empty.filteredTitle" : "incidents.empty.title")}</strong>
              <span>{t(hasActiveSearch ? "incidents.empty.filteredBody" : "incidents.empty.body")}</span>
            </div>
          }
          getRowId={(row) => row.id}
          onRowClick={(row) => {
            setActiveIncidentId(row.id);
            setIncidentDetailError(null);
          }}
          rowActions={(row) => [
            {
              key: "open",
              label: t("shared.dataTable.openDetail"),
              icon: <FileText size={14} />,
              onSelect: (target) => {
                setActiveIncidentId(target.id);
                setIncidentDetailError(null);
              },
            },
            {
              key: "view-asset",
              label: t("incidents.context.viewAsset"),
              icon: <Box size={14} />,
              disabled: !row.assetId,
              onSelect: (target) => {
                if (target.assetId) {
                  navigate(`/assets/${target.assetId}`);
                }
              },
            },
            {
              key: "mark-in-review",
              label: t("incidents.context.markInReview"),
              icon: <Eye size={14} />,
              disabled: row.status !== "Open" || isSubmittingIncidentDetail,
              separatorBefore: true,
              onSelect: (target) => {
                void quickMarkInReview(target.id);
              },
            },
          ]}
          onSortRequest={incidentControls.handleColumnSortRequest}
          persistKey="incidents-queue"
          columns={[
            {
              key: "title",
              label: t("incidents.columns.incident"),
              render: (row) => (
                <div className="identity-cell">
                  <span className="identity-title">{row.title}</span>
                </div>
              ),
            },
            { key: "assetCode", label: t("incidents.columns.assetCode"), render: (row) => row.assetCode },
            { key: "assetName", label: t("incidents.columns.asset"), render: (row) => row.assetName },
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

      {activeIncidentId ? (
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
        onCreateRepairCase={handleCreateRepairCaseFromIncident}
        onOpenRepairCase={handleOpenRepairCaseFromIncident}
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
      ) : null}
      </ResizableSideRailLayout>
    </div>
  );
};
