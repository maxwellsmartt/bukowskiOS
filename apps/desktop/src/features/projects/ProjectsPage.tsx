import { Archive } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ProjectCardRow, ProjectListQuery, ProjectSortField } from "@contracts";
import { useCompareTray } from "@app/providers/CompareTrayContext";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ListToolbar } from "@shared/components/ListToolbar";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { useShellContext } from "@shared/hooks/useShellContext";
import { uiPreferenceKeys } from "@shared/lib/preferences";
import { hasFinanceAccess } from "@shared/lib/financeAccess";

import { ProjectDetailPanel } from "./ProjectDetailPanel";
import { useProjectDetail, useProjectsRegistry } from "./useProjectsData";

const projectSortOptions: Array<ListSortOption<ProjectSortField> & { labelKey: string }> = [
  { value: "name", label: "Project name", labelKey: "projects.registry.sort.name", columnKey: "project" },
  { value: "code", label: "Code", labelKey: "projects.registry.sort.code" },
  { value: "client", label: "Client", labelKey: "projects.registry.sort.client" },
  { value: "status", label: "Status", labelKey: "projects.registry.sort.status", columnKey: "status" },
  { value: "startDate", label: "Start date", labelKey: "projects.registry.sort.startDate", columnKey: "startDate" },
  { value: "endDate", label: "End date", labelKey: "projects.registry.sort.endDate", columnKey: "endDate" },
  { value: "activeUnitCount", label: "Units", labelKey: "projects.registry.sort.activeUnitCount", columnKey: "activeUnitCount" },
  { value: "assetCount", label: "Asset count", labelKey: "projects.registry.sort.assetCount", columnKey: "assets" },
  { value: "incidentCount", label: "Incident count", labelKey: "projects.registry.sort.incidentCount", columnKey: "incidents" },
  { value: "exposure", label: "Exposure", labelKey: "projects.registry.sort.exposure", columnKey: "exposure" },
  { value: "updatedAt", label: "Updated", labelKey: "projects.registry.sort.updatedAt" },
  { value: "createdAt", label: "Created", labelKey: "projects.registry.sort.createdAt" },
];

