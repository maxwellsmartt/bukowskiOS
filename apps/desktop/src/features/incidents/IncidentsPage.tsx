import { useEffect, useState } from "react";
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

const incidentSortOptions: Array<ListSortOption<IncidentSortField>> = [
  { value: "reportedAt", label: "Reported date" },
  { value: "title", label: "Title", columnKey: "title" },
  { value: "asset", label: "Asset", columnKey: "title" },
  { value: "project", label: "Project", columnKey: "project" },
  { value: "responsible", label: "Responsible", columnKey: "responsible" },
  { value: "severity", label: "Severity", columnKey: "severity" },
  { value: "costEstimate", label: "Cost estimate", columnKey: "cost" },
  { value: "status", label: "Status", columnKey: "status" },
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
  const [incidentDetailFeedback, setIncidentDetailFeedback] = useState<string | null>(null);
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
      <SectionHeader title="Incidents" />

      {error ? <div className="empty-state">Incidents unavailable: {error}</div> : null}
      {catalogError ? <div className="empty-state">Incident catalog unavailable: {catalogError}</div> : null}
      {!isProjectMode && rmaError ? <div className="empty-state">Repair cases unavailable: {rmaError}</div> : null}

      <div className="selection-action-bar">
        <div className="selection-action-copy">
          <span className="selection-action-title">Report an issue</span>
          <span className="selection-action-subtitle">
            {isProjectMode
              ? effectiveProjectName ?? "This project"
              : "Track open issues and repair follow-up."}
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
          Report incident
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
              toast.success("Incident reported", result.summary);
              setIncidentDetailFeedback(null);
            } catch (nextError) {
              setReportError(getUserFacingErrorMessage(nextError, "Unable to create incident."));
            } finally {
              setIsSubmittingIncident(false);
            }
          }}
          projects={projects}
          users={catalog.users}
        />
      ) : null}

      <SurfaceCard title="Incidents">
        <ListToolbar
          activeSortLabel={incidentControls.activeSortOption?.label}
          onSearchValueChange={incidentControls.setSearchValue}
          onSortByChange={incidentControls.setSortField}
          onToggleSortDirection={incidentControls.toggleSortDirection}
          resultCount={data.length}
          resultLabel="incidents"
          searchPlaceholder={isProjectMode ? "Search incidents, assets or crew" : "Search incidents, projects or crew"}
          searchValue={incidentControls.searchValue}
          sortBy={incidentControls.sortBy}
          sortDirection={incidentControls.sortDirection}
          sortOptions={incidentSortOptions}
        />
        {isLoading && data.length === 0 ? (
          <TableSkeleton body="Loading incidents…" columns={6} />
        ) : null}
        <DataTable
          activeRowId={activeIncidentId}
          autoScrollToActiveRow
          getRowId={(row) => row.id}
          maxHeight="min(60vh, 640px)"
          onRowClick={(row) => {
            setActiveIncidentId(row.id);
            setIncidentDetailError(null);
            setIncidentDetailFeedback(null);
          }}
          onSortRequest={incidentControls.handleColumnSortRequest}
          persistKey="incidents-queue"
          columns={[
            {
              key: "title",
              label: "Incident",
              render: (row) => (
                <div className="identity-cell">
                  <span className="identity-title">{row.title}</span>
                  <span className="identity-meta">{row.asset}</span>
                </div>
              ),
            },
            { key: "project", label: "Project", render: (row) => row.project },
            { key: "responsible", label: "Responsible", render: (row) => row.responsible },
            {
              key: "severity",
              label: "Severity",
              render: (row) => (
                <StatusBadge tone={row.severity === "High" ? "critical" : row.severity === "Medium" ? "warning" : "neutral"}>
                  {row.severity}
                </StatusBadge>
              ),
            },
            { key: "cost", label: "Cost estimate", render: (row) => row.costEstimate },
            {
              key: "status",
              label: "Status",
              render: (row) => <StatusBadge tone={resolveIncidentStatusTone(row.status)}>{row.status}</StatusBadge>,
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
        feedback={incidentDetailFeedback}
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
          setIncidentDetailFeedback(null);
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
            setIncidentDetailFeedback(result.summary);
          } catch (nextError) {
            setIncidentDetailError(getUserFacingErrorMessage(nextError, "Unable to resolve incident."));
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
            setIncidentDetailFeedback(result.summary);
          } catch (nextError) {
            setIncidentDetailError(getUserFacingErrorMessage(nextError, "Unable to update incident."));
          } finally {
            setIsSubmittingIncidentDetail(false);
          }
        }}
        users={catalog.users}
      />

      {!isProjectMode ? (
        <SurfaceCard
          title="Repair cases"
          subtitle="Manufacturer RMAs and warranty claims now live on their own page."
          aside={
            <button className="action-primary-button" onClick={() => navigate("/rma")} type="button">
              Open repair cases
            </button>
          }
        >
          <p className="surface-card-subtitle">
            From an incident detail, use “Open repair case” to jump straight there with the asset pre-selected.
          </p>
        </SurfaceCard>
      ) : null}

    </div>
  );
};
