import { Mail, Plus, SquarePen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { AssetListQuery, IncidentListQuery, IncidentSortField, RmaCaseDetailSnapshot, RmaCaseStatus } from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useAssetsList } from "@features/assets/useAssetsData";
import { buildAvailableRmaAssets, RmaCaseEditorPanel, type RmaCaseEditorDraft } from "@features/rma/RmaCaseEditorPanel";
import { createRmaCase, updateRmaCase, useRmaCaseDetail, useRmaSnapshot } from "@features/rma/useRmaData";
import { useCatalogData } from "@features/projects/useProjectsData";
import { DataTable } from "@shared/components/DataTable";
import { ListToolbar } from "@shared/components/ListToolbar";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { type ListSortOption, useListControls } from "@shared/hooks/useListControls";
import { useShellContext } from "@shared/hooks/useShellContext";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";
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

const resolveRmaStatusTone = (status: RmaCaseStatus) => {
  if (status === "Repaired" || status === "Returned to inventory") {
    return "success" as const;
  }

  if (status === "Sent to repair" || status === "Waiting parts") {
    return "info" as const;
  }

  if (status === "No repair / retired") {
    return "critical" as const;
  }

  return "warning" as const;
};

const rmaStatusActions: Array<{ status: RmaCaseStatus; label: string }> = [
  { status: "Sent to repair", label: "Send to repair" },
  { status: "Waiting parts", label: "Waiting parts" },
  { status: "Repaired", label: "Mark repaired" },
  { status: "No repair / retired", label: "No repair" },
  { status: "Returned to inventory", label: "Return to inventory" },
];