export const ProjectsPage = () => {
  const { t } = useTranslation();
  const { activeMembership, activeWorkspaceId } = useWorkspace();
  const canAccessFinance = hasFinanceAccess(activeMembership);
  const availableProjectSortOptions = useMemo(
    () => (canAccessFinance ? projectSortOptions : projectSortOptions.filter((option) => option.value !== "exposure")),
    [canAccessFinance],
  );
  const [showArchived, setShowArchived] = useState(false);
  const projectControls = useListControls<ProjectSortField, ProjectListQuery>({
    viewKey: "projects-registry-list",
    defaults: {
      search: "",
      sortBy: "name",
      sortDirection: "asc",
    },
    sortOptions: availableProjectSortOptions,
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
      workspaceId: activeWorkspaceId,
      search,
      sortBy,
      sortDirection,
      includeArchived: showArchived,
    }),
  });
  const { data, error, isLoading } = useProjectsRegistry(projectControls.query);
  const { activeProjectId, openProject, setActiveProjectId, setShowArchivedProjects } = useShellContext();
  const { addItems, hasItem } = useCompareTray();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const { data: detail, error: detailError, isLoading: detailLoading, reload: reloadDetail } = useProjectDetail(activeProjectId);

  return (
    <div className="page-stack">
      <SectionHeader title={t("projects.registry.title")} />

      {error ? <div className="empty-state">{t("projects.registry.unavailable", { message: error })}</div> : null}

      <div className="chip-row">
        {selectedRowIds.length ? <StatusBadge>{t("projects.registry.selected", { count: selectedRowIds.length })}</StatusBadge> : null}
      </div>

      {selectedRowIds.length ? (
        <div className="selection-action-bar">
          <div className="selection-action-copy">
            <span className="selection-action-title">
              {t("projects.registry.projectsSelected", { count: selectedRowIds.length })}
            </span>
            <span className="selection-action-subtitle">{t("projects.registry.compareSubtitle")}</span>
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
                      meta: project.startDate || project.endDate ? `${project.startDate ?? t("projects.fallbacks.open")} - ${project.endDate ?? t("projects.fallbacks.open")}` : undefined,
                    })),
                )
              }
              type="button"
            >
              {t("projects.registry.addToCompare")}
            </button>
          </div>
        </div>
      ) : null}

      <ResizableSideRailLayout
        className="projects-layout"
        defaultWidth={520}
        maxWidth={760}
        minWidth={360}
        storageKey={uiPreferenceKeys.projectsSideRailWidth}
      >
        <SurfaceCard className="projects-registry-card" title={t("projects.registry.cardTitle")}>
          <ListToolbar
            activeSortLabel={
              projectControls.activeSortOption
                ? t(
                    (projectControls.activeSortOption as ListSortOption<ProjectSortField> & { labelKey?: string }).labelKey ??
                      projectControls.activeSortOption.label,
                    { defaultValue: projectControls.activeSortOption.label },
                  )
                : undefined
            }
            onSearchValueChange={projectControls.setSearchValue}
            onSortByChange={projectControls.setSortField}
            onToggleSortDirection={projectControls.toggleSortDirection}
            resultCount={data.length}
            resultLabel={t("projects.registry.resultLabel")}
            searchPlaceholder={t("projects.registry.searchPlaceholder")}
            searchValue={projectControls.searchValue}
            sortBy={projectControls.sortBy}
            sortDirection={projectControls.sortDirection}
            sortOptions={availableProjectSortOptions.map((option) => ({
              ...option,
              label: t(option.labelKey, { defaultValue: option.label }),
            }))}
          />
          {isLoading && data.length === 0 ? (
            <TableSkeleton body={t("projects.registry.loading")} columns={6} />
          ) : null}
          <DataTable
            activeRowId={activeProjectId}
            autoScrollToActiveRow
            columns={[
              {
                key: "project",
                label: t("projects.registry.columns.project"),
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
                label: t("projects.registry.columns.status"),
                width: 132,
                minWidth: 86,
                render: (row) => (
                  <div className="status-stack-cell">
                    <StatusBadge>{t(`projects.statuses.${row.status}`, { defaultValue: row.status })}</StatusBadge>
                    {row.isArchived ? <StatusBadge tone="warning">{t("projects.statuses.Archived")}</StatusBadge> : null}
                  </div>
                ),
              },
              {
                key: "startDate",
                label: t("projects.registry.columns.start"),
                width: 108,
                minWidth: 92,
                render: (row) => row.startDate ?? "—",
              },
              {
                key: "endDate",
                label: t("projects.registry.columns.end"),
                width: 108,
                minWidth: 92,
                render: (row) => row.endDate ?? "—",
              },
              {
                key: "colorKey",
                label: t("projects.registry.columns.color"),
                width: 94,
                minWidth: 82,
                render: (row) => row.colorKey ?? t("projects.fallbacks.default"),
              },
              {
                key: "activeUnitCount",
                label: t("projects.registry.columns.units"),
                align: "right",
                width: 74,
                minWidth: 62,
                render: (row) => row.activeUnitCount,
              },
              { key: "assets", label: t("projects.registry.columns.assets"), align: "right", width: 80, minWidth: 68, render: (row) => row.assetCount },
              {
                key: "incidents",
                label: t("projects.registry.columns.incidents"),
                align: "right",
                width: 88,
                minWidth: 74,
                render: (row) => row.incidentCount,
              },
              { key: "departments", label: t("projects.registry.columns.departments"), width: 210, minWidth: 170, render: (row) => row.departments },
              ...(canAccessFinance
                ? [
                    {
                      key: "exposure",
                      label: t("projects.registry.columns.exposure"),
                      align: "right" as const,
                      width: 110,
                      minWidth: 96,
                      render: (row: ProjectCardRow) => row.exposure,
                    },
                  ]
                : []),
              { key: "description", label: t("projects.registry.columns.description"), width: 260, minWidth: 220, render: (row) => row.description },
            ]}
            emptyContent={
              <GuidedEmptyState
                title={projectControls.searchValue ? t("projects.registry.empty.noMatchesTitle") : t("projects.registry.empty.noProjectsTitle")}
                body={
                  projectControls.searchValue
                    ? t("projects.registry.empty.noMatchesBody")
                    : t("projects.registry.empty.noProjectsBody")
                }
                tone="subtle"
                actionLabel={projectControls.searchValue ? t("projects.registry.empty.clearSearch") : undefined}
                onAction={projectControls.searchValue ? () => projectControls.setSearchValue("") : undefined}
                tips={
                  projectControls.searchValue
                    ? undefined
                    : [
                        t("projects.registry.empty.tipCreate"),
                        t("projects.registry.empty.tipUnits"),
                        t("projects.registry.empty.tipArchive"),
                      ]
                }
              />
            }
            getRowId={(row) => row.id}
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
            shellClassName="table-shell-fill"
            selectable
            selectedRowIds={selectedRowIds}
            controlsAddon={
              <button
                aria-label={showArchived ? t("projects.registry.hideArchived") : t("projects.registry.showArchived")}
                className={`icon-ghost-control${showArchived ? " is-active" : ""}`}
                onClick={() => setShowArchived((current) => !current)}
                type="button"
              >
                <Archive size={14} />
              </button>
            }
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
      </ResizableSideRailLayout>
    </div>
  );
};
