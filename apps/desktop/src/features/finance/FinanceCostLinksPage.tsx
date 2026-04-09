import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { financeCostLinks } from "@shared/lib/sample-data";

export const FinanceCostLinksPage = () => (
  <div className="page-stack">
    <SectionHeader
      eyebrow="Finance / Cost links"
      title="Linked incidents and assets with immediate economic context"
      body="This table exists to feel structurally useful from v1, even before invoicing, taxes or bank workflows exist."
    />

    <SurfaceCard title="Linked cost register" subtitle="Operational incidents become financially legible here without duplicating domain ownership.">
      <DataTable
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
        rows={financeCostLinks}
      />
    </SurfaceCard>
  </div>
);
