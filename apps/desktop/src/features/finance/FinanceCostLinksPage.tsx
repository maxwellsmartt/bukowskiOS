import { useState } from "react";

import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";

import { useFinanceCostLinks } from "./useFinanceData";

export const FinanceCostLinksPage = () => {
  const { data, error } = useFinanceCostLinks();
  const sectionScopeLabel = useSectionScopeLabel();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Finance / Cost links"
        title="Cost links"
        body="Incident cost, replacement risk and current finance status tied back to operations."
        contextLabel={sectionScopeLabel}
      />

      {error ? <div className="empty-state">Cost links unavailable: {error}</div> : null}

      <SurfaceCard title="Linked cost register" subtitle="Operational incidents become financially legible here without duplicating domain ownership.">
        <DataTable
          getRowId={(row) => `${row.incident}-${row.asset}`}
          maxHeight="min(60vh, 640px)"
          persistKey="finance-cost-links"
          columns={[
            {
              key: "incident",
              label: "Incident",
              render: (row) => (
                <div className="identity-cell">
                  <span className="identity-title">{row.incident}</span>
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
            { key: "estimate", label: "Estimate", render: (row) => row.costEstimate },
            { key: "replacement", label: "Replacement", render: (row) => row.replacementValue },
            { key: "status", label: "Finance status", render: (row) => row.financialStatus },
          ]}
          rows={data}
          selectable
          selectedRowIds={selectedRowIds}
          onSelectedRowIdsChange={setSelectedRowIds}
        />
      </SurfaceCard>
    </div>
  );
};