const buildRmaMailtoUrl = (detail: RmaCaseDetailSnapshot) => {
  if (!detail.caseRecord) {
    return "";
  }

  const subject = detail.caseRecord.title;
  const lines = [
    `Hello ${detail.caseRecord.contactName || detail.caseRecord.manufacturerName} team,`,
    "",
    detail.caseRecord.problemSummary,
    "",
    "Assets included:",
    ...detail.assets.map(
      (asset, index) =>
        `${index + 1}. ${asset.assetName} | ${[asset.brand, asset.model].filter(Boolean).join(" ")} | Serial: ${asset.serialNumber || "Pending"} | Year: ${asset.equipmentYear || "Pending"} | Issue: ${asset.issueSummary}`,
    ),
    "",
    detail.caseRecord.notes ? `Internal notes / context:\n${detail.caseRecord.notes}\n` : "",
    "Please confirm next steps and support instructions.",
  ].filter(Boolean);

  return `mailto:${detail.caseRecord.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
};

export const IncidentsPage = ({ projectId = null, projectName = null }: IncidentsPageProps) => {
  const navigate = useNavigate();
  const { activeWorkspaceId } = useWorkspace();
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
      workspaceId: activeWorkspaceId,
      scopeProjectId: projectId,
      search,
      sortBy,
      sortDirection,
    }),
  });
  const { data, error, reload } = useIncidentsData(incidentControls.query);
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
  const { data: rmaSnapshot, error: rmaError, reload: reloadRma } = useRmaSnapshot({ workspaceId: activeWorkspaceId });
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [isSubmittingIncident, setIsSubmittingIncident] = useState(false);
  const [activeIncidentId, setActiveIncidentId] = useState<string | null>(null);
  const [incidentDetailFeedback, setIncidentDetailFeedback] = useState<string | null>(null);
  const [incidentDetailError, setIncidentDetailError] = useState<string | null>(null);
  const [isSubmittingIncidentDetail, setIsSubmittingIncidentDetail] = useState(false);
  const [activeRmaCaseId, setActiveRmaCaseId] = useState<string | null>(null);
  const [pendingRmaCaseId, setPendingRmaCaseId] = useState<string | null>(null);
  const [rmaEditorMode, setRmaEditorMode] = useState<"create" | "edit" | null>(null);
  const [rmaEditorError, setRmaEditorError] = useState<string | null>(null);
  const [rmaFeedback, setRmaFeedback] = useState<string | null>(null);
  const [isSubmittingRma, setIsSubmittingRma] = useState(false);
  const { data: rmaDetail, error: rmaDetailError, isLoading: rmaDetailLoading, reload: reloadRmaDetail } = useRmaCaseDetail(activeRmaCaseId);
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

  useEffect(() => {
    if (isProjectMode || isSubmittingRma) {
      return;
    }

    if (pendingRmaCaseId && activeRmaCaseId === pendingRmaCaseId && !rmaSnapshot.cases.some((row) => row.id === pendingRmaCaseId)) {
      return;
    }

    if (!rmaSnapshot.cases.length) {
      setActiveRmaCaseId(null);
      return;
    }

    if (activeRmaCaseId && rmaSnapshot.cases.some((row) => row.id === activeRmaCaseId)) {
      return;
    }

    setActiveRmaCaseId(rmaSnapshot.cases[0]?.id ?? null);
  }, [activeRmaCaseId, isProjectMode, isSubmittingRma, pendingRmaCaseId, rmaSnapshot.cases]);

  useEffect(() => {
    if (pendingRmaCaseId && rmaSnapshot.cases.some((row) => row.id === pendingRmaCaseId)) {
      setPendingRmaCaseId(null);
    }
  }, [pendingRmaCaseId, rmaSnapshot.cases]);

  const availableRmaAssets = useMemo(
    () => buildAvailableRmaAssets(rmaSnapshot.maintenanceAssets, rmaEditorMode === "edit" ? rmaDetail : null),
    [rmaDetail, rmaEditorMode, rmaSnapshot.maintenanceAssets],
  );

  const handleSubmitRma = async (draft: RmaCaseEditorDraft) => {
    try {
      setIsSubmittingRma(true);

      if (rmaEditorMode === "edit" && rmaDetail.caseRecord) {
        const result = await updateRmaCase({
          commandId: crypto.randomUUID(),
          workspaceId: activeWorkspaceId,
          rmaCaseId: rmaDetail.caseRecord.id,
          manufacturerId: draft.manufacturerId,
          supportEmail: draft.supportEmail,
          title: draft.title,
          problemSummary: draft.problemSummary,
          notes: draft.notes,
          status: draft.status,
          assetItems: draft.assetItems,
          actorType: "user",
          sourceChannel: "desktop",
        });

        await Promise.all([reloadRma(), reloadRmaDetail()]);
        setRmaFeedback(result.summary);
      } else {
        const result = await createRmaCase({
          commandId: crypto.randomUUID(),
          workspaceId: activeWorkspaceId,
          manufacturerId: draft.manufacturerId,
          supportEmail: draft.supportEmail,
          title: draft.title,
          problemSummary: draft.problemSummary,
          notes: draft.notes,
          assetItems: draft.assetItems,
          actorType: "user",
          sourceChannel: "desktop",
        });

        await reloadRma();
        setPendingRmaCaseId(result.rmaCaseId);
        setActiveRmaCaseId(result.rmaCaseId);
        setRmaFeedback(result.summary);
      }

      setRmaEditorError(null);
      setRmaEditorMode(null);
    } catch (nextError) {
      setRmaEditorError(getUserFacingErrorMessage(nextError, "Unable to save repair case."));
    } finally {
      setIsSubmittingRma(false);
    }
  };

  const handleUpdateRmaStatus = async (nextStatus: RmaCaseStatus) => {
    if (!rmaDetail.caseRecord) {
      return;
    }

    try {
      setIsSubmittingRma(true);
      const result = await updateRmaCase({
        commandId: crypto.randomUUID(),
        workspaceId: activeWorkspaceId,
        rmaCaseId: rmaDetail.caseRecord.id,
        manufacturerId: rmaDetail.caseRecord.manufacturerId,
        supportEmail: rmaDetail.caseRecord.supportEmail,
        title: rmaDetail.caseRecord.title,
        problemSummary: rmaDetail.caseRecord.problemSummary,
        notes: rmaDetail.caseRecord.notes,
        status: nextStatus,
        assetItems: rmaDetail.assets.map((asset) => ({
          assetId: asset.assetId,
          equipmentYear: asset.equipmentYear || undefined,
          issueSummary: asset.issueSummary,
        })),
        actorType: "user",
        sourceChannel: "desktop",
      });

      await Promise.all([reloadRma(), reloadRmaDetail()]);
      setRmaFeedback(result.summary);
      setRmaEditorError(null);
    } catch (nextError) {
      setRmaEditorError(getUserFacingErrorMessage(nextError, "Unable to update repair status."));
    } finally {
      setIsSubmittingRma(false);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader
        title="Incidents"
        contextLabel={isProjectMode ? sectionScopeLabel ?? undefined : undefined}
      />

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
            setReportFeedback(null);
          }}
          type="button"
        >
          Report incident
        </button>
      </div>

      {reportFeedback ? <div className="action-feedback action-feedback-success">{reportFeedback}</div> : null}
      {rmaFeedback ? <div className="action-feedback action-feedback-success">{rmaFeedback}</div> : null}

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
              setReportFeedback(result.summary);
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
        onClose={() => {
          setActiveIncidentId(null);
          setIncidentDetailError(null);
          setIncidentDetailFeedback(null);
        }}
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
        <>
          <SurfaceCard
            title="Maintenance watch"
          >
            <DataTable
              getRowId={(row) => row.id}
              maxHeight="min(36vh, 300px)"
              persistKey="maintenance-watch"
              columns={[
                {
                  key: "asset",
                  label: "Asset",
                  render: (row) => (
                    <div className="identity-cell">
                      <span className="identity-title">{row.name}</span>
                      <span className="identity-meta">{[row.brand, row.model].filter(Boolean).join(" · ") || "Model pending"}</span>
                    </div>
                  ),
                },
                { key: "serial", label: "Serial", render: (row) => row.serialNumber || "Pending" },
                { key: "location", label: "Location", render: (row) => row.location },
                { key: "issue", label: "Latest issue", render: (row) => row.latestIssue },
              ]}
              rows={rmaSnapshot.maintenanceAssets}
            />
          </SurfaceCard>

          <ResizableSideRailLayout className="split-layout" defaultWidth={420} maxWidth={680} minWidth={320} storageKey="rma-side-rail-width">
            <SurfaceCard
              aside={
                <button
                  className="action-primary-button"
                  onClick={() => {
                    setRmaEditorMode("create");
                    setRmaEditorError(null);
                  }}
                  type="button"
                >
                  <Plus size={14} />
                  <span>New repair case</span>
                </button>
              }
              title="Repair cases"
            >
              <DataTable
                activeRowId={activeRmaCaseId}
                autoScrollToActiveRow
                getRowId={(row) => row.id}
                maxHeight="min(54vh, 560px)"
                persistKey="rma-cases"
                columns={[
                  {
                    key: "title",
                    label: "Case",
                    render: (row) => (
                      <div className="identity-cell">
                        <span className="identity-title">{row.title}</span>
                        <span className="identity-meta">{row.manufacturerName}</span>
                      </div>
                    ),
                  },
                  { key: "support", label: "Support", render: (row) => row.supportEmail || "Pending" },
                  {
                    key: "status",
                    label: "Status",
                    render: (row) => <StatusBadge tone={resolveRmaStatusTone(row.status)}>{row.status}</StatusBadge>,
                  },
                  { key: "assets", label: "Assets", align: "right", render: (row) => row.assetCount },
                ]}
                emptyMessage="No repair cases yet."
                onRowClick={(row) => {
                  setActiveRmaCaseId(row.id);
                  setRmaEditorMode(null);
                  setRmaEditorError(null);
                }}
                rows={rmaSnapshot.cases}
              />
            </SurfaceCard>

            {rmaEditorMode ? (
              <RmaCaseEditorPanel
                key={`${rmaEditorMode}-${rmaDetail.caseRecord?.id ?? "new"}`}
                availableAssets={availableRmaAssets}
                error={rmaEditorError}
                initialValue={rmaEditorMode === "edit" ? rmaDetail : null}
                isSubmitting={isSubmittingRma}
                manufacturers={rmaSnapshot.manufacturers}
                mode={rmaEditorMode}
                onClose={() => {
                  setRmaEditorMode(null);
                  setRmaEditorError(null);
                }}
                onOpenCatalog={() => navigate("/catalog")}
                onSubmit={handleSubmitRma}
              />
            ) : (
              <SurfaceCard
                aside={
                  rmaDetail.caseRecord ? (
                    <div className="surface-card-actions">
                      <button
                        className="ghost-control"
                        onClick={() => {
                          setRmaEditorMode("edit");
                          setRmaEditorError(null);
                        }}
                        type="button"
                      >
                        <SquarePen size={14} />
                        <span>Edit</span>
                      </button>
                      <button
                        className="ghost-control"
                        disabled={!rmaDetail.caseRecord.supportEmail}
                        onClick={() => {
                          const url = buildRmaMailtoUrl(rmaDetail);
                          if (url) {
                            void window.bukowskiApp?.openExternal(url);
                          }
                        }}
                        type="button"
                      >
                        <Mail size={14} />
                        <span>Open draft email</span>
                      </button>
                    </div>
                  ) : null
                }
                title={rmaDetail.caseRecord ? rmaDetail.caseRecord.title : "Repair details"}
              >
                {rmaDetailError ? <div className="action-feedback action-feedback-error">{rmaDetailError}</div> : null}
                {rmaEditorError && !rmaEditorMode ? <div className="action-feedback action-feedback-error">{rmaEditorError}</div> : null}
                {!rmaDetail.caseRecord && !rmaDetailLoading ? <div className="empty-state">No repair case selected.</div> : null}

                {rmaDetail.caseRecord ? (
                  <div className="page-stack">
                    <div className="summary-grid compact-summary-grid">
                      <div className="summary-row">
                        <span className="summary-label">Manufacturer</span>
                        <span className="summary-value">{rmaDetail.caseRecord.manufacturerName}</span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">Support email</span>
                        <span className="summary-value">{rmaDetail.caseRecord.supportEmail || "Pending"}</span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">Contact</span>
                        <span className="summary-value">{rmaDetail.caseRecord.contactName || "Pending"}</span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">Phone</span>
                        <span className="summary-value">{rmaDetail.caseRecord.phone || "Pending"}</span>
                      </div>
                    </div>

                    <div className="chip-row">
                      <StatusBadge tone={resolveRmaStatusTone(rmaDetail.caseRecord.status)}>{rmaDetail.caseRecord.status}</StatusBadge>
                      {rmaStatusActions
                        .filter((action) => action.status !== rmaDetail.caseRecord?.status)
                        .map((action) => (
                          <button
                            key={action.status}
                            className={action.status === "No repair / retired" ? "ghost-control is-danger" : "ghost-control"}
                            disabled={isSubmittingRma}
                            onClick={() => void handleUpdateRmaStatus(action.status)}
                            type="button"
                          >
                            {action.label}
                          </button>
                        ))}
                    </div>

                    <div className="summary-row">
                      <span className="summary-label">Problem summary</span>
                      <span className="summary-value">{rmaDetail.caseRecord.problemSummary}</span>
                    </div>

                    {rmaDetail.caseRecord.notes ? (
                      <div className="summary-row">
                        <span className="summary-label">Internal notes</span>
                        <span className="summary-value">{rmaDetail.caseRecord.notes}</span>
                      </div>
                    ) : null}

                    <DataTable
                      columns={[
                        {
                          key: "asset",
                          label: "Asset",
                          render: (row) => (
                            <div className="identity-cell">
                              <span className="identity-title">{row.assetName}</span>
                              <span className="identity-meta">{[row.brand, row.model].filter(Boolean).join(" · ") || "Model pending"}</span>
                            </div>
                          ),
                        },
                        { key: "serial", label: "Serial", render: (row) => row.serialNumber || "Pending" },
                        { key: "year", label: "Year", render: (row) => row.equipmentYear || "Pending" },
                        { key: "issue", label: "Issue", render: (row) => row.issueSummary },
                      ]}
                      maxHeight="min(34vh, 300px)"
                      persistKey="rma-case-assets"
                      rows={rmaDetail.assets}
                    />
                  </div>
                ) : null}
              </SurfaceCard>
            )}
          </ResizableSideRailLayout>
        </>
      ) : null}
    </div>
  );
};
