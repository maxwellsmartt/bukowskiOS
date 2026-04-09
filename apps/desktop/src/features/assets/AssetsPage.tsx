import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useCatalogData } from "@features/projects/useProjectsData";
import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";

import { AssetAssignMovePanel, type AssetAssignMoveFormValue } from "./AssetAssignMovePanel";
import { assignMoveAssets, useAssetsList } from "./useAssetsData";

export const AssetsPage = () => <AssetsContent />;

const AssetsContent = () => {
  const { activeProjectId, projects, refreshProjects } = useShellContext();
  const { data: assets, error, isLoading, reload } = useAssetsList();
  const { data: catalog, error: catalogError } = useCatalogData();
  const navigate = useNavigate();
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [actionPanelOpen, setActionPanelOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

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
        eyebrow="Assets"
        title="Inventory"
        body="Legacy inventory mounted into the live registry with status, quantity and storage context."
      />

      {error ? <div className="empty-state">Assets unavailable: {error}</div> : null}
      {!error && isLoading ? <div className="empty-state">Loading asset registry...</div> : null}

      <div className="chip-row">
        <StatusBadge tone="info">Live registry</StatusBadge>
        <StatusBadge tone="warning">Legacy import</StatusBadge>
        <StatusBadge tone="critical">Open issues</StatusBadge>
        <StatusBadge>{selectedRowIds.length ? `${selectedRowIds.length} selected` : "Metadata Cine"}</StatusBadge>
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
              Use the first real command pipeline to assign or move the current selection.
            </span>
          </div>
          <button
            className="action-primary-button"
            onClick={() => {
              setActionPanelOpen(true);
              setActionFeedback(null);
            }}
            type="button"
          >
            Assign / move selected
          </button>
        </div>
      ) : null}

      {actionPanelOpen && selectedRowIds.length ? (
        <AssetAssignMovePanel
          defaultProjectId={activeProjectId}
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

      <div className={`list-layout${activeAsset ? " has-preview" : ""}`}>
        <SurfaceCard
          title="Asset registry"
          subtitle="Single click previews. Double click opens detail. Resize columns and select rows for future bulk actions."
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
                <StatusBadge tone="warning">Assignment flow next</StatusBadge>
              </div>
            </>
          </SurfaceCard>
        ) : null}
      </div>
    </div>
  );
};
