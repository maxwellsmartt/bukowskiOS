import { useMemo, useState } from "react";
import { Plus, SquarePen, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useCompareTray } from "@app/providers/CompareTrayContext";
import { PackingSlipBuilderPanel, type PackingSlipBuilderDraft } from "@features/packing/PackingSlipBuilderPanel";
import { createPackingSlip } from "@features/packing/usePackingData";
import { useCatalogData } from "@features/projects/useProjectsData";
import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";
import { uiPreferenceKeys, writePreference } from "@shared/lib/preferences";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";

import { AssetAssignMovePanel, type AssetAssignMoveFormValue } from "./AssetAssignMovePanel";
import { AssetEditorPanel, type AssetEditorDraft } from "./AssetEditorPanel";
import { archiveAsset, assignMoveAssets, createAsset, updateAsset, useAssetDetail, useAssetsList } from "./useAssetsData";

type AssetsPageProps = {
  projectId?: string | null;
  projectName?: string | null;
};

export const AssetsPage = ({ projectId = null, projectName = null }: AssetsPageProps) => (
  <AssetsContent projectId={projectId} projectName={projectName} />
);

const AssetsContent = ({ projectId, projectName }: AssetsPageProps) => {
  const { activeProject, projects, refreshProjects } = useShellContext();
  const { addItems, hasItem } = useCompareTray();
  const isProjectMode = Boolean(projectId);
  const effectiveProjectName = projectName ?? (isProjectMode ? activeProject?.name ?? null : null);
  const sectionScopeLabel = useSectionScopeLabel();
  const { data: assets, error, isLoading, reload } = useAssetsList(projectId);
  const { data: catalog, error: catalogError } = useCatalogData();
  const navigate = useNavigate();
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [actionPanelOpen, setActionPanelOpen] = useState(false);
  const [packingPanelOpen, setPackingPanelOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [packingError, setPackingError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [isSubmittingPacking, setIsSubmittingPacking] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isSubmittingEditor, setIsSubmittingEditor] = useState(false);
  const [isArchivingAsset, setIsArchivingAsset] = useState(false);

  const editorAssetId = editorMode === "edit" ? selectedAssetId ?? undefined : undefined;
  const { data: editorDetail, reload: reloadEditorDetail } = useAssetDetail(editorAssetId);

  const activeAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );

  const handleAssignMove = async (formValue: AssetAssignMoveFormValue) => {
    try {
      setIsSubmittingAction(true);
      const result = await assignMoveAssets({
        commandId: crypto.randomUUID(),
        workspaceId: "workspace-metadata",
        assetIds: selectedRowIds,
        mode: formValue.mode,
        projectId: formValue.projectId,
        projectUnitId: formValue.projectUnitId,
        departmentId: formValue.departmentId,
        assignedToUserId: formValue.assignedToUserId,
        targetLocationId: formValue.targetLocationId,
        expectedReturnAt: formValue.expectedReturnAt ? new Date(formValue.expectedReturnAt).toISOString() : undefined,
        notes: formValue.notes,
        actorType: "user",
        sourceChannel: "desktop",
      });

      await Promise.all([reload(), refreshProjects()]);
      setActionError(null);
      setActionFeedback(result.summary);
      setActionPanelOpen(false);
      setSelectedRowIds([]);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "Unable to apply assign or move.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleCreatePackingSlip = async (formValue: PackingSlipBuilderDraft) => {
    try {
      setIsSubmittingPacking(true);
      const result = await createPackingSlip({
        commandId: crypto.randomUUID(),
        workspaceId: "workspace-metadata",
        assetIds: selectedRowIds,
        projectId: formValue.projectId,
        projectUnitId: formValue.projectUnitId,
        departmentId: formValue.departmentId,
        responsibleUserId: formValue.responsibleUserId,
        returnDueAt: formValue.returnDueAt ? new Date(formValue.returnDueAt).toISOString() : undefined,
        notes: formValue.notes,
        actorType: "user",
        sourceChannel: "desktop",
      });

      await Promise.all([reload(), refreshProjects()]);
      writePreference(uiPreferenceKeys.activePackingSlipId, result.packingSlipId);
      setPackingError(null);
      setActionFeedback(result.summary);
      setPackingPanelOpen(false);
      setSelectedRowIds([]);
      navigate("/packing-slips");
    } catch (nextError) {
      setPackingError(nextError instanceof Error ? nextError.message : "Unable to issue packing slip.");
    } finally {
      setIsSubmittingPacking(false);
    }
  };

  const handleSubmitAssetEditor = async (formValue: AssetEditorDraft) => {
    try {
      setIsSubmittingEditor(true);

      if (editorMode === "edit" && editorAssetId) {
        const result = await updateAsset({
          commandId: crypto.randomUUID(),
          workspaceId: "workspace-metadata",
          assetId: editorAssetId,
          actorType: "user",
          sourceChannel: "desktop",
          isActive: true,
          ...formValue,
        });

        await Promise.all([reload(), refreshProjects(), reloadEditorDetail()]);
        setActionFeedback(result.summary);
      } else {
        const result = await createAsset({
          commandId: crypto.randomUUID(),
          workspaceId: "workspace-metadata",
          actorType: "user",
          sourceChannel: "desktop",
          isActive: true,
          ...formValue,
        });

        await Promise.all([reload(), refreshProjects()]);
        setSelectedAssetId(result.assetId);
        setActionFeedback(result.summary);
      }

      setEditorError(null);
      setEditorMode(null);
    } catch (nextError) {
      setEditorError(nextError instanceof Error ? nextError.message : "Unable to save asset changes.");
    } finally {
      setIsSubmittingEditor(false);
    }
  };

  const handleArchiveAsset = async () => {
    if (!editorAssetId) {
      return;
    }

    try {
      setIsArchivingAsset(true);
      const result = await archiveAsset({
        commandId: crypto.randomUUID(),
        workspaceId: "workspace-metadata",
        assetId: editorAssetId,
        actorType: "user",
        sourceChannel: "desktop",
      });

      await Promise.all([reload(), refreshProjects()]);
      setEditorMode(null);
      setSelectedAssetId(null);
      setEditorError(null);
      setActionFeedback(result.summary);
    } catch (nextError) {
      setEditorError(nextError instanceof Error ? nextError.message : "Unable to archive asset.");
    } finally {
      setIsArchivingAsset(false);
    }
  };

  const assetColumns = useMemo(
    () => [
      {
        key: "asset",
        label: "Asset",
        width: 280,
        minWidth: 220,
        render: (row: (typeof assets)[number]) => (
          <div className="identity-cell">
            <span className="identity-title">{row.name}</span>
            <span className="identity-meta">{row.code}</span>
          </div>
        ),
      },
      { key: "category", label: "Category", width: 160, minWidth: 132, render: (row: (typeof assets)[number]) => row.category },
      { key: "quantity", label: "Qty", align: "right" as const, width: 72, minWidth: 60, render: (row: (typeof assets)[number]) => row.quantity },
      { key: "tracking", label: "Tracking", width: 110, minWidth: 96, render: (row: (typeof assets)[number]) => row.tracking },
      { key: "status", label: "Status", width: 112, minWidth: 96, render: (row: (typeof assets)[number]) => row.status },
      { key: "condition", label: "Condition", width: 112, minWidth: 96, render: (row: (typeof assets)[number]) => row.condition },
      { key: "custody", label: "Custody", width: 112, minWidth: 96, render: (row: (typeof assets)[number]) => row.custody },
      { key: "location", label: "Location", width: 190, minWidth: 150, render: (row: (typeof assets)[number]) => row.location },
      { key: "project", label: "Project", width: 170, minWidth: 140, render: (row: (typeof assets)[number]) => row.project },
      { key: "projectUnit", label: "Unit", width: 150, minWidth: 124, render: (row: (typeof assets)[number]) => row.projectUnit },
      { key: "responsible", label: "Responsible", width: 160, minWidth: 132, render: (row: (typeof assets)[number]) => row.responsible },
      { key: "serialNumber", label: "Serial", width: 150, minWidth: 120, render: (row: (typeof assets)[number]) => row.serialNumber },
      { key: "qrCode", label: "QR", width: 130, minWidth: 108, render: (row: (typeof assets)[number]) => row.qrCode },
      { key: "warehouseSlot", label: "Warehouse", width: 126, minWidth: 108, render: (row: (typeof assets)[number]) => row.warehouseSlot },
      { key: "folderPath", label: "Folder path", width: 250, minWidth: 200, render: (row: (typeof assets)[number]) => row.folderPath },
      { key: "hasAccessories", label: "Accessories", width: 110, minWidth: 96, render: (row: (typeof assets)[number]) => row.hasAccessories },
      { key: "source", label: "Source", width: 176, minWidth: 150, render: (row: (typeof assets)[number]) => row.source },
      { key: "incidents", label: "Open issues", align: "right" as const, width: 96, minWidth: 84, render: (row: (typeof assets)[number]) => row.incidentsOpen },
    ],
    [assets],
  );

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow={isProjectMode ? "Project / Assets" : "Assets"}
        title={isProjectMode ? "Assigned assets" : "Inventory"}
        body={
          isProjectMode
            ? "Assets currently linked to this project, ready for supervision, reassignment, packing and issue reporting."
            : "Live asset registry with current state, quantity, storage context and operational readiness in one pass."
        }
        contextLabel={sectionScopeLabel}
      />

      {error ? <div className="empty-state">Assets unavailable: {error}</div> : null}
      {!error && isLoading ? <div className="empty-state">Loading asset registry...</div> : null}

      <div className="chip-row">
        <StatusBadge tone="info">Live registry</StatusBadge>
        <StatusBadge tone="warning">Legacy import</StatusBadge>
        <StatusBadge tone="critical">Open issues</StatusBadge>
        <StatusBadge tone="success">{assets.filter((asset) => hasItem("asset", asset.id)).length} in compare</StatusBadge>
        <StatusBadge>
          {selectedRowIds.length
            ? `${selectedRowIds.length} selected`
            : isProjectMode
              ? effectiveProjectName ?? "Project scope"
              : "Workspace-wide"}
        </StatusBadge>
      </div>

      {catalogError ? <div className="action-feedback action-feedback-error">Catalog unavailable: {catalogError}</div> : null}
      {actionFeedback ? <div className="action-feedback action-feedback-success">{actionFeedback}</div> : null}

      {selectedRowIds.length ? (
        <div className="selection-action-bar">
          <div className="selection-action-copy">
            <span className="selection-action-title">
              {selectedRowIds.length === 1 ? "1 asset selected" : `${selectedRowIds.length} assets selected`}
            </span>
            <span className="selection-action-subtitle">
              {isProjectMode
                ? "Operate on the assets already assigned to this project or move them to a new destination."
                : "Assign, move or issue a packing slip from the current selection."}
            </span>
          </div>
          <div className="selection-action-buttons">
            <button
              className="ghost-control"
              onClick={() =>
                addItems(
                  assets
                    .filter((asset) => selectedRowIds.includes(asset.id))
                    .map((asset) => ({
                      id: asset.id,
                      entityType: "asset" as const,
                      label: `${asset.code} · ${asset.name}`,
                      subtitle: `${asset.location} · ${asset.project}`,
                      meta: asset.projectUnit && asset.projectUnit !== "—" ? `Unit · ${asset.projectUnit}` : undefined,
                    })),
                )
              }
              type="button"
            >
              Add to compare
            </button>
            <button
              className="ghost-control"
              onClick={() => {
                setPackingPanelOpen(true);
                setActionPanelOpen(false);
                setPackingError(null);
                setActionFeedback(null);
              }}
              type="button"
            >
              Create packing slip
            </button>
            <button
              className="action-primary-button"
              onClick={() => {
                setActionPanelOpen(true);
                setPackingPanelOpen(false);
                setActionFeedback(null);
              }}
              type="button"
            >
              Assign / move selected
            </button>
          </div>
        </div>
      ) : null}

      {actionPanelOpen && selectedRowIds.length ? (
        <AssetAssignMovePanel
          defaultProjectId={isProjectMode ? projectId ?? null : null}
          departments={catalog.departments}
          error={actionError}
          isSubmitting={isSubmittingAction}
          locations={catalog.locations}
          onClose={() => {
            setActionPanelOpen(false);
            setActionError(null);
          }}
          onSubmit={handleAssignMove}
          projects={projects}
          selectedCount={selectedRowIds.length}
          users={catalog.users}
        />
      ) : null}

      {packingPanelOpen && selectedRowIds.length ? (
        <PackingSlipBuilderPanel
          defaultProjectId={isProjectMode ? projectId ?? null : null}
          departments={catalog.departments}
          error={packingError}
          isSubmitting={isSubmittingPacking}
          onClose={() => {
            setPackingPanelOpen(false);
            setPackingError(null);
          }}
          onSubmit={handleCreatePackingSlip}
          projects={projects}
          selectedCount={selectedRowIds.length}
          users={catalog.users}
        />
      ) : null}

      {editorMode ? (
        <AssetEditorPanel
          key={`${editorMode}-${editorAssetId ?? "new"}-${editorDetail.editor?.id ?? "empty"}`}
          categories={catalog.categories}
          error={editorError}
          initialValue={editorMode === "edit" ? editorDetail.editor : null}
          isArchiving={isArchivingAsset}
          isSubmitting={isSubmittingEditor}
          locations={catalog.locations}
          mode={editorMode}
          onArchive={editorMode === "edit" ? handleArchiveAsset : undefined}
          onClose={() => {
            setEditorMode(null);
            setEditorError(null);
          }}
          onSubmit={handleSubmitAssetEditor}
        />
      ) : null}

      <div className={`list-layout${activeAsset ? " has-preview" : ""}`}>
        <SurfaceCard
          title="Asset registry"
          subtitle={
            isProjectMode
              ? "Single click previews. Double click opens detail. This view is scoped to the current project only."
              : "Single click previews. Double click opens detail. Resize columns and select rows for future bulk actions."
          }
          aside={
            <button
              className="ghost-control"
              onClick={() => {
                setEditorMode("create");
                setEditorError(null);
              }}
              type="button"
            >
              <Plus size={14} />
              <span>New asset</span>
            </button>
          }
        >
          <DataTable
            activeRowId={selectedAssetId}
            columns={assetColumns}
            getRowId={(row) => row.id}
            maxHeight="min(66vh, 720px)"
            onRowClick={(row) => setSelectedAssetId(row.id)}
            onRowDoubleClick={(row) => navigate(`/assets/${row.id}`)}
            persistKey="assets-registry"
            rows={assets}
            selectable
            selectedRowIds={selectedRowIds}
            onSelectedRowIdsChange={setSelectedRowIds}
          />
        </SurfaceCard>

        {activeAsset ? (
          <SurfaceCard
            aside={
              <button
                aria-label="Close quick preview"
                className="surface-card-action"
                onClick={() => setSelectedAssetId(null)}
                type="button"
              >
                <X size={14} />
              </button>
            }
            title="Quick preview"
            subtitle="Fast read of the selected asset before opening full detail."
          >
            <>
              <div className="summary-grid">
                <div className="summary-row">
                  <span className="summary-label">Current asset</span>
                  <span className="summary-value">{activeAsset.name}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Registry code</span>
                  <span className="summary-value">{activeAsset.code}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Quantity</span>
                  <span className="summary-value">
                    {activeAsset.quantity} · {activeAsset.tracking}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Location</span>
                  <span className="summary-value">{activeAsset.location}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Project / responsible</span>
                  <span className="summary-value">
                    {activeAsset.project} · {activeAsset.responsible}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Serial / QR</span>
                  <span className="summary-value">
                    {activeAsset.serialNumber} · {activeAsset.qrCode}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Warehouse / folder</span>
                  <span className="summary-value">
                    {activeAsset.warehouseSlot} · {activeAsset.folderPath}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Condition / custody</span>
                  <span className="summary-value">
                    {activeAsset.condition} · {activeAsset.custody}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Source / accessories</span>
                  <span className="summary-value">
                    {activeAsset.source} · {activeAsset.hasAccessories}
                  </span>
                </div>
              </div>

              <div className="chip-row">
                <StatusBadge tone="info">Double click to open detail</StatusBadge>
                <StatusBadge tone="success">QR ready</StatusBadge>
                <StatusBadge tone="warning">Assignment flow next</StatusBadge>
              </div>

              <div className="action-panel-actions action-panel-actions-start">
                <button
                  className="ghost-control"
                  onClick={() => {
                    setEditorMode("edit");
                    setEditorError(null);
                  }}
                  type="button"
                >
                  <SquarePen size={14} />
                  <span>Edit asset</span>
                </button>
                <button className="action-primary-button" onClick={() => navigate(`/assets/${activeAsset.id}`)} type="button">
                  Open detail
                </button>
              </div>
            </>
          </SurfaceCard>
        ) : null}
      </div>
    </div>
  );
};
