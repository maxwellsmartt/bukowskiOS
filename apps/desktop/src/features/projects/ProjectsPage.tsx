import { useState } from "react";

import type { ProjectListQuery, ProjectSortField } from "@contracts";
import { useCompareTray } from "@app/providers/CompareTrayContext";
import { DataTable } from "@shared/components/DataTable";
import { ListToolbar } from "@shared/components/ListToolbar";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { useShellContext } from "@shared/hooks/useShellContext";

import { ProjectDetailPanel } from "./ProjectDetailPanel";
import { useProjectDetail, useProjectsRegistry } from "./useProjectsData";

const projectSortOptions: Array<ListSortOption<ProjectSortField>> = [
  { value: "name", label: "Project name", columnKey: "project" },
  { value: "code", label: "Code" },
  { value: "client", label: "Client" },
  { value: "status", label: "Status", columnKey: "status" },
  { value: "startDate", label: "Start date", columnKey: "startDate" },
  { value: "endDate", label: "End date", columnKey: "endDate" },
  { value: "activeUnitCount", label: "Units", columnKey: "activeUnitCount" },
  { value: "assetCount", label: "Asset count", columnKey: "assets" },
  { value: "incidentCount", label: "Incident count", columnKey: "incidents" },
  { value: "exposure", label: "Exposure", columnKey: "exposure" },
  { value: "updatedAt", label: "Updated" },
  { value: "createdAt", label: "Created" },
];

