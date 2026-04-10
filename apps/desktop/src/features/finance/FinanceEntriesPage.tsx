import { useState } from "react";

import { useCompareTray } from "@app/providers/CompareTrayContext";
import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";

import { useFinanceEntries } from "./useFinanceData";

export const FinanceEntriesPage = () => {
  const { data, error } = useFinanceEntries();
  const { addItems, hasItem } = useCompareTray();
  const sectionScopeLabel = useSectionScopeLabel();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Finance / Entries"
        title="Entries"
        body="Linked reserves and exposure entries created from operational events."
        contextLabel={sectionScopeLabel}
      />

      {error ? <div className="empty-state">Entries unavailable: {error}</div> : null}

      <div className="chip-row">
        <StatusBadge tone="info">Operational finance hooks</StatusBadge>
        <StatusBadge tone="success">{data.filter((entry) => hasItem("financial_entry", entry.id)).length} in compare</StatusBadge>
        <StatusBadge>{selectedRowIds.length ? `${selectedRowIds.length} selected` : "Workspace-wide finance shell"}</StatusBadge>
      </div>

      {selectedRowIds.length ? (
        <div className="selection-action-bar">
          <div className="selection-action-copy">
            <span className="selection-action-title">
              {selectedRowIds.length === 1 ? "1 finance entry selected" : `${selectedRowIds.length} finance entries selected`}
            </span>
            <span className="selection-action-subtitle">
              Keep cost-bearing entries in the compare tray for future exposure and reserve comparisons.
            </span>
          </div>
          <div className="selection-action-buttons">
            <button
              className="ghost-control"
              onClick={() =>
                addItems(
                  data
                    .filter((entry) => selectedRowIds.includes(entry.id))
                    .map((entry) => ({
                      id: entry.id,
                      entityType: "financial_entry" as const,
                      label: `${entry.reference} · ${entry.amount}`,
                      subtitle: `${entry.category} · ${entry.project}`,
                      meta: entry.type,
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

      <SurfaceCard title="Entry register" subtitle="Current financial entries linked to projects, assets and incidents.">
        <DataTable
          getRowId={(row) => row.id}
          maxHeight="min(56vh, 620px)"
          persistKey="finance-entries"
          columns={[
            { key: "date", label: "Date", render: (row) => row.date },
            { key: "type", label: "Type", render: (row) => row.type },
            { key: "category", label: "Category", render: (row) => row.category },
            { key: "reference", label: "Reference", render: (row) => row.reference },
            { key: "project", label: "Project", render: (row) => row.project },
            { key: "amount", label: "Amount", align: "right", render: (row) => row.amount },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <StatusBadge tone={row.status === "Draft" ? "warning" : "info"}>{row.status}</StatusBadge>
              ),
            },
          ]}
          rows={data}
          selectable
          selectedRowIds={selectedRowIds}
          onSelectedRowIdsChange={setSelectedRowIds}
        />

        <div className="empty-state">
          <strong>Shell readiness</strong>
          <span>Incident reserves, replacement exposure, collaborator fee hooks and future ledger workflows.</span>
        </div>
      </SurfaceCard>
    </div>
  );
};
