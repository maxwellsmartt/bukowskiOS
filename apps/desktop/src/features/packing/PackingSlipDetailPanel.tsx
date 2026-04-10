import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import type { PackingSlipDetailSnapshot } from "@contracts";
import { DataTable } from "@shared/components/DataTable";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

type PackingSlipDetailPanelProps = {
  data: PackingSlipDetailSnapshot;
  error: string | null;
  isLoading: boolean;
  isSubmittingReturn: boolean;
  onReturnItems: (assetIds: string[], conditionIn?: string, notes?: string) => Promise<void>;
};

const conditionOptions = ["Good", "Review", "Damaged"] as const;

export const PackingSlipDetailPanel = ({
  data,
  error,
  isLoading,
  isSubmittingReturn,
  onReturnItems,
}: PackingSlipDetailPanelProps) => {
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [conditionIn, setConditionIn] = useState("Good");
  const [notes, setNotes] = useState("");
  const pendingAssetIds = useMemo(
    () => data.items.filter((item) => item.status === "Out").map((item) => item.assetId),
    [data.items],
  );

  if (isLoading) {
    return (
      <SurfaceCard title="Packing detail" subtitle="Loading selected slip...">
        <div className="empty-state">Preparing local packing detail...</div>
      </SurfaceCard>
    );
  }

  if (error) {
    return (
      <SurfaceCard title="Packing detail" subtitle={`Packing detail unavailable: ${error}`}>
        <div className="empty-state">Review the local document state and retry the action.</div>
      </SurfaceCard>
    );
  }

  if (!data.slip) {
    return (
      <SurfaceCard title="Packing detail" subtitle="Select a slip to inspect outgoing items, returns and document context.">
        <div className="empty-state">Choose a packing slip from the registry to inspect its document state.</div>
      </SurfaceCard>
    );
  }

  const selectedPendingAssetIds = pendingAssetIds.filter((assetId) => selectedItemIds.includes(assetId));
  const returnLabel = selectedPendingAssetIds.length
    ? `Return ${selectedPendingAssetIds.length} selected`
    : `Return all pending (${pendingAssetIds.length})`;

  return (
    <SurfaceCard
      title={data.slip.number}
      subtitle="Document detail with outgoing items, return status and quick return controls."
      aside={<StatusBadge tone={data.slip.status === "Overdue" ? "critical" : data.slip.status === "Closed" ? "success" : "info"}>{data.slip.status}</StatusBadge>}
    >
      <div className="summary-grid">
        <div className="summary-row">
          <span className="summary-label">Project</span>
          <span className="summary-value">{data.slip.project}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Responsible</span>
          <span className="summary-value">{data.slip.responsible}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Prepared by</span>
          <span className="summary-value">{data.slip.preparedBy}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Issued / due</span>
          <span className="summary-value">
            {data.slip.issueDate} · {data.slip.dueDate}
          </span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Items</span>
          <span className="summary-value">
            {data.slip.returnedCount} returned · {data.slip.pendingCount} pending
          </span>
        </div>
        <div className="summary-row">
          <span className="summary-label">QR ready</span>
          <span className="summary-value">{data.slip.primaryCodeValue}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Notes</span>
          <span className="summary-value">{data.slip.notes}</span>
        </div>
      </div>

      <div className="action-form-grid">
        <label className="action-field">
          <span className="action-field-label">Condition in</span>
          <SelectField onChange={(event) => setConditionIn(event.target.value)} value={conditionIn}>
            {conditionOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">Return note</span>
          <input
            className="action-field-control"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional note for the return event."
            value={notes}
          />
        </label>
      </div>

      <div className="action-panel-actions action-panel-actions-inline">
        <button
          className="action-primary-button"
          disabled={isSubmittingReturn || !pendingAssetIds.length}
          onClick={() => void onReturnItems(selectedPendingAssetIds.length ? selectedPendingAssetIds : pendingAssetIds, conditionIn, notes)}
          type="button"
        >
          <RotateCcw size={14} />
          <span>{isSubmittingReturn ? "Returning..." : returnLabel}</span>
        </button>
      </div>

      <DataTable
        getRowId={(row) => row.assetId}
        maxHeight="min(56vh, 620px)"
        persistKey="packing-slip-detail-items"
        columns={[
          {
            key: "asset",
            label: "Asset",
            width: 240,
            minWidth: 180,
            render: (row) => (
              <div className="identity-cell">
                <span className="identity-title">{row.asset}</span>
                <span className="identity-meta">{row.code}</span>
              </div>
            ),
          },
          { key: "quantity", label: "Qty", align: "right", width: 72, minWidth: 60, render: (row) => row.quantity },
          { key: "conditionOut", label: "Condition out", width: 116, minWidth: 100, render: (row) => row.conditionOut },
          { key: "conditionIn", label: "Condition in", width: 116, minWidth: 100, render: (row) => row.conditionIn },
          { key: "location", label: "Location", width: 170, minWidth: 136, render: (row) => row.location },
          { key: "responsible", label: "Responsible", width: 150, minWidth: 124, render: (row) => row.responsible },
          {
            key: "status",
            label: "Status",
            width: 100,
            minWidth: 88,
            render: (row) => (
              <StatusBadge tone={row.status === "Returned" ? "success" : "info"}>{row.status}</StatusBadge>
            ),
          },
          { key: "returnedAt", label: "Returned at", width: 140, minWidth: 120, render: (row) => row.returnedAt },
        ]}
        rows={data.items}
        selectable
        selectedRowIds={selectedItemIds}
        onSelectedRowIdsChange={setSelectedItemIds}
      />
    </SurfaceCard>
  );
};
