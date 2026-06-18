import { AlertTriangle, Archive, CheckCircle2, CircleDot, ExternalLink, GitCompareArrows, Pencil, PanelRightOpen, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ProjectCardRow, ProjectListQuery, ProjectSortField } from "@contracts";
import { useCompareTray } from "@app/providers/CompareTrayContext";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { IncidentReportPanel } from "@features/incidents/IncidentReportPanel";
import { reportIncident } from "@features/incidents/useIncidentsData";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ListSortMenuButton, ListToolbar } from "@shared/components/ListToolbar";
import { ModalShell } from "@shared/components/ModalShell";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { useShellContext } from "@shared/hooks/useShellContext";
import { uiPreferenceKeys } from "@shared/lib/preferences";
import { hasFinanceAccess } from "@shared/lib/financeAccess";
import { projectStatusTone, resolveProjectColor } from "@shared/lib/projectColors";
import { isPlaceholderValue } from "@shared/lib/displayValue";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import { ProjectDetailPanel } from "./ProjectDetailPanel";
import { useCatalogData, useProjectDetail, useProjectsRegistry } from "./useProjectsData";

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

const projectStatusOptions = ["Prep", "Active", "Wrapped", "On hold"] as const;

export const ProjectsPage = () => {
  const { t } = useTranslation();
  const { activeMembership, activeWorkspaceId } = useWorkspace();
  const toast = useToast();
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
  const { activeProjectId, openProject, refreshProjects, setActiveProjectId, setShowArchivedProjects, updateProject } = useShellContext();
  const { addItems } = useCompareTray();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [reportProject, setReportProject] = useState<ProjectCardRow | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [closeProjectTargets, setCloseProjectTargets] = useState<ProjectCardRow[]>([]);
  const [isClosingProjects, setIsClosingProjects] = useState(false);
  const selectedProjects = useMemo(() => data.filter((project) => selectedRowIds.includes(project.id)), [data, selectedRowIds]);
  const detailProjectId = selectedRowIds.length === 1 ? selectedRowIds[0] ?? null : selectedRowIds.length > 1 ? null : activeProjectId;
  const { data: detail, error: detailError, isLoading: detailLoading, reload: reloadDetail } = useProjectDetail(detailProjectId);
  const { data: catalog, error: catalogError } = useCatalogData();
  const selectedProject = selectedProjects.length === 1 ? selectedProjects[0] ?? null : null;
  const reportAssetOptions = reportProject && detail.project?.id === reportProject.id
    ? detail.assets.map((asset) => ({ id: asset.id, code: asset.code, name: asset.name }))
    : [];

  const addProjectsToCompare = (projects: ProjectCardRow[]) =>
    addItems(
      projects.map((project) => ({
        id: project.id,
        entityType: "project" as const,
        label: `${project.code} · ${project.name}`,
        subtitle: isPlaceholderValue(project.client)
          ? project.status
          : `${project.client} · ${project.status}`,
        meta: project.startDate || project.endDate ? `${project.startDate ?? t("projects.fallbacks.open")} - ${project.endDate ?? t("projects.fallbacks.open")}` : undefined,
      })),
    );

  const addSelectedProjectsToCompare = () => addProjectsToCompare(selectedProjects);

  const openProjectFromRegistry = (project: ProjectCardRow, section?: "overview" | "assets" | "packing" | "incidents" | "budget" | "info") => {
    if (project.isArchived) {
      setShowArchivedProjects(true);
    }

    openProject(project.id, section);
  };

  const buildProjectUpdateInput = (project: ProjectCardRow, status = project.status) => ({
    projectId: project.id,
    code: project.code,
    name: project.name,
    clientId: project.clientId ?? undefined,
    clientName: project.clientId || isPlaceholderValue(project.client) ? undefined : project.client,
    productionCompanyId: project.productionCompanyId ?? undefined,
    productionCompanyName: project.productionCompanyId || isPlaceholderValue(project.productionCompany) ? undefined : project.productionCompany,
    status,
    description: isPlaceholderValue(project.description) ? undefined : project.description,
    startDate: project.startDate ?? undefined,
    endDate: project.endDate ?? undefined,
    hasPreproduction: project.hasPreproduction,
    preproductionStartDate: project.preproductionStartDate ?? undefined,
    preproductionEndDate: project.preproductionEndDate ?? undefined,
    colorKey: project.colorKey ?? undefined,
  });

  const openProjectIncidentReport = (project: ProjectCardRow) => {
    setActiveProjectId(project.id);
    setReportProject(project);
    setReportError(null);
  };

  const openCloseProjectConfirm = (projects: ProjectCardRow[]) => {
    const closableProjects = projects.filter((project) => project.status !== "Wrapped");
    if (!closableProjects.length) {
      toast.info(t("projects.registry.closeAlreadyWrapped"));
      return;
    }

    setCloseProjectTargets(closableProjects);
  };

  const handleChangeProjectStatus = async (project: ProjectCardRow, status: ProjectCardRow["status"]) => {
    if (project.status === status) {
      return;
    }

    try {
      await updateProject(buildProjectUpdateInput(project, status));
      toast.success(
        t("projects.registry.statusChangedToast.title"),
        t("projects.registry.statusChangedToast.body", {
          name: project.name,
          status: t(`projects.statuses.${status}`, { defaultValue: status }),
        }),
      );
    } catch (nextError) {
      toast.error(
        t("projects.registry.statusChangedToast.failed"),
        getUserFacingErrorMessage(nextError, t("projects.registry.statusChangedToast.failed")),
      );
    }
  };

  const closeSelectedProjectTargets = async () => {
    try {
      setIsClosingProjects(true);
      for (const project of closeProjectTargets) {
        await updateProject(buildProjectUpdateInput(project, "Wrapped"));
      }
      setSelectedRowIds((current) => current.filter((projectId) => !closeProjectTargets.some((project) => project.id === projectId)));
      setCloseProjectTargets([]);
      toast.success(
        t("projects.registry.closeProjectToast.title"),
        t("projects.registry.closeProjectToast.body", { count: closeProjectTargets.length }),
      );
    } catch (nextError) {
      toast.error(t("projects.registry.closeProjectToast.failed"), getUserFacingErrorMessage(nextError, t("projects.registry.closeProjectToast.failed")));
    } finally {
      setIsClosingProjects(false);
    }
  };

  const handleSelectedRowIdsChange = (nextRowIds: string[]) => {
    setSelectedRowIds(nextRowIds);
    if (nextRowIds.length === 1) {
      setActiveProjectId(nextRowIds[0] ?? null);
    }
  };

  return (
    <div className="page-stack page-stack--fill projects-page-stack">
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
              disabled={!selectedProject}
              onClick={() => selectedProject ? openProjectFromRegistry(selectedProject, "info") : undefined}
              type="button"
            >
              <Pencil size={14} />
              {t("projects.registry.editProject")}
            </button>
            <button
              className="ghost-control"
              disabled={!selectedProject}
              onClick={() => selectedProject ? openProjectIncidentReport(selectedProject) : undefined}
              type="button"
            >
              <AlertTriangle size={14} />
              {t("projects.registry.reportIncident")}
            </button>
            <button
              className="ghost-control"
              disabled={!selectedProjects.some((project) => project.status !== "Wrapped")}
              onClick={() => openCloseProjectConfirm(selectedProjects)}
              type="button"
            >
              <CheckCircle2 size={14} />
              {t("projects.registry.closeProject")}
            </button>
            <button
              className="ghost-control"
              onClick={addSelectedProjectsToCompare}
              type="button"
            >
              <GitCompareArrows size={14} />
              {t("projects.registry.addToCompare")}
            </button>
            <button className="ghost-control" onClick={() => setSelectedRowIds([])} type="button">
              <X size={14} />
              {t("projects.registry.clearSelection")}
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
        <SurfaceCard className="surface-card--fill projects-registry-card" title={t("projects.registry.cardTitle")}>
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
            showSortControl={false}
          />
          {isLoading && data.length === 0 ? (
            <TableSkeleton body={t("projects.registry.loading")} columns={6} />
          ) : null}
          <DataTable
            activeRowId={activeProjectId}
            autoScrollToActiveRow
            fillParent
            columns={[
              {
                key: "project",
                label: t("projects.registry.columns.project"),
                width: 250,
                minWidth: 180,
                render: (row) => (
                  <div className="project-name-cell">
                    <span
                      aria-hidden="true"
                      className="project-color-dot"
                      style={{ background: resolveProjectColor(row.colorKey) }}
                    />
                    <div className="identity-cell">
                      <span className="identity-title">{row.name}</span>
                      <span className="identity-meta">
                        {row.code}
                        {isPlaceholderValue(row.client) ? "" : ` · ${row.client}`}
                      </span>
                    </div>
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
                    <StatusBadge tone={projectStatusTone(row.status)}>{t(`projects.statuses.${row.status}`, { defaultValue: row.status })}</StatusBadge>
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
              openProjectFromRegistry(row);
            }}
            rowActions={(row) => [
              {
                key: "edit-project",
                label: t("projects.registry.rowActions.editProject"),
                icon: <Pencil size={14} />,
                onSelect: () => openProjectFromRegistry(row, "info"),
              },
              {
                key: "report-incident",
                label: t("projects.registry.rowActions.reportIncident"),
                icon: <AlertTriangle size={14} />,
                onSelect: () => openProjectIncidentReport(row),
              },
              {
                key: "change-status",
                label: t("projects.registry.rowActions.changeStatus"),
                icon: <CircleDot size={14} />,
                children: projectStatusOptions.map((status) => ({
                  key: `change-status-${status}`,
                  label: t(`projects.statuses.${status}`, { defaultValue: status }),
                  icon: row.status === status ? <CheckCircle2 size={14} /> : <CircleDot size={14} />,
                  disabled: row.status === status,
                  onSelect: (target) => void handleChangeProjectStatus(target, status),
                })),
              },
              {
                key: "open-detail",
                label: t("projects.registry.rowActions.openDetail"),
                icon: <PanelRightOpen size={14} />,
                onSelect: () => setActiveProjectId(row.id),
              },
              {
                key: "open-project",
                label: t("projects.registry.rowActions.openProject"),
                icon: <ExternalLink size={14} />,
                onSelect: () => openProjectFromRegistry(row),
              },
              {
                key: "add-to-compare",
                label: t("projects.registry.rowActions.addToCompare"),
                icon: <GitCompareArrows size={14} />,
                onSelect: () => addProjectsToCompare([row]),
              },
            ]}
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
            controlsTrailingAddon={
              <ListSortMenuButton
                activeSortLabel={
                  projectControls.activeSortOption
                    ? t(
                        (projectControls.activeSortOption as ListSortOption<ProjectSortField> & { labelKey?: string }).labelKey ??
                          projectControls.activeSortOption.label,
                        { defaultValue: projectControls.activeSortOption.label },
                      )
                    : undefined
                }
                className="data-table-sort-trigger"
                onSortByChange={projectControls.setSortField}
                onToggleSortDirection={projectControls.toggleSortDirection}
                sortBy={projectControls.sortBy}
                sortDirection={projectControls.sortDirection}
                sortOptions={availableProjectSortOptions.map((option) => ({
                  ...option,
                  label: t(option.labelKey, { defaultValue: option.label }),
                }))}
              />
            }
            sortState={
              projectControls.activeColumnKey
                ? {
                    columnKey: projectControls.activeColumnKey,
                    direction: projectControls.sortDirection,
                  }
                : null
            }
            onSelectedRowIdsChange={handleSelectedRowIdsChange}
          />
        </SurfaceCard>

        <div className="project-detail-rail-shell">
          {selectedRowIds.length > 1 ? (
            <SurfaceCard className="project-detail-stack project-selection-detail-card" title={t("projects.registry.selectionDetail.title")}>
              <div className="project-selection-summary">
                <span>
                  <small>{t("projects.registry.selectionDetail.projects")}</small>
                  <strong>{selectedProjects.length}</strong>
                </span>
                <span>
                  <small>{t("projects.registry.selectionDetail.assets")}</small>
                  <strong>{selectedProjects.reduce((total, project) => total + project.assetCount, 0)}</strong>
                </span>
                <span>
                  <small>{t("projects.registry.selectionDetail.incidents")}</small>
                  <strong>{selectedProjects.reduce((total, project) => total + project.incidentCount, 0)}</strong>
                </span>
                <span>
                  <small>{t("projects.registry.selectionDetail.units")}</small>
                  <strong>{selectedProjects.reduce((total, project) => total + project.activeUnitCount, 0)}</strong>
                </span>
              </div>
              <p className="project-selection-helper">{t("projects.registry.selectionDetail.body")}</p>
              <div className="selection-action-buttons project-selection-actions">
                <button className="ghost-control" onClick={addSelectedProjectsToCompare} type="button">
                  <GitCompareArrows size={14} />
                  {t("projects.registry.addToCompare")}
                </button>
                <button className="ghost-control" onClick={() => setSelectedRowIds([])} type="button">
                  <X size={14} />
                  {t("projects.registry.clearSelection")}
                </button>
              </div>
              <div className="queue-list project-scroll-list">
                {selectedProjects.map((project) => (
                  <button
                    key={project.id}
                    className="queue-item queue-item-button"
                    onClick={() => {
                      setSelectedRowIds([project.id]);
                      setActiveProjectId(project.id);
                    }}
                    type="button"
                  >
                    <div className="identity-cell">
                      <span className="identity-title">{project.name}</span>
                      <span className="identity-meta">
                        {project.code}
                        {isPlaceholderValue(project.client) ? "" : ` · ${project.client}`}
                      </span>
                    </div>
                    <StatusBadge tone={projectStatusTone(project.status)}>{t(`projects.statuses.${project.status}`, { defaultValue: project.status })}</StatusBadge>
                  </button>
                ))}
              </div>
            </SurfaceCard>
          ) : (
            <ProjectDetailPanel data={detail} error={detailError} isLoading={detailLoading} onIncidentCreated={reloadDetail} />
          )}
        </div>
      </ResizableSideRailLayout>

      {reportProject ? (
        <ModalShell
          onClose={() => {
            setReportProject(null);
            setReportError(null);
          }}
        >
          <IncidentReportPanel
            assetOptions={reportAssetOptions}
            departments={catalog.departments}
            error={reportError ?? (catalogError ? t("incidents.catalogUnavailable", { message: catalogError }) : null)}
            initialValue={{
              projectId: reportProject.id,
              severity: "Medium",
            }}
            isSubmitting={isSubmittingReport}
            onClose={() => {
              setReportProject(null);
              setReportError(null);
            }}
            onSubmit={async (value) => {
              try {
                setIsSubmittingReport(true);
                const result = await reportIncident({
                  commandId: crypto.randomUUID(),
                  workspaceId: activeWorkspaceId,
                  assetId: value.assetId,
                  projectId: value.projectId ?? reportProject.id,
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

                await Promise.all([reloadDetail(), refreshProjects()]);
                setReportProject(null);
                setReportError(null);
                toast.success(t("incidents.toasts.reported"), result.summary);
              } catch (nextError) {
                setReportError(getUserFacingErrorMessage(nextError, t("incidents.toasts.createFailed")));
              } finally {
                setIsSubmittingReport(false);
              }
            }}
            projectLocked
            projects={data}
            users={catalog.users}
          />
        </ModalShell>
      ) : null}

      <ConfirmDialog
        body={t("projects.registry.closeProjectDialog.body", { count: closeProjectTargets.length })}
        confirmLabel={t("projects.registry.closeProjectDialog.confirm")}
        isOpen={closeProjectTargets.length > 0}
        isSubmitting={isClosingProjects}
        onCancel={() => {
          if (!isClosingProjects) {
            setCloseProjectTargets([]);
          }
        }}
        onConfirm={closeSelectedProjectTargets}
        title={t("projects.registry.closeProjectDialog.title", { count: closeProjectTargets.length })}
      />
    </div>
  );
};
