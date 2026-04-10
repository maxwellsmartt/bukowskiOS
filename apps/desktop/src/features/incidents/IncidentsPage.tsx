import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { AssetListQuery, IncidentListQuery, IncidentSortField } from "@contracts";
import { useAssetsList } from "@features/assets/useAssetsData";
import { useCatalogData } from "@features/projects/useProjectsData";
import { DataTable } from "@shared/components/DataTable";
import { ListToolbar } from "@shared/components/ListToolbar";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { useShellContext } from "@shared/hooks/useShellContext";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";

import { IncidentReportPanel } from "./IncidentReportPanel";
import { reportIncident, useIncidentsData } from "./useIncidentsData";

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

export const IncidentsPage = ({ projectId = null, projectName = null }: IncidentsPageProps) => {
  const { activeProject, projects, refreshProjects } = useShellContext();
  const isProjectMode = Boolean(projectId);
  const effectiveProjectName = projectName ?? (isProjectMode ? activeProject?.name ?? null : null);
  const sectionScopeLabel = useSectionScopeLabel();
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
      scopeProjectId: projectId,
      search,
      sortBy,
      sortDirection,
    }),
  });
  const { data, error, reload } = useIncidentsData(incidentControls.query);
  const { data: assets } = useAssetsList({
    scopeProjectId: projectId,
    search: "",
    sortBy: "name",
    sortDirection: "asc",
  } satisfies AssetListQuery);
  const { data: catalog, error: catalogError } = useCatalogData();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeIncidentId, setActiveIncidentId] = useState<string | null>(null);
  const focusedIncidentId = searchParams.get("focus");

  useEffect(() => {
    if (focusedIncidentId && data.some((row) => row.id === focusedIncidentId)) {
      setActiveIncidentId(focusedIncidentId);
    }
  }, [data, focusedIncidentId]);

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow={isProjectMode ? "Project / Incidents" : "Incidents"}
        title={isProjectMode ? "Project incident queue" : "Incident queue"}
        body={
          isProjectMode
            ? "Damage, loss and malfunction reports currently linked to this project and ready for follow-up."
            : "Damage, loss and malfunction reports with operational context and cost visibility."
        }
        contextLabel={sectionScopeLabel}
      />

      {error ? <div className="empty-state">Incidents unavailable: {error}</div> : null}
      {catalogError ? <div className="empty-state">Incident catalog unavailable: {catalogError}</div> : null}

      <div className="selection-action-bar">
        <div className="selection-action-copy">
          <span className="selection-action-title">Report incidents from here</span>
          <span className="selection-action-subtitle">
            {isProjectMode
              ? `Create reports inside ${effectiveProjectName ?? "this project"} and keep them linked to the right context.`
              : "Create reports here or from Asset and Project detail."}
          </span>
        </div>
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

      {reportFeedback ? <div className="action-feedback action-feedback-success">{reportFeedback}</div> : null}

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
          isSubmitting={isSubmitting}
          projectLocked={isProjectMode}
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
              setReportFeedback(result.summary);
            } catch (nextError) {
              setReportError(nextError instanceof Error ? nextError.message : "Unable to create incident.");
            } finally {
              setIsSubmitting(false);
            }
          }}
          projects={projects}
          users={catalog.users}
        />
      ) : null}

      <SurfaceCard title="Open and recent incidents" subtitle="Severity, responsibility and estimated cost in one view.">
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
        <DataTable
          activeRowId={activeIncidentId}
          autoScrollToActiveRow
          getRowId={(row) => row.id}
          maxHeight="min(60vh, 640px)"
          onRowClick={(row) => setActiveIncidentId(row.id)}
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
              render: (row) => <StatusBadge tone={row.status === "Open" ? "warning" : "info"}>{row.status}</StatusBadge>,
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
    </div>
  );
};
