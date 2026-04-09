import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { incidents } from "@shared/lib/sample-data";

export const IncidentsPage = () => (
  <div className="page-stack">
    <SectionHeader
      eyebrow="Incident reporting"
      title="Fast field capture, supervisor visibility and cost-awareness hooks"
      body="The reporting surface must stay short enough for technicians, but rich enough for supervisors to understand traceability and financial exposure."
    />

    <SurfaceCard title="Incident queue" subtitle="Severity, assignment context and estimated cost stay readable without building an ERP-style wall of columns.">
      <DataTable
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
            render: (row) => <StatusBadge tone={row.status === "Open" ? "warning" : "info"}>{row.status}</StatusBadge>,
          },
        ]}
        rows={incidents}
      />
    </SurfaceCard>
  </div>
);