export const ProjectsPage = () => {
  const [showArchived, setShowArchived] = useState(false);
  const projectControls = useListControls<ProjectSortField, ProjectListQuery>({
    viewKey: "projects-registry-list",
    defaults: {
      search: "",
      sortBy: "name",
      sortDirection: "asc",
    },
    sortOptions: projectSortOptions,
    defaultDirectionBySort: {
      activeUnitCount: "desc",
      assetCount: "desc",
      incidentCount: "desc",
      exposure: "desc",
      updatedAt: "desc",
      createdAt: "desc",
      startDate: "asc",
      endDate: "asc",
    },
    buildQuery: ({ search, sortBy, sortDirection }) => ({
      search,
      sortBy,
      sortDirection,
      includeArchived: showArchived,
    }),
  });
  const { data, error } = useProjectsRegistry(projectControls.query);
  const { activeProjectId, openProject, setActiveProjectId, setShowArchivedProjects } = useShellContext();
  const { addItems, hasItem } = useCompareTray();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const { data: detail, error: detailError, isLoading: detailLoading, reload: reloadDetail } = useProjectDetail(activeProjectId);

  return (
    <div className="page-stack">
      <SectionHeader title="Projects" />

      {error ? <div className="empty-state">Projects unavailable: {error}</div> : null}

      <div className="chip-row">
        <StatusBadge tone="success">{data.filter((project) => hasItem("project", project.id)).length} in compare</StatusBadge>
        {selectedRowIds.length ? <StatusBadge>{`${selectedRowIds.length} selected`}</StatusBadge> : null}
        <button className={`ghost-control${showArchived ? " is-active" : ""}`} onClick={() => setShowArchived((current) => !current)} type="button">
          {showArchived ? "Hide archived" : "Show archived"}
        </button>
      </div>

      {selectedRowIds.length ? (
        <div className="selection-action-bar">
          <div className="selection-action-copy">
            <span className="selection-action-title">
              {selectedRowIds.length === 1 ? "1 project selected" : `${selectedRowIds.length} projects selected`}
            </span>
            <span className="selection-action-subtitle">Add projects to compare for side-by-side schedule, resource and budget review.</span>
          </div>
          <div className="selection-action-buttons">
            <button
              className="ghost-control"
              onClick={() =>
                addItems(
                  data
                    .filter((project) => selectedRowIds.includes(project.id))
                    .map((project) => ({
                      id: project.id,
                      entityType: "project" as const,
                      label: `${project.code} · ${project.name}`,
                      subtitle: `${project.client} · ${project.status}`,
                      meta: project.startDate || project.endDate ? `${project.startDate ?? "Open"} - ${project.endDate ?? "Open"}` : undefined,
                    })),
                )
              }
              type="button"
            >
              Add to compare
            </button>
          </div>
        </div>
      ) : null}

      <div className="projects-layout">
        <SurfaceCard title="Projects">
          <ListToolbar
            activeSortLabel={projectControls.activeSortOption?.label}
            onSearchValueChange={projectControls.setSearchValue}
            onSortByChange={projectControls.setSortField}
            onToggleSortDirection={projectControls.toggleSortDirection}
            resultCount={data.length}
            resultLabel="projects"
            searchPlaceholder="Search projects, clients or departments"
            searchValue={projectControls.searchValue}
            sortBy={projectControls.sortBy}
            sortDirection={projectControls.sortDirection}
            sortOptions={projectSortOptions}
          />
          <DataTable
            activeRowId={activeProjectId}
            autoScrollToActiveRow
            columns={[
              {
                key: "project",
                label: "Project",
                width: 250,
                minWidth: 180,
                render: (row) => (
                  <div className="identity-cell">
                    <span className="identity-title">{row.name}</span>
                    <span className="identity-meta">
                      {row.code} · {row.client}
                    </span>
                  </div>
                ),
              },
              {
                key: "status",
                label: "Status",
                width: 132,
                minWidth: 86,
                render: (row) => (
                  <div className="status-stack-cell">
                    <StatusBadge>{row.status}</StatusBadge>
                    {row.isArchived ? <StatusBadge tone="warning">Archived</StatusBadge> : null}
                  </div>
                ),
              },
              {
                key: "startDate",
                label: "Start",
                width: 108,
                minWidth: 92,
                render: (row) => row.startDate ?? "—",
              },
              {
                key: "endDate",
                label: "End",
                width: 108,
                minWidth: 92,
                render: (row) => row.endDate ?? "—",
              },
              {
                key: "colorKey",
                label: "Color",
                width: 94,
                minWidth: 82,
                render: (row) => row.colorKey ?? "Default",
              },
              {
                key: "activeUnitCount",
                label: "Units",
                align: "right",
                width: 74,
                minWidth: 62,
                render: (row) => row.activeUnitCount,
              },
              { key: "assets", label: "Assets", align: "right", width: 80, minWidth: 68, render: (row) => row.assetCount },
              {
                key: "incidents",
                label: "Incidents",
                align: "right",
                width: 88,
                minWidth: 74,
                render: (row) => row.incidentCount,
              },
              { key: "departments", label: "Departments", width: 210, minWidth: 170, render: (row) => row.departments },
              { key: "exposure", label: "Exposure", align: "right", width: 110, minWidth: 96, render: (row) => row.exposure },
              { key: "description", label: "Description", width: 260, minWidth: 220, render: (row) => row.description },
            ]}
            getRowId={(row) => row.id}
            maxHeight="min(72vh, 760px)"
            onRowClick={(row) => setActiveProjectId(row.id)}
            onRowDoubleClick={(row) => {
              if (row.isArchived) {
                setShowArchivedProjects(true);
              }

              openProject(row.id);
            }}
            onSortRequest={projectControls.handleColumnSortRequest}
            persistKey="projects-registry"
            rows={data}
            selectable
            selectedRowIds={selectedRowIds}
            sortState={
              projectControls.activeColumnKey
                ? {
                    columnKey: projectControls.activeColumnKey,
                    direction: projectControls.sortDirection,
                  }
                : null
            }
            onSelectedRowIdsChange={setSelectedRowIds}
          />
        </SurfaceCard>

        <ProjectDetailPanel data={detail} error={detailError} isLoading={detailLoading} onIncidentCreated={reloadDetail} />
      </div>
    </div>
  );
};
